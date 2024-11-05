import { inflate } from "zlib";
import { InfoError } from "../../utility/info-error";
import { addDelay, textToMs } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { setInputValue, waitForElementInterval } from "../../utility/ui-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import GeneralInfo from "../master/ui/general-info";
import ResourceManager from "../resources/resource-manager";
import recruiterDialogHTML from "./recruiter-prod.html";
import recruiterDialogCSS from "./recruiter.css";

type UnitContext = {
  unitImageClass: string;
  unitSelector: string;
  emptySlotCount: number;
  unitInfo: {
    wood: number;
    stone: number;
    iron: number;
    population: number;
    recruitmentTime: number;
  }
  requiredResourcesPerSlot: {
    wood: number;
    stone: number;
    iron: number;
    population: number;
  };
  storeCapacity: number;
  populationCapacity: number;
}

type RequiredResourcesInfo = {
  woodAmountNeeded: number;
  irodAmountNeeded: number;
  stoneAmountNeeded: number;
}

type RecruitmentQueueItem = {
  unitContextInfo: UnitContext;
  amountType: 'units' | 'slots';
  slotsAmount?: number;
  unitsAmount?: number;
  slotsLeft?: number;
  unitsLeft?: number;
}

type RecruitmentSchedule = {
  city: CityInfo;
  suppliersCities: CityInfo[];
  queueItems: RecruitmentQueueItem[];
  timeoutId: NodeJS.Timeout | null;
  nextScheduledTime: number;
  runningItemIndex: number | null;
}

export default class Recruiter {
  private static instance: Recruiter;
  private resourceManager!: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;

  private RUN: boolean = false;
  private observer: MutationObserver | null = null;

  private currentUnitContext: UnitContext | null = null;
  private recruitmentSchedule: RecruitmentSchedule[] = [];

  private constructor() { };

  public static async getInstance() {
    if (!Recruiter.instance) {
      Recruiter.instance = new Recruiter();
      Recruiter.instance.addCSS();
      Recruiter.instance.resourceManager = await ResourceManager.getInstance();
      Recruiter.instance.lock = Lock.getInstance();
      Recruiter.instance.citySwitchManager = await CitySwitchManager.getInstance();
    }
    return Recruiter.instance;
  }
  private addCSS() {
    const style = document.createElement('style');
    style.textContent = recruiterDialogCSS;
    document.head.appendChild(style);
  }

  public async start() {
    this.RUN = true;
    if (!this.observer) {
      this.observer = this.mountObserver();
    }
  }

  public async stop() {
    this.RUN = false;
    this.observer?.disconnect();
    this.observer = null;
  }

  public isRunning() {
    return this.RUN;
  }

