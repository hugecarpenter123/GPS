/*
TODO
- update table state (non-blocking exists but main is empty)
- add signals and stop manually rerendering
*/

import EventEmitter from 'events';
import gpsConfig from '../../../gps.config';
import ConfigManager from '../../utility/config-manager';
import ResourceLock from '../../utility/resource-lock';
import Service from '../../utility/Service';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import useInlineQueueNavigation from './inline-queue-navigation';
import useMasterQueueInline, { componentName as MasterQueueInlineName } from './master-queue-inline';
import useMasterQueueTable, { MasterQueueTableUtility } from './master-queue-table';

import { TConfigChanges } from '~/config-popup/config-popup';
import { getBrowserExecutionContextInfo, performOnDocumentVisibilityReturn } from '~/utility/ui-utility';

const STANDARD_EXECUTION_TIME_MS = 30000 as const;

export type QueueItemType = 'recruiter' | 'builder' | 'municipal utility' | 'academy';
export type TimeoutPurpose = 'slot' | 'resources' | 'charms' | 'other item' | 'error';
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
  directOperation?: () => Promise<void> | void;
  subsequentItemIds?: string[];

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
  triggerQueue: QueueItem[];
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
  cancelExecution(id: QueueItem['id']): Promise<void> | void;
  // executor dostaje referencje do ui i details, które może updatować zgodnie ze swoim widzi mi się
  postDeleteAction?: (
    queue: PostDeleteQueueDetails<T>[],
    deletedItemDetails: ScheduleOperationDetails<T>['itemDetails'],
  ) => void | Promise<void>;
  // NOTE: rethink if these should modify referenced obj, or return modified copy
  onPositionChange?: (
    queue: PostDeleteQueueDetails<T>[],
    movedItemDetails: ScheduleOperationDetails<T>['itemDetails'],
  ) => void | Promise<void>;
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
        triggerQueue: [],
      };
      this.queue.push(citySchedule);
    }

    useMasterQueueInline().mount(container, {
      schedule: citySchedule,
      onDeleteItem: item => this.removeItem(citySchedule.city, item),
      onQueuePositionChange: (item, newPosition, queueType) =>
        this.changeItemPosition(citySchedule, item, newPosition, queueType),
    });
  }

  public static readonly LOCAL_STORAGE_KEY = 'master-queue';
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

      citySchedule.triggerQueue.forEach(item => {
        if (item.itemType === type) item.itemDetails = executor.hydrateItem(item.itemDetails);
      });
    });
  }

  /**
   * Changes the position of an item in the queue and revalidates affected items
   * @param citySchedule - The city schedule containing the queue
   * @param item - The item to move
   * @param newPosition - The new position (0-based index)
   */
  public async changeItemPosition(
    citySchedule: CitySchedule,
    item: QueueItem,
    newPosition: number,
    queueType: 'main' | QueueItemType,
  ) {
    const queue = queueType === 'main' ? citySchedule.queue : citySchedule.nonBlockingQueueComplex[queueType]?.queue;
    if (!queue) return;

    const currentIndex = queue.findIndex(i => i.id === item.id);

    console.warn(`[MasterQueue] prev position: ${currentIndex}, new position: ${newPosition}`);

    if (currentIndex === -1) {
      console.warn(`[MasterQueue] Item ${item.id} not found in queue`);
      return;
    }

    // Don't do anything if position hasn't changed
    if (currentIndex === newPosition) {
      return;
    }

    // Don't allow moving the currently executing item (index 0 when currentAction is set)
    if ((currentIndex === 0 || newPosition === 0) && queueType === 'main' && citySchedule.currentAction) {
      console.warn(`[MasterQueue] Cannot move item that is currently executing`);
      return;
    }

    // Clamp newPosition to valid range
    const clampedPosition = Math.max(0, Math.min(newPosition, queue.length - 1));

    // Remove item from current position
    const [movedItem] = queue.splice(currentIndex, 1);

    // Position is correct as-is after removal (no adjustment needed)
    const adjustedPosition = clampedPosition;

    // Insert at new position
    queue.splice(adjustedPosition, 0, movedItem);

    // Revalidate affected items (items between old and new position)
    // const startIndex = Math.min(currentIndex, adjustedPosition);
    // const endIndex = Math.max(currentIndex, adjustedPosition);

    console.log(
      `[MasterQueue] Item "${item.ui.title}" moved from position ${currentIndex + 1} to ${adjustedPosition + 1}`,
    );

    // revalidation there
    await this.executors.get(movedItem.itemType)?.onPositionChange?.(
      (citySchedule.nonBlockingQueueComplex[movedItem.itemType]?.queue ?? [])
        .concat(citySchedule.queue.filter(i => i.itemType === movedItem.itemType))
        .map(item => ({ ui: item.ui, details: item.itemDetails })),
      movedItem.itemDetails,
    );

    // Persist changes
    this.rerenderInjectedQueuesUI(citySchedule);
    this.tableUIUtility.update(this.queue);
    this.persistCitySchedule(citySchedule);
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
        // TODO: problem with status labels and refreshing
        for (const citySchedule of this.queue) {
          this.safeRunCitySchedule(citySchedule);
        }
        this.refreshUI();
      },
      onResetAll: async () => {
        this.rerunAllCitySchedules(true);
      },
      onDeleteAll: () => {
        this.deleteAllSchedules();
        this.refreshUI();
      },
      onPauseAll: () => {
        this.pauseAllSchedules();
        this.refreshUI();
      },
      onRunCity: async (citySchedule: CitySchedule) => {
        await this.safeRunCitySchedule(citySchedule);
        this.refreshUI();
      },
      onRestartCity: async (citySchedule: CitySchedule) => {
        this.stopCityScheduleActions(citySchedule);
        this.refreshUI();
        await this.safeRunCitySchedule(citySchedule);
        this.refreshUI();
      },
      onPauseCity: (citySchedule: CitySchedule) => {
        this.stopCityScheduleActions(citySchedule);
        this.refreshUI();
      },
      onDeleteCity: (citySchedule: CitySchedule) => {
        this.clearAndRemoveCitySchedule(citySchedule);
        this.refreshUI();
      },
      onDeleteItem: (citySchedule: CitySchedule, item: QueueItem) => {
        // TODO: find out if that refreshes UI
        this.removeItem(citySchedule.city, item);
      },
      onQueuePositionChange: (
        citySchedule: CitySchedule,
        item: QueueItem,
        newPosition: number,
        queueType: 'main' | QueueItemType,
      ) => {
        this.changeItemPosition(citySchedule, item, newPosition, queueType);
      },
    });
    // this.queueInlineUIUtility = useMasterQueueInline();
  }

  public isRunning() {
    return this.RUN;
  }

  public async start(autorun: boolean = false) {
    this.RUN = true;
    // QUESTION: consider not calling it there, but make sure it doesn't affect the integrity
    // this.reevaluateProviderCities();
    this.addResourceLockChangeListener();
    this.addOncityChangeListener();
    if (autorun) {
      this.rerunAllCitySchedules();
    }
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
        triggerQueue: [],
        timeoutData: {},
      };
      this.queue.push(citySchedule);
    } else {
      /*
      Jeżeli kolejka główna jest pusta, ale w async kolejce danego typu istnieją elementy,
      to dodaj nowy item na koniec async kolejki bez uruchamiania głównej.
      */
      if (!citySchedule.queue.length && citySchedule.nonBlockingQueueComplex[item.itemType]?.queue.length) {
        citySchedule.nonBlockingQueueComplex[item.itemType]!.queue.push({
          id: crypto.randomUUID(),
          ...item,
          supplierCities: item.supplierCities ?? [],
        });

        this.rerenderInjectedQueuesUI(citySchedule);
        this.tableUIUtility.update(this.queue);
        this.persistCitySchedule(citySchedule);
        return citySchedule;
      } else {
        // Dodaj na koniec kolejki
        citySchedule.queue.push({
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
  public clearAndRemoveCitySchedule(citySchedule: CitySchedule, persist: boolean = true) {
    // when start was called for many city schedules, ui lock got queued. And when stop is clicked this queue must be freed.
    const firstItem = citySchedule.queue[0];
    if (firstItem) this.getExecutor(firstItem.itemType).cancelExecution(firstItem.id);

    this.stopCityScheduleMainQueueAction(citySchedule);
    citySchedule.queue = [];
    Object.values(citySchedule.nonBlockingQueueComplex).forEach(nbqc => {
      this.stopNonBlockingQueueAction(nbqc);
      nbqc.queue = [];
    });

    if (persist) this.persistCitySchedule(citySchedule);
  }

  /**
   * Stops, and clears all action related info.
   * @see VALID
   */
  private stopCityScheduleMainQueueAction(citySchedule: CitySchedule) {
    citySchedule.currentAction = null;
    clearTimeout(citySchedule.timeoutData?.timeoutId);
    clearInterval(citySchedule.timeoutData?.timeoutId);
    citySchedule.timeoutData = {};
  }

  /**
   * Stops, and clears all action related info.
   * @see VALID
   */
  private stopNonBlockingQueueAction(complex: NonBlockingQueue) {
    clearTimeout(complex.timeoutData?.timeoutId);
    clearInterval(complex.timeoutData?.timeoutId);
    complex.timeoutData = {};
  }

  /**
   * @see VALID
   */
  private stopCityScheduleActions(citySchedule: CitySchedule) {
    // when start was called for many city schedules, ui lock got queued. And when stop is clicked this queue must be freed.
    const firstItem = citySchedule.queue[0];
    if (firstItem) this.getExecutor(firstItem.itemType).cancelExecution(firstItem.id);
    this.stopCityScheduleMainQueueAction(citySchedule);
    Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex => this.stopNonBlockingQueueAction(complex));
  }

  // QUESTION: await or not
  /**
   * Stop city schedule actions and runs it again for each city schedule.
   * @see VALID
   */
  public async rerunAllCitySchedules(refresh: boolean = false) {
    for (const citySchedule of this.queue) {
      // stops actions, and clears info data
      this.stopCityScheduleActions(citySchedule);
      if (refresh) this.refreshUI();
      // runs next action
      await this.safeRunCitySchedule(citySchedule);
      if (refresh) this.refreshUI();
    }
  }

  // QUESTION: should it be awaited or not
  /**
   * Starts safely citySchedule taking into account non-blocking queues which are merged into main queue
   * if for some reason are lacking the registered action.
   */
  private async safeRunCitySchedule(citySchedule: CitySchedule) {
    const isQueueRunning = citySchedule.queue.length && citySchedule.timeoutData.timeoutId;

    // Merge orphaned non-blocking queue items into main queue
    Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex => {
      if (complex.queue.length && !complex.timeoutData.timeoutId) {
        // Insert at position 1 if queue is running (to not interrupt current item), otherwise at 0
        const insertIndex = isQueueRunning ? 1 : 0;
        citySchedule.queue.splice(insertIndex, 0, ...complex.queue.splice(0));
      }
    });

    // Start queue if it has items and is not running
    if (citySchedule.queue.length && !isQueueRunning) {
      await this.runNextAction(citySchedule);
    }
  }

  /**
   * Wrapper method around removing finished item from the queue, clearing queue timeouts, and revalidating all queues first items.
   * @param citySchedule
   * @see VALID - but repetition policy not implemented
   */
  private async onItemExecutionFinish(citySchedule: CitySchedule, finishedItem?: QueueItem) {
    console.log('onItemExecutionFinish', JSON.parse(JSON.stringify(citySchedule)));
    // TODO: this is the place to handle execution policy (cycles)
    finishedItem ??= citySchedule.queue[0];
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
      // if item triggers execution of other items, add them to the queue front and execute
      if (finishedItem.subsequentItemIds?.length) {
        // potentially nnecessary call
        // this.stopCityScheduleMainQueueAction(citySchedule);

        // Remove finishedItem by reference (not by position) to avoid race conditions
        const finishedIdx = citySchedule.queue.indexOf(finishedItem);
        if (finishedIdx !== -1) citySchedule.queue.splice(finishedIdx, 1);

        // Get subsequent items from triggerQueue and add them to front
        const subsequentItems = finishedItem
          .subsequentItemIds!.splice(0)
          .map(id => {
            const idx = citySchedule.triggerQueue.findIndex(item => item.id === id);
            return idx >= 0 ? citySchedule.triggerQueue.splice(idx, 1)[0] : undefined;
          })
          .filter(i => i !== undefined);

        citySchedule.queue.unshift(...subsequentItems);

        this.persistCitySchedule(citySchedule);
        this.rerenderInjectedQueuesUI(citySchedule);
        this.tableUIUtility.update(this.queue);
        await this.runNextAction(citySchedule);
      } else {
        await this.cleanAndRunNext(citySchedule, finishedItem);
      }
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
  private async cleanAndRunNext(citySchedule: CitySchedule, item?: QueueItem) {
    // clean info holders
    this.cleanUpdateAndPersist(citySchedule, item);

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
          this.onItemExecutionFinish(citySchedule, nextQueueItem);
        },
        setScheduleTimeout: (operationCallback, executionTime, timeoutType: TimeoutType, purpose) => {
          this.setScheduleTimeout(citySchedule, operationCallback, executionTime, timeoutType, nextQueueItem, purpose);
        },
        shiftQueueAndNext: () => {
          console.error(
            `[MasterQueue]: Removing element (shiftQueueAndNext):`,
            JSON.parse(JSON.stringify(nextQueueItem)),
          );
          this.removeItem(citySchedule, nextQueueItem);
          this.runNextAction(citySchedule);
        },
      });
    } catch (error) {
      const browserContext = getBrowserExecutionContextInfo();
      console.error(`[MasterQueue]: Failed to execute queue item, running next one`, error, browserContext);

      if (browserContext.visibilityState === 'hidden') {
        performOnDocumentVisibilityReturn(() => this.runNextAction(citySchedule));
      } else {
        await this.runNextAction(citySchedule);
      }
    }
  }

  /**
   * Removes given queue item (or else first one) from the queue, clears action related data and timeouts,
   * reevaluates provider cities, persits the schedule, rerenders all UI and emits the event.
   * @param citySchedule - city schedule to shift
   * @see VALID - QUESTIONABLE - is it for removing items onClick? if so then flow is potentially bad!!!
   */
  private cleanUpdateAndPersist(citySchedule: CitySchedule, item?: QueueItem) {
    if (!item) {
      citySchedule.queue.shift();
    } else {
      const idx = citySchedule.queue.indexOf(item);
      if (idx !== -1) citySchedule.queue.splice(idx, 1);
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
      console.log(
        `[MasterQueue] → Non-blocking item - checking if should block the queue or be moved to non blocking queue`,
      );
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
          queueItem.directOperation = operationCallback;
          nonBlockingQueueContainerOfType.queue.push(queueItem);
          this.persistCitySchedule(citySchedule);
        }
        // else (async queue doesn't exist, this item is first to be added)
        else {
          console.log(
            `[MasterQueue] → First item of type "${queueItem.itemType}" in async queue - extracting adjacent items of same type`,
          );
          // it will be executed instead of plain "execute" method
          queueItem.directOperation = operationCallback;
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
    return citySchedule.queue.splice(
      0,
      firstOtherItemTypeIndex === -1 ? citySchedule.queue.length : firstOtherItemTypeIndex,
    );
  }

  /**
   * Puts queue items to the queue front with respect to running items in the main queue and runs if idle.
   * @param citySchedule on which operation occurs
   * @param items list of queue items to be attached to the main queue
   */
  public async respectfulUnshiftQueueItems(citySchedule: CitySchedule, items: QueueItem[]) {
    if (citySchedule.currentAction) {
      // stop first item if it's waiting for the slot and merge nbq at 0 index
      if (
        citySchedule.timeoutData.purpose &&
        (['slot', 'charms', 'other item'] as Partial<TimeoutPurpose>[]).includes(citySchedule.timeoutData.purpose)
      ) {
        this.stopCityScheduleMainQueueAction(citySchedule);
        citySchedule.queue.unshift(...items);
        await this.runNextAction(citySchedule);
      } else {
        // Queue is actively executing - insert after current item
        citySchedule.queue.splice(1, 0, ...items);
      }
    } else {
      // Queue is idle - insert at front and start
      citySchedule.queue.unshift(...items);
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
          // onQueuePositionChange: (item: QueueItem, newPosition: number, qu) =>
          //   this.changeItemPosition(citySchedule, item, newPosition),
          onQueuePositionChange: (item, newPosition, queueType) =>
            this.changeItemPosition(citySchedule, item, newPosition, queueType),
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
          .filter(
            citySchedule =>
              citySchedule.queue.length > 0 ||
              Object.values(citySchedule.nonBlockingQueueComplex).some(c => c.queue.length),
          )
          .map((citySchedule: CitySchedule) => ({
            city: citySchedule.city,
            queue: citySchedule.queue.map(queueItem => ({
              ...queueItem,
              itemDetails: this.getExecutor(queueItem.itemType).persistItem(queueItem.itemDetails),
            })),
            nonBlockingQueueComplex: Object.fromEntries(
              Object.entries(citySchedule.nonBlockingQueueComplex)
                .filter(([itemType, complex]) => complex != null && complex.queue.length > 0)
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
            triggerQueue: citySchedule.triggerQueue.map(queueItem => ({
              ...queueItem,
              itemDetails: this.getExecutor(queueItem.itemType).persistItem(queueItem.itemDetails),
            })),
          })) as CitySchedule[],
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

    const citySchedulePersistObj =
      schedule.queue.length || Object.values(schedule.nonBlockingQueueComplex).some(c => c.queue.length)
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
            triggerQueue: schedule.triggerQueue.map(queueItem => ({
              ...queueItem,
              itemDetails: this.getExecutor(queueItem.itemType).persistItem(queueItem.itemDetails),
            })),
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

  /**
   * Loads schedule from localStorage, hydrates executor specific part with executor's method, moves all non-blocking queues
   * into master queue to the front.
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
          ...Object.entries(citySchedule.nonBlockingQueueComplex)
            .filter(([itemType, complex]) => complex != null)
            .flatMap(([itemType, complex]) => complex.queue.splice(0)),
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
        // Ensure nonBlockingQueueComplex is initialized and doesn't contain undefined values
        if (!citySchedule.nonBlockingQueueComplex) {
          citySchedule.nonBlockingQueueComplex = {};
        } else {
          // Remove any undefined/null values that might have been deserialized
          Object.keys(citySchedule.nonBlockingQueueComplex).forEach(key => {
            if (citySchedule.nonBlockingQueueComplex[key as QueueItemType] == null) {
              delete citySchedule.nonBlockingQueueComplex[key as QueueItemType];
            }
          });
        }

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
        Object.values(citySchedule.nonBlockingQueueComplex)
          .filter((complex): complex is NonBlockingQueue => complex != null)
          .forEach(complex =>
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

        citySchedule.triggerQueue.forEach(queueItem => {
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

        return citySchedule;
      })
      .filter(Boolean) as CitySchedule[];
  }

  public getTypeSpecificItemDetailsForCity(city: CityInfo, type: QueueItemType): { id: string; itemDetails: any }[] {
    const citySchedule = this.queue.find(citySchedule => citySchedule.city.name === city.name);
    if (type && citySchedule) {
      return (
        (citySchedule.nonBlockingQueueComplex[type]?.queue ?? [])
          .concat(citySchedule.queue.filter(item => item.itemType === type))
          .map(item => ({ id: item.id, itemDetails: item.itemDetails })) ?? []
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
        triggerQueue: [],
      };
      this.queue.push(citySchedule);
    }

    // QUESTION: await or not?
    const utility = useInlineQueueNavigation();
    utility.mount(container, {
      onRun: async () => {
        await this.safeRunCitySchedule(citySchedule);
        this.refreshUI();
      },
      onRestart: async () => {
        this.stopCityScheduleActions(citySchedule);
        this.refreshUI();
        await this.safeRunCitySchedule(citySchedule);
        this.refreshUI();
      },
      onPause: () => {
        this.stopCityScheduleActions(citySchedule);
        this.refreshUI();
      },
      onDelete: () => {
        this.clearAndRemoveCitySchedule(citySchedule);
        this.refreshUI();
      },
    });
    return { getValues: utility.getValues };
  }

  /**
   * @see VALID
   */
  private deleteAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.clearAndRemoveCitySchedule(citySchedule, false);
    });
    this.persistSchedule();
  }

  /**
   * @see VALID
   */
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

    const citySchedule = this.resolveScheduleIdentifier(scheduleIdentifier);

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
      // remove subscribed items
      if (
        removedQueueItem.subsequentItemIds &&
        removedQueueItem.subsequentItemIds.length &&
        citySchedule.triggerQueue.length
      ) {
        citySchedule.triggerQueue = citySchedule.triggerQueue.filter(
          item => !removedQueueItem!.subsequentItemIds!.includes(item.id),
        );
      }

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

  private resolveScheduleIdentifier(scheduleIdentifier: CitySchedule | CityInfo) {
    return 'name' in scheduleIdentifier
      ? this.queue.find(cs => cs.city.name === scheduleIdentifier.name)
      : scheduleIdentifier;
  }

  // TODO: hydration & persistence of triggerQeueue
  public subscribeToItemOnExecutionFinish(
    scheduleIdentifier: CitySchedule | CityInfo,
    referenceItemId: string,
    triggerItemId: string,
  ) {
    const citySchedule = this.resolveScheduleIdentifier(scheduleIdentifier)!;

    let queueType!: 'main' | QueueItemType;
    let positionInQueue!: number;

    if ((positionInQueue = citySchedule.queue.findIndex(qi => qi.id === triggerItemId)) !== -1) {
      queueType = 'main';
    } else if (
      Object.entries(citySchedule.nonBlockingQueueComplex).some(([type, complex]) => {
        if ((positionInQueue = complex.queue.findIndex(qi => qi.id === triggerItemId)) !== -1) {
          queueType = type as QueueItemType;
          return true;
        }
        return false;
      })
    ) {
      /* nothing in here */
    } else {
      return false;
    }

    const referenceItem = [
      ...citySchedule.queue,
      ...Object.values(citySchedule.nonBlockingQueueComplex).flatMap(c => c.queue),
      ...citySchedule.triggerQueue,
    ].find(i => i.id === referenceItemId)!;

    if (queueType === 'main') {
      if (positionInQueue === 0 && citySchedule.currentAction) {
        this.stopCityScheduleMainQueueAction(citySchedule);
        citySchedule.triggerQueue.push(citySchedule.queue.shift()!);
        this.runNextAction(citySchedule);
      } else {
        citySchedule.triggerQueue.push(citySchedule.queue.splice(positionInQueue, 1)[0]);
      }
    } else {
      citySchedule.triggerQueue.push(
        citySchedule.nonBlockingQueueComplex[queueType]!.queue.splice(positionInQueue, 1)[0],
      );
      if (!citySchedule.nonBlockingQueueComplex[queueType]!.queue.length) {
        this.stopNonBlockingQueueAction(citySchedule.nonBlockingQueueComplex[queueType]!);
      }
    }
    (referenceItem.subsequentItemIds ??= []).push(triggerItemId);
    console.log(
      `[MasterQueue]: subscription of id=${triggerItemId} added to item: ${JSON.stringify(referenceItem.itemDetails)}`,
    );
    return true;
  }
  // FUTURE: to resume only those actions which were running before relog or something
  public getActiveQueueCityNameList = () => {
    return this.queue.reduce((acc: string[], cq: CitySchedule) => {
      if (
        cq.currentAction ||
        cq?.timeoutData.timeoutId ||
        Object.values(cq.nonBlockingQueueComplex).some(nbqc => nbqc.timeoutData.timeoutId)
      ) {
        acc.push(cq.city.name);
      }
      return acc;
    }, []);
  };

  private runDistinctCitySchedules(citySchedulesNameList: string[]) {
    citySchedulesNameList.forEach(cityName => {
      const city = this.citySwitchManager.getCityByName(cityName);
      if (city) {
        const citySchedule = this.getCitySchedule(city);
        if (citySchedule) {
          this.runNextAction(citySchedule);
        }
      }
    });
  }
}
