import { inflate } from "zlib";
import { InfoError } from "../../utility/info-error";
import { addDelay, doUntil, shuffle, textToMs, waitUntil } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, setInputValue, waitForElementInterval } from "../../utility/ui-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import GeneralInfo from "../master/ui/general-info";
import ResourceManager from "../resources/resource-manager";
import recruiterDialogHTML from "./recruiter-prod.html";
import recruiterToggleBtnHTML from "./recruiter-toggle-btn-prod.html";
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
/**
 * target: final required resources amount
 * toStack: remaining resources to be stacked
 */
type RequiredResourcesInfo = {
  target: {
    wood: number;
    iron: number;
    stone: number;
  },
  toStack: {
    wood: number;
    iron: number;
    stone: number;
  }
}

type RecruitmentQueueItem = {
  type: 'barracks' | 'docks';
  suppliersCities: CityInfo[];
  maxShipmentTime: number;
  unitContextInfo: UnitContext;
  amountType: 'units' | 'slots';
  amount: number;
  amountLeft: number;
}

type RecruitmentSchedule = {
  city: CityInfo
  timeoutId: NodeJS.Timeout | null;
  nextScheduledTime: number | null;
  queue: RecruitmentQueueItem[]
}

export default class Recruiter {
  public static readonly MAX_DELIVERY_TIME_MS = 1000 * 60 * 25;
  private static instance: Recruiter;
  private resourceManager!: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;
  private tryCount: number = 0;

  private RUN: boolean = false;
  private observer: MutationObserver | null = null;
  private unitChangeObserver: MutationObserver | null = null;
  private recruitmentBuildingDialogAttr: string | null = null;

  private currentUnitContext: UnitContext | null = null;
  private recruitmentSchedule: RecruitmentSchedule[] = [];
  private eventListenersCleanupCallbacks: (() => void)[] = [];

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

  public getRecruitmentScheduleTimes() {
    return this.recruitmentSchedule
      .map(citySchedule => citySchedule.nextScheduledTime)
      .filter(time => time != null)
  }

  private addRecruiterDialog() {
    const recruiterDialogContainer = document.createElement('div');
    recruiterDialogContainer.id = 'recruiter-container';
    recruiterDialogContainer.style.zIndex = '2000';
    recruiterDialogContainer.innerHTML = recruiterDialogHTML;
    document.body.appendChild(recruiterDialogContainer);
  }

  private createRecruiterToggleButton() {
    const recruiterToggleContainer = document.createElement('div');
    recruiterToggleContainer.id = 'recruiter-toggle-container';
    recruiterToggleContainer.innerHTML = recruiterToggleBtnHTML;
    return recruiterToggleContainer;
  }

  private removeRecruiterDialog() {
    document.getElementById('recruiter-container')?.remove();
  }

  public async start() {
    console.log('recruiter start');
    this.RUN = true;
    if (!this.observer) {
      // this.addRecruiterDialog();
      this.observer = this.mountObserver();
    }
    this.recruitmentSchedule.forEach(schedule => {
      if (schedule.queue.length) {
        this.tryRecruitOrStackResources(schedule);
      }
    })
  }

  public async stop() {
    this.RUN = false;
    // this.removeRecruiterDialog();
    this.recruitmentSchedule.forEach(schedule => {
      schedule.timeoutId && clearTimeout(schedule.timeoutId);
      schedule.timeoutId = null;
      schedule.nextScheduledTime = null;
    });

    this.observer?.disconnect();
    this.unitChangeObserver?.disconnect();
    this.observer = null;
    this.unitChangeObserver = null;
  }

  public isRunning() {
    return this.RUN;
  }