  private mountObserver(): MutationObserver {
    const checkAsyncCondition = async (node: Node) => {
      if (node instanceof HTMLElement
        && node.getAttribute('role') === 'dialog'
        && await waitForElementInterval('.barracks_building', { fromNode: node, interval: 500, retries: 3 }).catch(() => false)) {
        this.extendUI(node);
      }
    }

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            checkAsyncCondition(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
    return observer;
  }

  /**
   * 1. Metoda dodaje przycisk recruiter w prawym górnym rogu
   * 2. Po przyciśnięciu pojawia sie okno dialogowe
   * 3. W oknie są do wypełnienia następujące inputy:
   *    -ile slotów jednostki produkować (liczba | 'max') lub ilość jednostek
   *    -lista miast z jakich można pobierać surowce
   *    -przycisk `submit`
   * 4. Po wciśnięciu submit inna metoda zajmuje się implementacją działania
   * 5. Okno dialogowe pokazuje obecną kolejkę przypisaną do miasta wraz z czasami rekrutacji
   * 6. Przycisk anuluj, który kasuje (na tą chwilę) całość zaplanowanych operacji i elementy w kolejce
   * 
   * @param node 
   */
  private extendUI(node: HTMLElement) {
    const recruiterDialogContainer = document.createElement('div');
    recruiterDialogContainer.id = 'recruiter-container';
    recruiterDialogContainer.innerHTML = recruiterDialogHTML;
    node.querySelector('#unit_order')?.appendChild(recruiterDialogContainer);
    this.addEntryEventListener(node);
    this.mountUnitChangeObserver();
  }

  private addEntryEventListener(node: HTMLElement) {
    const recruiterOpenBtn = document.getElementById('recruiter-btn');
    const recruiterDialog = document.getElementById('recruiter-dialog');
    let areListenersAttached = false;
    recruiterOpenBtn?.addEventListener('click', async () => {
      if (recruiterDialog!.hidden) {
        recruiterDialog!.hidden = false;
        await this.setCurrentUnitContext();
        this.setCurrentUnitImage();
      } else {
        recruiterDialog!.hidden = true;
      }
      if (!areListenersAttached) {
        this.addEventListeners();
        areListenersAttached = true;
      }
    });
  }

  /**
   * Updates dialog ui based on the unit change
   */
  private mountUnitChangeObserver() {
    const unitContainer = document.querySelector<HTMLDivElement>('#unit_order #units');
    // Funkcja callback, która będzie wywoływana przy każdej zmianie
    const callback = async (mutationsList: MutationRecord[], observer: MutationObserver) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class' && (mutation.target as HTMLElement).classList.contains('unit_active')) {
          console.log('Class attribute matched:', mutation.target);
          if (!document.getElementById('recruiter-dialog')?.hidden) {
            await this.setCurrentUnitContext();
            this.setCurrentUnitImage();
          }
        }
      }
    };

    const observer = new MutationObserver(callback);

    const config = {
      attributes: true,
      subtree: true,
      attributeFilter: ['class']
    };

    observer.observe(unitContainer!, config);
  }

  /**
   * Inicjalizuje wszystkie eventy związane z dialogiem rekrutera
   */
  private async addEventListeners() {
    this.populateCitiesSelect();

    const refreshIcon = document.querySelector<SVGElement>('#recruiter-dialog .recruiter-dialog-header-icon');
    const recruiterDialog = document.getElementById('recruiter-dialog');
    const recruiterCloseBtn = document.getElementById('recruiter-close-btn');
    const recruiterConfirmBtn = document.getElementById('recruiter-confirm-btn');
    const recruiterAddBtn = document.getElementById('recruiter-add-btn');
    const recruiterCancelBtn = document.getElementById('recruiter-cancel-btn');

    const amountTypeRadios = recruiterDialog?.querySelectorAll<HTMLInputElement>('[name="recruiter-type"]');
    const amountInput = recruiterDialog?.querySelector<HTMLInputElement>('#recruiter-ammount');
    const amountMaxCheckbox = recruiterDialog?.querySelector<HTMLInputElement>('#recruiter-amount-max');
    const citiesSelect = recruiterDialog?.querySelector<HTMLSelectElement>('#recruiter-cities');

    console.log('this.currentUnitContext:', this.currentUnitContext);


    /**
     * Disables/enables amount input based on amount max checkbox value
     */
    amountMaxCheckbox?.addEventListener('change', () => {
      console.log('amount max checkbox changed:', amountMaxCheckbox.checked);
      if (amountMaxCheckbox.checked) {
        amountInput!.disabled = true;
      } else {
        amountInput!.disabled = false;
      }
    });

    /**
     * action happens here
     */
    recruiterConfirmBtn?.addEventListener('click', () => {
      console.log('confirm');
      /*
      Opis działania:
      1. sprawdza czy planer nie jest zajęty jakimś itemem
      2. Jak nie to: woła metodę, która robi kółeczko po wioskach i zbiera surowce, otrzymuje info po jakim czasie
         ma przyjść by zacząć rekrutację.
      3. Po określonym czasie przychodzi, rekrutuje daną jednostkę, sprawdza licznik i inne parametry i rekrutuje od nowa.
      4. gdy skończy rekrutować item, przechodzi do następnego.
      */
      const recruiterScheduleItem = this.recruitmentSchedule.find(item => item.city.name === this.citySwitchManager.getCurrentCity()?.name);
      if (!recruiterScheduleItem) throw new Error('No scheduler items in the queue');

      if (recruiterScheduleItem.runningItemIndex !== null) {
        return
      } else {
        this.tryRecruitOrStackResources(recruiterScheduleItem);
      }
    });

    /**
     * Closes recruiter dialog
     */
    recruiterCloseBtn?.addEventListener('click', () => {
      console.log('close');
      recruiterDialog!.hidden = true;
    });

    /**
     * Refreshes current unit image, sets new context and updates ui
     */
    refreshIcon?.addEventListener('click', async () => {
      // TODO: should refresh ui
      console.log('refresh');
      await this.setCurrentUnitContext();
      this.setCurrentUnitImage();
      this.populateCitiesSelect();
    });

    /**
     * Parses configuration from recruiter dialog calls executive method based on this.
     */
    recruiterAddBtn?.addEventListener('click', () => {
      const amountType: 'units' | 'slots' = amountTypeRadios![0].checked ? 'units' : 'slots';
      const amountInputValue = amountInput!.value;
      const amountMaxCheckboxValue = amountMaxCheckbox!.checked;
      const citiesSelectValue = Array.from((citiesSelect)!.selectedOptions).map(option => option.value);
      const sourceCity = this.citySwitchManager.getCurrentCity();
      const unit =

        console.log(
          'amountType:', amountType,
          'amountInputValue:', amountInputValue,
          'amountMaxCheckboxValue:', amountMaxCheckboxValue,
          'citiesSelectValue:', citiesSelectValue,
          'sourceCity:', sourceCity
        )

      const scheduleExists = this.recruitmentSchedule.find(schedule => schedule.city.name === sourceCity?.name);
      const schedule: RecruitmentSchedule = scheduleExists ?? {
        city: sourceCity!,
        suppliersCities: [],
        runningItemIndex: null,
        timeoutId: null,
        nextScheduledTime: -1,
        queueItems: [],
      };

      if (amountMaxCheckboxValue) {
        schedule.queueItems.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          slotsAmount: this.getEmptySlotsCount(),
          slotsLeft: this.getEmptySlotsCount(),
        });
      } else if (amountType === 'units') {
        schedule.queueItems.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'units',
          // TODO: if max, then calculate how many units is it
          unitsAmount: Number(amountInputValue),
          unitsLeft: Number(amountInputValue),
        });
      }
      const selectedCities = citiesSelectValue.map(cityName => this.citySwitchManager.getCityByName(cityName));
      schedule.suppliersCities = selectedCities.filter(city => city !== undefined && city.name !== sourceCity?.name) as CityInfo[];
      if (!scheduleExists) {
        this.recruitmentSchedule.push(schedule);
      }
      this.renderRecruitmentQueue(schedule.queueItems);
    });
  }

  private async tryRecruitOrStackResources(schedule: RecruitmentSchedule) {
    try {
      await this.lock.acquire()
      GeneralInfo.getInstance().showInfo('Recruiter:', 'Rekrutacja/stakowanie surowców do rekrutacji');
      await schedule.city.switchAction();
      await this.performRecruitOrStackResources(schedule);

    } catch (e) {
      console.warn('tryRecruitOrStackResources.catch:', e);
    } finally {
      GeneralInfo.getInstance().hideInfo();
      this.lock.release();
    }
  }

  private async performRecruitOrStackResources(schedule: RecruitmentSchedule, stacked: boolean = false) {
    // always first from the queue
    const scheduleItem = schedule.queueItems[0];
    if (!scheduleItem) return;

    const { city, suppliersCities } = schedule;

    if (scheduleItem.amountType === 'slots') {
      const resources = await this.resourceManager.getResourcesInfo();
      const woodDiff = (scheduleItem.unitContextInfo.requiredResourcesPerSlot.wood * 0.9) - resources.wood.amount;
      const ironDiff = (scheduleItem.unitContextInfo.requiredResourcesPerSlot.iron * 0.9) - resources.iron.amount;
      const stoneDiff = (scheduleItem.unitContextInfo.requiredResourcesPerSlot.stone * 0.9) - resources.stone.amount;
      const populationDiff = scheduleItem.unitContextInfo.requiredResourcesPerSlot.population - resources.population.amount;

      const woodAmountNeeded = woodDiff < 0 ? 0 : Math.floor(woodDiff);
      const irodAmountNeeded = ironDiff < 0 ? 0 : Math.floor(ironDiff);
      const stoneAmountNeeded = stoneDiff < 0 ? 0 : Math.floor(stoneDiff);
      const popuatiodAmountNeeded = populationDiff < 0 ? 0 : populationDiff;

      if (popuatiodAmountNeeded > 0) {
        return;
      }

      // if there is not enough resources, stack and schedule next recruitment
      if ([woodAmountNeeded, irodAmountNeeded, stoneAmountNeeded, popuatiodAmountNeeded].some(v => v > 0)) {
        const resourcesToStack = {
          woodAmountNeeded,
          irodAmountNeeded,
          stoneAmountNeeded
        }
        const timeoutMs = await this.stackResources(resourcesToStack, city, suppliersCities);
        schedule.timeoutId = this.createTimeoutForRecruitment(schedule, timeoutMs);
      } else {
        await this.performRecruitment(schedule);
        await this.performRecruitOrStackResources(schedule);
      }
    } else {
      // TODO: do for units
      return;
    }
  }

  private async performRecruitment(schedule: RecruitmentSchedule) {
    // recruitment process
    const item = schedule.queueItems[0];
    await this.goToBarracksView();
    const recruitedUnitsAmount = await this.recruitUnits(
      item.unitContextInfo.unitSelector,
      item.amountType === 'slots' ? Infinity : item.unitsLeft!
    );

    // decrement recruitet amount
    const currentQueueItem = schedule.queueItems[0];
    if (currentQueueItem.amountType === 'slots') {
      currentQueueItem.slotsLeft!--
      if (currentQueueItem.slotsLeft! <= 0) {
        schedule.queueItems.pop();
      }
    } else {
      currentQueueItem.unitsLeft! -= recruitedUnitsAmount;
      if (currentQueueItem.unitsLeft! <= 0) {
        schedule.queueItems.pop();
      }
    }
  }

  // TODO: 
  private async recruitUnits(unitSelector: string, amount: number) {
    let counter = 0;
    do {
      counter++
      document.querySelector<HTMLElement>(unitSelector)?.click();
      await addDelay(400);
      if (counter > 5) { throw new InfoError('Unit cant get selectedd...', {}) }
    } while (!document.querySelector(unitSelector)?.parentElement?.classList.contains('unit_active'))

    const unitInput = document.querySelector<HTMLInputElement>('#unit_order_input')!;
    const maxValue = Number(unitInput.value);
    let recruitedUnitAmount = maxValue;
    if (amount !== Infinity && amount < maxValue) {
      recruitedUnitAmount = amount;
      unitInput.value = amount.toString();
      await addDelay(100);
    }
    const emptySlotsBefore = document.querySelectorAll('.type_unit_queue.barracks .empty_slot').length;
    document.getElementById('unit_order_confirm')?.click();
    await this.untilEmptySlotsAreEqual(emptySlotsBefore - 1);
    return recruitedUnitAmount;
  }

  private async untilEmptySlotsAreEqual(number: number) {
    let counter = 0;
    do {
      counter++;
      await addDelay(400)
      if (counter > 4) { throw new InfoError("queue size didn't change", {}) }
    } while (document.querySelectorAll('.type_unit_queue.barracks .empty_slot').length !== number);
  }

  private async goToBarracksView() {
    document.querySelector<HTMLElement>('[name="city_overview"]')?.click();
    await waitForElementInterval('.units_land .bottom_link .js-caption').then(el => el.click());
  }

  private createTimeoutForRecruitment(schedule: RecruitmentSchedule, timeMs: number) {
    return setTimeout(() => {
      this.tryRecruitOrStackResources(schedule);
    }, timeMs);
  }

  private async stackResources(resourceInfo: RequiredResourcesInfo, city: CityInfo, fromCities: CityInfo[]) {
    // stack resources from cities
    // await goToMapViewAndFocusCity();
    // await goToTradeMode(fromCities);


    // return time in ms to last shipment
    return 0;
  }

  private setCurrentUnitImage() {
    const imageEl = document.querySelector<HTMLDivElement>('#current-unit-image');
    imageEl?.setAttribute('class', this.currentUnitContext!.unitImageClass);
  }

  private async setCurrentUnitContext() {
    const recruiterImageEl = document.getElementById('unit_order_unit_big_image');
    const unitKey = recruiterImageEl?.classList.item(2);
    const currentUnitClassAttr = 'unit_icon50x50' + ' ' + unitKey;
    const emptySlotCount = Number(document.querySelectorAll('.type_unit_queue .empty_slot').length);
    const requiredWoodPerUnit = Number(document.querySelector<HTMLDivElement>('#unit_order_unit_wood')?.textContent ?? -1);
    const requiredStonePerUnit = Number(document.querySelector<HTMLDivElement>('#unit_order_unit_stone')?.textContent ?? -1);
    const requiredIronPerUnit = Number(document.querySelector<HTMLDivElement>('#unit_order_unit_iron')?.textContent ?? -1);
    const populationPerUnit = Number(document.querySelector<HTMLDivElement>('#unit_order_unit_pop')?.textContent ?? -1);
    const recruitmentTime = textToMs(document.querySelector<HTMLDivElement>('#unit_order_unit_build_time')?.textContent ?? '-1');
    const storeCapacity = await this.resourceManager.getStoreCapacity();
    const populationCapacity = this.resourceManager.getPopulation();
    const unitSelector = `.unit_order_unit_image.${unitKey}`

    const maxUnitsPerSlot = Math.floor(storeCapacity / Math.max(requiredWoodPerUnit, requiredStonePerUnit, requiredIronPerUnit));

    const requiredWoodPerSlot = requiredWoodPerUnit * maxUnitsPerSlot;
    const requiredStonePerSlot = requiredStonePerUnit * maxUnitsPerSlot;
    const requiredIronPerSlot = requiredIronPerUnit * maxUnitsPerSlot;
    const requiredPopulationPerSlot = populationPerUnit * maxUnitsPerSlot;

    const currentUnitContext: UnitContext = {
      unitImageClass: currentUnitClassAttr,
      unitSelector,
      emptySlotCount,
      unitInfo: {
        wood: requiredWoodPerUnit,
        stone: requiredStonePerUnit,
        iron: requiredIronPerUnit,
        population: populationPerUnit,
        recruitmentTime,
      },
      requiredResourcesPerSlot: {
        wood: requiredWoodPerSlot,
        stone: requiredStonePerSlot,
        iron: requiredIronPerSlot,
        population: requiredPopulationPerSlot,
      },
      storeCapacity,
      populationCapacity,
    }

    this.currentUnitContext = currentUnitContext;
    console.log(this.currentUnitContext);
    return currentUnitContext;
  }

  private populateCitiesSelect() {
    const cities = this.citySwitchManager.getCityList();
    const citiesSelect = document.querySelector<HTMLSelectElement>('#recruiter-cities');
    const selectedCities = this.recruitmentSchedule.find(schedule => schedule.city.name === this.citySwitchManager.getCurrentCity()?.name)?.suppliersCities;
    citiesSelect!.innerHTML = '';
    for (const city of cities) {
      if (city.name === this.citySwitchManager.getCurrentCity()?.name) continue;
      const option = document.createElement('option');
      option.value = city.name;
      option.textContent = city.name;
      citiesSelect!.appendChild(option);
      if (selectedCities?.some(sc => sc.name === city.name)) {
        option.selected = true;
      }
    }
  }

  private getEmptySlotsCount() {
    return Number(document.querySelectorAll('.type_unit_queue .empty_slot').length);
  }

  private getCurrentUnitContextCopy() {
    return JSON.parse(JSON.stringify(this.currentUnitContext));
  }

  private renderRecruitmentQueue(queueItems: RecruitmentQueueItem[]) {
    const recruitmentQueueEl = document.getElementById('recruiter-queue-content');
    recruitmentQueueEl!.innerHTML = '';
    /*
      <div id="recruiter-queue-content">
        <div class="recruiter-queue-item">
          <div class="recruiter-queue-item-image"></div>
          <span class="recruiter-queue-item-info">name</span>
        </div>
      </div>
    */
    for (const item of queueItems) {
      const queueItemEl = document.createElement('div');
      queueItemEl.classList.add('recruiter-queue-item');

      const imageEl = document.createElement('div');
      imageEl.setAttribute('class', item.unitContextInfo.unitImageClass);
      imageEl.classList.add('recruiter-queue-item-image');
      queueItemEl.appendChild(imageEl);

      const infoEl = document.createElement('span');
      infoEl.classList.add('recruiter-queue-item-info');
      infoEl.textContent = `${item.unitsAmount ?? item.slotsAmount}x ${item.slotsAmount ? 'slots' : 'units'}`;
      queueItemEl.appendChild(infoEl);

      recruitmentQueueEl!.appendChild(queueItemEl);
    }
  }
}