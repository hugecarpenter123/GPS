import MasterQueue from "../master-queue/master-queue";
import ConfigManager from "../../utility/config-manager";
import { InfoError } from "../../utility/info-error";
import { addDelay, textToMs, waitUntil } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { waitForElementInterval } from "../../utility/ui-utility";
import CharmsUtility, { CityCharm } from "../charms/charms-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import GeneralInfo from "../master/ui/general-info";
import ResourceManager from "../resources/resource-manager";
import TradeManager from "../trade/trade-manager";
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

export type ScheduleOperationDetails = {
  city: CityInfo;
  queueItem: RecruiterQueueItem;
  onFinishCallback: () => void;
  setScheduleTimeout: (timeoutId: NodeJS.Timeout, nextScheduleDate: number) => void;
  shiftQueueAndNext: () => void;
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

export type RecruiterQueueItem = {
  type: 'barracks' | 'docks';
  supplierCities: CityInfo[];
  maxShipmentTime: number;
  unitContextInfo: UnitContext;
  amountType: 'units' | 'slots';
  amount: number;
  amountLeft: number;
  charms?: {
    required: CityCharm[];
    optional: CityCharm[];
  }
}

/*
w momencie kliknięcia add:
-item zostaje dodany do master queue
*/

export default class Recruiter {
  public static readonly MAX_DELIVERY_TIME_MS = 1000 * 60 * 25;
  private static instance: Recruiter;
  private resourceManager!: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;
  private tryCount: number = 0;
  private config!: ReturnType<typeof ConfigManager.prototype.getConfig>;
  private tradeManager!: TradeManager;
  private masterQueue!: MasterQueue;

  private RUN: boolean = false;
  private observer: MutationObserver | null = null;
  private unitChangeObserver: MutationObserver | null = null;
  private recruitmentBuildingDialogAttr: string | null = null;

  private currentUnitContext: UnitContext | null = null;
  private eventListenersCleanupCallbacks: (() => void)[] = [];

  private constructor() { };

  public static async getInstance() {
    if (!Recruiter.instance) {
      Recruiter.instance = new Recruiter();
      Recruiter.instance.addCSS();
      Recruiter.instance.resourceManager = await ResourceManager.getInstance();
      Recruiter.instance.lock = Lock.getInstance();
      Recruiter.instance.citySwitchManager = await CitySwitchManager.getInstance();
      Recruiter.instance.config = ConfigManager.getInstance().getConfig();
      Recruiter.instance.tradeManager = await TradeManager.getInstance();
      Recruiter.instance.masterQueue = await MasterQueue.getInstance();
    }
    return Recruiter.instance;
  }

  private addCSS() {
    const style = document.createElement('style');
    style.textContent = recruiterDialogCSS;
    document.head.appendChild(style);
  }

  public async execute(operationDetails: ScheduleOperationDetails) {
    console.log('execute:', operationDetails);
    await this.tryRecruitOrStackResources(operationDetails);
  }

  private addRecruiterDialogHTML() {
    const recruiterDialogContainer = document.createElement('div');
    recruiterDialogContainer.id = 'recruiter-container';
    recruiterDialogContainer.style.zIndex = '2000';
    recruiterDialogContainer.innerHTML = recruiterDialogHTML;
    if (this.config.masterQueue.autoReevaluate) {
      recruiterDialogContainer.querySelector<HTMLDivElement>('#recruiter-cities')?.parentElement?.classList.add('hidden');
    }
    document.body.appendChild(recruiterDialogContainer);
    this.addCharmsToDialog();
  }

  private addCharmsToDialog() {
    const charms = CharmsUtility.getRecruitmentSpecificCharms();
    const requiredList = document.getElementById('recruiter-charms-required-list');
    const optionalList = document.getElementById('recruiter-charms-optional-list');

    charms.forEach(charm => {
      const item = document.createElement('div');
      item.setAttribute('class', charm.classes);
      item.classList.add('recruiter-charms-item');
      item.dataset.powerId = charm.dataPowerId;
      const onClickClb = () => {
        item.classList.toggle('selected');
        if (item.classList.contains('selected')) {
          const sameCharmOptional = optionalList?.querySelector(`[data-power-id="${charm.dataPowerId}"]`);
          sameCharmOptional?.classList.remove('selected');
        }
      }
      item.addEventListener('click', onClickClb);
      this.eventListenersCleanupCallbacks.push(() => item.removeEventListener('click', onClickClb));
      requiredList?.appendChild(item);
    })

    charms.forEach(charm => {
      const item = document.createElement('div');
      item.setAttribute('class', charm.classes);
      item.classList.add('recruiter-charms-item');
      item.dataset.powerId = charm.dataPowerId;
      const onClickClb = () => {
        item.classList.toggle('selected');
        if (item.classList.contains('selected')) {
          const sameCharmRequired = requiredList?.querySelector(`[data-power-id="${charm.dataPowerId}"]`);
          sameCharmRequired?.classList.remove('selected');
        }
      }
      item.addEventListener('click', onClickClb);
      this.eventListenersCleanupCallbacks.push(() => item.removeEventListener('click', onClickClb));
      optionalList?.appendChild(item);
    })
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
    this.addRecruiterDialogHTML();

    // adds event listeners to the toggle button
    this.addEntryEventListener(node, type);
    this.attachOnCityChangeCallback();
    this.mountUnitChangeObserver();

    this.renderQueue(this.citySwitchManager.getCurrentCity());
  }

  /**
   * Dodaje onclick listenera, dla toggle buttona. Gdy zostanie wciśnięty poraz pierwszy, to inicjalizuje
   * wszystkie inne listenery potrzebne do obłsugi funkcjonalności. W przeciwnym razie, jedynym listenerem jest toggle onClick.
   */
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
        this.initEventListeners(type);
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
      this.renderQueue(city);
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
  private async initEventListeners(type: 'barracks' | 'docks') {
    this.populateCitiesSelect();

    const recruiterDialog = document.getElementById('recruiter-dialog');
    const recruiterNav = recruiterDialog?.querySelector<HTMLElement>('#recruiter-nav');

    const recruiterCloseBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-close-btn');
    const recruiterAddBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-add-btn');

    const amountTypeRadios = recruiterDialog?.querySelectorAll<HTMLInputElement>('[name="recruiter-type"]');
    const amountInput = recruiterDialog?.querySelector<HTMLInputElement>('#recruiter-ammount');
    const amountMaxCheckbox = recruiterDialog?.querySelector<HTMLInputElement>('#recruiter-amount-max');
    const citiesSelect = recruiterDialog?.querySelector<HTMLSelectElement>('#recruiter-cities');
    const shipmentTimeSelect = recruiterDialog?.querySelector<HTMLSelectElement>('#shipment-time');

    const buttonsSection = document.querySelector<HTMLElement>('.recruiter-buttons-section')!;
    this.masterQueue.getNavigation('city', this.citySwitchManager.getCurrentCity()!, buttonsSection);

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
     * Closes recruiter dialog
     */
    const closeButtonAction = () => {
      console.log('close');
      recruiterDialog!.hidden = true;
    }
    recruiterCloseBtn?.addEventListener('click', closeButtonAction);
    this.eventListenersCleanupCallbacks.push(() => recruiterCloseBtn?.removeEventListener('click', closeButtonAction));

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
      const charms = this.getSelectedCharms();

      let selectedCities: CityInfo[];
      // if auto reevaluation is disabled, selected cities are cities from the select apart from source city
      if (!this.config.masterQueue.autoReevaluate) {
        selectedCities = citiesSelectValue.map(cityName => this.citySwitchManager.getCityByName(cityName))
          .filter(city => city !== undefined && city.name !== sourceCity?.name) as CityInfo[];
      } else {
        // if auto reevaluation is enabled, all cities are selected apart from those already recruiting in other cities (apart from source city)
        const busyCityNames = this.masterQueue.getBusyCities().map(city => city.name);
        selectedCities = this.citySwitchManager.getCityList().filter(city => !busyCityNames.includes(city.name) && city.name !== sourceCity?.name);
      }

      if (amountMaxCheckboxValue) {
        const properMaxSlotsAmount = this.getEmptySlotsCount(type) - this.masterQueue.getCityRecruiterSchedule(sourceCity!).reduce((acc, item) => {
          if (item.type === type) {
            if (item.amountType === 'slots') {
              return acc + item.amount;
            }
            // jezeli units, to załóż że tylko 95% zasobu potrzebnego na jednostkę będzie dostępne w magazynie 
            // (potencjalnie jeden slot więcej może dojść - co jest bezpiecznie)
            return acc + Math.floor((item.unitContextInfo.requiredResourcesPerSlot.population * 0.95) / (item.unitContextInfo.unitInfo.population * item.amount));
          }
          return acc;
        }, 0);
        this.masterQueue.addToQueue(sourceCity!, 'recruiter', {
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          amount: properMaxSlotsAmount,
          amountLeft: properMaxSlotsAmount,
          type: type,
          supplierCities: selectedCities,
          maxShipmentTime: shipmentTime,
          charms
        })
      } else if (amountType === 'units') {
        this.masterQueue.addToQueue(sourceCity!, 'recruiter', {
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'units',
          amount: Number(amountInputValue),
          amountLeft: Number(amountInputValue),
          type: type,
          supplierCities: selectedCities,
          maxShipmentTime: shipmentTime,
          charms
        });
      } else if (amountType === 'slots') {
        this.masterQueue.addToQueue(sourceCity!, 'recruiter', {
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          amount: Number(amountInputValue),
          amountLeft: Number(amountInputValue),
          type: type,
          supplierCities: selectedCities,
          maxShipmentTime: shipmentTime,
          charms
        });
      }
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

  private getSelectedCharms() {
    const selectedRequiredCharms =
      Array.from(document.querySelectorAll<HTMLElement>('#recruiter-charms-required-list .recruiter-charms-item.selected'))
        .map(el => CharmsUtility.getCharmByPowerId(el.dataset.powerId!)!) ?? []

    const selectedOptionalCharms =
      Array.from(document.querySelectorAll<HTMLElement>('#recruiter-charms-optional-list .recruiter-charms-item.selected'))
        .map(el => CharmsUtility.getCharmByPowerId(el.dataset.powerId!)!) ?? []

    return {
      required: selectedRequiredCharms,
      optional: selectedOptionalCharms
    }
  }

  private async tryRecruitOrStackResources(operationDetails: ScheduleOperationDetails) {
    try {
      await this.lock.acquire({ method: 'tryRecruitOrStackResources', manager: 'recruiter' });
      GeneralInfo.getInstance().showInfo('Recruiter:', 'Rekrutacja/stakowanie surowców do rekrutacji');
      await operationDetails.city.switchAction();
      await this.performRecruitOrStackResources(operationDetails);
      this.tryCount = 0;
    } catch (e) {
      console.warn('tryRecruitOrStackResources.catch:', e);
      this.tryCount++;
      if (this.tryCount < 3) {
        this.performRecruitOrStackResources(operationDetails);
      }
    } finally {
      GeneralInfo.getInstance().hideInfo();
      this.lock.release();
    }
  }

  private async performRecruitOrStackResources(operationDetails: ScheduleOperationDetails) {
    // always first from the queue
    const scheduleItem = operationDetails.queueItem;
    console.log('performRecruitOrStackResources:', scheduleItem);
    const { city } = operationDetails;
    const { supplierCities, charms } = scheduleItem;
    if (charms?.required && !CharmsUtility.areCharmsCastedOrAvailable(charms?.required)) {
      // TODO: get real timeout based on charms getting castable
      const timeout = this.createTimeoutForRecruitment(operationDetails, 10 * 60 * 1000);
      operationDetails.setScheduleTimeout(timeout, new Date().getTime() + 10 * 60 * 1000);
    } else {
      // TODO: delete
      console.log(`charms (${JSON.stringify((charms?.required.concat(charms.optional))?.map(c => c.dataPowerId))}) casted or available, can stack resources`)
    }

    const resources = await this.resourceManager.getResourcesInfo();

    if (scheduleItem.amountType === 'slots') {
      const targetResources = {
        wood: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.wood * 0.9),
        iron: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.iron * 0.9),
        stone: Math.floor(scheduleItem.unitContextInfo.requiredResourcesPerSlot.stone * 0.9),
      };

      const hasEnoughResources = await this.resourceManager.hasEnoughResources(targetResources);
      // const hasEnoughPopulationPerSlot = resources.population.amount - scheduleItem.unitContextInfo.requiredResourcesPerSlot.population >= this.config.resources.minPopulationBuffer;
      const hasEnoughPopulationPerSlot = resources.population.amount - scheduleItem.unitContextInfo.requiredResourcesPerSlot.population >= 0;
      const hasEnoughStorageCapacityPerUnit = scheduleItem.unitContextInfo.unitInfo.iron < resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.wood < resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.stone < resources.storeMaxSize

      if (!hasEnoughPopulationPerSlot) {
        console.log('population exceeded min buffer, shifting queue');
        operationDetails.shiftQueueAndNext();
        return;
      }

      if (!hasEnoughStorageCapacityPerUnit) {
        console.log('not enough storage capacity for unit, shifting queue');
        operationDetails.shiftQueueAndNext();
        return;
      }

      if (!hasEnoughResources) {
        const stackResult = await this.tradeManager.stackResources(targetResources, city, supplierCities, scheduleItem.maxShipmentTime);
        if (stackResult.fullyStacked) {
          console.log('fully stacked, scheduling recruitment');
          const timeMs = stackResult.timeMs!;
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, timeMs), new Date().getTime() + timeMs);
        } else {
          console.log('not fully stacked, rescheduling stacking in 10 minutes');
          // schedule in 10 minutes
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 600000), new Date().getTime() + 600000);
        }
      } else {
        console.log('enough resources, performing recruitment');
        const recruitmentResult = await this.performRecruitment(operationDetails);
        if (recruitmentResult === 'reschedule') {
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 10 * 60 * 1000), new Date().getTime() + 10 * 60 * 1000);
        } else if (recruitmentResult === 'done') {
          operationDetails.onFinishCallback();
        } else if (recruitmentResult === 'partial') {
          console.log('recruitment partially performed, scheduling next round');
          await this.performRecruitOrStackResources(operationDetails);
        } else if (recruitmentResult === 'failed') {
          // in case its one unit but takes most of the store capacity, and stacking provided only 90% of the resources but 100% is required
          console.log('recruitment failed, but teoretically should be possible, so rescheduling in 10 minutes');
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 10 * 60 * 1000), new Date().getTime() + 10 * 60 * 1000);
        }
      }
    } else {
      const needsMoreResourcesThanOneSlot = scheduleItem.unitContextInfo.unitInfo.population * scheduleItem.amountLeft! > scheduleItem.unitContextInfo.requiredResourcesPerSlot.population;
      const targetResources = {
        wood: Math.floor(
          needsMoreResourcesThanOneSlot
            ? scheduleItem.unitContextInfo.requiredResourcesPerSlot.wood * 0.9
            : scheduleItem.unitContextInfo.unitInfo.wood * scheduleItem.amountLeft!,
        ),
        iron: Math.floor(
          needsMoreResourcesThanOneSlot
            ? scheduleItem.unitContextInfo.requiredResourcesPerSlot.iron * 0.9
            : scheduleItem.unitContextInfo.unitInfo.iron * scheduleItem.amountLeft!,
        ),
        stone: Math.floor(
          needsMoreResourcesThanOneSlot
            ? scheduleItem.unitContextInfo.requiredResourcesPerSlot.stone * 0.9
            : scheduleItem.unitContextInfo.unitInfo.stone * scheduleItem.amountLeft!,
        ),
      };

      const hasEnoughResources = await this.resourceManager.hasEnoughResources(targetResources);
      // const hasEnoughPopulation = resources.population.amount - scheduleItem.unitContextInfo.unitInfo.population >= this.config.resources.minPopulationBuffer;
      const hasEnoughPopulation = resources.population.amount - scheduleItem.unitContextInfo.unitInfo.population * scheduleItem.amountLeft! >= 0;
      const hasEnoughStorageCapacityPerUnit = scheduleItem.unitContextInfo.unitInfo.iron < resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.wood < resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.stone < resources.storeMaxSize

      if (!hasEnoughPopulation) {
        console.log('population exceeded min buffer, shifting queue');
        operationDetails.shiftQueueAndNext();
        return;
      }
      if (!hasEnoughStorageCapacityPerUnit) {
        console.log('not enough storage capacity for unit, shifting queue');
        operationDetails.shiftQueueAndNext();
        return;
      }
      if (!hasEnoughResources) {
        await this.closeAllRecruitmentBuildingDialogs();
        const stackResult = await this.tradeManager.stackResources(targetResources, city, supplierCities, scheduleItem.maxShipmentTime);
        if (stackResult.fullyStacked) {
          console.log('fully stacked, scheduling recruitment');
          const timeMs = stackResult.timeMs!;
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, timeMs), new Date().getTime() + timeMs);
        } else {
          console.log('not fully stacked, scheduling in 10 minutes');
          // schedule in 10 minutes
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 600000), new Date().getTime() + 600000);
        }
      } else {
        const recruitmentResult = await this.performRecruitment(operationDetails);
        if (recruitmentResult === 'reschedule') {
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 10 * 60 * 1000), new Date().getTime() + 10 * 60 * 1000);
        } else if (recruitmentResult === 'done') {
          operationDetails.onFinishCallback();
        } else if (recruitmentResult === 'partial') {
          console.log('recruitment partially performed, scheduling next round');
          await this.performRecruitOrStackResources(operationDetails);
        } else if (recruitmentResult === 'failed') {
          console.log('recruitment failed, shifting queue');
          operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 10 * 60 * 1000), new Date().getTime() + 10 * 60 * 1000);
        }
      }
    }
  }

  private async getTimeToFreeSlot(buildingType: 'barracks' | 'docks') {
    const timeToFinishElement = await waitForElementInterval(`#unit_order.${buildingType}_building .first_order .type_unit_queue .curr`, { retries: 2, interval: 333 }).catch(() => null);
    const timeToFinish = timeToFinishElement?.textContent?.match(/(\d+:\d+:\d+)/)?.[0] ? textToMs(timeToFinishElement.textContent!) : undefined;
    if (!timeToFinish) {
      throw new Error('No time to finish element found');
    }
    return timeToFinish;
  }


  private async performRecruitment(operationDetails: ScheduleOperationDetails): Promise<'done' | 'failed' | 'partial' | 'reschedule'> {
    // recruitment process
    const item = operationDetails.queueItem;

    // handle charms ----------------
    console.log('performRecruitment, item charms:', item.charms)
    const requiuredCharmsCasted = CharmsUtility.castCharms(item.charms ?? {});
    console.log('requiredCharmsCasted:', requiuredCharmsCasted)
    if (!requiuredCharmsCasted) {
      GeneralInfo.getInstance().showError('Recruiter', 'Nie udało się rzucić wymaganych zaklęć, ponowna próba za 10 minut', 5000);
      await this.closeAllRecruitmentBuildingDialogs();
      return 'reschedule';
    }
    // END handle charms ------------

    await this.closeAllRecruitmentBuildingDialogs();
    await this.goToRecruitmentBuilding(item.type);

    // free slots check
    // const freeSlots = this.getEmptySlotsCount(item.type);
    // if (!freeSlots) {
    //   const timeToFreeSlot = await this.getTimeToFreeSlot(item.type);
    //   const minutes20 = 20 * 60 * 1000;
    //   if (timeToFreeSlot < minutes20) {
    //     // reschedule recruitment
    //     this.createTimeoutForRecruitment(schedule, timeToFreeSlot);
    //     schedule.nextScheduledTime = new Date().getTime() + timeToFreeSlot;
    //     console.log('recruitment schedule updated:', schedule);
    //     return 'rescheduled';
    //   } else {
    //     // find element with different type and move it to the front
    //     const index = schedule.queue.findIndex(item => item.type != item.type);
    //     if (index !== -1) {
    //       const before = schedule.queue.slice(0, index);
    //       const after = schedule.queue.slice(index + 1);
    //       schedule.queue = [schedule.queue[index], ...before, ...after];
    //       this.tryRecruitOrStackResources(schedule);
    //       return 'rescheduled';
    //     } else {
    //       this.createTimeoutForRecruitment(schedule, timeToFreeSlot);
    //       schedule.nextScheduledTime = new Date().getTime() + timeToFreeSlot;
    //       console.log('recruitment schedule updated:', schedule);
    //       return 'rescheduled';
    //     }
    //   }
    // }
    // end free slots check

    const recruitedUnitsAmount = await this.recruitUnits(
      item.unitContextInfo.unitSelector,
      item.amountType === 'slots' ? Infinity : item.amountLeft!,
    );

    // decrement recruited amount
    console.log('item.amountLeft before:', item.amountLeft);
    item.amountLeft -= item.amountType === 'slots' ? 1 : recruitedUnitsAmount;
    this.closeAllRecruitmentBuildingDialogs();

    if (item.amountLeft <= 0) {
      return 'done';
    } else {
      return recruitedUnitsAmount > 0 ? 'partial' : 'failed';
    }
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

  /**
   * Rekrutuje jednostki w dialogu rekrutera. 
   * @param unitSelector Selektor jednostki w dialogu rekrutera.
   * @param amount Liczba jednostek do rekrutacji.
   * @returns Liczba rekrutowanych jednostek.
   */
  private async recruitUnits(unitSelector: string, amount: number): Promise<number> {
    let counter = 0;
    do {
      counter++
      document.querySelector<HTMLElement>(unitSelector)?.click();
      await addDelay(400);
      if (counter > 5) { throw new InfoError('Unit cant get selected...', {}) }
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
    await waitUntil(() => !!document.querySelector<HTMLElement>(`#unit_order.${buildingType}_building`));
  }

  private createTimeoutForRecruitment(operationDetails: ScheduleOperationDetails, timeMs: number) {
    console.log('createTimeoutForRecruitment:', timeMs);
    return setTimeout(() => {
      this.tryRecruitOrStackResources(operationDetails);
    }, timeMs);
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
  private populateCitiesSelect() {
    const citiesSelectElement = document.querySelector<HTMLSelectElement>('#recruiter-cities');
    if (!citiesSelectElement) return;

    // if auto reevaluation is enabled, clear the select (don't show any cities, all are selected by default)
    if (this.config.masterQueue.autoReevaluate) {
      return;
    }
    const cities = this.citySwitchManager.getCityList();
    citiesSelectElement.innerHTML = '';
    for (const city of cities) {
      if (city.name === this.citySwitchManager.getCurrentCity()?.name) continue;
      const option = document.createElement('option');
      option.value = city.name;
      option.textContent = city.name;
      citiesSelectElement.appendChild(option);
    }
  }

  /**
   * Zwraca liczbę pustych slotów w rekruterze.
   * @param buildingType Typ budynku rekrutera.
   * @returns Liczba pustych slotów.
   * @requires
   * - Budynek rekrutera musi być otwarty.
   */
  private getEmptySlotsCount(buildingType: 'barracks' | 'docks') {
    // return Number(document.querySelectorAll('.type_unit_queue .empty_slot').length);
    return Number(document.querySelectorAll(`.type_unit_queue.${buildingType}`)[0].querySelectorAll('.empty_slot').length);
  }

  private getCurrentUnitContextCopy() {
    return JSON.parse(JSON.stringify(this.currentUnitContext));
  }

  private renderQueue(city?: CityInfo) {
    const recruitmentQueueEl = document.getElementById('recruiter-queue-content');
    if (!recruitmentQueueEl) return;
    recruitmentQueueEl.innerHTML = '';
    if (city) {
      recruitmentQueueEl.appendChild(this.masterQueue.getCityQueueUI(city));
    }
  }

  private closeMinimizedRecruitmentBuildingDialogs() {
    document.querySelectorAll('.minimized_windows_area .box-middle').forEach(el => {
      if (el.textContent?.includes('Port') || el.textContent?.includes('Koszary')) (el.querySelector('.btn_wnd.close') as HTMLElement)?.click();
    });
  }


  public async isRealQueueFull(type: 'barracks' | 'docks', city?: CityInfo): Promise<{ isRealQueueFull: boolean, timeToFreeSlot: number }> {
    if (city) await city.switchAction(false);
    await this.goToRecruitmentBuilding(type);
    const emptySlots = this.getEmptySlotsCount(type);
    const returnValue = { isRealQueueFull: !emptySlots, timeToFreeSlot: 0 };
    if (!emptySlots) {
      returnValue.timeToFreeSlot = await this.getTimeToFreeSlot(type);
    }
    await this.closeAllRecruitmentBuildingDialogs();
    return returnValue;
  }
}