  private mountObserver(): MutationObserver {
    const checkAsyncConditionForAddedNodes = async (node: Node) => {
      if (node instanceof HTMLElement
        && node.getAttribute('role') === 'dialog') {
        waitForElementInterval('.barracks_building', { fromNode: node, interval: 500, retries: 3 })
          .then(() => {
            this.recruitmentBuildingDialogAttr = node.getAttribute('aria-describedby');
            console.log('barracks dialog attr:', this.recruitmentBuildingDialogAttr);
            this.extendUI(node, 'barracks');
          })
          .catch(() => { /* nothing */ })
        waitForElementInterval('.docks_building', { fromNode: node, interval: 500, retries: 3 })
          .then(() => {
            this.recruitmentBuildingDialogAttr = node.getAttribute('aria-describedby');
            console.log('docks dialog attr:', this.recruitmentBuildingDialogAttr);
            this.extendUI(node, 'docks');
          })
          .catch(() => { /* nothing */ })
      }
    }

    const checkConditionForRemovedNodes = async (node: Node) => {
      if (node instanceof HTMLElement
        && node.getAttribute('role') === 'dialog') {
        if (node.getAttribute('aria-describedby') === this.recruitmentBuildingDialogAttr) {
          console.log('Unmounting recruiter utilities');
          this.removeRecruiterDialog();
          this.unitChangeObserver?.disconnect();
          this.unitChangeObserver = null;
          this.cleanEventListeners();
        }
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
   * Dodaje przycisk do otwarcia dialogu rekrutera oraz dialog rekrutera, 
   * podłącza eventy obługujące dialog,
   * inicjalizuje observer który nasłuchuje zmian w jednostkach,
   * dodaje nasłuchiwanie zmiany miasta, które aktualizuje listę miast w select oraz kolejkę rekrutacji
   */
  private extendUI(node: HTMLElement, type: 'barracks' | 'docks') {
    // adds togle button HTML to the recruitment building
    node.querySelector('#unit_order')?.appendChild(this.createRecruiterToggleButton());

    // adds recruiter dialog HTML to the body
    this.addRecruiterDialog();

    // adds event listeners to the toggle button
    this.addEntryEventListener(node, type);
    this.attachOnCityChangeCallback();
    this.mountUnitChangeObserver();
    this.renderRecruitmentQueue(
      this.recruitmentSchedule
        .find(item => item.city.name === this.citySwitchManager.getCurrentCity()?.name)?.queue ?? []
    );
  }

  private addEntryEventListener(node: HTMLElement, type: 'barracks' | 'docks') {
    const recruiterOpenBtn = document.getElementById('recruiter-btn');
    const recruiterDialog = document.getElementById('recruiter-dialog');
    let areListenersAttached = false;

    const toggleAcction = async () => {
      if (recruiterDialog!.hidden) {
        recruiterDialog!.hidden = false;
        await this.setCurrentUnitContext();
        this.setDialogCurrentUnitImage();
      } else {
        recruiterDialog!.hidden = true;
      }
      if (!areListenersAttached) {
        this.addEventListeners(type);
        areListenersAttached = true;
      }
    }
    recruiterOpenBtn?.addEventListener('click', toggleAcction);
    this.eventListenersCleanupCallbacks.push(() => recruiterOpenBtn?.removeEventListener('click', toggleAcction));
  }

  /**
   * Nasłuchuje zmiany miasta, aktualizuje listę miast w select oraz kolejkę rekrutacji 
   * ze względu na aktualne miasto.
   */
  private attachOnCityChangeCallback() {
    const callback = async (city: CityInfo) => {
      this.populateCitiesSelect();
      this.renderRecruitmentQueue(
        this.recruitmentSchedule
          .find(item => item.city.name === city.name)?.queue ?? []
      );
    }
    this.citySwitchManager.addListener('cityChange', callback);
    this.eventListenersCleanupCallbacks.push(() => this.citySwitchManager.removeListener('cityChange', callback));
  }

  /**
   * Updates dialog ui based on the unit change
   */
  private mountUnitChangeObserver() {
    const unitContainer = document.querySelector<HTMLDivElement>(`[aria-describedby="${this.recruitmentBuildingDialogAttr}"]`);
    // Funkcja callback, która będzie wywoływana przy każdej zmianie
    const callback = async (mutationsList: MutationRecord[]) => {
      for (const mutation of mutationsList) {
        if ((mutation.target as HTMLElement).classList.contains('unit_active')) {
          console.log('Class attribute matched:', mutation.target);
          if (!document.getElementById('recruiter-dialog')?.hidden) {
            await this.setCurrentUnitContext();
            this.setDialogCurrentUnitImage();
          }
        }
      }
    };
    // const unitContainer = document.querySelector<HTMLDivElement>('#unit_order #units');
    // // Funkcja callback, która będzie wywoływana przy każdej zmianie
    // const callback = async (mutationsList: MutationRecord[]) => {
    //   for (const mutation of mutationsList) {
    //     if (mutation.type === 'attributes' && mutation.attributeName === 'class' && (mutation.target as HTMLElement).classList.contains('unit_active')) {
    //       console.log('Class attribute matched:', mutation.target);
    //       if (!document.getElementById('recruiter-dialog')?.hidden) {
    //         await this.setCurrentUnitContext();
    //         this.setCurrentUnitImage();
    //       }
    //     }
    //   }
    // };

    const observer = new MutationObserver(callback);

    const config = {
      attributes: true,
      subtree: true,
      attributeFilter: ['class']
    };

    observer.observe(unitContainer!, config);
    this.unitChangeObserver?.disconnect();
    this.unitChangeObserver = observer;
  }

  /**
   * Inicjalizuje wszystkie eventy związane z dialogiem rekrutera, dzieje się to na pierwsze otwarcie dialogu (recruitera)
   */
  private async addEventListeners(type: 'barracks' | 'docks') {
    this.populateCitiesSelect();

    const recruiterDialog = document.getElementById('recruiter-dialog');
    const recruiterNav = recruiterDialog?.querySelector<HTMLElement>('#recruiter-nav');

    const refreshIcon = recruiterDialog?.querySelector<SVGElement>('.recruiter-dialog-header-icon');
    const recruiterCloseBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-close-btn');
    const recruiterConfirmBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-confirm-btn');
    const recruiterAddBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-add-btn');
    const recruiterCancelBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-cancel-btn');

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
          item.timeoutId && clearTimeout(item.timeoutId);
          item.nextScheduledTime = null;
          return false;
        }
        return true;
      });
      this.renderRecruitmentQueue([]);
    });

    /**
     * Disables/enables amount input based on amount max checkbox value
     */
    const amountMaxCheckboxChangeClb = () => {
      console.log('amount max checkbox changed:', amountMaxCheckbox!.checked);
      if (amountMaxCheckbox!.checked) {
        amountInput!.disabled = true;
      } else {
        amountInput!.disabled = false;
      }
    }
    amountMaxCheckbox?.addEventListener('change', amountMaxCheckboxChangeClb);
    this.eventListenersCleanupCallbacks.push(() => amountMaxCheckbox?.removeEventListener('change', amountMaxCheckboxChangeClb));

    /*
    * Disables/enables amount input initially (no event triggered yet to handle it)
    */
    amountMaxCheckbox!.checked ? (amountInput!.disabled = true) : (amountInput!.disabled = false);

    /**
     * action happens here
     */
    const confirmButtonAcction = () => {
      console.log('confirm');
      /*
      Opis działania:
      1. sprawdza czy planer nie jest zajęty jakimś itemem
      2. Jak nie to: woła metodę, która robi kółeczko po wioskach i zbiera surowce, otrzymuje info po jakim czasie
         ma przyjść by zacząć rekrutację.
      3. Po określonym czasie przychodzi, rekrutuje daną jednostkę, sprawdza licznik i inne parametry i rekrutuje od nowa.
      4. gdy skończy rekrutować item, przechodzi do następnego.
      */
      const scheduleForCity = this.recruitmentSchedule.find(item => item.city.name === this.citySwitchManager.getCurrentCity()?.name);
      if (!scheduleForCity) throw new Error('No scheduler items in the queue');

      if (scheduleForCity.queue.length === 1 || (!scheduleForCity.timeoutId && !scheduleForCity.nextScheduledTime)) {
        this.tryRecruitOrStackResources(scheduleForCity);
      }
      recruiterDialog!.hidden = true;
    }
    recruiterConfirmBtn?.addEventListener('click', confirmButtonAcction);
    this.eventListenersCleanupCallbacks.push(() => recruiterConfirmBtn?.removeEventListener('click', confirmButtonAcction));

    /**
     * Closes recruiter dialog
     */
    const closeButtonAction = () => {
      console.log('close');
      recruiterDialog!.hidden = true;
    }
    recruiterCloseBtn?.addEventListener('click', closeButtonAction);
    this.eventListenersCleanupCallbacks.push(() => recruiterCloseBtn?.removeEventListener('click', closeButtonAction));

    /**
     * Refreshes current unit image, sets new context and updates ui
     */
    const refreshButtonAction = async () => {
      // TODO: should refresh ui
      console.log('refresh');
      await this.setCurrentUnitContext();
      this.setDialogCurrentUnitImage();
      this.populateCitiesSelect();
    }
    refreshIcon?.addEventListener('click', refreshButtonAction);
    this.eventListenersCleanupCallbacks.push(() => refreshIcon?.removeEventListener('click', refreshButtonAction));

    /**
     * Parses configuration from recruiter dialog calls executive method based on this.
     */
    const addButtonAction = () => {
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
        nextScheduledTime: null,
        timeoutId: null,
        queue: []
      };
      console.log('schedule:', schedule);
      const selectedCities = citiesSelectValue.map(cityName => this.citySwitchManager.getCityByName(cityName))
        .filter(city => city !== undefined && city.name !== sourceCity?.name) as CityInfo[];
      console.log('selectedCities:', selectedCities);

      if (amountMaxCheckboxValue) {
        console.log('amountMaxCheckboxValue:', amountMaxCheckboxValue);
        // TODO: lepiej wykalkulować ilość slotów w przyadku gdy itemy w kolejce nie są slots
        const properMaxSlotsAmount = this.getEmptySlotsCount(type) - schedule.queue.reduce((acc, item) => acc + (item.amountType === 'slots' ? item.amount : 1), 0);
        schedule.queue.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          amount: properMaxSlotsAmount,
          amountLeft: properMaxSlotsAmount,
          type: type,
          suppliersCities: selectedCities,
          maxShipmentTime: shipmentTime
        });
        console.log('slots queue item added, schedule:', schedule);
      } else if (amountType === 'units') {
        console.log('units queue item added, schedule:', schedule);
        schedule.queue.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'units',
          amount: Number(amountInputValue),
          amountLeft: Number(amountInputValue),
          type: type,
          suppliersCities: selectedCities,
          maxShipmentTime: shipmentTime
        });
      } else if (amountType === 'slots') {
        console.log('slots queue item added, schedule:', schedule);
        schedule.queue.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          amount: Number(amountInputValue),
          amountLeft: Number(amountInputValue),
          type: type,
          suppliersCities: selectedCities,
          maxShipmentTime: shipmentTime
        });
      }

      if (!scheduleExists) {
        console.log('schedue does not exist, pushing new schedule');
        this.recruitmentSchedule.push(schedule);
      }
      this.renderRecruitmentQueue(schedule.queue);
    }
    recruiterAddBtn?.addEventListener('click', addButtonAction);
    this.eventListenersCleanupCallbacks.push(() => recruiterAddBtn?.removeEventListener('click', addButtonAction));

    // draggable recruiter dialog listeners
    {
      let isDragging = false;
      let offsetX: number | null = null;
      let offsetY: number | null = null;

      recruiterNav?.addEventListener('mousedown', onMouseDown);
      this.eventListenersCleanupCallbacks.push(() => {
        recruiterNav?.removeEventListener('mousedown', onMouseDown)
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      });

      function onMouseDown(e: MouseEvent) {
        isDragging = true;
        offsetX = e.clientX - recruiterDialog!.offsetLeft;
        offsetY = e.clientY - recruiterDialog!.offsetTop;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }

      function onMouseMove(e: MouseEvent) {
        if (isDragging) {
          recruiterDialog!.style.left = `${e.clientX - (offsetX ?? 0)}px`;
          recruiterDialog!.style.top = `${e.clientY - (offsetY ?? 0)}px`;
        }
      }

      function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
    }

  }

  private async tryRecruitOrStackResources(schedule: RecruitmentSchedule) {
    try {
      await this.lock.acquire({ method: 'tryRecruitOrStackResources', manager: 'recruiter' });
      GeneralInfo.getInstance().showInfo('Recruiter:', 'Rekrutacja/stakowanie surowców do rekrutacji');
      await schedule.city.switchAction();
      await this.performRecruitOrStackResources(schedule);
      this.tryCount = 0;
    } catch (e) {
      console.warn('tryRecruitOrStackResources.catch:', e);
      this.tryCount++;
      if (this.tryCount < 3) {
        this.performRecruitOrStackResources(schedule);
      }
    } finally {
      GeneralInfo.getInstance().hideInfo();
      this.lock.release();
    }
  }

  private async performRecruitOrStackResources(schedule: RecruitmentSchedule) {
    // always first from the queue
    const scheduleItem = schedule.queue[0];
    console.log('performRecruitOrStackResources:', scheduleItem);
    if (!scheduleItem) {
      console.log('no schedule item, clearing timeout and next scheduled time');
      schedule.timeoutId && clearTimeout(schedule.timeoutId);
      schedule.timeoutId = null;
      schedule.nextScheduledTime = null;
      return;
    }

    const { city } = schedule;
    const suppliersCities = scheduleItem.suppliersCities;
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
        schedule.queue.shift();
        return;
      }

      // if there is not enough storage capacity for unit, shift queue
      if (scheduleItem.unitContextInfo.unitInfo.iron > resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.wood > resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.stone > resources.storeMaxSize) {
        console.log('not enough storage capacity for unit, shifting queue');
        schedule.queue.shift();
        return;
      }

      // if there is not enough resources, stack and schedule next recruitment
      if ([woodAmountNeeded, ironAmountNeeded, stoneAmountNeeded].some(v => v > 0)) {
        const resourcesToStack: RequiredResourcesInfo = {
          target: {
            wood: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.wood * 0.9),
            iron: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.iron * 0.9),
            stone: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.stone * 0.9)
          },
          toStack: {
            wood: woodAmountNeeded,
            iron: ironAmountNeeded,
            stone: stoneAmountNeeded
          }
        }
        console.log('not enough resources, stacking:', resourcesToStack);
        await this.closeAllRecruitmentBuildingDialogs();
        const stackResult = await this.stackResources(resourcesToStack, city, suppliersCities, scheduleItem.maxShipmentTime);
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
        console.log('recruitment performed, scheduling next recruitment');
        await this.performRecruitOrStackResources(schedule);
      }
    } else {
      console.log('units');
      const woodDiff = (scheduleItem.unitContextInfo.unitInfo.wood) * scheduleItem.amountLeft! - resources.wood.amount;
      const ironDiff = (scheduleItem.unitContextInfo.unitInfo.iron) * scheduleItem.amountLeft! - resources.iron.amount;
      const stoneDiff = (scheduleItem.unitContextInfo.unitInfo.stone) * scheduleItem.amountLeft! - resources.stone.amount;
      const populationDiff = scheduleItem.unitContextInfo.unitInfo.population * scheduleItem.amountLeft! - resources.population.amount;

      // if there is not enough population, shift queue
      if (populationDiff > 0) {
        console.log('populationDiff > 0 - shifting queue');
        schedule.queue.shift();
        return;
      }

      // if there is not enough storage capacity for unit, shift queue
      if (scheduleItem.unitContextInfo.unitInfo.iron > resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.wood > resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.stone > resources.storeMaxSize) {
        console.log('not enough storage capacity for unit, shifting queue');
        schedule.queue.shift();
        return;
      }

      const woodAmountNeeded = Math.min(woodDiff < 0 ? 0 : Math.floor(woodDiff), resources.storeMaxSize * 0.9);
      const ironAmountNeeded = Math.min(ironDiff < 0 ? 0 : Math.floor(ironDiff), resources.storeMaxSize * 0.9);
      const stoneAmountNeeded = Math.min(stoneDiff < 0 ? 0 : Math.floor(stoneDiff), resources.storeMaxSize * 0.9);
      if ([woodAmountNeeded, ironAmountNeeded, stoneAmountNeeded].some(v => v > 0)) {
        const resourcesToStack: RequiredResourcesInfo = {
          target: {
            wood: Math.floor(scheduleItem.unitContextInfo.unitInfo.wood * 0.9),
            iron: Math.floor(scheduleItem.unitContextInfo.unitInfo.iron * 0.9),
            stone: Math.floor(scheduleItem.unitContextInfo.unitInfo.stone * 0.9)
          },
          toStack: {
            wood: woodAmountNeeded,
            iron: ironAmountNeeded,
            stone: stoneAmountNeeded
          }
        }
        console.log('not enough resources, stacking:', resourcesToStack);
        await this.closeAllRecruitmentBuildingDialogs();
        const stackResult = await this.stackResources(resourcesToStack, city, suppliersCities, scheduleItem.maxShipmentTime);
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
        const recruitmentOccured = await this.performRecruitment(schedule);
        // rzadki przypadek gdy nie można zarekrutować 1 jednostki (np kolon, a magazyn ma pojemność na styk)
        if (!recruitmentOccured) {
          // planowanie rekrutacji w 10 minut ponieważ zaplanowane surowce (max 90% magazynu) nie są wystarczające
          // trzeba poczekać aż surowce się uzbierają
          schedule.timeoutId = this.createTimeoutForRecruitment(schedule, 600000);
          schedule.nextScheduledTime = new Date().getTime() + 600000;
          console.log('recruitment schedule updated:', schedule);
        } else {
          console.log('recruitment performed, scheduling next recruitment');
          await this.performRecruitOrStackResources(schedule);
        }
      }
    }
  }

  private async performRecruitment(schedule: RecruitmentSchedule): Promise<boolean> {
    // recruitment process
    const item = schedule.queue[0];
    await this.closeAllRecruitmentBuildingDialogs();
    await this.goToRecruitmentBuilding(item.type);
    const recruitedUnitsAmount = await this.recruitUnits(
      item.unitContextInfo.unitSelector,
      item.amountType === 'slots' ? Infinity : item.amountLeft!,
    );

    // decrement recruitet amount
    console.log('slots');
    item.amountLeft -= item.amountType === 'slots' ? 1 : recruitedUnitsAmount;
    if (item.amountLeft <= 0) {
      schedule.queue.shift();
    }
    console.log('amount left:', item.amountLeft);
    this.renderRecruitmentQueue(schedule.queue);
    this.closeAllRecruitmentBuildingDialogs();

    return recruitedUnitsAmount > 0;
  }

  private cleanEventListeners() {
    this.eventListenersCleanupCallbacks.forEach(fn => fn());
    this.eventListenersCleanupCallbacks = [];
  }

  private async closeAllRecruitmentBuildingDialogs() {
    document.querySelectorAll('.minimized_windows_area .box-middle').forEach(el => {
      if (el.textContent?.includes('Port') || el.textContent?.includes('Koszary')) {
        (el.querySelector('.btn_wnd.close') as HTMLElement)?.click();
      }
    });
    console.log('closeAllRecruitmentBuildingDialogs');
    let closeBtns: NodeListOf<HTMLElement> | null = null;
    await waitUntil(
      () => !(closeBtns = document.querySelectorAll('.ui-dialog-titlebar-close')).length || !(Array.from(closeBtns).some(btn => (btn.parentElement?.nextSibling as HTMLElement)?.querySelector('#unit_order'))),
      { onError: () => {/* do nothing */ }, maxIterations: 3, delay: 400 }
    );
    if (closeBtns) {
      Array.from(closeBtns as NodeListOf<HTMLElement>)
        .filter(btn => !!(btn.parentElement?.nextSibling as HTMLElement)?.querySelector<HTMLElement>('#unit_order'))
        .forEach(btn => btn.click());
    }
    console.log('closeAllRecruitmentBuildingDialogs done');
  }

  private async recruitUnits(unitSelector: string, amount: number): Promise<number> {
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
    } else {
      unitInput.value = maxValue.toString();
    }
    await addDelay(100);

    // confirm recruitment in UI
    const emptySlotsBefore = document.querySelectorAll(`[role="dialog"] .various_orders_background .empty_slot`).length;
    document.getElementById('unit_order_confirm')?.click();
    await this.untilEmptySlotsAreEqual(emptySlotsBefore - 1);
    // END recruitment in UI

    return recruitedUnitAmount;
  }

  private async untilEmptySlotsAreEqual(number: number) {
    await waitUntil(() => document.querySelectorAll(`[role="dialog"] .various_orders_background .empty_slot`).length !== number)
  }

  private async goToRecruitmentBuilding(buildingType: 'barracks' | 'docks') {
    document.querySelector<HTMLElement>('[name="city_overview"]')?.click();
    await waitForElementInterval(`[data-building="${buildingType}"]`).then(el => el.click());
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
    const shuffledFromCities = shuffle([...fromCities]);
    await this.goToTradeMode(city, shuffledFromCities[0]);
    const stillNeededResources = { ...resourceInfo.toStack };

    // check if resources are alredy non its way
    let [woodRealState, stoneRealState, ironRealState] =
      Array.from(document.querySelectorAll('.amounts'))
        ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];

    while (woodRealState?.length !== 2 || stoneRealState?.length !== 2 || ironRealState?.length !== 2) {
      await addDelay(400);
      [woodRealState, stoneRealState, ironRealState] =
        Array.from(document.querySelectorAll('.amounts'))
          ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];
    }
    console.log('woodRealState:', woodRealState, 'stoneRealState:', stoneRealState, 'ironRealState:', ironRealState);

    if (woodRealState![0] >= resourceInfo.target.wood && stoneRealState![0] >= resourceInfo.target.stone && ironRealState![0] >= resourceInfo.target.iron) {
      await this.closeTradeMode();
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
        await addDelay(500);
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
      if (stillNeededResources.iron !== 0) {
        stillNeededResources.iron = ironRealState![0] + stillNeededResources.iron >= Math.floor(0.9 * ironRealState![1])
          ? Math.max(100, Math.floor(ironRealState![1] * 0.9) - ironRealState![0])
          : Math.max(100, stillNeededResources.iron);
      }

      if (stillNeededResources.stone !== 0) {
        stillNeededResources.stone = stoneRealState![0] + stillNeededResources.stone >= Math.floor(0.9 * stoneRealState![1])
          ? Math.max(100, Math.floor(stoneRealState![1] * 0.9) - stoneRealState![0])
          : Math.max(100, stillNeededResources.stone);
      }

      if (stillNeededResources.wood !== 0) {
        stillNeededResources.wood = woodRealState![0] + stillNeededResources.wood >= Math.floor(0.9 * woodRealState![1])
          ? Math.max(100, Math.floor(woodRealState![1] * 0.9) - woodRealState![0])
          : Math.max(100, stillNeededResources.wood);
      }

      console.log('stillNeededResources after checking:', stillNeededResources);


      if (stillNeededResources.wood > 0 && currentTradeCapacity >= 100 && resources.wood.amount >= 100) {
        const woodInput = await waitForElementInterval('#trade_type_wood input', { interval: 333, retries: 4 });
        const woodAmountToSend = Math.min(stillNeededResources.wood, resources.wood.amount, currentTradeCapacity);
        console.log('setting min wood value out of:', [stillNeededResources.wood, resources.wood.amount, currentTradeCapacity]);
        (woodInput as HTMLInputElement).value = woodAmountToSend.toString();
        stillNeededResources.wood -= woodAmountToSend;
        currentTradeCapacity -= woodAmountToSend;
        resourcesSent = true;
        console.log('remainning capacity:', currentTradeCapacity);
      }
      if (stillNeededResources.iron > 0 && currentTradeCapacity >= 100 && resources.iron.amount >= 100) {
        const ironInput = await waitForElementInterval('#trade_type_iron input', { interval: 333, retries: 4 })
        const ironAmountToSend = Math.min(stillNeededResources.iron, resources.iron.amount, currentTradeCapacity);
        console.log('setting min iron value out of:', [stillNeededResources.iron, resources.iron.amount, currentTradeCapacity]);
        (ironInput as HTMLInputElement).value = ironAmountToSend.toString();
        stillNeededResources.iron -= ironAmountToSend;
        currentTradeCapacity -= ironAmountToSend;
        resourcesSent = true;
        console.log('remainning capacity:', currentTradeCapacity);
      }
      if (stillNeededResources.stone > 0 && currentTradeCapacity >= 100 && resources.stone.amount >= 100) {
        const stoneInput = await waitForElementInterval('#trade_type_stone input', { interval: 333, retries: 4 })
        const stoneAmountToSend = Math.min(stillNeededResources.stone, resources.stone.amount, currentTradeCapacity);
        console.log('setting min stone value out of:', [stillNeededResources.stone, resources.stone.amount, currentTradeCapacity]);
        (stoneInput as HTMLInputElement).value = stoneAmountToSend.toString();
        stillNeededResources.stone -= stoneAmountToSend;
        currentTradeCapacity -= stoneAmountToSend;
        resourcesSent = true;
        console.log('remainning capacity:', currentTradeCapacity);
      }
      console.log(`-------------\nclicking trade button, while inputs values are: 
        woodInput:${document.querySelector<HTMLInputElement>('#trade_type_wood input')?.value} 
        stoneInput:${document.querySelector<HTMLInputElement>('#trade_type_stone input')?.value} 
        ironInput:${document.querySelector<HTMLInputElement>('#trade_type_iron input')?.value}
        capacity is: ${currentTradeCapacity}
        stillNeededResources: ${JSON.stringify(stillNeededResources)}
        `);
      document.querySelector<HTMLElement>('.btn_trade_button.button_new')?.click();

      if (currentShipmentTimeMS > highestTime && resourcesSent) highestTime = currentShipmentTimeMS;
      if (stillNeededResources.wood <= 0 && stillNeededResources.iron <= 0 && stillNeededResources.stone <= 0) {
        break;
      }
    }
    await this.closeTradeMode();
    if (stillNeededResources.wood > 0 || stillNeededResources.iron > 0 || stillNeededResources.stone > 0) {
      console.log('not fully stacked, timeMs:', highestTime);
      return {
        fullyStacked: false,
        timeMs: highestTime + 3000,
        resources: { toStack: stillNeededResources, target: resourceInfo.target }
      }
    }
    // return time in ms to last shipment
    console.log('fully stacked, timeMs:', highestTime);
    return {
      fullyStacked: true,
      timeMs: highestTime + 3000,
    }
  }

  private async closeTradeMode() {
    await waitUntil(() => {
      const closeBtn = document.querySelector('.ui-dialog-titlebar-close');
      return !closeBtn || !(closeBtn.parentElement?.nextSibling as HTMLElement)?.querySelector('#trade');
    }, { delay: 400, maxIterations: 3, onError: () => {/* do nothing */ } });
    (document.querySelector('.ui-dialog-titlebar-close') as HTMLElement)?.click();
  }

  private async goToTradeMode(city: CityInfo, fromCity: CityInfo) {
    console.log('goToTradeMode, city:', city, 'fromCity:', fromCity);
    let counter = 0;
    do {
      counter++;
      await fromCity.switchAction(false);
      await performComplexClick(document.querySelector<HTMLElement>(`#town_${city.cityId}`)).catch(() => { console.log(`no town ${city.cityId} found`) });
      await addDelay(500);
    } while (!document.querySelector<HTMLElement>('#trading') && counter < 5)
    if (counter >= 5) throw new InfoError('Couldn\'t click trading option', {})
    document.querySelector<HTMLElement>('#trading')!.click();
  }

  /**
   * Ustawia klasę obrazu jednostki w dialogu rekrutera na podstawie globalnego kontekstu jednostki.
   */
  private setDialogCurrentUnitImage() {
    const imageEl = document.querySelector<HTMLDivElement>('#current-unit-image');
    imageEl?.setAttribute('class', this.currentUnitContext!.unitImageClass);
  }

  private async setCurrentUnitContext() {
    this.closeMinimizedRecruitmentBuildingDialogs();
    const recruiterImageEl = document.getElementById('unit_order_unit_big_image');
    const unitKey = recruiterImageEl?.classList.item(2);
    const currentUnitClassAttr = 'unit_icon50x50' + ' ' + unitKey;
    const emptySlotCount = Number(document.querySelectorAll('[role="dialog"] .various_orders_background .empty_slot').length);
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

  /**
   * Tworzy listę miast na podstawie aktualnego miasta i zaznacza wybrane miasta z ostatniej operacji w kolejce
   * przypisanej do danego miasta w momencie wywołania metody.
   */
  private populateCitiesSelect(type: 'barracks' | 'docks' = 'barracks') {
    const citiesSelectElement = document.querySelector<HTMLSelectElement>('#recruiter-cities');
    if (!citiesSelectElement) return;

    const cities = this.citySwitchManager.getCityList();
    const selectedCities = this.recruitmentSchedule.find(schedule => schedule.city.name === this.citySwitchManager.getCurrentCity()?.name)?.queue.at(-1)?.suppliersCities;
    citiesSelectElement.innerHTML = '';
    for (const city of cities) {
      if (city.name === this.citySwitchManager.getCurrentCity()?.name) continue;
      const option = document.createElement('option');
      option.value = city.name;
      option.textContent = city.name;
      citiesSelectElement.appendChild(option);
      if (selectedCities?.some(sc => sc.name === city.name)) {
        option.selected = true;
      }
    }
  }

  private getEmptySlotsCount(buildingType: 'barracks' | 'docks') {
    // return Number(document.querySelectorAll('.type_unit_queue .empty_slot').length);
    return Number(document.querySelectorAll(`.type_unit_queue.${buildingType}`)[0].querySelectorAll('.empty_slot').length);
  }

  private getCurrentUnitContextCopy() {
    return JSON.parse(JSON.stringify(this.currentUnitContext));
  }

  private renderRecruitmentQueue(queue: RecruitmentQueueItem[]) {
    const recruitmentQueueEl = document.getElementById('recruiter-queue-content');
    if (!recruitmentQueueEl) return;

    recruitmentQueueEl.innerHTML = '';
    /*
      <div id="recruiter-queue-content">
        <div class="recruiter-queue-item">
          <div class="recruiter-queue-item-image"></div>
          <span class="recruiter-queue-item-info">name</span>
        </div>
      </div>
    */
    for (const [id, item] of queue.entries()) {
      const queueItemEl = document.createElement('div');
      queueItemEl.classList.add('recruiter-queue-item');

      const imageEl = document.createElement('div');
      imageEl.setAttribute('class', item.unitContextInfo.unitImageClass);
      imageEl.classList.add('recruiter-queue-item-image');
      queueItemEl.appendChild(imageEl);

      const infoEl = document.createElement('span');
      infoEl.classList.add('recruiter-queue-item-info');
      infoEl.textContent = `${item.amount}x ${item.amountType === 'slots' ? 'slots' : 'units'}`;
      queueItemEl.appendChild(infoEl);

      const deleteBtn = document.createElement('button');
      deleteBtn.setAttribute('type', 'button');
      deleteBtn.classList.add('recruiter-queue-item-delete-btn');
      deleteBtn.textContent = 'x';
      queueItemEl.appendChild(deleteBtn);

      const onDeleteClick = () => {
        queue.splice(id, 1);
        deleteBtn.removeEventListener('click', onDeleteClick)
        this.renderRecruitmentQueue(queue);
      }
      deleteBtn.addEventListener('click', onDeleteClick);

      recruitmentQueueEl!.appendChild(queueItemEl);
    }
  }
  private closeMinimizedRecruitmentBuildingDialogs() {
    document.querySelectorAll('.minimized_windows_area .box-middle').forEach(el => {
      if (el.textContent?.includes('Port') || el.textContent?.includes('Koszary')) (el.querySelector('.btn_wnd.close') as HTMLElement)?.click();
    });
  }
}