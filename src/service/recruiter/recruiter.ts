import { TConfigChanges } from '../../config-popup/config-popup';
import ConfigManager from '../../utility/config-manager';
import { InfoError } from '../../utility/info-error';
import { addDelay, HHMMSS_toMS, waitWhile } from '../../utility/plain-utility';
import Service from '../../utility/Service';
import Lock, { LockOperationCancelledError } from '../../utility/ui-lock';
import {
  getBrowserExecutionContextInfo,
  performOnDocumentVisibilityReturn,
  waitForElementInterval,
} from '../../utility/ui-utility';
import CharmsUtility, { CharmDetails } from '../charms/charms-utility';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import { ScheduleExecutionDetails } from '../master-queue-rework/inline-queue-navigation';
import MasterQueue, { ScheduleOperationDetails } from '../master-queue-rework/master-queue';
import GeneralInfo from '../master/ui/general-info';
import ResourceManager from '../resources/resource-manager';
import TradeManager from '../trade/trade-manager';
import recruiterDialogHTML from './recruiter-prod.html';
import recruiterToggleBtnHTML from './recruiter-toggle-btn-prod.html';
import recruiterDialogCSS from './recruiter.css?raw';

// TODO: create a map to persist only the name of a unit
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
  };
  requiredResourcesPerSlot: {
    wood: number;
    stone: number;
    iron: number;
    population: number;
  };
  storeCapacity: number;
  populationCapacity: number;
};

export type ItemDetails = {
  type: 'barracks' | 'docks';
  unitContextInfo: UnitContext;
  amountType: 'units' | 'slots';
  amount: number;
  amountLeft: number;
  charms?: {
    required: CharmDetails[];
    optional: CharmDetails[];
  };
};

export default class Recruiter implements Service<'recruiter'> {
  public static readonly MAX_DELIVERY_TIME_MS = 1000 * 60 * 25;
  private static instance: Recruiter;
  private resourceManager!: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;
  private tryCount: Record<string, number> = {};
  private config!: ReturnType<typeof ConfigManager.prototype.getConfig>;
  private tradeManager!: TradeManager;
  private masterQueue!: MasterQueue;

  private RUN: boolean = false;
  private observer: MutationObserver | null = null;
  private unitChangeObserver: MutationObserver | null = null;
  private recruitmentBuildingDialogAttr: string | null = null;

  private currentUnitContext: UnitContext | null = null;
  private eventListenersCleanupCallbacks: (() => void)[] = [];
  private getScheduleBaseFormValues: (() => ScheduleExecutionDetails) | undefined;

