/*
TODO
- update table state (non-blocking exists but main is empty)
*/

import EventEmitter from 'events';
import { findLastIndex } from '~/utility/plain-utility';
import gpsConfig from '../../../gps.config';
import ConfigManager from '../../utility/config-manager';
import ResourceLock from '../../utility/resource-lock';
import Service from '../../utility/Service';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import useInlineQueueNavigation from './inline-queue-navigation';
import useMasterQueueInline, { componentName as MasterQueueInlineName } from './master-queue-inline';
import useMasterQueueTable, { MasterQueueTableUtility } from './master-queue-table';

import { TConfigChanges } from '~/config-popup/config-popup';
import { QueuePriority } from './types';
export { QueuePriority };

const STANDARD_EXECUTION_TIME_MS = 30000 as const;

export type QueueItemType = 'recruiter' | 'builder' | 'municipal utility' | 'academy';
export type TimeoutPurpose = 'slot' | 'resources' | 'charms' | 'error';
export type TimeoutType = 'execution' | 'waiting';
export type ScheduleOperationDetails<T> = Pick<QueueItem, 'id' | 'supplierCities' | 'maxShipmentTime'> & {
  city: CityInfo;
  itemDetails: T;
  onFinishCallback: () => void;
  setScheduleTimeout: (
    operationCallback: () => Promise<void> | void,
    executionTime: number,
    timeoutType: TimeoutType,
    purpose?: TimeoutPurpose,
  ) => void;
  shiftQueueAndNext: () => void;
};

interface RepetitionPolicy {
  count?: number;
  until?: () => boolean | Promise<boolean>;
  while?: () => boolean | Promise<boolean>;
  interval?: number;
  currentIteration: number;
}

export type QueueItem = {
  id: string;
  itemType: QueueItemType;
  ui: {
    style?: Record<string, string>;
    className?: string;
    title: string;
    description?: string;
    lvlBar?: string;
  };

  blocking?: boolean;
  executionTime?: number;
  repetitionPolicy?: RepetitionPolicy;
  directOperation?: () => Promise<void>;

  priority: QueuePriority;
  maxShipmentTime: number;
  supplyEvaluation: 'auto' | 'manual';
  supplierCities: CityInfo[];
  itemDetails: any;
};

// Utility type for creating queue items without id and with optional supplierCities
export type QueueItemInput = Omit<QueueItem, 'id' | 'supplierCities'> & Partial<Pick<QueueItem, 'supplierCities'>>;

type NonBlockingQueueComplex = Partial<Record<QueueItemType, NonBlockingQueue>>;

type NonBlockingQueue = {
  queue: QueueItem[];
  timeoutData: {
    timeoutId?: NodeJS.Timeout;
    executionTime?: number;
    purpose?: TimeoutPurpose;
  };
};

export type CitySchedule = {
  city: CityInfo;
  queue: QueueItem[];
  nonBlockingQueueComplex: NonBlockingQueueComplex;
  currentAction?: QueueItemType | null;
  timeoutData: {
    timeoutId?: NodeJS.Timeout;
    executionTime?: number;
    purpose?: TimeoutPurpose;
  };
};

interface QueueExecutorRegistry {
  registerExecutor<T>(type: QueueItemType, executor: QueueExecutor<T>): void;
  getExecutor<T>(type: QueueItemType): QueueExecutor<T>;
}

export interface PostDeleteQueueDetails<T> {
  ui: QueueItem['ui'];
  details: T;
}

export interface QueueExecutor<T> {
  execute(operation: ScheduleOperationDetails<T>): Promise<void>;
  // executor dostaje referencje do ui i details, które może updatować zgodnie ze swoim widzi mi się
  postDeleteAction?: (
    queue: PostDeleteQueueDetails<T>[],
    deletedItemDetails: ScheduleOperationDetails<T>['itemDetails'],
  ) => void | Promise<void>;
  // NOTE: rethink if these should modify referenced obj, or return modified copy
  hydrateItem: (itemDetails: T) => Promise<T> | T;
  persistItem: (itemDetails: T) => any;
}

export default class MasterQueue extends EventEmitter implements Service<'masterQueue'>, QueueExecutorRegistry {
  public injectCityQueueUI(container: HTMLElement, identifier: CityInfo | CitySchedule) {
    let citySchedule =
      'name' in identifier ? this.queue.find(schedule => schedule.city.name === identifier.name) : identifier;

    if (!citySchedule) {
      citySchedule = {
        city: 'name' in identifier ? identifier : identifier.city,
        queue: [],
        nonBlockingQueueComplex: {},
        timeoutData: {},
      };
      this.queue.push(citySchedule);
    }

    useMasterQueueInline().mount(container, {
      schedule: citySchedule,
      onDeleteItem: item => this.removeItem(citySchedule.city, item),
    });
  }

  private static readonly LOCAL_STORAGE_KEY = 'master-queue';
  // public static readonly RESOURCES_BLOCKING_TIME = 1800000; // 30 min
  public static readonly RESOURCES_BLOCKING_TIME = 300000; // 5 min testing
  public static MASTER_QUEUE_CHANGE_EVENT = 'master-qeueue-change';

  private config!: typeof gpsConfig;
  private queue: CitySchedule[];
  private citySwitchManager!: CitySwitchManager;
  private resourceLock!: ResourceLock;
  private RUN: boolean = false;
  private resourceLockChangeListener?: (city: CityInfo) => void;
  private cityChangeListener?: (city: CityInfo) => void;
  private resourcesWhiteList: CityInfo[] = [];
  private executors: Map<QueueItemType, QueueExecutor<any>> = new Map();
  private tableUIUtility!: MasterQueueTableUtility;
  // private queueInlineUIUtility!: MasterQueueInlineUtility;
  private pausedCitySchedulesSnapshot: CitySchedule[] = [];
  private supplierCities: CityInfo[] = [];

  private constructor() {
    super();
    this.queue = [];
  }

  public onConfigChange(configChanges: Partial<TConfigChanges['recruiter']>) {}

  private static instance: MasterQueue;

  public static async getInstance(): Promise<MasterQueue> {
    if (!MasterQueue.instance) {
      MasterQueue.instance = new MasterQueue();
      MasterQueue.instance.resourceLock = ResourceLock.getInstance();
      MasterQueue.instance.config = ConfigManager.getInstance().getConfig();
      MasterQueue.instance.citySwitchManager = await CitySwitchManager.getInstance();
      MasterQueue.instance.init();
    }
    return MasterQueue.instance;
  }

