import { inflate } from "zlib";
import { InfoError } from "../../utility/info-error";
import { addDelay, textToMs } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, setInputValue, waitForElementInterval } from "../../utility/ui-utility";
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

type StackResourcesResult = {
  fullyStacked: boolean;
  timeMs?: number;
  resources?: RequiredResourcesInfo;
}

type RequiredResourcesInfo = {
  woodAmountNeeded: number;
  targetWoodAmount: number;
  ironAmountNeeded: number;
  targetIronAmount: number;
  stoneAmountNeeded: number;
  targetStoneAmount: number;
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
  maxShipmentTime: number;
}

export default class Recruiter {
  public static readonly MAX_DELIVERY_TIME_MS = 1000 * 60 * 25;
  private static instance: Recruiter;
  private resourceManager!: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;

  private RUN: boolean = false;
  private observer: MutationObserver | null = null;
  private unitChangeObserver: MutationObserver | null = null;

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
    this.unitChangeObserver?.disconnect();
    this.observer = null;
    this.unitChangeObserver = null;
  }

  public isRunning() {
    return this.RUN;
  }

  private mountObserver(): MutationObserver {
    let barracksDialogAttr: string | null = null;
    let docksDialogAttr: string | null = null;
    const checkAsyncConditionForAddedNodes = async (node: Node) => {
      if (node instanceof HTMLElement
        && node.getAttribute('role') === 'dialog') {
        waitForElementInterval('.barracks_building', { fromNode: node, interval: 500, retries: 3 })
          .catch(() => { /* nothing */ })
          .then(() => {
            barracksDialogAttr = node.getAttribute('aria-describedby');
            this.extendUI(node);
          })
        // waitForElementInterval('.docks_building', { fromNode: node, interval: 500, retries: 3 })
        //   .catch(() => false)
        //   .then(() => {
        //     docksDialogAttr = node.getAttribute('aria-describedby');
        //     this.extendUI(node);
        //   })
      }
    }

    const checkConditionForRemovedNodes = async (node: Node) => {
      console.log('checkConditionForRemovedNodes:', node);
      if (node instanceof HTMLElement
        && node.getAttribute('role') === 'dialog') {
        if (node.getAttribute('aria-describedby') === barracksDialogAttr) {
          console.log('unit observer unmounted');
          this.unitChangeObserver?.disconnect();
          this.unitChangeObserver = null;
        }
        // else if (node.getAttribute('aria-describedby') === docksDialogAttr) {
        //   console.log('unit observer unmounted');
        //   this.unitChangeObserver?.disconnect();
        //   this.unitChangeObserver = null;
        // }
      }
    }

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            checkAsyncConditionForAddedNodes(node);
          }
          for (const node of mutation.removedNodes) {
            checkConditionForRemovedNodes(node);
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
    recruiterDialogContainer.style.zIndex = '2000';
    recruiterDialogContainer.innerHTML = recruiterDialogHTML;
    node.querySelector('#unit_order')?.appendChild(recruiterDialogContainer);
    this.addEntryEventListener(node);
    this.mountUnitChangeObserver();
    this.renderRecruitmentQueue(this.recruitmentSchedule.find(item => item.city.name === this.citySwitchManager.getCurrentCity()?.name)?.queueItems ?? []);
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
    this.unitChangeObserver = observer;
  }

  /**
   * Inicjalizuje wszystkie eventy związane z dialogiem rekrutera, dzieje się to na pierwsze otwarcie dialogu (recruitera)
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
    const shipmentTimeSelect = recruiterDialog?.querySelector<HTMLSelectElement>('#shipment-time');

    console.log('this.currentUnitContext:', this.currentUnitContext);


    recruiterCancelBtn?.addEventListener('click', () => {
      console.log('cancel');
      const currentCity = this.citySwitchManager.getCurrentCity();
      if (!currentCity) return;
      this.recruitmentSchedule = this.recruitmentSchedule.filter(item => {
        if (item.city.name === currentCity.name) {
          clearTimeout(item.timeoutId!);
          return false;
        }
        return true;
      });
      this.renderRecruitmentQueue([]);
    });

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
    /*
    * Disables/enables amount input initially (no event triggered yet to handle it)
    */
    amountMaxCheckbox!.checked ? (amountInput!.disabled = true) : (amountInput!.disabled = false);

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

      if (recruiterScheduleItem.queueItems.length === 1) {
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
      const shipmentTime = Number(shipmentTimeSelect!.value);
      console.log(
        'amountType:', amountType,
        'amountInputValue:', amountInputValue,
        'amountMaxCheckboxValue:', amountMaxCheckboxValue,
        'citiesSelectValue:', citiesSelectValue,
        'sourceCity:', sourceCity,
        'shipmentTime:', shipmentTime
      )

      const scheduleExists = this.recruitmentSchedule.find(schedule => schedule.city.name === sourceCity?.name);
      console.log('scheduleExists:', scheduleExists);
      const schedule: RecruitmentSchedule = scheduleExists ?? {
        city: sourceCity!,
        suppliersCities: [],
        timeoutId: null,
        nextScheduledTime: -1,
        queueItems: [],
        maxShipmentTime: shipmentTime,
      };
      console.log('schedule:', schedule);

      if (amountMaxCheckboxValue) {
        console.log('amountMaxCheckboxValue:', amountMaxCheckboxValue);
        schedule.queueItems.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          slotsAmount: this.getEmptySlotsCount(),
          slotsLeft: this.getEmptySlotsCount(),
        });
        console.log('slots queue item added, schedule:', schedule);
      } else if (amountType === 'units') {
        console.log('units queue item added, schedule:', schedule);
        schedule.queueItems.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'units',
          unitsAmount: Number(amountInputValue),
          unitsLeft: Number(amountInputValue),
        });
      } else if (amountType === 'slots') {
        console.log('slots queue item added, schedule:', schedule);
        schedule.queueItems.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          slotsAmount: Number(amountInputValue),
          slotsLeft: Number(amountInputValue),
        });
      }
      const selectedCities = citiesSelectValue.map(cityName => this.citySwitchManager.getCityByName(cityName));
      schedule.suppliersCities = selectedCities.filter(city => city !== undefined && city.name !== sourceCity?.name) as CityInfo[];
      console.log('suppliersCities:', schedule.suppliersCities);
      schedule.maxShipmentTime = shipmentTime;

      if (!scheduleExists) {
        console.log('schedue does not exist, pushing new schedule');
        this.recruitmentSchedule.push(schedule);
      }
      this.renderRecruitmentQueue(schedule.queueItems);
    });
  }

  private async tryRecruitOrStackResources(schedule: RecruitmentSchedule) {
    try {
      await this.lock.acquire({ method: 'tryRecruitOrStackResources', manager: 'recruiter' });
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
    console.log('performRecruitOrStackResources:', scheduleItem);
    if (!scheduleItem) {
      console.log('no schedule item, clearing timeout and next scheduled time');
      schedule.timeoutId = null;
      schedule.nextScheduledTime = -1;
      return;
    }

    const { city, suppliersCities } = schedule;
    const resources = await this.resourceManager.getResourcesInfo();

    if (scheduleItem.amountType === 'slots') {
      console.log('slots');
      console.log('resourcesInfo before:', resources);
      const woodDiff = (scheduleItem.unitContextInfo.requiredResourcesPerSlot.wood * 0.9) - resources.wood.amount;
      const ironDiff = (scheduleItem.unitContextInfo.requiredResourcesPerSlot.iron * 0.9) - resources.iron.amount;
      const stoneDiff = (scheduleItem.unitContextInfo.requiredResourcesPerSlot.stone * 0.9) - resources.stone.amount;
      const populationDiff = scheduleItem.unitContextInfo.requiredResourcesPerSlot.population - resources.population.amount;
      console.log('woodDiff:', woodDiff, 'ironDiff:', ironDiff, 'stoneDiff:', stoneDiff, 'populationDiff:', populationDiff);

      const woodAmountNeeded = woodDiff < 0 ? 0 : Math.floor(woodDiff);
      const ironAmountNeeded = ironDiff < 0 ? 0 : Math.floor(ironDiff);
      const stoneAmountNeeded = stoneDiff < 0 ? 0 : Math.floor(stoneDiff);
      const popuationAmountNeeded = populationDiff < 0 ? 0 : populationDiff;
      console.log('woodAmountNeeded:', woodAmountNeeded, 'ironAmountNeeded:', ironAmountNeeded, 'stoneAmountNeeded:', stoneAmountNeeded, 'popuationAmountNeeded:', popuationAmountNeeded);

      if (popuationAmountNeeded > 0) {
        console.log('popuationAmountNeeded > 0 - shifting queue');
        schedule.queueItems.shift();
        return;
      }

      // if there is not enough resources, stack and schedule next recruitment
      if ([woodAmountNeeded, ironAmountNeeded, stoneAmountNeeded].some(v => v > 0)) {

        const resourcesToStack = {
          woodAmountNeeded,
          targetWoodAmount: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.wood * 0.9),
          ironAmountNeeded,
          targetIronAmount: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.iron * 0.9),
          stoneAmountNeeded,
          targetStoneAmount: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.stone * 0.9)
        }
        console.log('not enough resources, stacking:', resourcesToStack);
        const stackResult = await this.stackResources(resourcesToStack, city, suppliersCities, schedule.maxShipmentTime);
        if (stackResult.fullyStacked) {
          console.log('fully stacked, scheduling recruitment');
          const timeMs = stackResult.timeMs!;
          schedule.timeoutId = this.createTimeoutForRecruitment(schedule, timeMs);
          schedule.nextScheduledTime = new Date().getTime() + timeMs;
        } else {
          console.log('not fully stacked, scheduling in 10 minutes');
          // schedule in 10 minutes
          schedule.timeoutId = this.createTimeoutForRecruitment(schedule, 600000);
          schedule.nextScheduledTime = new Date().getTime() + 600000;
          console.log('recruitment schedule updated:', schedule);
        }
      } else {
        console.log('enough resources, performing recruitment');
        await this.performRecruitment(schedule);
        await this.performRecruitOrStackResources(schedule);
      }
    } else {
      console.log('units');
      const woodDiff = (scheduleItem.unitContextInfo.unitInfo.wood) * scheduleItem.unitsLeft! - resources.wood.amount;
      const ironDiff = (scheduleItem.unitContextInfo.unitInfo.iron) * scheduleItem.unitsLeft! - resources.iron.amount;
      const stoneDiff = (scheduleItem.unitContextInfo.unitInfo.stone) * scheduleItem.unitsLeft! - resources.stone.amount;
      const populationDiff = scheduleItem.unitContextInfo.unitInfo.population * scheduleItem.unitsLeft! - resources.population.amount;
      // TODO: do rest
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
        schedule.queueItems.shift();
        this.renderRecruitmentQueue(schedule.queueItems);
      }
    } else {
      currentQueueItem.unitsLeft! -= recruitedUnitsAmount;
      if (currentQueueItem.unitsLeft! <= 0) {
        schedule.queueItems.shift();
        this.renderRecruitmentQueue(schedule.queueItems);
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
    } else {
      unitInput.value = maxValue.toString();
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
    console.log('createTimeoutForRecruitment:', timeMs);
    return setTimeout(() => {
      this.tryRecruitOrStackResources(schedule);
    }, timeMs);
  }

  /**
   * Goes through the cities and stacks resources, returns time in ms to last shipment or -1 if not enough resources, which means
   * that stacking should be rescheduled
   * @requires Lock
   */
  private async stackResources(resourceInfo: RequiredResourcesInfo, city: CityInfo, fromCities: CityInfo[], maxShipmentTime: number): Promise<StackResourcesResult> {
    console.log('stackResources', resourceInfo);
    // stack resources from cities
    let highestTime = -1;
    console.log('going to trade mode');
    await this.goToTradeMode(city, fromCities[0]);
    const stillNeededResources = { ...resourceInfo };

    // check if resources are alredy non its way
    let [woodRealState, stoneRealState, ironRealState] =
      Array.from(document.querySelectorAll('.amounts'))
        ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];
    console.log('woodRealState:', woodRealState, 'stoneRealState:', stoneRealState, 'ironRealState:', ironRealState);

    while (woodRealState?.length !== 2 || stoneRealState?.length !== 2 || ironRealState?.length !== 2) {
      await addDelay(400);
      [woodRealState, stoneRealState, ironRealState] =
        Array.from(document.querySelectorAll('.amounts'))
          ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];
    }

    if (woodRealState![0] >= resourceInfo.targetWoodAmount && stoneRealState![0] >= resourceInfo.targetStoneAmount && ironRealState![0] >= resourceInfo.targetIronAmount) {
      return {
        fullyStacked: true,
        timeMs: 1000 * 60 * 5,
      }
    }
    // END check if resources are alredy non its way

    let prevWayDurationText = '-1';
    // w tym miejscue jest trade mode
    for (const supplierCity of fromCities) {
      console.log('stacking resources from:', supplierCity.name);
      let resourcesSent = false;
      let currentShipmentTimeMS = 0;
      let currentTradeCapacity = 0;
      // przejdź do miasta z którego się przesyła surowce
      console.log('switching to without jumping:', supplierCity.name);
      await supplierCity.switchAction(false);
      // upewnia się że miasto zostało przełączone przez porównanie czasu dostawy
      let currentWayDurationText: string | undefined | null = null;
      let counter = 0;
      do {
        counter++;
        await addDelay(333);
        currentWayDurationText = document.querySelector<HTMLElement>('#duration_container .way_duration')?.textContent;
      } while ((!currentWayDurationText || currentWayDurationText === prevWayDurationText) && counter < 6);
      if (counter >= 6) console.warn('stackResources.while.counter:', counter);
      prevWayDurationText = currentWayDurationText!;
      console.log('currentWayDurationText:', currentWayDurationText);
      await addDelay(333);

      currentShipmentTimeMS = textToMs(currentWayDurationText!.slice(1));
      console.log('currentShipmentTimeMS:', currentShipmentTimeMS);
      console.log('maxShipmentTime:', maxShipmentTime);
      if (currentShipmentTimeMS > maxShipmentTime) continue;

      // zczytaj surki z obecnego miasta
      const resources = await this.resourceManager.getResourcesInfo();
      console.log('resources:', resources);
      // dowiedz się jaki jest max trade capaacity
      currentTradeCapacity = await waitForElementInterval('#big_progressbar .curr').then(el => Number(el.textContent));
      console.log('currentTradeCapacity:', currentTradeCapacity);
      // zczytaj wartości z progress barów na temat tego co jest w mieście i co do niego już idzie i nadpisz wartości
      const [woodRealState, stoneRealState, ironRealState] =
        Array.from(document.querySelectorAll('.amounts'))
          ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];
      console.log('woodRealState:', woodRealState, 'stoneRealState:', stoneRealState, 'ironRealState:', ironRealState);

      // minimalnie 100 surowców (wymóg gry)
      if (stillNeededResources.ironAmountNeeded !== 0) {
        stillNeededResources.ironAmountNeeded = ironRealState![0] + stillNeededResources.ironAmountNeeded >= Math.floor(0.9 * ironRealState![1])
          ? Math.max(100, Math.floor(ironRealState![1] * 0.9) - ironRealState![0])
          : Math.max(100, stillNeededResources.ironAmountNeeded);
      }

      if (stillNeededResources.stoneAmountNeeded !== 0) {
        stillNeededResources.stoneAmountNeeded = stoneRealState![0] + stillNeededResources.stoneAmountNeeded >= Math.floor(0.9 * stoneRealState![1])
          ? Math.max(100, Math.floor(stoneRealState![1] * 0.9) - stoneRealState![0])
          : Math.max(100, stillNeededResources.stoneAmountNeeded);
      }

      if (stillNeededResources.woodAmountNeeded !== 0) {
        stillNeededResources.woodAmountNeeded = woodRealState![0] + stillNeededResources.woodAmountNeeded >= Math.floor(0.9 * woodRealState![1])
          ? Math.max(100, Math.floor(woodRealState![1] * 0.9) - woodRealState![0])
          : Math.max(100, stillNeededResources.woodAmountNeeded);
      }

      console.log('stillNeededResources after checking:', stillNeededResources);


      if (stillNeededResources.woodAmountNeeded > 0 && currentTradeCapacity >= 100 && resources.wood.amount >= 100) {
        const woodInput = await waitForElementInterval('#trade_type_wood input', { interval: 333, retries: 4 });
        console.log('woodInput:', woodInput);
        if (resources.wood.amount < stillNeededResources.woodAmountNeeded) {
          console.log('Setting wood input to available amount:', resources.wood.amount);
          if (resources.wood.amount < currentTradeCapacity) {
            console.log('Setting wood input to available amount:', resources.wood.amount);
            (woodInput as HTMLInputElement).value = resources.wood.amount.toString();
            stillNeededResources.woodAmountNeeded -= resources.wood.amount;
            currentTradeCapacity -= resources.wood.amount;
          } else {
            console.log('Setting wood input to current trade capacity:', currentTradeCapacity);
            (woodInput as HTMLInputElement).value = currentTradeCapacity.toString();
            stillNeededResources.woodAmountNeeded -= currentTradeCapacity;
            currentTradeCapacity = 0;
            console.log('woodInput.value:', (woodInput as HTMLInputElement).value);
          }
        } else {
          if (currentTradeCapacity < stillNeededResources.woodAmountNeeded) {
            console.log('Setting wood input to current trade capacity:', currentTradeCapacity);
            (woodInput as HTMLInputElement).value = currentTradeCapacity.toString();
            stillNeededResources.woodAmountNeeded -= currentTradeCapacity;
            currentTradeCapacity = 0;
            console.log('woodInput.value:', (woodInput as HTMLInputElement).value);
          } else {
            console.log('Setting wood input to needed amount:', stillNeededResources.woodAmountNeeded);
            (woodInput as HTMLInputElement).value = stillNeededResources.woodAmountNeeded.toString();
            stillNeededResources.woodAmountNeeded = 0;
            currentTradeCapacity -= stillNeededResources.woodAmountNeeded;
          }
        }
        resourcesSent = true;
      }
      if (stillNeededResources.ironAmountNeeded > 0 && currentTradeCapacity >= 100 && resources.iron.amount >= 100) {
        const ironInput = await waitForElementInterval('#trade_type_iron input', { interval: 333, retries: 4 })

        console.log('Iron check:', resources.iron.amount, '<', stillNeededResources.ironAmountNeeded);
        if (resources.iron.amount < stillNeededResources.ironAmountNeeded) {
          console.log('Setting iron input to available amount:', resources.iron.amount);
          if (resources.iron.amount < currentTradeCapacity) {
            console.log('Setting iron input to available amount:', resources.iron.amount);
            (ironInput as HTMLInputElement).value = resources.iron.amount.toString();
            stillNeededResources.ironAmountNeeded -= resources.iron.amount;
            currentTradeCapacity -= resources.iron.amount;
            console.log('ironInput.value:', (ironInput as HTMLInputElement).value);
          } else {
            console.log('Setting iron input to current trade capacity:', currentTradeCapacity);
            (ironInput as HTMLInputElement).value = currentTradeCapacity.toString();
            stillNeededResources.ironAmountNeeded -= currentTradeCapacity;
            currentTradeCapacity = 0;
            console.log('ironInput.value:', (ironInput as HTMLInputElement).value);
          }
        } else {
          if (currentTradeCapacity < stillNeededResources.ironAmountNeeded) {
            console.log('Setting iron input to current trade capacity:', currentTradeCapacity);
            (ironInput as HTMLInputElement).value = currentTradeCapacity.toString();
            stillNeededResources.ironAmountNeeded -= currentTradeCapacity;
            currentTradeCapacity = 0;
            console.log('ironInput.value:', (ironInput as HTMLInputElement).value);
          } else {
            console.log('Setting iron input to needed amount:', stillNeededResources.ironAmountNeeded);
            (ironInput as HTMLInputElement).value = stillNeededResources.ironAmountNeeded.toString();
            stillNeededResources.ironAmountNeeded = 0;
            currentTradeCapacity -= stillNeededResources.ironAmountNeeded;
            console.log('ironInput.value:', (ironInput as HTMLInputElement).value);
          }
        }
        resourcesSent = true;
      }
      if (stillNeededResources.stoneAmountNeeded > 0 && currentTradeCapacity >= 100 && resources.stone.amount >= 100) {
        const stoneInput = await waitForElementInterval('#trade_type_stone input', { interval: 333, retries: 4 })

        console.log('Stone check:', resources.stone.amount, '<', stillNeededResources.stoneAmountNeeded);
        if (resources.stone.amount < stillNeededResources.stoneAmountNeeded) {
          if (resources.stone.amount < currentTradeCapacity) {
            console.log('Setting stone input to available amount:', resources.stone.amount);
            (stoneInput as HTMLInputElement).value = resources.stone.amount.toString();
            stillNeededResources.stoneAmountNeeded -= resources.stone.amount;
            currentTradeCapacity -= resources.stone.amount;
            console.log('stoneInput.value:', (stoneInput as HTMLInputElement).value);
          } else {
            console.log('Setting stone input to current trade capacity:', currentTradeCapacity);
            (stoneInput as HTMLInputElement).value = currentTradeCapacity.toString();
            stillNeededResources.stoneAmountNeeded -= currentTradeCapacity;
            currentTradeCapacity = 0;
            console.log('stoneInput.value:', (stoneInput as HTMLInputElement).value);
          }
        } else {
          if (currentTradeCapacity < stillNeededResources.stoneAmountNeeded) {
            console.log('Setting stone input to current trade capacity:', currentTradeCapacity);
            (stoneInput as HTMLInputElement).value = currentTradeCapacity.toString();
            stillNeededResources.stoneAmountNeeded -= currentTradeCapacity;
            currentTradeCapacity = 0;
            console.log('stoneInput.value:', (stoneInput as HTMLInputElement).value);
          } else {
            console.log('Setting stone input to needed amount:', stillNeededResources.stoneAmountNeeded);
            (stoneInput as HTMLInputElement).value = stillNeededResources.stoneAmountNeeded.toString();
            stillNeededResources.stoneAmountNeeded = 0;
            console.log('stoneInput.value:', (stoneInput as HTMLInputElement).value);
          }
        }
        resourcesSent = true;
      }
      document.querySelector<HTMLElement>('.btn_trade_button.button_new')?.click();

      if (currentShipmentTimeMS > highestTime && resourcesSent) highestTime = currentShipmentTimeMS;
      if (stillNeededResources.woodAmountNeeded <= 0 && stillNeededResources.ironAmountNeeded <= 0 && stillNeededResources.stoneAmountNeeded <= 0) {
        break;
      }
    }

    if (stillNeededResources.woodAmountNeeded > 0 || stillNeededResources.ironAmountNeeded > 0 || stillNeededResources.stoneAmountNeeded > 0) {
      console.log('not fully stacked, timeMs:', highestTime);
      return {
        fullyStacked: false,
        timeMs: highestTime + 3000,
        resources: stillNeededResources
      }
    }
    // return time in ms to last shipment
    console.log('fully stacked, timeMs:', highestTime);
    return {
      fullyStacked: true,
      timeMs: highestTime + 3000,
    }
  }

  private async goToTradeMode(city: CityInfo, fromCity: CityInfo) {
    await fromCity.switchAction(false);
    let counter = 0;
    await performComplexClick(document.querySelector<HTMLElement>(`#town_${city.cityId}`))
    do {
      counter++;
      await addDelay(400);
      console.log('counter:', counter);
      console.log('document.querySelector<HTMLElement>("#trading")', document.querySelector<HTMLElement>('#trading'));
    } while (!document.querySelector<HTMLElement>('#trading') && counter < 5)
    if (counter >= 5) throw new InfoError('Couldn\'t click trading option', {})
    document.querySelector<HTMLElement>('#trading')!.click();
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