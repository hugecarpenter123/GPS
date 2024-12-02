import { TConfigChanges } from "../../config-popup/config-popup";
import ConfigManager from "../../utility/config-manager";
import { InfoError } from "../../utility/info-error";
import { addDelay, shuffle, textToMs, waitUntil } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, waitForElementInterval } from "../../utility/ui-utility";
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

type RecruitmentSchedule = {
  city: CityInfo
  timeoutId: NodeJS.Timeout | null;
  nextScheduledTime: number | null;
  queue: RecruitmentQueueItem[]
}

export default class Recruiter {
  public static readonly MAX_DELIVERY_TIME_MS = 1000 * 60 * 25;
  private static instance: Recruiter;
  private initialized: boolean = false;
  private resourceManager!: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;
  private tryCount: number = 0;
  private config!: ReturnType<typeof ConfigManager.prototype.getConfig>;
  private tradeManager!: TradeManager;

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
      Recruiter.instance.config = ConfigManager.getInstance().getConfig();
      Recruiter.instance.tradeManager = await TradeManager.getInstance();
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

  private addRecruiterDialogHTML() {
    const recruiterDialogContainer = document.createElement('div');
    recruiterDialogContainer.id = 'recruiter-container';
    recruiterDialogContainer.style.zIndex = '2000';
    recruiterDialogContainer.innerHTML = recruiterDialogHTML;
    if (this.config.recruiter.autoReevaluate) {
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

  public handleRecruiterConfigChange(configChanges: TConfigChanges['recruiter']) {
    console.log('handleRecruiterConfigChange():', configChanges);
    if (configChanges.autoReevaluate && this.config.recruiter.autoReevaluate) {
      console.log('reevaluating provider cities');
      this.reevaluateProviderCities();
    }
  }

  private reevaluateProviderCities() {
    const recruitingCities = this.recruitmentSchedule.filter(schedule => schedule.queue.length > 0).map(schedule => schedule.city);
    this.recruitmentSchedule.forEach(schedule => {
      schedule.queue.forEach(item => {
        item.supplierCities = this.citySwitchManager.getCityList().filter(city => !recruitingCities.includes(city));
      });
    });
  }

  public async start() {
    console.log('recruiter start');
    if (!this.initialized) {
      this.loadSchedule();
      this.initialized = true;
    }

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
    this.addRecruiterDialogHTML();

    // adds event listeners to the toggle button
    this.addEntryEventListener(node, type);
    this.attachOnCityChangeCallback();
    this.mountUnitChangeObserver();

    const citySchedule = this.recruitmentSchedule.find(item => item.city.name === this.citySwitchManager.getCurrentCity()?.name);
    this.renderRecruitmentQueue(citySchedule);
  }

  /**
   * Dodaje onclick listenera, dla toggle buttona. Gry zostanie wciśnięty poraz pierwszy, to inicjalizuje
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
      const citySchedule = this.recruitmentSchedule.find(item => item.city.name === city.name);
      this.renderRecruitmentQueue(citySchedule);
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
      this.renderRecruitmentQueue(null);
      this.persistSchedule();
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

      // reevaluate provider cities if auto reevaluate is enabled after confirming new schedule
      // TODO: rethink where to put this line (maybe this place is not bad, but is called always)
      if (this.config.recruiter.autoReevaluate) {
        this.reevaluateProviderCities();
        console.log('provider cities reevaluated, schedule:', this.recruitmentSchedule);
      }

      this.persistSchedule();

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
      const charms = this.getSelectedCharms();

      const scheduleExists = this.recruitmentSchedule.find(schedule => schedule.city.name === sourceCity?.name);
      const schedule: RecruitmentSchedule = scheduleExists ?? {
        city: sourceCity!,
        nextScheduledTime: null,
        timeoutId: null,
        queue: []
      };

      let selectedCities: CityInfo[];
      // if auto reevaluation is enabled, selected cities are cities from the select apart from source city
      if (this.config.recruiter.autoReevaluate) {
        selectedCities = citiesSelectValue.map(cityName => this.citySwitchManager.getCityByName(cityName))
          .filter(city => city !== undefined && city.name !== sourceCity?.name) as CityInfo[];
      } else {
        // if auto reevaluation is disabled, all cities are selected apart from those already recruiting in other cities (apart from source city)
        const recruitingCities = this.recruitmentSchedule.map(schedule => schedule.city.name);
        selectedCities = this.citySwitchManager.getCityList().filter(city => !recruitingCities.includes(city.name) || city.name !== sourceCity?.name);
      }

      if (amountMaxCheckboxValue) {
        // TODO: lepiej wykalkulować ilość slotów w przyadku gdy itemy w kolejce nie są slots
        const properMaxSlotsAmount = this.getEmptySlotsCount(type) - schedule.queue.reduce((acc, item) => acc + (item.amountType === 'slots' ? item.amount : 1), 0);
        schedule.queue.push({
          unitContextInfo: this.getCurrentUnitContextCopy(),
          amountType: 'slots',
          amount: properMaxSlotsAmount,
          amountLeft: properMaxSlotsAmount,
          type: type,
          supplierCities: selectedCities,
          maxShipmentTime: shipmentTime,
          charms
        });
      } else if (amountType === 'units') {
        schedule.queue.push({
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
        schedule.queue.push({
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

      if (!scheduleExists) {
        console.log('schedue does not exist, pushing new schedule');
        this.recruitmentSchedule.push(schedule);
      }
      this.renderRecruitmentQueue(schedule);
      this.persistSchedule();
      console.log('scheduleItem added:', schedule);
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

  private persistSchedule() {
    localStorage.setItem('recruitmentSchedule', JSON.stringify(this.recruitmentSchedule.filter(item => item.queue.length)));
  }

  /*
   * TODO: In order to use persisted schedule one must after initialization confirm that this schedule is valid.
   * Also cityInfo must be hydrated as its expected to have switchAction method.
   */
  private loadSchedule() {
    const unparsedSchedule = localStorage.getItem('recruitmentSchedule');
    if (unparsedSchedule) {
      const schedule: RecruitmentSchedule[] = JSON.parse(unparsedSchedule);
      const isAnyQueue = schedule.some(item => item.queue.length);
      if (isAnyQueue) {
        if (this.simpleScheduleLoadConfirmationDialog(schedule)) {
          this.recruitmentSchedule = this.hydrateSchedule(schedule);
        } else {
          this.recruitmentSchedule = [];
          this.persistSchedule();
        }
      }
    } else {
      this.recruitmentSchedule = [];
    }
  }

  private simpleScheduleLoadConfirmationDialog(schedule: RecruitmentSchedule[]) {
    let message = `Czy chcesz kontynuować poprzednią sesje rekrutacji?`;
    schedule.forEach(item => {
      if (item.queue.length) {
        message += `\n${item.city.name}:\n${item.queue.map(q => {
          const unitName = q.unitContextInfo.unitSelector.split('.').at(-1);
          return `\t${unitName} x ${q.amountLeft} ${q.amountType === 'slots' ? 'slotów' : 'jednostek'}`
        }).join('\n')}`;
      }
    })
    const confirm = window.confirm(message);
    return confirm;
  }

  private hydrateSchedule(schedule: RecruitmentSchedule[]) {
    schedule.forEach(item => {
      console.log('hydrating schedule item:', item);
      item.city = this.citySwitchManager.getCityByName(item.city.name)!;
      console.log('city:', item.city);
      item.queue.forEach(q => {
        console.log('hydrating queue item.supplierCities:', q.supplierCities);
        if (q.supplierCities) {
          q.supplierCities = q.supplierCities.map(city => this.citySwitchManager.getCityByName(city.name) ?? null).filter(Boolean) as CityInfo[];
          console.log('supplierCities:', q.supplierCities);
        }
      });
    });
    return schedule;
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
    const { supplierCities, charms } = scheduleItem;
    if (charms?.required && !CharmsUtility.areCharmsCastedOrAvailable(charms?.required)) {
      // TODO: get real timeout based on charms getting castable
      this.createTimeoutForRecruitment(schedule, 10 * 60 * 1000);
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
        schedule.queue.shift();
        return;
      }

      if (!hasEnoughStorageCapacityPerUnit) {
        console.log('not enough storage capacity for unit, shifting queue');
        schedule.queue.shift();
        return;
      }

      if (!hasEnoughResources) {
        const stackResult = await this.tradeManager.stackResources(targetResources, city, supplierCities, scheduleItem.maxShipmentTime);
        if (stackResult.fullyStacked) {
          console.log('fully stacked, scheduling recruitment');
          const timeMs = stackResult.timeMs!;
          schedule.timeoutId = this.createTimeoutForRecruitment(schedule, timeMs);
          schedule.nextScheduledTime = new Date().getTime() + timeMs;
        } else {
          console.log('not fully stacked, rescheduling stacking in 10 minutes');
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
      const targetResources = {
        wood: Math.floor(Math.min(resources.storeMaxSize, scheduleItem.unitContextInfo.unitInfo.wood * scheduleItem.amountLeft!, resources.storeMaxSize * 0.9)),
        iron: Math.floor(Math.min(resources.storeMaxSize, scheduleItem.unitContextInfo.unitInfo.iron * scheduleItem.amountLeft!, resources.storeMaxSize * 0.9)),
        stone: Math.floor(Math.min(resources.storeMaxSize, scheduleItem.unitContextInfo.unitInfo.stone * scheduleItem.amountLeft!, resources.storeMaxSize * 0.9)),
      };

      const hasEnoughResources = await this.resourceManager.hasEnoughResources(targetResources);
      // const hasEnoughPopulation = resources.population.amount - scheduleItem.unitContextInfo.unitInfo.population >= this.config.resources.minPopulationBuffer;
      const hasEnoughPopulation = resources.population.amount - scheduleItem.unitContextInfo.unitInfo.population * scheduleItem.amountLeft! >= 0;
      const hasEnoughStorageCapacityPerUnit = scheduleItem.unitContextInfo.unitInfo.iron < resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.wood < resources.storeMaxSize ||
        scheduleItem.unitContextInfo.unitInfo.stone < resources.storeMaxSize

      if (!hasEnoughPopulation) {
        console.log('population exceeded min buffer, shifting queue');
        schedule.queue.shift();
        return;
      }
      if (!hasEnoughStorageCapacityPerUnit) {
        console.log('not enough storage capacity for unit, shifting queue');
        schedule.queue.shift();
        return;
      }
      if (!hasEnoughResources) {
        await this.closeAllRecruitmentBuildingDialogs();
        const stackResult = await this.tradeManager.stackResources(targetResources, city, supplierCities, scheduleItem.maxShipmentTime);
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

    // handle charms ----------------
    console.log('performRecruitment, item charms:', item.charms)
    const requiuredCharmsCasted = CharmsUtility.castCharms(item.charms ?? {});
    console.log('requiredCharmsCasted:', requiuredCharmsCasted)
    if (!requiuredCharmsCasted) {
      GeneralInfo.getInstance().showError('Recruiter', 'Nie udało się rzucić wymaganych zaklęć, ponowna próba za 10 minut', 5000);
      this.createTimeoutForRecruitment(schedule, 10 * 60 * 1000);
      await this.closeAllRecruitmentBuildingDialogs();
      throw new Error('No required charms available before recruitment, rescheduling in 10 mins');
    }
    // END handle charms ------------

    await this.closeAllRecruitmentBuildingDialogs();
    await this.goToRecruitmentBuilding(item.type);

    const recruitedUnitsAmount = await this.recruitUnits(
      item.unitContextInfo.unitSelector,
      item.amountType === 'slots' ? Infinity : item.amountLeft!,
    );

    // decrement recruitet amount
    console.log('item.amountLeft before:', item.amountLeft);
    item.amountLeft -= item.amountType === 'slots' ? 1 : recruitedUnitsAmount;
    if (item.amountLeft <= 0) {
      schedule.queue.shift();
      if (schedule.queue.length === 0 && this.config.recruiter.autoReevaluate) {
        this.reevaluateProviderCities();
      }
    }
    console.log('item.amountLeft after:', item.amountLeft);
    this.renderRecruitmentQueue(schedule);
    this.closeAllRecruitmentBuildingDialogs();
    this.persistSchedule();

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
  }

  private createTimeoutForRecruitment(schedule: RecruitmentSchedule, timeMs: number) {
    console.log('createTimeoutForRecruitment:', timeMs);
    return setTimeout(() => {
      this.tryRecruitOrStackResources(schedule);
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
  private populateCitiesSelect(type: 'barracks' | 'docks' = 'barracks') {
    const citiesSelectElement = document.querySelector<HTMLSelectElement>('#recruiter-cities');
    if (!citiesSelectElement) return;

    // if auto reevaluation is enabled, clear the select (don't show any cities, all are selected by default)
    if (this.config.recruiter.autoReevaluate) {
      return;
    }
    const recruitingCities = this.recruitmentSchedule.map(schedule => schedule.city.name);
    const cities = this.citySwitchManager.getCityList();
    const selectedCities = this.recruitmentSchedule.find(schedule => schedule.city.name === this.citySwitchManager.getCurrentCity()?.name)?.queue.at(-1)?.supplierCities;
    citiesSelectElement.innerHTML = '';
    for (const city of cities) {
      if (city.name === this.citySwitchManager.getCurrentCity()?.name) continue;
      const option = document.createElement('option');
      option.value = city.name;
      option.textContent = city.name;
      if (recruitingCities.includes(city.name)) {
        option.disabled = true;
      }
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

  private renderRecruitmentQueue(citySchedule: RecruitmentSchedule | null | undefined) {
    const recruitmentQueueEl = document.getElementById('recruiter-queue-content');
    if (!recruitmentQueueEl) return;

    recruitmentQueueEl.innerHTML = '';
    const queue = citySchedule?.queue ?? [];
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
      infoEl.textContent = `${item.amountLeft}x ${item.amountType === 'slots' ? 'slots' : 'units'}`;
      queueItemEl.appendChild(infoEl);

      const deleteBtn = document.createElement('button');
      deleteBtn.setAttribute('type', 'button');
      deleteBtn.classList.add('recruiter-queue-item-delete-btn');
      deleteBtn.textContent = 'x';
      queueItemEl.appendChild(deleteBtn);

      const onDeleteClick = () => {
        if (id === 0) {
          if (queue.length > 1) {
            if (citySchedule?.timeoutId) {
              if (!this.simpleConfirmationDialog('Czy na pewno chcesz usunąć pierwszy element z kolejki? Spowoduje to rekrutację następnego elementu.')) {
                return;
              }
              queue.splice(id, 1);
              clearTimeout(citySchedule.timeoutId);
              citySchedule.timeoutId = null;
              citySchedule.nextScheduledTime = null;
              this.tryRecruitOrStackResources(citySchedule);
            } else {
              queue.splice(id, 1);
            }
          } else {
            queue.splice(id, 1);
            if (citySchedule?.timeoutId) {
              clearTimeout(citySchedule.timeoutId);
              citySchedule.timeoutId = null;
              citySchedule.nextScheduledTime = null;
            }
          }
        } else {
          queue.splice(id, 1);
        }
        if (queue.length === 0 && this.config.recruiter.autoReevaluate) {
          this.reevaluateProviderCities();
        }
        this.persistSchedule();
        deleteBtn.removeEventListener('click', onDeleteClick)
        this.renderRecruitmentQueue(citySchedule);
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

  private simpleConfirmationDialog(message: string) {
    return window.confirm(message);
  }
}