  public registerExecutor<T>(type: QueueItemType, executor: QueueExecutor<T>): void {
    if (this.executors.has(type)) {
      throw new Error(`Executor for type ${type} is already registered`);
    }
    this.executors.set(type, executor);
    // Hydrate any items of this type that were loaded before executor was registered
    this.hydrateItemsOfType(type);
  }

  private hydrateItemsOfType(type: QueueItemType): void {
    const executor = this.executors.get(type);
    if (!executor) return;

    this.queue.forEach(citySchedule => {
      citySchedule.queue.forEach(item => {
        if (item.itemType === type && (item as any).__needsHydration) {
          item.itemDetails = executor.hydrateItem(item.itemDetails);
          delete (item as any).__needsHydration;
        }
      });

      Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex =>
        complex.queue.forEach(item => {
          if (item.itemType === type && (item as any).__needsHydration) {
            item.itemDetails = executor.hydrateItem(item.itemDetails);
            delete (item as any).__needsHydration;
          }
        }),
      );
    });
  }

  public getExecutor<T>(type: QueueItemType): QueueExecutor<T> {
    const executor = this.executors.get(type);
    if (!executor) {
      throw new Error(`No executor registered for type: ${type}`);
    }
    return executor as QueueExecutor<T>;
  }

  private init() {
    this.loadSchedule();
    this.reevaluateProviderCities();
    this.loadUI();
  }

  private loadUI() {
    this.tableUIUtility = useMasterQueueTable();
    this.tableUIUtility.mount(null, {
      initialQueue: this.queue,
      onRunAll: async () => {
        // TODO: problem with status labels
        for (const citySchedule of this.queue) {
          this.safeRunCitySchedule(citySchedule);
        }
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onResetAll: async () => {
        this.rerunAllCitySchedules();
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onDeleteAll: () => {
        this.deleteAllSchedules();
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onPauseAll: () => {
        this.pauseAllSchedules();
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onRunCity: async (citySchedule: CitySchedule) => {
        await this.safeRunCitySchedule(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onRestartCity: async (citySchedule: CitySchedule) => {
        this.stopCityScheduleActions(citySchedule);
        await this.safeRunCitySchedule(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onPauseCity: (citySchedule: CitySchedule) => {
        this.stopCityScheduleActions(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onDeleteCity: (citySchedule: CitySchedule) => {
        this.clearAndRemoveCitySchedule(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onDeleteItem: (citySchedule: CitySchedule, item: QueueItem) => {
        this.removeItem(citySchedule.city, item);
      },
    });
    // this.queueInlineUIUtility = useMasterQueueInline();
  }

  public isRunning() {
    return this.RUN;
  }

  public async start() {
    this.RUN = true;
    // QUESTION: consider not calling it there, but make sure it doesn't affect the integrity
    // this.reevaluateProviderCities();
    this.addResourceLockChangeListener();
    this.addOncityChangeListener();
  }

  public pause() {
    this.RUN = false;
    this.pausedCitySchedulesSnapshot = this.queue.filter(schedule => {
      // QUESTION: should `currentAction` or `timeoutData.timeoutId` be both checked
      const isRunning =
        schedule.currentAction ||
        schedule.timeoutData.timeoutId ||
        Object.values(schedule.nonBlockingQueueComplex).some(nbs => nbs.timeoutData.timeoutId);

      // to avoid double iteration by separate method call, stop it there
      if (isRunning) this.stopCityScheduleActions(schedule);
      return isRunning;
    });
  }

  public async resume() {
    this.RUN = true;
    for (const cs of this.pausedCitySchedulesSnapshot) {
      // no await
      this.safeRunCitySchedule(cs);
    }
    this.pausedCitySchedulesSnapshot = [];
  }

  public async stop() {
    this.RUN = false;
    if (this.resourceLockChangeListener) {
      this.resourceLock.removeListener('resource-lock-change', this.resourceLockChangeListener);
    }
    if (this.cityChangeListener) {
      this.citySwitchManager.removeListener('cityChange', this.cityChangeListener);
    }

    this.tableUIUtility.unmount();
    document.querySelectorAll('[data-component-name="master-queue-inline"]').forEach(el => (el.innerHTML = ''));

    this.queue.forEach(citySchedule => {
      this.stopCityScheduleMainQueueAction(citySchedule);
      Object.values(citySchedule.nonBlockingQueueComplex).forEach(nbs => this.stopNonBlockingQueueAction(nbs));
    });
  }

  private addResourceLockChangeListener() {
    const listener = (city: CityInfo) => {
      console.log('resource-lock-change:', city);
      this.reevaluateProviderCities();
      this.persistSchedule();
    };
    this.resourceLockChangeListener = listener;
    this.resourceLock.addListener('resource-lock-change', listener);
  }

  // OPTIMIZATION: maybe do some visibility check first not to rerender if its hidden
  private addOncityChangeListener() {
    const listener = (city: CityInfo) => {
      const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
      this.rerenderInjectedQueuesUI(citySchedule);
    };
    this.cityChangeListener = listener;
    this.citySwitchManager.addListener('cityChange', listener);
  }

  public addToQueue(city: CityInfo, item: QueueItemInput) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = {
        city,
        queue: [
          {
            id: crypto.randomUUID(),
            ...item,
            supplierCities: item.supplierCities ?? [],
          },
        ],
        nonBlockingQueueComplex: {},
        timeoutData: {},
      };
      this.queue.push(citySchedule);
    } else {
      /*
      jeżeli kolejka główna jest pusta, ale w async kolejce typu kolejka istnieje to żeby nie uruchamiać
      specjalnie kolejki głównej żeby item został dodany na koniec async kolejki zrób to tutaj od razu.
      */
      if (!citySchedule.queue.length && citySchedule.nonBlockingQueueComplex[item.itemType]?.queue.length) {
        const asyncQueueOfType = citySchedule.nonBlockingQueueComplex[item.itemType]!.queue;
        asyncQueueOfType.splice(
          item.priority === QueuePriority.High
            ? findLastIndex<QueueItem>(asyncQueueOfType, queueItem => queueItem.priority === QueuePriority.High) + 1
            : asyncQueueOfType.length,
          0,
          {
            id: crypto.randomUUID(),
            ...item,
            supplierCities: item.supplierCities ?? [],
          },
        );

        this.rerenderInjectedQueuesUI(citySchedule);
        this.tableUIUtility.update(this.queue);
        this.persistCitySchedule(citySchedule);
        return citySchedule;
      } else {
        // index kolejki dla nowego itemu, który uwzględnia priorytet i to czy kolejka jest w trakcie działania
        const insertIndex =
          item.priority === QueuePriority.High
            ? (() => {
                const afterLastHPIndex =
                  findLastIndex<QueueItem>(citySchedule.queue, queueItem => queueItem.priority === QueuePriority.High) +
                  1;
                return citySchedule.currentAction ? afterLastHPIndex || 1 : afterLastHPIndex;
              })()
            : citySchedule.queue.length;

        citySchedule.queue.splice(insertIndex, 0, {
          id: crypto.randomUUID(),
          ...item,
          supplierCities: item.supplierCities ?? [],
        });

        /* 
          jeżeli po dodaniu itemu na koniec, kolejka ma tylko nowo dodany item ALE jakaś async kolejka jest uruchomiona, 
          to trzeba ręcznie uruchomić kolejkę główną, bo jest idle
        */
        if (
          citySchedule.queue.length === 1 &&
          Object.values(citySchedule.nonBlockingQueueComplex).some(c => c.timeoutData.timeoutId)
        ) {
          /*
           nie trzeba reewaluować bo podczas runNextAction wykona się sprawdzenie czy to miasto było dotychczas
           supplierem i samo się zreewaluuje
           */
          this.runNextAction(citySchedule);
          this.rerenderInjectedQueuesUI(citySchedule);
          this.tableUIUtility.update(this.queue);
          this.persistCitySchedule(citySchedule);
          return citySchedule;
        }
      }
    }

    this.reevaluateProviderCities();
    this.rerenderInjectedQueuesUI(citySchedule);
    this.tableUIUtility.update(this.queue);
    this.persistCitySchedule(citySchedule);
    return citySchedule;
  }

  /**
   * @see VALID
   */
  public clearAndRemoveCitySchedule(citySchedule: CitySchedule) {
    this.stopCityScheduleActions(citySchedule);
    citySchedule.queue = [];

    this.persistCitySchedule(citySchedule);
  }

  /**
   * Stops, and clears all action related info.
   * @see VALID
   */
  private stopCityScheduleMainQueueAction(citySchedule: CitySchedule) {
    citySchedule.currentAction = null;
    citySchedule.timeoutData.executionTime = undefined;
    citySchedule.timeoutData.purpose = undefined;
    clearTimeout(citySchedule.timeoutData.timeoutId);
    clearInterval(citySchedule.timeoutData.timeoutId);
    citySchedule.timeoutData.timeoutId = undefined;
  }

  /**
   * Stops, and clears all action related info.
   * @see VALID
   */
  private stopNonBlockingQueueAction(complex: NonBlockingQueue) {
    clearTimeout(complex.timeoutData.timeoutId);
    clearInterval(complex.timeoutData.timeoutId);
    complex.timeoutData.purpose = undefined;
    complex.timeoutData.executionTime = undefined;
  }

  /**
   * @see VALID - BUT should call reworked UILock instance to remove queued element
   */
  private stopCityScheduleActions(citySchedule: CitySchedule) {
    this.stopCityScheduleMainQueueAction(citySchedule);
    Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex => this.stopNonBlockingQueueAction(complex));
  }

  // QUESTION: await or not
  /**
   * Stop city schedule actions and runs it again for each city schedule.
   * @see VALID
   */
  public async rerunAllCitySchedules() {
    for (const citySchedule of this.queue) {
      // stops actions, and clears info data
      this.stopCityScheduleActions(citySchedule);
      // runs next action
      await this.safeRunCitySchedule(citySchedule);
    }
  }

  // QUESTION: should it be awaited or not
  /**
   * Starts safely citySchedule taking into account non-blocking queues which are merged into main queue
   * if for some reason are lacking the registered action.
   * @see VALID
   */
  private async safeRunCitySchedule(citySchedule: CitySchedule) {
    if ((citySchedule.queue.length && !citySchedule.timeoutData.timeoutId) || !citySchedule.queue.length) {
      Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex => {
        if (complex.queue.length && !complex.timeoutData.timeoutId) {
          let startIndex = findLastIndex<QueueItem>(citySchedule.queue, i => i.priority === QueuePriority.High) + 1;
          citySchedule.queue.splice(startIndex, 0, ...complex.queue.splice(0));
        }
      });
      if (citySchedule.queue.length) await this.runNextAction(citySchedule);
    } else {
      // kolejka istnieje i chodzi na pewno
      Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex => {
        if (complex.queue.length && !complex.timeoutData.timeoutId) {
          let startIndex = findLastIndex<QueueItem>(citySchedule.queue, i => i.priority === QueuePriority.High) + 1;
          // jeżeli nie znaleziono nic z wysokim priorytetem (więc jest na 0), to daj na 1 indeks bo kolejka chodzi
          if (startIndex === 0) startIndex = 1;
          citySchedule.queue.splice(startIndex, 0, ...complex.queue.splice(0));
        }
      });
    }
  }

  /**
   * Wrapper method around removing finished item from the queue, clearing queue timeouts, and revalidating all queues first items.
   * @param citySchedule
   * @see VALID - but repetition policy not implemented
   */
  private async onItemExecutionFinish(citySchedule: CitySchedule) {
    console.log('onItemExecutionFinish', JSON.parse(JSON.stringify(citySchedule)));
    // TODO: this is the place to handle execution policy (cycles)
    const finishedItem = citySchedule.queue[0];
    if (finishedItem?.repetitionPolicy) {
      finishedItem.repetitionPolicy.currentIteration++;
      if (
        (finishedItem.repetitionPolicy.count &&
          finishedItem.repetitionPolicy.count < finishedItem.repetitionPolicy.currentIteration) ||
        (finishedItem.repetitionPolicy.while && (await finishedItem.repetitionPolicy.while())) ||
        (finishedItem.repetitionPolicy.until && (await finishedItem.repetitionPolicy.until()))
      ) {
        // clear callbacks just in case
        this.stopCityScheduleMainQueueAction(citySchedule);

        if (finishedItem.repetitionPolicy.interval) {
          // TODO: implement this later, for now don't add this functionality
          // finishedItem.executionTime = Date.now() + finishedItem.repetitionPolicy.interval;
        }
        // this.persistSchedule();
        this.persistCitySchedule(citySchedule);
        await this.runNextAction(citySchedule);
      }
    } else {
      await this.cleanAndRunNext(citySchedule);
    }
  }

  /**
   * Wrapper method that summarically does the following:
   * - Clean's the current action details
   * - Removes given element
   * - Updates the supplier cities
   * - Persists the schedule
   * - rerenders all master-queue related UI
   * - runs subsequent queue element
   *
   * @see VALID
   */
  private async cleanAndRunNext(citySchedule: CitySchedule, id?: string) {
    // clean info holders
    this.cleanUpdateAndPersist(citySchedule, id);

    // run next action
    await this.runNextAction(citySchedule);
  }

  private async runNextAction(citySchedule: CitySchedule) {
    // run next action
    const nextQueueItem = citySchedule?.queue[0];
    if (!nextQueueItem) return;

    citySchedule.currentAction = nextQueueItem.itemType;
    // makes sure that city is not supplier any more
    this.removeFromSupplierCityList(citySchedule.city);
    // assigns reference to supplierCities array
    if (nextQueueItem.supplyEvaluation === 'auto') {
      nextQueueItem.supplierCities = this.supplierCities;
    }

    /**
     * Flow wywołuje metodę odpowiedniego managera przekazując mu:
     * @param queueItem - na którym jest wywołana
     * @param onFinishCallback - callback który zostaje wywołany po zakończeniu działania (by kolejka wiedziała kiedy zacząć działanie na następnym elemencie)
     * @param setScheduleTimeout - callback który ustawia timeout i datę następnego wywołania, jeżeli item ma timeout
     */
    try {
      // if it comes back from non-blocking queue and had specific callback assigned for some reason -> perform it instead
      if (nextQueueItem.directOperation) {
        return await nextQueueItem.directOperation();
      }

      await this.getExecutor(nextQueueItem.itemType).execute({
        id: nextQueueItem.id,
        supplierCities: nextQueueItem.supplierCities,
        maxShipmentTime: nextQueueItem.maxShipmentTime,
        city: citySchedule.city,
        itemDetails: nextQueueItem.itemDetails,
        onFinishCallback: () => {
          this.onItemExecutionFinish(citySchedule);
        },
        setScheduleTimeout: (operationCallback, executionTime, timeoutType: TimeoutType, purpose) => {
          this.setScheduleTimeout(citySchedule, operationCallback, executionTime, timeoutType, nextQueueItem, purpose);
        },
        shiftQueueAndNext: () => {
          this.removeItem(citySchedule, citySchedule.queue[0]);
          this.runNextAction(citySchedule);
          // this.cleanAndRunNext(citySchedule, nextQueueItem.id);
        },
      });
    } catch (error) {
      console.error(`Failed to execute queue item: ${error}, running next one`);
      await this.runNextAction(citySchedule);
    }
  }

  /**
   * Removes given queue item (or else first one) from the queue, clears action related data and timeouts,
   * reevaluates provider cities, persits the schedule, rerenders all UI and emits the event.
   * @param citySchedule - city schedule to shift
   * @see VALID - QUESTIONABLE - is it for removing items onClick? if so then flow is potentially bad!!!
   */
  private cleanUpdateAndPersist(citySchedule: CitySchedule, id?: string) {
    if (!id) citySchedule.queue.shift();
    else {
      citySchedule.queue = citySchedule.queue.filter(q => q.id !== id);
    }
    this.stopCityScheduleMainQueueAction(citySchedule);
    this.reevaluateProviderCities();
    this.persistCitySchedule(citySchedule);
    this.rerenderInjectedQueuesUI(citySchedule);
    this.tableUIUtility.update(this.queue);
  }

  // TODO: potentially make it use this.supplierCities reference
  /**
   * Evaluates supplier cities for each first queue item (potentially running) in every city schedule.
   * @param schedule
   * @see VALID
   */
  private reevaluateProviderCities() {
    this.supplierCities.length = 0;
    this.supplierCities.push(...this.getSupplierCities());

    // this.queue.forEach(citySchedule => {
    //   if (citySchedule.queue[0]?.supplyEvaluation === 'auto') {
    //     citySchedule.queue[0].supplierCities = supplierCities;
    //   }
    // });
  }

  // TODO: optimize it later (reducer or sth)
  /**
   * Calculates supplier citiy list based on the blocking queue traffic, whitelist and lockedlist.
   * If given schedule has no items in the main queue it is automatically considered supplier - unless
   * it's "locked".
   *
   * @returns
   */
  public getSupplierCities() {
    const queuedCityNames = this.queue
      .filter(citySchedule => citySchedule.queue.length > 0)
      .map(citySchedule => citySchedule.city.name);
    const whiteListCityNames = this.resourcesWhiteList.map(city => city.name);
    const lockedCityNames = this.resourceLock.getLockList().map(city => city.name);

    const consumerCityNames = new Set<string>([
      // miasta które są zakolejkowane ale nie są w białej liście - np blokujący item który czeka powyżej 30 minut jest dodawany do takiej listy
      ...queuedCityNames.filter(queuedCity => !whiteListCityNames.includes(queuedCity)),
      // miasta które są zablokowane (mają większy priorytet niż white list)
      ...lockedCityNames,
    ]);

    const allCities = this.citySwitchManager.getCityList();
    return allCities.filter(city => !consumerCityNames.has(city.name));
  }

  private addCityToSuppliersList(city: CityInfo) {
    if (!this.resourcesWhiteList.map(city => city.name).includes(city.name)) {
      this.resourcesWhiteList.push(city);
      this.reevaluateProviderCities();
    }
  }

  /**
   *
   * @param citySchedule
   * @param operationCallback
   * @param executionTime
   * @param timeoutType
   * @param queueItem
   * @param purpose
   *
   * @see VALID - no ui refresh
   */
  private setScheduleTimeout(
    citySchedule: CitySchedule,
    operationCallback: () => Promise<void> | void,
    executionTime: number,
    timeoutType: TimeoutType, // part of execution (resources arrival) | waiting (for slot, charms etc)
    queueItem: QueueItem,
    purpose?: TimeoutPurpose,
  ) {
    const waitTimeMs = executionTime - Date.now();
    const waitTimeSeconds = Math.round(waitTimeMs / 1000);
    console.log(
      `[MasterQueue] Scheduling timeout for "${queueItem.itemType}" in city "${citySchedule.city.name}"`,
      `- Execution time: ${new Date(executionTime).toLocaleString()} (in ${waitTimeSeconds}s)`,
      `- Timeout type: ${timeoutType} (${timeoutType === 'execution' ? 'resources arrival' : 'waiting for slot/charms'})`,
      `- Purpose: ${purpose ?? 'unspecified'}`,
      `- Item blocking: ${queueItem.blocking ? 'YES' : 'NO'}`,
    );

    // item is sequential (blocks until executed)
    if (queueItem.blocking) {
      console.log(`[MasterQueue] → Blocking item - will block queue until execution`);
      // if blocking item needs to wait for longer than "maximumBlockingTime" then it can share its resources
      if (timeoutType === 'waiting') {
        if (executionTime - Date.now() > MasterQueue.RESOURCES_BLOCKING_TIME) {
          console.log(
            `[MasterQueue] → Blocking item waiting > ${MasterQueue.RESOURCES_BLOCKING_TIME / 1000}s - adding city to suppliers list (resources can be shared)`,
          );
          this.addCityToSuppliersList(citySchedule.city);
        } else {
          console.log(
            `[MasterQueue] → Blocking item waiting < ${MasterQueue.RESOURCES_BLOCKING_TIME / 1000}s - city stays blocked (resources not shared)`,
          );
        }
      }

      // creating timeout that will execute operationCallback and remove city from suppliers list
      console.log(`[MasterQueue] → Creating blocking timeout (will execute in ${waitTimeSeconds}s)`);
      const timeoutId = setTimeout(async () => {
        if (timeoutType === 'waiting') {
          console.log(`[MasterQueue] → Timeout executed - removing city from suppliers list`);
          this.removeFromSupplierCityList(citySchedule.city);
        }
        await operationCallback();
      }, executionTime - Date.now());

      citySchedule.timeoutData = {
        timeoutId,
        executionTime,
        purpose,
      };
      console.log(`[MasterQueue] ✓ Blocking timeout scheduled successfully`);
    }
    // non-blocking
    else {
      console.log(`[MasterQueue] → Non-blocking item - queue continues processing other items`);
      // indirect (waiting for charms, slots, etc.) and waiting time is longer than RESOURCES_BLOCKING_TIME
      if (timeoutType === 'waiting' && executionTime - Date.now() > MasterQueue.RESOURCES_BLOCKING_TIME) {
        console.log(
          `[MasterQueue] → Non-blocking item waiting > ${MasterQueue.RESOURCES_BLOCKING_TIME / 1000}s - using async queue for type "${queueItem.itemType}"`,
        );
        let nonBlockingQueueContainerOfType = citySchedule.nonBlockingQueueComplex?.[queueItem.itemType];
        if (!nonBlockingQueueContainerOfType) {
          console.log(`[MasterQueue] → Creating new async queue container for type "${queueItem.itemType}"`);
          nonBlockingQueueContainerOfType = {
            queue: [],
            timeoutData: {},
          };
          citySchedule.nonBlockingQueueComplex[queueItem.itemType] = nonBlockingQueueContainerOfType;
        }

        // if async queue aleady exists just push queue item there
        if (nonBlockingQueueContainerOfType.queue.length) {
          console.log(
            `[MasterQueue] → Async queue for "${queueItem.itemType}" already exists (${nonBlockingQueueContainerOfType.queue.length} items) - adding item to queue`,
          );
          queueItem.directOperation = async () => await operationCallback();
          nonBlockingQueueContainerOfType.queue.push(queueItem);
          this.persistCitySchedule(citySchedule);
        }
        // else (async queue doesn't exist, this item is first to be added)
        else {
          console.log(
            `[MasterQueue] → First item of type "${queueItem.itemType}" in async queue - extracting adjacent items of same type`,
          );
          // it will be executed instead of plain "execute" method
          queueItem.directOperation = async () => await operationCallback();
          // eliminates the need to check execution possibility for each item of the same type after the first one which is already not possible
          const adjacentQueueItemsOfType = this.extractAdjacentQueueItemsOfSameType(citySchedule);
          console.log(
            `[MasterQueue] → Extracted ${adjacentQueueItemsOfType.length} adjacent items of type "${queueItem.itemType}" to async queue`,
          );
          nonBlockingQueueContainerOfType.queue.push(...adjacentQueueItemsOfType);

          // if after extraction, main queue is empty, make this city supplier
          if (!citySchedule.queue.length) {
            console.log(`[MasterQueue] → Main queue is now empty - reevaluating provider cities`);
            this.reevaluateProviderCities();
          }

          console.log(
            `[MasterQueue] → Creating async queue timeout (will merge back to main queue in ${waitTimeSeconds}s)`,
          );
          nonBlockingQueueContainerOfType.timeoutData = {
            timeoutId: setTimeout(() => {
              console.log(
                `[MasterQueue] → Async queue timeout executed - merging ${nonBlockingQueueContainerOfType.queue.length} items back to main queue`,
              );
              /*
               -move all type-related queue back to the main queue
              NOTE: to rozwiązanie nie jest idealne, ale jest proste i zapewnia zachowanie kolejności 
              pierwszy item najprawdpodobniej uda się zrobić bo pojawił się slot, następny zostanie sprawdzony - odomowa - i ta metoda wywoła się od nowa, 
              znów znajdzie przyległe elementy tego samego typu i wrzuci do non-blocking-queue, z ustawionym timeoutem na pierwszy item
              */
              const items = nonBlockingQueueContainerOfType.queue.splice(0);
              nonBlockingQueueContainerOfType.timeoutData = {};

              // merge non-blocking queue to main queue, runNextAction will remove it from supplierCities and reevaluate
              this.respectfulUnshiftQueueItems(citySchedule, items);

              /* POSSIBILITY: put only first item to the main queue, ale wadliwe bo jest problem by później zabrać następny element z nieblokującej kolejki - ona nie ma timeoutu */
            }, executionTime - Date.now()),
            executionTime,
            purpose,
          };
          // OPTIMIZATION: conisder persisting only given city schedule, because the others will take care of themselves
          this.persistSchedule();
          console.log(`[MasterQueue] ✓ Async queue timeout scheduled successfully`);

          // after extracting to separate queue, run next
          this.runNextAction(citySchedule);
        }
      }
      // non-blocking 'execution' callback - so it must block
      else {
        console.log(
          `[MasterQueue] → Non-blocking execution timeout (resources arrival) - creating simple timeout (will execute in ${waitTimeSeconds}s)`,
        );
        citySchedule.timeoutData = {
          timeoutId: setTimeout(async () => await operationCallback(), executionTime - Date.now()),
          executionTime,
          purpose,
        };
        console.log(`[MasterQueue] ✓ Non-blocking execution timeout scheduled successfully`);
      }
    }
    console.log(`[MasterQueue] → Updating UI queues after timeout scheduling`);
    this.rerenderInjectedQueuesUI();
    this.tableUIUtility.update(this.queue);
  }

  /**
   * Removes first group of adjacent items of the same type from the original array and returns.
   * @param citySchedule
   * @returns list of items adjacent to each other of the same type
   * @see VALID
   */
  public extractAdjacentQueueItemsOfSameType(citySchedule: CitySchedule) {
    const firstOtherItemTypeIndex = citySchedule.queue.findIndex(
      item => item.itemType !== citySchedule.queue[0].itemType,
    );
    return citySchedule.queue.splice(0, firstOtherItemTypeIndex === -1 ? 1 : firstOtherItemTypeIndex);
  }

  // NOTE: rethink merge logic with high priority
  /**
   * Puts queue items to the queue front with respect to running or high priority items in the main queue and runs if idle.
   * @param citySchedule on which operation occurs
   * @param items list of queue items to be attached to the main queue
   * @see ALMOST-VALID ( priority makes it complex)
   */
  public async respectfulUnshiftQueueItems(citySchedule: CitySchedule, items: QueueItem[]) {
    if (citySchedule.currentAction || citySchedule.timeoutData.timeoutId) {
      // stop first item if it's waiting for the slot and merge nbq at 0 index
      if (citySchedule.timeoutData.purpose === 'slot') {
        this.stopCityScheduleMainQueueAction(citySchedule);
        citySchedule.queue.splice(0, 0, ...items);
        await this.runNextAction(citySchedule);
      } else {
        citySchedule.queue.splice(
          findLastIndex<QueueItem>(citySchedule.queue, item => item.priority === QueuePriority.High) + 1 || 1,
          0,
          ...items,
        );
      }
    } else {
      // main queue is idle and at this point should be empty (bacause otherwise this condition wouldn't fire),
      // either way execution should be started
      citySchedule.queue.splice(
        findLastIndex<QueueItem>(citySchedule.queue, item => item.priority === QueuePriority.High) + 1,
        0,
        ...items,
      );
      await this.runNextAction(citySchedule);
    }
  }

  /**
   * If there is no queue item in the main queue, puts city to suplliers list.
   * @param citySchedule
   * @see VALID
   */
  public tryAddCityToSuppliersList(citySchedule: CitySchedule) {
    if (!citySchedule.queue.length) this.addCityToSuppliersList(citySchedule.city);
  }

  public getBusyCities() {
    return this.queue.filter(citySchedule => citySchedule.queue.length > 0).map(citySchedule => citySchedule.city);
  }

  public hasCitySchedule(city: CityInfo) {
    return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue.length ?? 0 > 0;
  }

  public getCityScheduleQueueLength(city: CityInfo) {
    return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue.length ?? 0;
  }

  public getCitySchedule(city: CityInfo) {
    return this.queue.find(citySchedule => citySchedule.city.name === city.name);
  }

  /**
   * Rerenders all master-queue elements in the DOM.
   * If no argument is provided, rerenders queue for current city (or clears if non-existent).
   * @param arg - city schedule/city info corresponding to the queue to rerender
   */
  // TODO: preact integration
  public rerenderInjectedQueuesUI(arg?: CitySchedule | CityInfo) {
    const citySchedule = arg
      ? Object.keys(arg).includes('name')
        ? this.getCitySchedule(arg as CityInfo)
        : (arg as CitySchedule)
      : this.getCitySchedule(this.citySwitchManager.getCurrentCity()!);

    console.log('rerenderAllUIQueues, citySchedule', citySchedule);
    document.querySelectorAll(`[data-component-name="${MasterQueueInlineName}"]`).forEach(el => {
      if (citySchedule) {
        console.log('should mount');
        useMasterQueueInline().mount(el as HTMLElement, {
          schedule: citySchedule,
          onDeleteItem: item => this.removeItem(citySchedule.city, item),
        });
      } else {
        el.innerHTML = '';
      }
    });
  }

  /**
   * Adds data attribute, so that on any schedule change all containers of that kind gets automatically refreshed.
   * If city arg is provided -> injects queue into the container.
   */
  public registerInlineQueueContainer(container: HTMLElement, city?: CityInfo) {
    container.dataset.componentName = MasterQueueInlineName;
    // if second param is added, then mount UI in the queue
    if (city) {
      this.injectCityQueueUI(container, city);
    }
  }

  // FUTURE: it's being called very often, in large datasets it may require optimization
  /**
   * @see VALID - but probably shouldn't be used anymore (maybe?)
   */
  private persistSchedule() {
    localStorage.setItem(
      MasterQueue.LOCAL_STORAGE_KEY,
      JSON.stringify(
        this.queue
          .filter(citySchedule => citySchedule.queue.length > 0)
          .map((citySchedule: CitySchedule) => ({
            city: citySchedule.city,
            queue: citySchedule.queue.map(queueItem => ({
              ...queueItem,
              itemDetails: this.getExecutor(queueItem.itemType).persistItem(queueItem.itemDetails),
            })),
            nonBlockingQueueComplex: Object.fromEntries(
              Object.entries(citySchedule.nonBlockingQueueComplex)
                .filter(([itemType, complex]) => complex.queue.length > 0)
                .map(([itemType, complex]) => [
                  itemType,
                  {
                    queue: complex.queue.map(queueItem => ({
                      ...queueItem,
                      itemDetails: this.getExecutor(queueItem.itemType).persistItem(queueItem.itemDetails),
                    })),
                  },
                ]),
            ),
          })),
      ),
    );
  }

  /**
   * Takes already persisted obj from local storage and updates only given citySchedule obj in it
   * which reduces amount of operations.
   *
   * @see VALID
   */
  private persistCitySchedule(schedule: CitySchedule) {
    const alreadyPersistedSchedule: CitySchedule[] = JSON.parse(
      localStorage.getItem(MasterQueue.LOCAL_STORAGE_KEY) ?? '[]',
    );

    const citySchedulePersistObj = schedule.queue.length
      ? ({
          city: schedule.city,
          queue: schedule.queue.map(queueItem => ({
            ...queueItem,
            itemDetails: this.getExecutor(queueItem.itemType).persistItem(queueItem.itemDetails),
          })),
          nonBlockingQueueComplex: Object.fromEntries(
            Object.entries(schedule.nonBlockingQueueComplex)
              .filter(([itemType, complex]) => complex.queue.length > 0)
              .map(([itemType, complex]) => [
                itemType,
                {
                  queue: complex.queue.map(queueItem => ({
                    ...queueItem,
                    itemDetails: this.getExecutor(queueItem.itemType).persistItem(queueItem.itemDetails),
                  })),
                },
              ]),
          ),
        } as CitySchedule)
      : null;

    const index = alreadyPersistedSchedule.findIndex(e => e.city.name === schedule.city.name);

    // exists
    if (index !== -1) {
      if (citySchedulePersistObj) alreadyPersistedSchedule[index] = citySchedulePersistObj;
      else alreadyPersistedSchedule.splice(index, 1);
    }
    // doesn't exist in the local storage
    else {
      if (citySchedulePersistObj) alreadyPersistedSchedule.push(citySchedulePersistObj);
    }

    localStorage.setItem(MasterQueue.LOCAL_STORAGE_KEY, JSON.stringify(alreadyPersistedSchedule));
  }

  // NOTE: during non-blocking queue joining, it doesn't take into account the priority
  /**
   * Loads schedule from localStorage, hydrates executor specific part with executor's method, moves all non-blocking queues
   * into master queue to the front.
   *
   * @see VALID - apart from priority
   */
  private loadSchedule() {
    const schedule = localStorage.getItem(MasterQueue.LOCAL_STORAGE_KEY);
    if (schedule) {
      const parsedSchedule: CitySchedule[] = JSON.parse(schedule);
      console.log('loaded master-queue schedule:', parsedSchedule);
      const hydratedSchedule = this.hydrateSchedule(parsedSchedule);
      console.log('hydrated master-queue schedule:', hydratedSchedule);

      hydratedSchedule.forEach(citySchedule => {
        citySchedule.queue.unshift(
          ...Object.entries(citySchedule.nonBlockingQueueComplex).flatMap(([itemType, complex]) =>
            complex.queue.splice(0),
          ),
        );
      });
      // schedule
      this.queue = hydratedSchedule;
    } else {
      this.queue = [];
    }
  }

  /**
   * Hydrates the schedule using executor's specific methods.
   * @see VALID
   */
  private hydrateSchedule(schedule: CitySchedule[]) {
    return schedule
      .map(citySchedule => {
        const city = this.citySwitchManager.getCityByName(citySchedule.city.name);
        if (!city) return null;

        // city has method inside which needs to be hydrated
        citySchedule.city = city;
        // during persistance it's not saved, but is required for proper functioning
        citySchedule.timeoutData = {};

        // supllier cities contain CityInfo which needs to be hydrated
        citySchedule.queue.forEach(queueItem => {
          // if manual then hydrate cities
          if (queueItem.supplyEvaluation === 'manual') {
            queueItem.supplierCities = (queueItem.supplierCities ?? [])
              .map(city => this.citySwitchManager.getCityByName(city.name) ?? null)
              .filter(Boolean) as CityInfo[];
          }
          // else empty it, runNextAction will attach newly calcualted list
          else {
            queueItem.supplierCities = [];
          }

          // Mark for later hydration if executor not yet registered
          const executor = this.executors.get(queueItem.itemType);
          if (executor) {
            queueItem.itemDetails = executor.hydrateItem(queueItem.itemDetails);
          } else {
            (queueItem as any).__needsHydration = true;
          }
        });

        // smae thing for each element in the non-blocking queue
        Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex =>
          complex.queue.forEach(queueItem => {
            if (queueItem.supplyEvaluation === 'manual') {
              queueItem.supplierCities = (queueItem.supplierCities ?? [])
                .map(city => this.citySwitchManager.getCityByName(city.name) ?? null)
                .filter(Boolean) as CityInfo[];
            } else {
              queueItem.supplierCities = [];
            }

            // Mark for later hydration if executor not yet registered
            const executor = this.executors.get(queueItem.itemType);
            if (executor) {
              queueItem.itemDetails = executor.hydrateItem(queueItem.itemDetails);
            } else {
              (queueItem as any).__needsHydration = true;
            }
          }),
        );
        return citySchedule;
      })
      .filter(Boolean) as CitySchedule[];
  }

  public getTypeSpecificItemDetailsForCity(city: CityInfo, type: QueueItemType): QueueItem['itemDetails'][] {
    const citySchedule = this.queue.find(citySchedule => citySchedule.city.name === city.name);
    if (type && citySchedule) {
      return (
        (citySchedule.nonBlockingQueueComplex[type]?.queue ?? [])
          .concat(citySchedule.queue.filter(item => item.itemType === type))
          .map(item => item.itemDetails) ?? []
      );
    }
    return [];
  }

  public injectQueueNavigation(identifier: CityInfo | CitySchedule, container: HTMLElement) {
    let citySchedule =
      'name' in identifier ? this.queue.find(schedule => schedule.city.name === identifier.name) : identifier;

    // because schedule for citry may not exist at this point, create one
    // so that when item is added, buttons are initialized and work
    if (!citySchedule) {
      citySchedule = {
        city: 'name' in identifier ? identifier : identifier.city,
        queue: [],
        nonBlockingQueueComplex: {},
        timeoutData: {},
      };
      this.queue.push(citySchedule);
    }

    // QUESTION: await or not?
    const utility = useInlineQueueNavigation();
    utility.mount(container, {
      onRun: async () => {
        await this.safeRunCitySchedule(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onRestart: async () => {
        this.stopCityScheduleActions(citySchedule);
        await this.safeRunCitySchedule(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onPause: () => {
        this.stopCityScheduleActions(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
      onDelete: () => {
        this.clearAndRemoveCitySchedule(citySchedule);
        this.tableUIUtility!.update(this.queue);
        this.rerenderInjectedQueuesUI();
      },
    });
    return { getValues: utility.getValues };
  }

  private deleteAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.stopCityScheduleActions(citySchedule);
      citySchedule.queue = [];
    });
    this.persistSchedule();
  }

  private pauseAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.stopCityScheduleActions(citySchedule);
    });
  }

  public getScheduledActionTimes() {
    return this.queue
      .flatMap(citySchedule => {
        return [[citySchedule.timeoutData.executionTime, STANDARD_EXECUTION_TIME_MS]].concat(
          Object.values(citySchedule.nonBlockingQueueComplex).map(item => [
            item.timeoutData.executionTime,
            STANDARD_EXECUTION_TIME_MS,
          ]),
        );
      })
      .filter(Boolean) as [number, number | undefined][];
  }

  /**
   * Removes item from queue by id or reference and refreshes all ui elements. If item was first in queue its scheduled operation will be canceled.
   * Method handles also deletion from non-blocking queues.
   * @param scheduleIdentifier - city whose schedule item is to be deleted
   * @param identifier - either item id (string) or queue item reference
   * @see VALID
   */
  public removeItem(scheduleIdentifier: CityInfo | CitySchedule, identifier: string | QueueItem): void {
    let removedQueueItem: QueueItem | null = null;
    let queue: QueueItem[] | null = null;
    let removedIndex: number | null = null;
    let queueType: 'main' | 'non-blocking' | null = null;

    const citySchedule =
      'name' in scheduleIdentifier
        ? this.queue.find(schedule => schedule.city.name === scheduleIdentifier.name)
        : scheduleIdentifier;

    if (!citySchedule) return;

    let itemIndexInMainQueue =
      typeof identifier === 'string'
        ? citySchedule.queue.findIndex(item => item.id === identifier)
        : citySchedule.queue.findIndex(item => item === identifier);

    if (itemIndexInMainQueue !== -1) {
      queue = citySchedule.queue;
      queueType = 'main';
      removedIndex = itemIndexInMainQueue;
      if (itemIndexInMainQueue === 0) {
        this.stopCityScheduleMainQueueAction(citySchedule);
        // simplest thing is to let this citySchedule stop as first item was deleted, and let the user rerun it manually or programmatically if needed
        // NOTE: consider running new first item instantly
      }

      removedQueueItem = citySchedule.queue.splice(itemIndexInMainQueue, 1)[0];
    } else {
      Object.values(citySchedule.nonBlockingQueueComplex).some(complex => {
        const index = complex.queue.findIndex(e =>
          typeof identifier === 'string' ? e.id === identifier : e === identifier,
        );
        if (index !== -1) {
          queue = complex.queue;
          queueType = 'non-blocking';
          removedIndex = index;
          removedQueueItem = complex.queue.splice(index, 1)[0];
          if (!complex.queue.length) {
            this.stopNonBlockingQueueAction(complex);
          }
          // else don't clear the timeoutes - it will still merge the rest of the items at the exact same time
          return true;
        }
        return false;
      });
    }

    if (removedQueueItem && queue && removedIndex !== null && queueType) {
      /*
      If executor has postDeleteActon: merges chronologically queues of given types, slices from removed index and prepares the format. 
      */
      if (this.getExecutor(removedQueueItem.itemType).postDeleteAction) {
        const itemsToUpdate = (
          (queueType as 'main' | 'non-blocking') === 'non-blocking'
            ? queue
                .slice(removedIndex)
                .concat(citySchedule.queue.filter(i => i.itemType === removedQueueItem!.itemType))
            : (citySchedule.nonBlockingQueueComplex?.[removedQueueItem.itemType]?.queue ?? []).concat(
                queue.slice(removedIndex).filter(i => i.itemType === removedQueueItem!.itemType),
              )
        ).map(e => ({ ui: e.ui, details: e.itemDetails }));

        this.getExecutor(removedQueueItem.itemType).postDeleteAction!(itemsToUpdate, removedQueueItem.itemDetails);
      }

      this.rerenderInjectedQueuesUI(citySchedule);
      this.tableUIUtility.update(this.queue);
      // reevaluate only if city can become supplier
      if (!citySchedule.queue.length) {
        this.reevaluateProviderCities();
      }

      this.persistCitySchedule(citySchedule);
    }
  }

  public getProviderCitiesSelect = () => {};

  // NOTE: has it any use at all?
  public unshiftAndRun(scheduleIdentifier: CityInfo | CitySchedule, item: QueueItemInput) {
    let citySchedule =
      'name' in scheduleIdentifier
        ? this.queue.find(schedule => schedule.city.name === scheduleIdentifier.name)
        : scheduleIdentifier;
    if (!citySchedule) {
      citySchedule = this.addToQueue(scheduleIdentifier as CityInfo, item);
    } else {
      this.stopCityScheduleMainQueueAction(citySchedule);

      citySchedule.queue.unshift({
        id: crypto.randomUUID(),
        ...item,
        supplierCities: item.supplierCities ?? [],
      });
    }
    this.persistSchedule();
    this.runNextAction(citySchedule);
  }

  public shareCityResources(city: CityInfo) {
    this.resourcesWhiteList.push(city);
    this.reevaluateProviderCities();
  }

  /**
   * Removes city from the resourcesWhiteList and reevaluates providerCities if item was present inside.
   * @param city
   * @returns true if removed, false if not
   */
  // private removeCityFromSupplierCityList(city: CityInfo) {
  //   const lengthBefore = this.resourcesWhiteList.length;
  //   this.resourcesWhiteList = this.resourcesWhiteList.filter(whitelistCity => whitelistCity.name !== city.name);
  //   const lengthAfter = this.resourcesWhiteList.length;
  //   if (lengthBefore !== lengthAfter) {
  //     this.reevaluateProviderCities();
  //     return true;
  //   }
  //   return false;
  // }

  /**
   * Checks if city is anyhow (ex. in resourcesWhiteList) considered supplier city:
   * - if yes, then removes from resourcesWhiteList, reevaluated and returns `True`
   * - else returns `False`
   * @param city
   * @returns true if removed & reevaluated, false if not
   */
  private removeFromSupplierCityList(city: CityInfo) {
    if (this.supplierCities.find(c => c === city) || this.resourcesWhiteList.find(c => c === city)) {
      // remove from resourcesWhiteList (not necessarily in there)
      this.resourcesWhiteList = this.resourcesWhiteList.filter(whitelistCity => whitelistCity !== city);
      this.reevaluateProviderCities();
      return true;
    }
    return false;
  }

  public refreshUI() {
    this.rerenderInjectedQueuesUI();
    this.tableUIUtility!.update(this.queue);
  }
}