  private constructor() {}

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
      Recruiter.instance.register();
    }
    return Recruiter.instance;
  }

  private register() {
    this.masterQueue.registerExecutor<ItemDetails>('recruiter', {
      execute: async (operation: ScheduleOperationDetails<ItemDetails>): Promise<void> => {
        await this.tryRecruitOrStackResources(operation);
      },
      cancelExecution: (id): void => {
        this.lock.cancelQueuedLock({ manager: 'recruiter', id: id });
      },
      hydrateItem: function (itemDetails: ItemDetails): ItemDetails {
        return itemDetails;
      },
      persistItem: function (itemDetails: ItemDetails): ItemDetails {
        return itemDetails;
      },
    });
  }

  private addCSS() {
    const style = document.createElement('style');
    style.textContent = recruiterDialogCSS;
    document.head.appendChild(style);
  }

  /**
   * Mounts recruiter dialog into DOM, injects master-queue specific UI elements.
   * @see VALID
   */
  private addRecruiterDialogHTML() {
    const recruiterDialogContainer = document.createElement('div');
    recruiterDialogContainer.id = 'recruiter-container';
    recruiterDialogContainer.style.zIndex = '2000';
    recruiterDialogContainer.innerHTML = recruiterDialogHTML;

    const city = this.citySwitchManager.getCurrentCity();

    this.masterQueue.registerInlineQueueContainer(
      recruiterDialogContainer.querySelector('#recruiter-queue-content')!,
      city,
    );

    // inject queue navigation plus generic schedule form and assign getValues callack
    this.getScheduleBaseFormValues = this.masterQueue.injectQueueNavigation(
      // BUG: city must either be found for sure or error thrown (cityswitch refactor)
      city!,
      recruiterDialogContainer.querySelector('#recruiter-navigation-section')!,
    ).getValues;

    this.addCharmsToDialog(recruiterDialogContainer);

    document.body.appendChild(recruiterDialogContainer);
  }

  // nothing applies to it
  public getScheduledActionTimes = () => [] as [number, number][];
  public onConfigChange = (configChanges: Partial<TConfigChanges['recruiter']>) => {};

  private addCharmsToDialog(container: HTMLElement) {
    const charms = CharmsUtility.getRecruitmentSpecificCharms();
    const requiredList = container.querySelector('#recruiter-charms-required-list');
    const optionalList = container.querySelector('#recruiter-charms-optional-list');

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
      };
      item.addEventListener('click', onClickClb);
      this.eventListenersCleanupCallbacks.push(() => item.removeEventListener('click', onClickClb));
      requiredList?.appendChild(item);
    });

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
      };
      item.addEventListener('click', onClickClb);
      this.eventListenersCleanupCallbacks.push(() => item.removeEventListener('click', onClickClb));
      optionalList?.appendChild(item);
    });
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
  public pause() {
    this.RUN = false;
  }
  public resume() {
    this.RUN = true;
  }

  public isRunning() {
    return this.RUN;
  }

  private mountObserver(): MutationObserver {
    const checkAsyncConditionForAddedNodes = async (node: Node) => {
      if (node instanceof HTMLElement && node.getAttribute('role') === 'dialog') {
        waitForElementInterval('.barracks_building', { fromNode: node, interval: 500, retries: 3 })
          .then(() => {
            this.recruitmentBuildingDialogAttr = node.getAttribute('aria-describedby');
            console.log('barracks dialog attr:', this.recruitmentBuildingDialogAttr);
            this.extendUI(node, 'barracks');
          })
          .catch(() => {
            /* nothing */
          });
        waitForElementInterval('.docks_building', { fromNode: node, interval: 500, retries: 3 })
          .then(() => {
            this.recruitmentBuildingDialogAttr = node.getAttribute('aria-describedby');
            console.log('docks dialog attr:', this.recruitmentBuildingDialogAttr);
            this.extendUI(node, 'docks');
          })
          .catch(() => {
            /* nothing */
          });
      }
    };

    const checkConditionForRemovedNodes = async (node: Node) => {
      if (node instanceof HTMLElement && node.getAttribute('role') === 'dialog') {
        if (node.getAttribute('aria-describedby') === this.recruitmentBuildingDialogAttr) {
          console.log('Unmounting recruiter utilities');
          this.removeRecruiterDialog();
          this.unitChangeObserver?.disconnect();
          this.unitChangeObserver = null;
          this.cleanEventListeners();
        }
      }
    };

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
    // adds togle button to the original recruitment dialog
    node.querySelector('#unit_order')?.appendChild(this.createRecruiterToggleButton());

    // adds "recruiter" dialog HTML to the body
    this.addRecruiterDialogHTML();

    // adds event listeners to the toggle button
    this.addEntryEventListener(node, type);
    this.mountUnitChangeObserver();
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
    };
    recruiterOpenBtn?.addEventListener('click', toggleAcction);
    this.eventListenersCleanupCallbacks.push(() => recruiterOpenBtn?.removeEventListener('click', toggleAcction));
  }

  /**
   * Updates dialog ui based on the unit change
   */
  private mountUnitChangeObserver() {
    const unitContainer = document.querySelector<HTMLDivElement>(
      `[aria-describedby="${this.recruitmentBuildingDialogAttr}"]`,
    );
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
      attributeFilter: ['class'],
    };

    observer.observe(unitContainer!, config);
    this.unitChangeObserver?.disconnect();
    this.unitChangeObserver = observer;
  }

  /**
   * Inicjalizuje wszystkie eventy związane z dialogiem rekrutera, dzieje się to na pierwsze otwarcie dialogu (recruitera)
   */
  private async initEventListeners(type: 'barracks' | 'docks') {
    const recruiterDialog = document.getElementById('recruiter-dialog');
    const recruiterNav = recruiterDialog?.querySelector<HTMLElement>('#recruiter-nav');

    const recruiterCloseBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-close-btn');
    const recruiterAddBtn = recruiterDialog?.querySelector<HTMLButtonElement>('#recruiter-add-item');

    const amountTypeRadios = recruiterDialog?.querySelectorAll<HTMLInputElement>('[name="recruiter-type"]');
    const amountInput = recruiterDialog?.querySelector<HTMLInputElement>('#recruiter-ammount');
    const amountMaxCheckbox = recruiterDialog?.querySelector<HTMLInputElement>('#recruiter-amount-max');

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
    };
    amountMaxCheckbox?.addEventListener('change', amountMaxCheckboxChangeClb);
    this.eventListenersCleanupCallbacks.push(() =>
      amountMaxCheckbox?.removeEventListener('change', amountMaxCheckboxChangeClb),
    );

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
    };
    recruiterCloseBtn?.addEventListener('click', closeButtonAction);
    this.eventListenersCleanupCallbacks.push(() => recruiterCloseBtn?.removeEventListener('click', closeButtonAction));

    /**
     * Parses configuration from recruiter dialog calls executive method based on this.
     */
    const addButtonAction = async () => {
      const amountType: 'units' | 'slots' = amountTypeRadios![0].checked ? 'units' : 'slots';
      const amountInputValue = amountInput!.value;
      const amountMaxCheckboxValue = amountMaxCheckbox!.checked;
      // const citiesSelectValue = Array.from(citiesSelect!.selectedOptions).map(option => option.value);

      const sourceCity = this.citySwitchManager.getCurrentCity();
      // const shipmentTime = Number(shipmentTimeSelect!.value);
      const charms = this.getSelectedCharms();
      const { maxShipmentTime, blocking, autoSuppliers, supplierCityNames } =
        this.getScheduleBaseFormValues!();

      const { unitImageClass } = this.currentUnitContext!;

      if (amountMaxCheckboxValue) {
        const properMaxSlotsAmount =
          (await this.getEmptySlotsCount(type)) -
          this.masterQueue
            .getTypeSpecificItemDetailsForCity(sourceCity!, 'recruiter')
            .reduce((acc, { itemDetails }: { itemDetails: ItemDetails }) => {
              if (itemDetails.type === type) {
                if (itemDetails.amountType === 'slots') {
                  return acc + itemDetails.amount;
                }
                // jezeli units, to załóż że tylko 95% zasobu potrzebnego na jednostkę będzie dostępne w magazynie
                // (potencjalnie jeden slot więcej może dojść - co jest bezpiecznie)
                return (
                  acc +
                  Math.floor(
                    (itemDetails.unitContextInfo.requiredResourcesPerSlot.population * 0.95) /
                      (itemDetails.unitContextInfo.unitInfo.population * itemDetails.amount),
                  )
                );
              }
              return acc;
            }, 0);
        this.masterQueue.addToQueue(sourceCity!, {
          ui: {
            title: unitImageClass.split(' ')[1],
            className: unitImageClass,
            description: properMaxSlotsAmount + 'x ' + amountType,
          },
          itemDetails: {
            unitContextInfo: this.currentUnitContext,
            amountType: 'slots',
            amount: properMaxSlotsAmount,
            amountLeft: properMaxSlotsAmount,
            type: type,
            charms,
          },
          itemType: 'recruiter',
          blocking,
          supplierCities: supplierCityNames?.map(cn => this.citySwitchManager.getCityByName(cn)).filter(e => !!e),
          maxShipmentTime,
          supplyEvaluation: autoSuppliers ? 'auto' : 'manual',
        });
      } else if (amountType === 'units') {
        this.masterQueue.addToQueue(sourceCity!, {
          ui: {
            title: unitImageClass.split(' ')[1],
            className: unitImageClass,
            description: Number(amountInputValue) + 'x ' + amountType,
          },
          itemDetails: {
            unitContextInfo: this.currentUnitContext,
            amountType: 'units',
            amount: Number(amountInputValue),
            amountLeft: Number(amountInputValue),
            type: type,
            charms,
          },
          itemType: 'recruiter',
          blocking,
          supplierCities: supplierCityNames?.map(cn => this.citySwitchManager.getCityByName(cn)).filter(e => !!e),
          maxShipmentTime,
          supplyEvaluation: autoSuppliers ? 'auto' : 'manual',
        });
      } else if (amountType === 'slots') {
        this.masterQueue.addToQueue(sourceCity!, {
          ui: {
            title: unitImageClass.split(' ')[1],
            className: unitImageClass,
            description: Number(amountInputValue) + 'x ' + amountType,
          },
          itemDetails: {
            unitContextInfo: this.currentUnitContext,
            amountType: 'slots',
            amount: Number(amountInputValue),
            amountLeft: Number(amountInputValue),
            type: type,
            charms,
          },
          itemType: 'recruiter',
          blocking,
          supplierCities: supplierCityNames?.map(cn => this.citySwitchManager.getCityByName(cn)).filter(e => !!e),
          maxShipmentTime,
          supplyEvaluation: autoSuppliers ? 'auto' : 'manual',
        });
      }
    };
    recruiterAddBtn?.addEventListener('click', addButtonAction);
    this.eventListenersCleanupCallbacks.push(() => recruiterAddBtn?.removeEventListener('click', addButtonAction));

    // draggable recruiter dialog listeners
    {
      let isDragging = false;
      let offsetX: number | null = null;
      let offsetY: number | null = null;

      recruiterNav?.addEventListener('mousedown', onMouseDown);
      this.eventListenersCleanupCallbacks.push(() => {
        recruiterNav?.removeEventListener('mousedown', onMouseDown);
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
      Array.from(
        document.querySelectorAll<HTMLElement>('#recruiter-charms-required-list .recruiter-charms-item.selected'),
      ).map(el => CharmsUtility.getCharmByPowerId(el.dataset.powerId!)!) ?? [];

    const selectedOptionalCharms =
      Array.from(
        document.querySelectorAll<HTMLElement>('#recruiter-charms-optional-list .recruiter-charms-item.selected'),
      ).map(el => CharmsUtility.getCharmByPowerId(el.dataset.powerId!)!) ?? [];

    return {
      required: selectedRequiredCharms,
      optional: selectedOptionalCharms,
    };
  }

  private async tryRecruitOrStackResources(operationDetails: ScheduleOperationDetails<ItemDetails>) {
    let infoId!: number;
    try {
      await this.lock.performWithLock(
        async () => {
          infoId = GeneralInfo.getInstance().showInfo(
            'Recruiter:',
            'Rekrutacja/stakowanie surowców do rekrutacji',
            'info',
          );
          await operationDetails.city.switchAction();
          await this.performRecruitOrStackResources(operationDetails);
          delete this.tryCount[operationDetails.city.name];
        },
        { method: 'tryRecruitOrStackResources', manager: 'recruiter' },
      );
    } catch (e) {
      // if it's not deliberate Lock cancelation, retry the whole flow
      if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
        const browserContext = getBrowserExecutionContextInfo();
        console.warn('[Recruiter]: tryRecruitOrStackResources.catch:', e, browserContext);
        const cityName = operationDetails.city.name;
        this.tryCount[cityName] = (this.tryCount[cityName] ?? 0) + 1;
        if (this.tryCount[cityName] < 3) {
          console.log(`\tretry number ${this.tryCount[cityName]} for item:`, operationDetails.itemDetails);
          if (browserContext.visibilityState === 'hidden') {
            performOnDocumentVisibilityReturn(() => this.tryRecruitOrStackResources(operationDetails));
          } else {
            this.tryRecruitOrStackResources(operationDetails);
          }
        } else {
          delete this.tryCount[cityName];
          console.log(`\tretry limit exceeded, removing item:`, operationDetails.itemDetails);
          operationDetails.shiftQueueAndNext();
        }
      }
    } finally {
      GeneralInfo.getInstance().hideInfo(infoId);
    }
  }

  private async performRecruitOrStackResources(operationDetails: ScheduleOperationDetails<ItemDetails>) {
    // always first from the queue
    console.log('performRecruitOrStackResources:', operationDetails);
    const { city } = operationDetails;
    const {
      supplierCities,
      maxShipmentTime,
      itemDetails: { charms, amountType, unitContextInfo, type, amountLeft },
    } = operationDetails;
    if (charms?.required && !CharmsUtility.areCharmsCastedOrAvailable(charms.required)) {
      const timeToCharmsCastable = CharmsUtility.getCharmsCastingTime(charms?.required);
      const timeToCharmsCastableMs = Math.max(...Array.from(timeToCharmsCastable.values()), 10 * 60 * 1000);
      operationDetails.setScheduleTimeout(
        async () => await this.tryRecruitOrStackResources(operationDetails),
        // timeToCharmsCastableMs,
        Date.now() + timeToCharmsCastableMs,
        'waiting',
        'charms',
      );
    }
    const resources = await this.resourceManager.getResourcesInfo();

    if (amountType === 'slots') {
      const targetResources = {
        // TODO: must not be stored as JSON!
        wood: Math.floor(unitContextInfo.requiredResourcesPerSlot.wood * 0.9),
        iron: Math.floor(unitContextInfo.requiredResourcesPerSlot.iron * 0.9),
        stone: Math.floor(unitContextInfo.requiredResourcesPerSlot.stone * 0.9),
      };

      const hasEnoughResources = await this.resourceManager.hasEnoughResources(targetResources);
      // const hasEnoughPopulationPerSlot = resources.population.amount - scheduleItem.unitContextInfo.requiredResourcesPerSlot.population >= this.config.resources.minPopulationBuffer;
      const hasEnoughPopulationPerSlot =
        resources.population.amount - unitContextInfo.requiredResourcesPerSlot.population >= 0;
      const hasEnoughStorageCapacityPerUnit =
        unitContextInfo.unitInfo.iron < resources.storeMaxSize ||
        unitContextInfo.unitInfo.wood < resources.storeMaxSize ||
        unitContextInfo.unitInfo.stone < resources.storeMaxSize;

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
        const stackResult = await this.tradeManager.stackResources(
          targetResources,
          city,
          supplierCities,
          maxShipmentTime,
        );
        if (stackResult.fullyStacked) {
          console.log('fully stacked, scheduling recruitment');
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            stackResult.arrivalTime!,
            'execution',
            'resources',
          );
        } else {
          console.log('not fully stacked, rescheduling stacking in 10 minutes');
          // schedule in 10 minutes
          // operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 600000), new Date().getTime() + 600000);
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            Date.now() + 600000,
            'execution',
            'resources',
          );
        }
      } else {
        const recruitmentResult = await this.performRecruitment(operationDetails);
        if (recruitmentResult === 'done') {
          console.log('recruitment done, calling onFinishCallback');
          operationDetails.onFinishCallback();
        } else if (recruitmentResult === 'partial') {
          console.log('recruitment partially performed, scheduling next round');
          await this.performRecruitOrStackResources(operationDetails);
        } else if (recruitmentResult === 'slot') {
          const timeToFreeSlot = await this.getTimeToFreeSlot(type);
          console.log('no free slot, rescheduling in time to free slot:', timeToFreeSlot);
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            Date.now() + timeToFreeSlot,
            'waiting',
            'slot',
          );
        } else if (recruitmentResult === 'charms') {
          const maxTimeToCharmsCastable = CharmsUtility.getCharmsCastingTime(charms?.required ?? []);
          const maxTimeToCharmsCastableMs = Math.max(...Array.from(maxTimeToCharmsCastable.values()), 10 * 60 * 1000);
          console.log(
            'required charms not available, rescheduling in max time to cast charms:',
            maxTimeToCharmsCastableMs,
          );
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            Date.now() + maxTimeToCharmsCastableMs,
            'waiting',
            'charms',
          );
        } else if (recruitmentResult === 'failed') {
          console.log('recruitment failed, but technically possible, so rescheduling in 10 minutes');
          operationDetails.setScheduleTimeout(
            () => this.tryRecruitOrStackResources(operationDetails),
            Date.now() + 600000,
            'execution',
            'error',
          );
        }
      }
    } else {
      const needsMoreResourcesThanOneSlot =
        unitContextInfo.unitInfo.population * amountLeft! > unitContextInfo.requiredResourcesPerSlot.population;
      const targetResources = {
        wood: Math.floor(
          needsMoreResourcesThanOneSlot
            ? unitContextInfo.requiredResourcesPerSlot.wood * 0.9
            : unitContextInfo.unitInfo.wood * amountLeft!,
        ),
        iron: Math.floor(
          needsMoreResourcesThanOneSlot
            ? unitContextInfo.requiredResourcesPerSlot.iron * 0.9
            : unitContextInfo.unitInfo.iron * amountLeft!,
        ),
        stone: Math.floor(
          needsMoreResourcesThanOneSlot
            ? unitContextInfo.requiredResourcesPerSlot.stone * 0.9
            : unitContextInfo.unitInfo.stone * amountLeft!,
        ),
      };

      const hasEnoughResources = await this.resourceManager.hasEnoughResources(targetResources);
      // const hasEnoughPopulation = resources.population.amount - scheduleItem.unitContextInfo.unitInfo.population >= this.config.resources.minPopulationBuffer;
      const hasEnoughPopulation = resources.population.amount - unitContextInfo.unitInfo.population * amountLeft! >= 0;
      const hasEnoughStorageCapacityPerUnit =
        unitContextInfo.unitInfo.iron < resources.storeMaxSize ||
        unitContextInfo.unitInfo.wood < resources.storeMaxSize ||
        unitContextInfo.unitInfo.stone < resources.storeMaxSize;

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
        const stackResult = await this.tradeManager.stackResources(
          targetResources,
          city,
          supplierCities,
          maxShipmentTime,
        );
        if (stackResult.fullyStacked) {
          console.log('fully stacked, scheduling recruitment');
          // operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, timeMs), new Date().getTime() + timeMs);
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            stackResult.arrivalTime!,
            'execution',
            'resources',
          );
        } else {
          console.log('not fully stacked, scheduling in 10 minutes');
          // schedule in 10 minutes
          // operationDetails.setScheduleTimeout(this.createTimeoutForRecruitment(operationDetails, 600000), new Date().getTime() + 600000);
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            Date.now() + 600000,
            'execution',
            'resources',
          );
        }
      } else {
        const recruitmentResult = await this.performRecruitment(operationDetails);
        if (recruitmentResult === 'done') {
          console.log('recruitment done, calling onFinishCallback');
          operationDetails.onFinishCallback();
        } else if (recruitmentResult === 'partial') {
          console.log('recruitment partially performed, scheduling next round');
          await this.performRecruitOrStackResources(operationDetails);
        } else if (recruitmentResult === 'slot') {
          console.log('no free slot, rescheduling in time to free slot');
          const timeToFreeSlot = await this.getTimeToFreeSlot(type);
          console.log('timeToFreeSlot:', timeToFreeSlot);
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            Date.now() + timeToFreeSlot,
            'waiting',
            'slot',
          );
        } else if (recruitmentResult === 'charms') {
          const maxTimeToCharmsCastable = CharmsUtility.getCharmsCastingTime(charms?.required ?? []);
          const maxTimeToCharmsCastableMs = Math.max(...Array.from(maxTimeToCharmsCastable.values()), 10 * 60 * 1000);
          console.log(
            'required charms not available, rescheduling in max time to cast charms:',
            maxTimeToCharmsCastableMs,
          );
          operationDetails.setScheduleTimeout(
            async () => await this.tryRecruitOrStackResources(operationDetails),
            Date.now() + maxTimeToCharmsCastableMs,
            'waiting',
            'charms',
          );
        } else if (recruitmentResult === 'failed') {
          console.log('recruitment failed, but technically possible, so rescheduling in 10 minutes');
          operationDetails.setScheduleTimeout(
            () => this.tryRecruitOrStackResources(operationDetails),
            Date.now() + 600000,
            'execution',
            'error',
          );
        }
      }
    }
  }

  private async getTimeToFreeSlot(buildingType: 'barracks' | 'docks') {
    const timeToFinishElement = await waitForElementInterval(
      `#unit_order.${buildingType}_building .first_order .type_unit_queue .curr`,
      { retries: 3, interval: 333 },
    ).catch(() => null);
    const timeToFinish = timeToFinishElement?.textContent?.match(/(\d+:\d+:\d+)/)?.[0]
      ? HHMMSS_toMS(timeToFinishElement.textContent!)
      : undefined;
    if (!timeToFinish) {
      throw new Error('No time to finish element found');
    }
    return timeToFinish;
  }

  private async performRecruitment(
    operationDetails: ScheduleOperationDetails<ItemDetails>,
  ): Promise<'done' | 'failed' | 'partial' | 'charms' | 'slot'> {
    const {
      itemDetails: { charms, unitContextInfo, amountType, type },
    } = operationDetails;
    // handle charms ----------------
    console.log('performRecruitment, item charms:', charms);
    const requiuredCharmsCasted = CharmsUtility.castCityCharms(charms ?? {});
    console.log('requiredCharmsCasted:', requiuredCharmsCasted);
    if (!requiuredCharmsCasted) {
      GeneralInfo.getInstance().showInfo(
        'Recruiter',
        'Nie udało się rzucić wymaganych zaklęć, ponowna próba za 10 minut',
        'error',
        5000,
      );
      await this.closeAllRecruitmentBuildingDialogs();
      return 'charms';
    }
    // END handle charms ------------

    await this.closeAllRecruitmentBuildingDialogs();
    await this.goToRecruitmentBuilding(type);

    // free slots check
    const freeSlots = await this.getEmptySlotsCount(type);
    console.log('freeSlots:', freeSlots);
    if (!freeSlots) return 'slot';

    const recruitedUnitsAmount = await this.recruitUnits(
      unitContextInfo.unitSelector,
      amountType === 'slots' ? Infinity : operationDetails.itemDetails.amountLeft!,
    );

    // decrement recruited amount
    console.log('item.amountLeft before:', operationDetails.itemDetails.amountLeft);
    operationDetails.itemDetails.amountLeft -= amountType === 'slots' ? 1 : recruitedUnitsAmount;
    this.closeAllRecruitmentBuildingDialogs();

    if (operationDetails.itemDetails.amountLeft <= 0) {
      return 'done';
    } else {
      this.masterQueue.refreshUI();
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
    await waitWhile(
      () =>
        !(closeBtns = document.querySelectorAll('.ui-dialog-titlebar-close')).length ||
        !Array.from(closeBtns).some(btn =>
          (btn.parentElement?.nextSibling as HTMLElement)?.querySelector('#unit_order'),
        ),
      {
        onError: () => {
          /* do nothing */
        },
        maxIterations: 3,
        delay: 400,
      },
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
      counter++;
      document.querySelector<HTMLElement>(unitSelector)?.click();
      await addDelay(400);
      if (counter > 5) {
        throw new InfoError('Unit cant get selected...', {});
      }
    } while (!document.querySelector(unitSelector)?.parentElement?.classList.contains('unit_active'));

    const unitInput = document.querySelector<HTMLInputElement>('#unit_order_input')!;
    const maxValue = Number(unitInput.value);
    let recruitedUnitAmount = maxValue;
    if (amount !== Infinity && amount < maxValue) {
      recruitedUnitAmount = amount;
      console.log('set input value to:', amount.toString());
      unitInput.value = amount.toString();
    } else {
      console.log('set input value to (max):', maxValue.toString());
      unitInput.value = maxValue.toString();
    }
    await addDelay(100);

    // confirm recruitment in UI
    const emptySlotsBefore = document.querySelectorAll(`[role="dialog"] .various_orders_background .empty_slot`).length;
    console.log('unitInput.value before click=', unitInput.value);
    document.getElementById('unit_order_confirm')?.click();
    await this.untilEmptySlotsAreEqual(emptySlotsBefore - 1).catch(err => {
      console.warn('unitInput.value on error:', unitInput.value);
      throw err;
    });
    // END recruitment in UI

    return recruitedUnitAmount;
  }

  private async untilEmptySlotsAreEqual(number: number) {
    await waitWhile(
      () => document.querySelectorAll(`[role="dialog"] .various_orders_background .empty_slot`).length !== number,
    );
  }

  private async goToRecruitmentBuilding(buildingType: 'barracks' | 'docks') {
    document.querySelector<HTMLElement>('[name="city_overview"]')?.click();
    await waitForElementInterval(`[data-building="${buildingType}"]`).then(el => el.click());
    await waitWhile(() => !!document.querySelector<HTMLElement>(`#unit_order.${buildingType}_building`));
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
    const emptySlotCount = Number(
      document.querySelectorAll('[role="dialog"] .various_orders_background .empty_slot').length,
    );
    const requiredWoodPerUnit = Number(
      document.querySelector<HTMLDivElement>('#unit_order_unit_wood')?.textContent ?? -1,
    );
    const requiredStonePerUnit = Number(
      document.querySelector<HTMLDivElement>('#unit_order_unit_stone')?.textContent ?? -1,
    );
    const requiredIronPerUnit = Number(
      document.querySelector<HTMLDivElement>('#unit_order_unit_iron')?.textContent ?? -1,
    );
    const populationPerUnit = Number(document.querySelector<HTMLDivElement>('#unit_order_unit_pop')?.textContent ?? -1);
    const recruitmentTime = HHMMSS_toMS(
      document.querySelector<HTMLDivElement>('#unit_order_unit_build_time')?.textContent ?? '-1',
    );
    const storeCapacity = await this.resourceManager.getStoreCapacity();
    const populationCapacity = this.resourceManager.getPopulation();
    const unitSelector = `.unit_order_unit_image.${unitKey}`;

    const maxUnitsPerSlot = Math.floor(
      storeCapacity / Math.max(requiredWoodPerUnit, requiredStonePerUnit, requiredIronPerUnit),
    );

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
    };

    this.currentUnitContext = currentUnitContext;
    console.log(this.currentUnitContext);
    return currentUnitContext;
  }

  /**
   * Zwraca liczbę pustych slotów w danym budynku (Port/Koszary).
   * @param buildingType Typ budynku rekrutera.
   * @returns Liczba pustych slotów.
   * @requires
   * - Budynek rekrutera musi być otwarty.
   */
  private async getEmptySlotsCount(buildingType: 'barracks' | 'docks') {
    // return Number(document.querySelector(`.type_unit_queue.${buildingType}`)?.querySelectorAll('.empty_slot').length);
    const unitQueueEl = await waitForElementInterval(`.type_unit_queue.${buildingType}`, { retries: 4, interval: 333 });
    return Number(unitQueueEl?.querySelectorAll('.empty_slot').length);
  }

  private renderQueue(city?: CityInfo) {
    const recruitmentQueueEl = document.getElementById('recruiter-queue-content');
    if (!recruitmentQueueEl) return;
    if ((city ??= this.citySwitchManager.getCurrentCity())) {
      this.masterQueue.injectCityQueueUI(recruitmentQueueEl, city ?? this.citySwitchManager.getCurrentCity());
    }
  }

  private closeMinimizedRecruitmentBuildingDialogs() {
    document.querySelectorAll('.minimized_windows_area .box-middle').forEach(el => {
      if (el.textContent?.includes('Port') || el.textContent?.includes('Koszary'))
        (el.querySelector('.btn_wnd.close') as HTMLElement)?.click();
    });
  }

  /**
   * Sprawdza, czy kolejka w porcie/koszarach jest pełna..
   * @param type Typ budynku rekrutera.
   * @param city Miasto, w którym sprawdza się kolejka.
   * @returns Obiekt zawierający informację, czy kolejka jest pełna oraz czas do zwolnienia slotu.
   */
  public async isRealQueueFull(
    type: 'barracks' | 'docks',
    city?: CityInfo,
  ): Promise<{ isRealQueueFull: boolean; timeToFreeSlot: number }> {
    if (city) await city.switchAction(false);
    await this.goToRecruitmentBuilding(type);
    const emptySlots = await this.getEmptySlotsCount(type);
    const returnValue = { isRealQueueFull: !emptySlots, timeToFreeSlot: 0 };
    if (!emptySlots) {
      returnValue.timeToFreeSlot = await this.getTimeToFreeSlot(type);
    }
    await this.closeAllRecruitmentBuildingDialogs();
    return returnValue;
  }

  /**
   * Zwraca liczbę pustych slotów w koszarach.
   * @returns Liczba pustych slotów.
   * @Requires Lock
   */
  private async getBarracksEmptySlotsCount() {
    await this.goToRecruitmentBuilding('barracks');
    return document.querySelectorAll('.type_unit_queue .empty_slot').length;
  }

  private async getDocksEmptySlotsCount() {
    return Number(document.querySelectorAll('.type_unit_queue .empty_slot').length);
  }
}
