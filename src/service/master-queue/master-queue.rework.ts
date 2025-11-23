/*
TODO
- removing item by id/item reference rather than by index, because item can belong to different queues
- table update - add toggle to show non-blocking queues along with time of first item's merge into the main queue
- add method to change items position in the queue
- add ui to non-blocking queues
- update table state (non-blocking exists but main is empty)
*/

import EventEmitter from 'events';
import { findLastIndex } from '~/utility/plain-utility';
import gpsConfig from '../../../gps.config';
import ConfigManager from '../../utility/config-manager';
import ResourceLock from '../../utility/resource-lock';
import Service from '../../utility/Service';
import { BuilderQueueItem } from '../city/builder/city-builder';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import { RecruiterQueueItem } from '../recruiter/recruiter';
import masterQueueTableCss from './master-queue-table.css';
import masterQueueTableHtml from './master-queue-table.prod.html';
import masterQueueCss from './master-queue.css';

export enum QueuePriority {
  High = 'high',
  Normal = 'normal',
}

const STANDARD_EXECUTION_TIME_MS = 30000 as const;

export type QueueItemType = 'recruiter' | 'builder' | 'municipal utility';
export type TimeoutPurpose = 'slot' | 'resources' | 'charms' | string;
export type TimeoutType = 'execution' | 'waiting';
export type ScheduleOperationDetails<T> = {
  id: string;
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
    queueBgImgProp?: string;
    queueImageClass?: string;
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

export interface QueueExecutor<T> {
  execute(operation: ScheduleOperationDetails<T>): Promise<void>;
  // executor dostaje referencje do ui i details, które może updatować zgodnie ze swoim widzi mi się
  postDeleteAction?: (
    queue: { ui: QueueItem['ui']; details: T }[],
    deletedItemDetails: QueueItem['itemDetails'],
  ) => void | Promise<void>;
  // NOTE: rethink if these should modify referenced obj, or return modified copy
  hydrateItem: (itemDetails: T) => Promise<void>;
  persistItem: (itemDetails: T) => T;
}

export default class MasterQueue extends EventEmitter implements Service<'masterQueue'>, QueueExecutorRegistry {
  private static readonly TABLE_CONTAINER_ID = 'master-queue-table-container';
  private static readonly TABLE_ID = 'master-queue-table';
  private static readonly TABLE_EMPTY_ID = 'master-queue-table-empty';
  private static readonly TABLE_FOOTER_ID = 'master-queue-table-footer';
  private static readonly TABLE_TOGGLE_BUTTON_ID = 'master-queue-table-toggle-button';
  private static readonly TABLE_CLOSE_BUTTON_ID = 'master-queue-table-close-icon';
  private static readonly LOCAL_STORAGE_KEY = 'master-queue';
  public static readonly MAX_NOT_SHARING_BLOCKING_TIME = 1800000; // 30 min
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

  private constructor() {
    super();
    this.queue = [];
  }
  public onConfigChange(configChanges: Partial<{ autoReevaluate: boolean }>) {
    if (configChanges.autoReevaluate) {
      this.reevaluateProviderCities();
    }
  }

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
  }

  public getExecutor<T>(type: QueueItemType): QueueExecutor<T> {
    const executor = this.executors.get(type);
    if (!executor) {
      throw new Error(`No executor registered for type: ${type}`);
    }
    return executor as QueueExecutor<T>;
  }

  private async init() {
    this.loadSchedule();
    this.addCSS();
    this.addTable();
  }

  private addCSS() {
    const queueStyle = document.createElement('style');
    queueStyle.textContent = masterQueueCss;
    document.head.appendChild(queueStyle);

    const tableStyle = document.createElement('style');
    tableStyle.textContent = masterQueueTableCss;
    document.head.appendChild(tableStyle);
  }

  private addTable() {
    const tableWrapper = document.createElement('div');
    document.body.appendChild(tableWrapper);
    tableWrapper.outerHTML = masterQueueTableHtml;
    const tableContainer = document.getElementById(MasterQueue.TABLE_CONTAINER_ID)!;
    const table = document.getElementById(MasterQueue.TABLE_ID)!;
    const tableFooter = document.querySelector<HTMLElement>(`#${MasterQueue.TABLE_FOOTER_ID}`)!;
    this.getNavigation('master', tableFooter);
    document
      .querySelector<HTMLButtonElement>(`#${MasterQueue.TABLE_TOGGLE_BUTTON_ID}`)!
      .addEventListener('click', () => {
        if (tableContainer.hidden) {
          this.rerenderTable();
          tableContainer.hidden = false;
        } else {
          tableContainer.hidden = true;
        }
      });
    document.getElementById(MasterQueue.TABLE_CLOSE_BUTTON_ID)!.addEventListener('click', () => {
      tableContainer.hidden = true;
    });
  }

  // OPTIMIZATION: potentially add "is table opened" condition to rerendering + force argument to bypass that
  private rerenderTable() {
    // TODO: also wtf is this? why this check?
    const tableBody = document.querySelector<HTMLTableSectionElement>(`#${MasterQueue.TABLE_ID} .tbody`);
    if (!tableBody) return;

    const isTableEmpty = this.queue.filter(citySchedule => citySchedule.queue.length > 0).length === 0;
    console.log('isTableEmpty:', isTableEmpty);
    const tableFooter = document.getElementById(MasterQueue.TABLE_FOOTER_ID)!;
    if (isTableEmpty) {
      tableFooter.hidden = true;
    } else {
      tableFooter.hidden = false;
    }

    tableBody.innerHTML = `
    <div class="tr ${isTableEmpty ? '' : 'hidden'}" id="${MasterQueue.TABLE_EMPTY_ID}">
      <div class="td no-schedules">No schedules</div>
    </div>`;

    // then hydrate table
    for (const citySchedule of this.queue) {
      if (citySchedule.queue.length === 0) continue;
      const row = document.createElement('div');
      row.classList.add('tr');
      row.dataset.city = citySchedule.city.name;

      // city Cell
      const cityCell = document.createElement('div');
      cityCell.classList.add('td');
      cityCell.textContent = citySchedule.city.name;
      row.appendChild(cityCell);

      // queue Cell
      const queueCell = document.createElement('div');
      queueCell.classList.add('td');
      const queueCellContent = document.createElement('div');
      queueCellContent.classList.add('queue-cell');
      this.createUIQueueItems(queueCellContent, citySchedule);
      queueCell.appendChild(queueCellContent);
      row.appendChild(queueCell);

      // state Cell
      const stateCell = document.createElement('div');
      stateCell.classList.add('td');
      stateCell.classList.add('master-queue-state');
      stateCell.classList.add(citySchedule.currentAction ? 'running' : 'idle');
      stateCell.textContent = citySchedule.currentAction ? 'Running' : 'Idle';
      row.appendChild(stateCell);

      // actions Cell
      const actionsCell = document.createElement('div');
      actionsCell.classList.add('td');
      actionsCell.classList.add('master-queue-actions');
      this.getNavigation('city', citySchedule, actionsCell);
      row.appendChild(actionsCell);

      tableBody.appendChild(row);
    }
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
    this.showToggleButton(true);
  }

  private showToggleButton(value: boolean) {
    const toggleButton = document.getElementById(MasterQueue.TABLE_TOGGLE_BUTTON_ID)!;
    toggleButton.hidden = !value;
  }

  public async stop() {
    this.RUN = false;
    if (this.resourceLockChangeListener) {
      this.resourceLock.removeListener('resource-lock-change', this.resourceLockChangeListener);
    }
    if (this.cityChangeListener) {
      this.citySwitchManager.removeListener('cityChange', this.cityChangeListener);
    }
    this.showToggleButton(false);
    this.queue.forEach(citySchedule => {
      this.stopCityScheduleMainQueueAction(citySchedule);
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

  private addOncityChangeListener() {
    const listener = (city: CityInfo) => {
      const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
      this.rerenderAllUIQueues(citySchedule);
    };
    this.cityChangeListener = listener;
    this.citySwitchManager.addListener('cityChange', listener);
  }

  public addToQueue(city: CityInfo, item: Omit<QueueItem, 'id'>) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = {
        city,
        queue: [
          {
            id: crypto.randomUUID(),
            ...item,
          },
        ],
        nonBlockingQueueComplex: {},
        timeoutData: {},
      };
      this.queue.push(citySchedule);
    } else {
      // item ma wysoki priorytet
      if (item.priority === QueuePriority.High && citySchedule.queue.length) {
        // kolejka jest w trakcie działania - dodaj na drugie miejsce
        if (citySchedule.currentAction) {
          citySchedule.queue.splice(1, 0, {
            id: crypto.randomUUID(),
            ...item,
          });
        } else {
          // kolejka jest nieaktywna - dodaj na początek
          citySchedule.queue.unshift({
            id: crypto.randomUUID(),
            ...item,
          });
        }
      } else {
        // item ma zwykły priorytet lub nie ma nic w kolejce - dodaj na koniec
        citySchedule.queue.push({
          id: crypto.randomUUID(),
          ...item,
        });
      }
    }

    this.reevaluateProviderCities(citySchedule);
    this.rerenderAllUIQueues(citySchedule);
    if (this.isTableOpened()) {
      this.rerenderTable();
    }
    this.persistCitySchedule(citySchedule);
    this.emit(MasterQueue.MASTER_QUEUE_CHANGE_EVENT, this.queue);
    return citySchedule;
  }

  /**
   * @see VALID
   */
  public clearAndRemoveCitySchedule(citySchedule: CitySchedule) {
    this.queue = this.queue.filter(cs => {
      if (cs === citySchedule) {
        this.stopAllCityScheduleActions(citySchedule);
        return false;
      }
      return true;
    });

    // this.persistSchedule();
    this.persistCitySchedule(citySchedule);
  }

  /**
   * Stops, and clears all action related info.
   * @see VALID
   */
  private stopCityScheduleMainQueueAction(citySchedule: CitySchedule) {
    citySchedule.currentAction = null;
    (citySchedule.timeoutData ??= {}).executionTime = undefined;
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
    complex.timeoutData.purpose = undefined;
    complex.timeoutData.executionTime = undefined;
  }

  /**
   * @see VALID - BUT should call reworked UILock instance to remove queued element
   */
  private stopAllCityScheduleActions(citySchedule: CitySchedule) {
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
      this.stopAllCityScheduleActions(citySchedule);
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
   * Merges all non-blocking quques into main queue to the front.
   * @see VALID
   * @requires all queues must be idle
   */
  private joinCityScheduleQueues(citySchedule: CitySchedule) {
    let startIndex = findLastIndex<QueueItem>(citySchedule.queue, i => i.priority === QueuePriority.High) + 1;
    citySchedule.queue.splice(
      startIndex,
      0,
      ...Object.entries(citySchedule.nonBlockingQueueComplex).flatMap(([itemType, complex]) => complex.queue.splice(0)),
    );
  }

  /**
   * Wrapper method around removing finished item from the queue, clearing queue timeouts, and revalidating all queues first items.
   * @param citySchedule
   * @see VALID - but repetition policy not implemented
   */
  private async onItemExecutionFinish(citySchedule: CitySchedule) {
    // TODO: this is the place to handle execution policy (cycles)
    const finishedItem = citySchedule.queue[0];
    if (finishedItem.repetitionPolicy) {
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
    if (nextQueueItem.supplyEvaluation === 'auto') {
      // usuwa item z whitelisty jezeli sie na niej znajdował i automatycznie reewaluuje providerów,
      // jeżeli item nie był na whitelisćie to przypisuje mu providerów manualnie
      if (!this.removeCityFromSupplierCityList(citySchedule.city)) {
        nextQueueItem.supplierCities = this.getSupplierCities();
      }
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
        city: citySchedule.city,
        itemDetails: nextQueueItem.itemDetails,
        onFinishCallback: () => {
          this.onItemExecutionFinish(citySchedule);
        },
        setScheduleTimeout: (operationCallback, executionTime, timeoutType: TimeoutType, purpose) => {
          this.setScheduleTimeout(citySchedule, operationCallback, executionTime, timeoutType, nextQueueItem, purpose);
        },
        shiftQueueAndNext: () => {
          this.cleanAndRunNext(citySchedule, nextQueueItem.id);
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
   * @see VALID
   */
  private cleanUpdateAndPersist(citySchedule: CitySchedule, id?: string) {
    if (!id) citySchedule.queue.shift();
    else {
      citySchedule.queue = citySchedule.queue.filter(q => q.id !== id);
    }
    this.stopCityScheduleMainQueueAction(citySchedule);
    this.reevaluateProviderCities(citySchedule);
    this.persistCitySchedule(citySchedule);
    this.rerenderAllUIQueues(citySchedule);
    if (this.isTableOpened()) {
      this.rerenderTable();
    }
    this.emit(MasterQueue.MASTER_QUEUE_CHANGE_EVENT, this.queue);
  }

  /**
   * Sets specified status for all table rows or for specified city schedule row.
   * @param status - status to set
   * @param citySchedule - city schedule to set status for
   */
  private setUITableStatuses(status: 'idle' | 'running', citySchedule?: CitySchedule) {
    const table = document.getElementById(MasterQueue.TABLE_ID)!;
    if (!citySchedule) {
      table.querySelectorAll<HTMLDivElement>('div.tr .master-queue-state').forEach(statusCell => {
        statusCell.classList.remove('idle', 'running');
        statusCell.classList.add(status);
        statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      });
    } else {
      const statusCell = table.querySelector<HTMLDivElement>(
        `div.tr[data-city="${citySchedule.city.name}"] .master-queue-state`,
      );
      console.log('row:', statusCell);
      if (statusCell) {
        statusCell.classList.remove('idle', 'running');
        statusCell.classList.add(status);
        statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      }
    }
  }

  /**
   * Evaluates supplier cities for each first queue item (potentially running) in every city schedule.
   * @param schedule
   * @see VALID
   */
  private reevaluateProviderCities(schedule?: CitySchedule) {
    this.queue.forEach(citySchedule => {
      if (citySchedule.queue[0]?.supplyEvaluation === 'auto') {
        citySchedule.queue[0].supplierCities = this.getSupplierCities();
      }
    });
  }

  // TODO: optimize it later (reducer or sth)
  /**
   * Calculates supplier citiy list based on the queue traffic, whitelist and lockedlist.
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
   * @see VALID
   */
  private setScheduleTimeout(
    citySchedule: CitySchedule,
    operationCallback: () => Promise<void> | void,
    executionTime: number,
    timeoutType: TimeoutType, // part of execution (resources arrival) | waiting (for slot, charms etc)
    queueItem: QueueItem,
    purpose?: TimeoutPurpose,
  ) {
    // item is sequential (blocks until executed)
    if (queueItem.blocking) {
      // if blocking item needs to wait for longer than "maximumBlockingTime" then it can share its resources
      if (timeoutType === 'waiting') {
        if (executionTime - Date.now() > MasterQueue.MAX_NOT_SHARING_BLOCKING_TIME) {
          console.log(
            `${citySchedule.city.name}: ${citySchedule.queue[0].itemType} awaits for ${purpose}, adding to suppliers list`,
          );
          this.addCityToSuppliersList(citySchedule.city);
        }
      }

      // creating timeout that will execute operationCallback and remove city from suppliers list
      const timeoutId = setTimeout(async () => {
        if (timeoutType === 'waiting') {
          this.removeCityFromSupplierCityList(citySchedule.city);
        }
        await operationCallback();
      }, executionTime - Date.now());

      citySchedule.timeoutData = {
        timeoutId,
        executionTime: executionTime - Date.now(),
        purpose,
      };
    }
    // non-blocking
    else {
      // indirect (waiting for charms, slots, etc.) and waiting time is longer than maximum blocking time
      if (timeoutType === 'waiting' && executionTime - Date.now() > MasterQueue.MAX_NOT_SHARING_BLOCKING_TIME) {
        let nonBlockingQueueContainerOfType = citySchedule.nonBlockingQueueComplex?.[queueItem.itemType];
        if (!nonBlockingQueueContainerOfType) {
          nonBlockingQueueContainerOfType = {
            queue: [],
            timeoutData: {},
          };
          citySchedule.nonBlockingQueueComplex[queueItem.itemType] = nonBlockingQueueContainerOfType;
        }
        // it will be executed instead of plain "exeucte" method
        queueItem.directOperation = async () => await operationCallback();
        // eliminates the need to check execution possibility for each item of the same type after the first one which is already not possible
        const adjacentQueueItemsOfType = this.extractAdjacentQueueItemsOfSameType(citySchedule);
        nonBlockingQueueContainerOfType.queue.push(...adjacentQueueItemsOfType);
        this.tryAddCityToSuppliersList(citySchedule);

        /*
        TODO: jeżeli kolejka zostanie zatrzymana przez usera, tzn timeouty zostaną usunięte - to wtedy po uruchomieniu
        nieblokująca kolejka typów nie uruchomi się sama. Trzeba będzie te kolejki zmergować z powrotem do głównej kolejki, która
        się zajmie resztą.
        */
        nonBlockingQueueContainerOfType.timeoutData = {
          timeoutId: setTimeout(() => {
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
      }
      // non-blocking 'execution' callback - so it must block
      else {
        citySchedule.timeoutData = {
          timeoutId: setTimeout(async () => await operationCallback(), executionTime - Date.now()),
          executionTime: executionTime - Date.now(),
          purpose,
        };
      }
    }
  }

  /**
   * Removes first group of adjacent items of the same type from the original array and returns.
   * @param citySchedule
   * @returns list of items adjacent to each other of the same type
   * @see VALID
   */
  public extractAdjacentQueueItemsOfSameType(citySchedule: CitySchedule) {
    return citySchedule.queue.splice(
      0,
      citySchedule.queue.findIndex(item => item.itemType !== citySchedule.queue[0].itemType) + 1 || 1,
    );
  }

  /**
   * Puts queue items to the queue front with respect to running or high priority items in the main queue and runs if idle.
   * @param citySchedule on which operation occurs
   * @param items list of queue items to be attached to the main queue
   * @see VALID
   */
  public async respectfulUnshiftQueueItems(citySchedule: CitySchedule, items: QueueItem[]) {
    if (citySchedule.currentAction || citySchedule.timeoutData.timeoutId) {
      citySchedule.queue.splice(
        findLastIndex<QueueItem>(citySchedule.queue, item => item.priority === QueuePriority.High) + 1 || 1,
        0,
        ...items,
      );
    } else {
      // at this point queue should be rather empty, but if for some reason is not, then should be started
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
   * Creates new element and hydrates it with queue items for given city.
   * @param city - city to get queue for
   * @returns - new element with queue items
   */
  public getCityQueueUI(city: CityInfo) {
    const container = document.createElement('div');
    container.classList.add('master-queue');

    const citySchedule = this.getCitySchedule(city);
    if (!citySchedule) return container;

    this.createUIQueueItems(container, citySchedule);
    return container;
  }

  /**
   * Rerenders all master-queue elements in the DOM.
   * If no argument is provided, rerenders queue for current city (or clears if non-existent).
   * @param arg - city schedule/city info corresponding to the queue to rerender
   */
  public rerenderAllUIQueues(arg?: CitySchedule | CityInfo) {
    const citySchedule = arg
      ? Object.keys(arg).includes('name')
        ? this.getCitySchedule(arg as CityInfo)
        : (arg as CitySchedule)
      : this.getCitySchedule(this.citySwitchManager.getCurrentCity()!);

    document.querySelectorAll('.master-queue').forEach(el => {
      el.innerHTML = '';
      if (citySchedule) {
        this.createUIQueueItems(el as HTMLElement, citySchedule);
      }
    });
  }

  /**
   * Creates UI elements for given city schedule with complete delete buttons functionality
   * and appends them to provided container.
   * @param container - container to append queue items to
   * @param schedule - city schedule to create queue items for
   */
  private createUIQueueItems(container: HTMLElement, schedule: CitySchedule) {
    const queue = schedule.queue;

    queue.forEach((item, index) => {
      const queueItem = document.createElement('div');
      queueItem.classList.add('master-queue-item');
      // NOTE: innerHtml looks ugly, consider doing it in JS when complexity grows
      queueItem.innerHTML = `
        <span class="master-queue-item-position">${index + 1}</span>
        <div class="master-queue-item-delete">&#x2715;</div>
        <div class="master-queue-item-level-bar">
          ${item.ui.lvlBar}
        </div>
        <div class="master-queue-item-image ${item.ui.queueImageClass ?? ''}"
          style="${item.ui.queueBgImgProp ? `background-image: ${item.ui.queueBgImgProp};` : ''}"
        >
        </div>
        <div class="master-queue-item-info">
          <span class="desc1">
          ${item.ui.title}
          </span>
          ${item.ui.description ? `<span class="desc2">${item.ui.description}</span>` : ''}
        </div>
      `;

      const deleteButton = queueItem.querySelector('.master-queue-item-delete');
      deleteButton?.addEventListener('click', () => {
        // this.onQueueItemDelete(schedule, item, index);
        this.removeItem(schedule.city, item);
      });
      container.appendChild(queueItem);
    });
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

  private isTableOpened = () => {
    return document.getElementById(MasterQueue.TABLE_ID)?.hidden === false;
  };

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
          if ((queueItem.supplyEvaluation = 'manual')) {
            queueItem.supplierCities = queueItem.supplierCities
              .map(city => this.citySwitchManager.getCityByName(city.name) ?? null)
              .filter(Boolean) as CityInfo[];
          }
          // else empty it, runNextAction will attach newly calcualted list
          else {
            queueItem.supplierCities = [];
          }

          this.getExecutor(queueItem.itemType).hydrateItem(queueItem.itemDetails);
        });

        // smae thing for each element in the non-blocking queue
        Object.values(citySchedule.nonBlockingQueueComplex).forEach(complex =>
          complex.queue.forEach(queueItem => {
            if (queueItem.supplyEvaluation === 'manual') {
              queueItem.supplierCities = queueItem.supplierCities
                .map(city => this.citySwitchManager.getCityByName(city.name))
                .filter(Boolean) as CityInfo[];
            } else {
              queueItem.supplierCities = [];
            }

            this.getExecutor(queueItem.itemType).hydrateItem(queueItem.itemDetails);
          }),
        );
        return citySchedule;
      })
      .filter(Boolean) as CitySchedule[];
  }

  public getTypeSpecificItemDetailsForCity<T>(city: CityInfo, type?: QueueItemType) {
    if (type) {
      return (
        this.queue
          .find(citySchedule => citySchedule.city.name === city.name)
          ?.queue.filter(item => item.itemType === type)
          .map(item => item.itemDetails) ?? []
      );
    }
    return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue ?? [];
  }

  public getNavigation(type: 'master', container?: HTMLElement): HTMLElement;
  public getNavigation(type: 'city' | 'all', arg1: CitySchedule | CityInfo, container?: HTMLElement): void;
  public getNavigation(
    type: 'master' | 'city' | 'all',
    arg1?: HTMLElement | CitySchedule | CityInfo,
    arg2?: HTMLElement,
  ): HTMLElement | void {
    const div = document.createElement('div');
    div.classList.add('master-queue-navigation');

    if (type === 'master') {
      const navigation = this.getMasterNavigationButtons();
      if (arg1 instanceof HTMLElement) {
        Object.values(navigation).forEach(button => {
          arg1.appendChild(button);
        });
      } else {
        Object.values(navigation).forEach(button => {
          div.appendChild(button);
        });
        return div;
      }
    } else if (type === 'city') {
      const navigation = this.getQueueNavigationButtons(arg1 as CitySchedule | CityInfo);
      if (arg2 instanceof HTMLElement) {
        Object.values(navigation).forEach(button => {
          arg2.appendChild(button);
        });
      } else {
        Object.values(navigation).forEach(button => {
          div.appendChild(button);
        });
        return div;
      }
    } else if (type === 'all') {
      const queueNavigation = this.getQueueNavigationButtons(arg1 as CitySchedule | CityInfo);
      const masterNavigation = this.getMasterNavigationButtons();

      if (arg2 instanceof HTMLElement) {
        Object.values(queueNavigation).forEach(button => {
          arg2.appendChild(button);
        });
        Object.values(masterNavigation).forEach(button => {
          arg2.appendChild(button);
        });
      } else {
        Object.values(queueNavigation).forEach(button => {
          div.appendChild(button);
        });
        Object.values(masterNavigation).forEach(button => {
          div.appendChild(button);
        });
        return div;
      }
    }
  }

  private deleteAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.stopCityScheduleMainQueueAction(citySchedule);
      this.stopNonBlockingQueueAction(citySchedule);
      citySchedule.queue = [];
    });
    this.persistSchedule();
  }

  public getMasterNavigationButtons(): {
    runAllButton: HTMLButtonElement;
    resetAllButton: HTMLButtonElement;
    deleteAllButton: HTMLButtonElement;
    pauseAllButton: HTMLButtonElement;
  } {
    const runAllButton = document.createElement('button');
    const resetAllButton = document.createElement('button');
    const deleteAllButton = document.createElement('button');
    const pauseAllButton = document.createElement('button');
    runAllButton.textContent = 'Run all';
    resetAllButton.textContent = 'Reset all';
    deleteAllButton.textContent = 'Delete all';
    pauseAllButton.textContent = 'Pause all';

    runAllButton.classList.add('run-all-button');
    resetAllButton.classList.add('reset-all-button');
    deleteAllButton.classList.add('clear-all-button');
    pauseAllButton.classList.add('pause-all-button');

    runAllButton.addEventListener('click', async () => {
      // show something which is not YET true, but will certainly will
      // on table reopen - if some schedules are yet to start, status will be shown accordingly
      this.setUITableStatuses('running');

      // QUESTION: await or not
      for (const citySchedule of this.queue) {
        this.safeRunCitySchedule(citySchedule);
      }
      if (this.isTableOpened()) {
        // this.rehydrateTable();
      }
    });
    resetAllButton.addEventListener('click', () => {
      this.rerunAllCitySchedules();
      if (this.isTableOpened()) {
        // this.rerenderTable();
        // premature 'status' display
        this.setUITableStatuses('running');
      }
    });
    deleteAllButton.addEventListener('click', () => {
      this.deleteAllSchedules();
      if (this.isTableOpened()) {
        this.rerenderTable();
      }
    });
    pauseAllButton.addEventListener('click', () => {
      this.pauseAllSchedules();
      if (this.isTableOpened()) {
        // this.rehydrateTable();
        this.setUITableStatuses('idle');
      }
    });

    return {
      runAllButton,
      resetAllButton,
      deleteAllButton,
      pauseAllButton,
    };
  }

  // OPTIMIZATION: possible optimizations by checking if queue length changed - then rerender all UI, else only statuses
  /**
   * @see VALID - but optimization for rerenders can be done
   */
  public getQueueNavigationButtons(queueIdentifier: CityInfo | CitySchedule): {
    runThisButton: HTMLButtonElement;
    restartThisButton: HTMLButtonElement;
    pauseThisButton: HTMLButtonElement;
    deleteThisButton: HTMLButtonElement;
  } {
    const runThisButton = document.createElement('button');
    const restartThisButton = document.createElement('button');
    const pauseThisButton = document.createElement('button');
    const deleteThisButton = document.createElement('button');

    runThisButton.textContent = 'Run';
    restartThisButton.textContent = 'Restart';
    pauseThisButton.textContent = 'Pause';
    deleteThisButton.textContent = 'Delete';

    runThisButton.classList.add('run-this-button');
    restartThisButton.classList.add('reset-this-button');
    pauseThisButton.classList.add('pause-this-button');
    deleteThisButton.classList.add('clear-this-button');

    const citySchedule = Object.keys(queueIdentifier).includes('city')
      ? (queueIdentifier as CitySchedule)
      : this.queue.find(schedule => schedule.city.name === (queueIdentifier as CityInfo).name)!;

    runThisButton.addEventListener('click', () => {
      this.safeRunCitySchedule(citySchedule);
      if (this.isTableOpened()) {
        this.rerenderTable();
      }
      // restart may take non-blocking queues into main queue and it should be shown
      this.rerenderAllUIQueues();
    });

    restartThisButton.addEventListener('click', () => {
      if (citySchedule) {
        this.stopAllCityScheduleActions(citySchedule);
        this.safeRunCitySchedule(citySchedule);

        if (this.isTableOpened()) {
          this.rerenderTable();
        }
        // restart may take non-blocking queues into main queue and it should be shown
        this.rerenderAllUIQueues();
      }
    });
    pauseThisButton.addEventListener('click', () => {
      console.log('pauseThisButton clicked, schedule:', citySchedule);
      if (citySchedule) {
        console.log('should clear city schedule action');
        this.stopAllCityScheduleActions(citySchedule);
        if (this.isTableOpened()) {
          // this.rerenderTable();
          this.setUITableStatuses('idle', citySchedule);
        }
      }
    });
    deleteThisButton.addEventListener('click', () => {
      this.clearAndRemoveCitySchedule(citySchedule);
      this.rerenderAllUIQueues();
      if (this.isTableOpened()) {
        this.rerenderTable();
      }
    });

    return {
      runThisButton,
      restartThisButton,
      pauseThisButton,
      deleteThisButton,
    };
  }

  private pauseAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.stopCityScheduleMainQueueAction(citySchedule);
    });
  }

  private simpleScheduleLoadConfirmationDialog(cityScheduleList: CitySchedule[]) {
    let message = `Czy chcesz kontynuować poprzednią sesje rekrutacji?`;
    cityScheduleList.forEach(citySchedule => {
      if (citySchedule.queue.length) {
        message += `\n${citySchedule.city.name}:\n${citySchedule.queue
          .map(q => {
            switch (q.itemType) {
              case 'recruiter':
                const queueItem = q.itemDetails as RecruiterQueueItem;
                const unitName = queueItem.unitContextInfo.unitSelector.split('.').at(-1);
                return `\t${unitName} x ${queueItem.amountLeft} ${queueItem.amountType === 'slots' ? 'slotów' : 'jednostek'}`;
              case 'builder':
                const builderItem = q.itemDetails as BuilderQueueItem;
                return `\t${builderItem.building.name} -> ${builderItem.toLvl}`;
            }
          })
          .join('\n')}`;
      }
    });
    const confirm = window.confirm(message);
    return confirm;
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
   * Removes item from queue by id or reference. If item was first in queue its scheduled operation will be canceled.
   * Method handles also deletion from non-blocking queues.
   * @param city - city whose schedule item is to be deleted
   * @param identifier - either item id (string) or queue item reference
   * @see VALID
   */
  public removeItem(city: CityInfo, identifier: string | QueueItem): void {
    let removedQueueItem: QueueItem | null = null;
    let queue: QueueItem[] | null = null;
    let removedIndex: number | null = null;
    let queueType: 'main' | 'non-blocking' | null = null;

    const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
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
        // simplest thing is to let this citySchedule stop as first item was deleted, and let the user rerun it manually
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

    if (removedQueueItem && queue && removedIndex && queueType) {
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

      this.rerenderAllUIQueues(citySchedule);
      if (this.isTableOpened()) {
        this.rerenderTable();
      }
      // reevaluate only if city can become supplier
      if (!citySchedule.queue.length) {
        this.reevaluateProviderCities();
      }

      this.persistCitySchedule(citySchedule);
    }
  }

  public unshiftAndRun(city: CityInfo, item: Omit<QueueItem, 'id'>) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = this.addToQueue(city, item);
    } else {
      this.stopCityScheduleMainQueueAction(citySchedule);

      citySchedule.queue.unshift({
        id: crypto.randomUUID(),
        ...item,
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
  private removeCityFromSupplierCityList(city: CityInfo) {
    const lengthBefore = this.resourcesWhiteList.length;
    this.resourcesWhiteList = this.resourcesWhiteList.filter(whitelistCity => whitelistCity.name !== city.name);
    const lengthAfter = this.resourcesWhiteList.length;
    if (lengthBefore !== lengthAfter) {
      this.reevaluateProviderCities();
      return true;
    }
    return false;
  }

  private isOnTheSupplierCityList(city: CityInfo | string) {
    const cityName = typeof city === 'object' ? city.name : city;
    return this.resourcesWhiteList.find(c => c.name === cityName);
  }
}
