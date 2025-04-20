// /*
// Serwisy powinny udostępniać:
// -metodę `post-delete-action`: która wykona poprawki, korekty itp na kolejce
// -metodę `hydrate-schedule-item`
// -podczas addToQueue info do renderowania itemu: 
//   --styl dla obrazka
//   --tytuł
//   --opis?
//   --pask poziomu?

// flow
// 1. non-blocking builder item dodany do kolejki
// 2. slot zajęty, ustaw timeout na 3h
// 3. 

// */

// import gpsConfig from "../../../gps.config";
// import { TConfigChanges } from "../../config-popup/config-popup";
// import ConfigManager from "../../utility/config-manager";
// import ResourceLock from "../../utility/resource-lock";
// import { BuilderQueueItem } from "../city/builder/city-builder";
// import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
// import { RecruiterQueueItem } from "../recruiter/recruiter";
// import masterQueueCss from './master-queue.css';

// import EventEmitter from "events";
// import Service from "../../utility/service";
// import masterQueueTableCss from './master-queue-table.css';
// import masterQueueTableHtml from './master-queue-table.prod.html';

// export enum QueuePriority {
//   High = 'high',
//   Normal = 'normal',
// }

// export type QueueItemType = 'recruiter' | 'builder' | 'municipal utility';
// export type TimeoutPurpose = 'slot' | 'resources' | 'charms' | string;

// export type ScheduleOperationDetails<T> = {
//   id: string;
//   city: CityInfo;
//   queueItem: T;
//   onFinishCallback: () => void;
//   setScheduleTimeout: (
//     operationCallback: () => Promise<void> | void,
//     timeToExecution: number,
//     purpose: TimeoutPurpose) => void;
//   shiftQueueAndNext: () => void;
// }

// type RepeatCondition = 'count' | 'until' | 'while';
// interface ExecutionPolicy {
//   type: RepeatCondition;
//   count?: number;           // dla type: 'count'
//   until?: () => boolean;    // dla type: 'until'
//   while?: () => boolean;    // dla type: 'while'
//   interval?: number;        // opcjonalny interwał
//   currentIteration: number; // śledzenie postępu
// }

// export type QueueItem = {
//   id: string;
//   itemType: QueueItemType;
//   ui: {
//     queueBgImgProp?: string,
//     queueImageClass?: string,
//     title: string,
//     description?: string,
//     lvlBar?: string,
//   }

//   blocking?: boolean,
//   executionPolicy?: ExecutionPolicy,
//   directOperation?: () => Promise<void>

//   priority: QueuePriority
//   maxShipmentTime: number,
//   supplierCities: CityInfo[],
//   itemDetails: any
// }


// type NonBlockingQueueComplex = Record<QueueItemType, NonBlockingQueue>

// type NonBlockingQueue = {
//   queue: QueueItem[],
//   timeoutData: {
//     timeoutId?: NodeJS.Timeout;
//     executionTime?: number;
//     purpose?: TimeoutPurpose;
//   };
// }

// export type CitySchedule = {
//   city: CityInfo;
//   queue: QueueItem[];
//   nonBlockingQueueComplex?: NonBlockingQueueComplex;
//   currentAction?: QueueItemType | null;
//   timeoutData: {
//     timeoutId?: NodeJS.Timeout;
//     executionTime?: number;
//     purpose?: TimeoutPurpose;
//   };
// }

// interface QueueExecutorRegistry {
//   registerExecutor<T>(type: QueueItemType, executor: QueueExecutor<T>): void;
//   getExecutor<T>(type: QueueItemType): QueueExecutor<T>;
// }

// interface QueueExecutor<T> {
//   execute(operation: ScheduleOperationDetails<T>): Promise<void>;
//   postDeleteAction?: (queue: { ui: QueueItem['ui'], details: T }[], deleteIndex: number) => void | Promise<void>;
//   hydrateItem: (itemDetails: T) => Promise<void>;
//   persistItem: (itemDetails: T) => void;
//   isRealQueueFull(city: CityInfo, itemDetails: T): Promise<{ isRealQueueFull: boolean; timeToFreeSlot: number }>;
// }


// export default class MasterQueue extends EventEmitter implements Service, QueueExecutorRegistry {
//   private static readonly TABLE_CONTAINER_ID = 'master-queue-table-container';
//   private static readonly TABLE_ID = 'master-queue-table';
//   private static readonly TABLE_EMPTY_ID = 'master-queue-table-empty';
//   private static readonly TABLE_FOOTER_ID = 'master-queue-table-footer';
//   private static readonly TABLE_TOGGLE_BUTTON_ID = 'master-queue-table-toggle-button';
//   private static readonly TABLE_CLOSE_BUTTON_ID = 'master-queue-table-close-icon';

//   private static readonly LOCAL_STORAGE_KEY = 'master-queue';
//   private config!: typeof gpsConfig;
//   private queue: CitySchedule[];
//   private citySwitchManager!: CitySwitchManager;
//   private resourceLock!: ResourceLock;
//   private RUN: boolean = false;
//   private resourceLockChangeListener?: (city: CityInfo) => void;
//   private cityChangeListener?: (city: CityInfo) => void;
//   private resourcesWhiteList: CityInfo[] = [];
//   private executors: Map<QueueItemType, QueueExecutor<any>> = new Map();

//   private constructor() {
//     super();
//     this.queue = [];
//   }

//   private static instance: MasterQueue;

//   public static async getInstance(): Promise<MasterQueue> {
//     if (!MasterQueue.instance) {
//       MasterQueue.instance = new MasterQueue();
//       MasterQueue.instance.resourceLock = ResourceLock.getInstance();
//       MasterQueue.instance.config = ConfigManager.getInstance().getConfig();
//       MasterQueue.instance.citySwitchManager = await CitySwitchManager.getInstance();
//       MasterQueue.instance.init();
//     }
//     return MasterQueue.instance;
//   }

//   public registerExecutor<T>(type: QueueItemType, executor: QueueExecutor<T>): void {
//     if (this.executors.has(type)) {
//       throw new Error(`Executor for type ${type} is already registered`);
//     }
//     this.executors.set(type, executor);
//   }

//   public getExecutor<T>(type: QueueItemType): QueueExecutor<T> {
//     const executor = this.executors.get(type);
//     if (!executor) {
//       throw new Error(`No executor registered for type: ${type}`);
//     }
//     return executor as QueueExecutor<T>;
//   }

//   private async init() {
//     this.loadSchedule();
//     this.addCSS();
//     this.addTable();
//   }

//   private addCSS() {
//     const queueStyle = document.createElement('style');
//     queueStyle.textContent = masterQueueCss;
//     document.head.appendChild(queueStyle);

//     const tableStyle = document.createElement('style');
//     tableStyle.textContent = masterQueueTableCss;
//     document.head.appendChild(tableStyle);
//   }


//   private addTable() {
//     const tableWrapper = document.createElement('div');
//     document.body.appendChild(tableWrapper);
//     tableWrapper.outerHTML = masterQueueTableHtml;
//     const tableContainer = document.getElementById(MasterQueue.TABLE_CONTAINER_ID)!;
//     const table = document.getElementById(MasterQueue.TABLE_ID)!;
//     const tableFooter = document.querySelector<HTMLElement>(`#${MasterQueue.TABLE_FOOTER_ID}`)!;
//     this.getNavigation('master', tableFooter);
//     document.querySelector<HTMLButtonElement>(`#${MasterQueue.TABLE_TOGGLE_BUTTON_ID}`)!.addEventListener('click', () => {
//       if (tableContainer.hidden) {
//         this.rehydrateTable();
//         tableContainer.hidden = false;
//       } else {
//         tableContainer.hidden = true;
//       }
//     });
//     document.getElementById(MasterQueue.TABLE_CLOSE_BUTTON_ID)!.addEventListener('click', () => {
//       tableContainer.hidden = true;
//     });
//   }

//   private rehydrateTable() {
//     // TODO: also wtf is this? why this check?
//     const tableBody = document.querySelector<HTMLTableSectionElement>(`#${MasterQueue.TABLE_ID} .tbody`);
//     if (!tableBody) return;

//     const isTableEmpty = this.queue.filter(citySchedule => citySchedule.queue.length > 0).length === 0;
//     console.log('isTableEmpty:', isTableEmpty);
//     const tableFooter = document.getElementById(MasterQueue.TABLE_FOOTER_ID)!;
//     if (isTableEmpty) {
//       tableFooter.hidden = true;
//     } else {
//       tableFooter.hidden = false;
//     }

//     tableBody.innerHTML = `
//     <div class="tr ${isTableEmpty ? '' : 'hidden'}" id="${MasterQueue.TABLE_EMPTY_ID}">
//       <div class="td no-schedules">No schedules</div>
//     </div>`;

//     // then hydrate table
//     for (const citySchedule of this.queue) {
//       if (citySchedule.queue.length === 0) continue;
//       const row = document.createElement('div');
//       row.classList.add('tr');
//       row.dataset.city = citySchedule.city.name;

//       // city Cell
//       const cityCell = document.createElement('div');
//       cityCell.classList.add('td');
//       cityCell.textContent = citySchedule.city.name;
//       row.appendChild(cityCell);

//       // queue Cell
//       const queueCell = document.createElement('div');
//       queueCell.classList.add('td');
//       const queueCellContent = document.createElement('div');
//       queueCellContent.classList.add('queue-cell');
//       this.createUIQueueItems(queueCellContent, citySchedule);
//       queueCell.appendChild(queueCellContent);
//       row.appendChild(queueCell);

//       // state Cell
//       const stateCell = document.createElement('div');
//       stateCell.classList.add('td');
//       stateCell.classList.add('master-queue-state');
//       stateCell.classList.add(citySchedule.currentAction ? 'running' : 'idle');
//       stateCell.textContent = citySchedule.currentAction ? 'Running' : 'Idle';
//       row.appendChild(stateCell);

//       // actions Cell
//       const actionsCell = document.createElement('div');
//       actionsCell.classList.add('td');
//       actionsCell.classList.add('master-queue-actions');
//       this.getNavigation('city', citySchedule, actionsCell);
//       row.appendChild(actionsCell);

//       tableBody.appendChild(row);
//     }
//   }

//   public isRunning() {
//     return this.RUN;
//   }

//   public async start() {
//     this.RUN = true;
//     this.reevaluateProviderCities();
//     this.addResourceLockChangeListener();
//     this.addOncityChangeLister();
//     this.showToggleButton(true);
//   }

//   private showToggleButton(value: boolean) {
//     const toggleButton = document.getElementById(MasterQueue.TABLE_TOGGLE_BUTTON_ID)!;
//     toggleButton.hidden = !value;
//   }


//   public async stop() {
//     this.RUN = false;
//     if (this.resourceLockChangeListener) {
//       this.resourceLock.removeListener('resource-lock-change', this.resourceLockChangeListener);
//     }
//     if (this.cityChangeListener) {
//       this.citySwitchManager.removeListener('cityChange', this.cityChangeListener);
//     }
//     this.showToggleButton(false);
//     this.queue.forEach(citySchedule => {
//       this.clearCityScheduleAction(citySchedule);
//     })
//   }

//   private addResourceLockChangeListener() {
//     const listener = (city: CityInfo) => {
//       console.log('resource-lock-change:', city);
//       this.reevaluateProviderCities();
//       this.persistSchedule();
//     }
//     this.resourceLockChangeListener = listener;
//     this.resourceLock.addListener('resource-lock-change', listener);
//   }

//   private addOncityChangeLister() {
//     const listener = (city: CityInfo) => {
//       const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
//       this.rerenderAllUIQueues(citySchedule);
//     }
//     this.cityChangeListener = listener;
//     this.citySwitchManager.addListener('cityChange', listener);
//   }

//   public addToQueue(city: CityInfo, item: Omit<QueueItem, 'id'>) {
//     let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
//     if (!citySchedule) {
//       citySchedule = {
//         city,
//         queue: [{
//           id: crypto.randomUUID(),
//           ...item
//         }],
//         timeoutData: {}
//       }
//       this.queue.push(citySchedule);
//     } else {
//       // item ma wysoki priorytet
//       if (item.priority === QueuePriority.High && citySchedule.queue.length) {
//         // kolejka jest w trakcie działania - dodaj na drugie miejsce
//         if (citySchedule.currentAction) {
//           citySchedule.queue.splice(1, 0, {
//             id: crypto.randomUUID(),
//             ...item
//           })
//         } else {
//           // kolejka jest nieaktywna - dodaj na początek
//           citySchedule.queue.unshift({
//             id: crypto.randomUUID(),
//             ...item
//           })
//         }
//       } else {
//         // item ma zwykły priorytet - dodaj na koniec
//         citySchedule.queue.push({
//           id: crypto.randomUUID(),
//           ...item
//         });
//       }
//     }

//     this.reevaluateProviderCities(citySchedule);
//     this.rerenderAllUIQueues(citySchedule);
//     if (this.isTableOpened()) {
//       this.rehydrateTable();
//     }
//     this.persistSchedule();
//     this.emit('masterQueueChanged', this.queue);
//     return citySchedule;
//   }

//   public runSchedule(city: CityInfo) {
//     const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
//     if (!citySchedule) return;
//     this.runNextAction(citySchedule);
//   }

//   public restartAllSchedules() {
//     this.queue.forEach(citySchedule => {
//       // reset info holders
//       this.clearCityScheduleAction(citySchedule);
//       // run next action
//       this.runNextAction(citySchedule);
//     })
//   }

//   public clearScheduleActionForCity(city: CityInfo) {
//     this.queue = this.queue.filter(citySchedule => {
//       if (citySchedule.city.name === city.name) {
//         this.clearCityScheduleAction(citySchedule);
//         return false;
//       }
//       return true;
//     });
//     this.persistSchedule();
//   }

//   private clearCityScheduleAction(citySchedule: CitySchedule) {
//     citySchedule.currentAction = null;
//     (citySchedule.timeoutData ??= {}).executionTime = undefined;
//     clearTimeout(citySchedule.timeoutData.timeoutId);
//     clearInterval(citySchedule.timeoutData.timeoutId);
//     citySchedule.timeoutData.timeoutId = undefined;
//   }

//   public async rerunAllSchedules() {
//     for (const citySchedule of this.queue) {
//       // reset info holders
//       this.clearCityScheduleAction(citySchedule);
//       // run next action
//       await this.runNextAction(citySchedule);
//     }
//   }

//   private runScheduleIfNotRunning(citySchedule: CitySchedule) {
//     if (citySchedule.currentAction || citySchedule.timeoutData.timeoutId) return;
//     this.runNextAction(citySchedule);
//   }

//   private async shiftQueueAndRunNext(citySchedule: CitySchedule) {
//     // clean info holders
//     this.shiftQueueCleanAndPersist(citySchedule);

//     // run next action
//     await this.runNextAction(citySchedule);
//   }

//   private async runNextAction(citySchedule: CitySchedule) {
//     // run next action
//     const nextQueueItem = citySchedule?.queue[0];
//     if (!nextQueueItem) return;

//     citySchedule.currentAction = nextQueueItem.itemType;

//     // TODO: call proper method from specific service API
//     /**
//      * Flow wywołuje metodę odpowiedniego managera przekazując mu:
//      * @param queueItem - na którym jest wywołana
//      * @param onFinishCallback - callback który zostaje wywołany po zakończeniu działania (by kolejka wiedziała kiedy zacząć działanie na następnym elemencie)
//      * @param setScheduleTimeout - callback który ustawia timeout i datę następnego wywołania, jeżeli item ma timeout
//      */
//     try {
//       const executor = this.getExecutor(nextQueueItem.itemType);
//       await executor.execute({
//         id: nextQueueItem.id,
//         city: citySchedule.city,
//         queueItem: nextQueueItem.itemDetails,
//         onFinishCallback: () => { this.shiftQueueAndRunNext(citySchedule) },
//         setScheduleTimeout: (operationCallback, timeToExecution, purpose) => {
//           this.setScheduleTimeout(citySchedule, operationCallback, timeToExecution, purpose)
//         },
//         shiftQueueAndNext: () => { this.shiftQueueAndRunNext(citySchedule) }
//       });
//     } catch (error) {
//       console.error(`Failed to execute queue item: ${error}, running next one`);
//       this.runNextAction(citySchedule);
//     }
//   }

//   /**
//    * Shifts queue, clears timeout and resets current action and schedule date. 
//    * Reevaluates provider cities if autoRevalidate is enabled.
//    * @param schedule - city schedule to shift
//    */
//   private shiftQueueCleanAndPersist(schedule: CitySchedule) {
//     schedule.queue.shift();
//     this.clearCityScheduleAction(schedule);
//     this.reevaluateProviderCities(schedule);
//     this.persistSchedule();
//     this.rerenderAllUIQueues(schedule);
//     if (this.isTableOpened()) {
//       this.rehydrateTable();
//     }
//     this.emit('masterQueueChanged', this.queue);
//   }

//   /**
//    * Special method (like "shiftQueueCleanAndPersist" but without persist and UI refresh) used on item deletion 
//    * to first perform queue modifications and only then persist and rehydrate ui manually.
//    * @param schedule 
//    */
//   private shiftQueueAndClearCallbacks(schedule: CitySchedule) {
//     schedule.queue.shift();
//     this.clearCityScheduleAction(schedule);
//     this.emit('masterQueueChanged', this.queue);
//   }

//   /**
//    * Sets specified status for all table rows or for specified city schedule row.
//    * @param status - status to set
//    * @param citySchedule - city schedule to set status for
//    */
//   private setUITableStatuses(status: 'idle' | 'running', citySchedule?: CitySchedule) {
//     const table = document.getElementById(MasterQueue.TABLE_ID)!;
//     if (!citySchedule) {
//       table.querySelectorAll<HTMLDivElement>('div.tr .master-queue-state').forEach(statusCell => {
//         statusCell.classList.remove('idle', 'running');
//         statusCell.classList.add(status);
//         statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
//       })
//     } else {
//       const statusCell = table.querySelector<HTMLDivElement>(`div.tr[data-city="${citySchedule.city.name}"] .master-queue-state`);
//       console.log('row:', statusCell);
//       if (statusCell) {
//         statusCell.classList.remove('idle', 'running');
//         statusCell.classList.add(status);
//         statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
//       }
//     }
//   }

//   /**
//    * If autoReevaluate is enabled:
//    * - reevaluates provider cities for all city schedules considering:
//    *   - queued cities (as consumers)
//    *   - white list cities (as providers)
//    *   - locked cities (as consumers)
//    * If schedule argument is provided and schedule queue length is in [0, 1] then reevaluates all items, otherwise reevaluates only items from specified schedule
//    * @param schedule - city schedule to reevaluate
//    */
//   private reevaluateProviderCities(schedule?: CitySchedule) {
//     if (this.config.masterQueue.autoReevaluate) {
//       // domyślnie miasta które są zakolejkowane są wyłączane z grupy dostawców, chyba że są w białej liście np. bo chwilowo nie mogą utylizować surowców
//       const queuedCityNames = this.queue.filter(citySchedule => citySchedule.queue.length > 0).map(citySchedule => citySchedule.city.name);
//       const whiteListCityNames = this.resourcesWhiteList.map(city => city.name);
//       const lockedCityNames = this.resourceLock.getLockList().map(city => city.name);

//       const consumerCityNames = new Set<string>([
//         // miasta które są zakolejkowane ale nie są w białej liście
//         ...queuedCityNames.filter(queuedCity => !whiteListCityNames.includes(queuedCity)),
//         // miasta które są zablokowane (mają większy priorytet niż white list)
//         ...lockedCityNames
//       ]);

//       const allCities = this.citySwitchManager.getCityList();
//       const providerCities = allCities.filter(city => !consumerCityNames.has(city.name));

//       // jeżeli w kolejce jest 0 lub 1 elementów, to znaczy że to potencjalnie punkt krytyczny gdy trzeba reewaluować dostawców wszystkich elementów
//       if (schedule && !([0, 1].includes(schedule.queue.length))) {
//         // reevaluate only current city schedule, because newly added items may have empty array of supplierCities
//         schedule.queue.forEach(item => {
//           item.itemDetails.supplierCities = providerCities;
//         })
//         return;
//       };

//       this.queue.forEach(citySchedule => {
//         citySchedule.queue.forEach(item => {
//           item.itemDetails.supplierCities = providerCities;
//         })
//       })
//     }
//   }

//   private addCityToSuppliersList(city: CityInfo) {
//     if (!this.resourcesWhiteList.map(city => city.name).includes(city.name)) {
//       this.resourcesWhiteList.push(city);
//     }
//   }

//   // private setScheduleTimeout(citySchedule: CitySchedule, timeoutId: NodeJS.Timeout, executionTime: number, purpose: 'slot' | 'resources' | 'other') {
//   private setScheduleTimeout(
//     citySchedule: CitySchedule,
//     operationCallback: () => Promise<void> | void,
//     timeToExecution: number,
//     purpose: TimeoutPurpose // "blocking" | "non-blocking"
//   ) {
//     if (purpose === 'slot' || purpose === 'charms') {
//       if (timeToExecution > 1000 * 60 * 30) {
//         console.log(`${citySchedule.city.name}: ${citySchedule.queue[0].itemType} awaits for ${purpose}, adding to suppliers list`);
//         this.addCityToSuppliersList(citySchedule.city);
//         this.reevaluateProviderCities();
//       }
//     }

//     // creating timeout that will execute operationCallback and remove city from suppliers list
//     const timeoutId = setTimeout(async () => {
//       if (purpose === 'slot' || purpose === 'charms') { // === "blocking"
//         this.removeCityFromSupplierCityList(citySchedule.city);
//         // NOTE: rethink if reevaluation there is optimal and necessary
//         this.reevaluateProviderCities();
//       }
//       await operationCallback();
//     }, timeToExecution);

//     // TODO: ensure its cleared on timeout clear
//     citySchedule.timeoutData = {
//       timeoutId,
//       executionTime: Date.now() + timeToExecution,
//       purpose
//     }
//   }

//   public getBusyCities() {
//     return this.queue.filter(citySchedule => citySchedule.queue.length > 0).map(citySchedule => citySchedule.city);
//   }

//   public getCityRecruiterSchedule(city: CityInfo): RecruiterQueueItem[] {
//     return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue.filter(item => item.itemType === 'recruiter').map(item => item.itemDetails) as RecruiterQueueItem[] ?? [];
//   }

//   public hasCitySchedule(city: CityInfo) {
//     return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue.length ?? 0 > 0;
//   }

//   public getCityScheduleQueueLength(city: CityInfo) {
//     return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue.length ?? 0;
//   }

//   public getCitySchedule(city: CityInfo) {
//     return this.queue.find(citySchedule => citySchedule.city.name === city.name);
//   }

//   /**
//    * Creates new element and hydrates it with queue items for given city.
//    * @param city - city to get queue for
//    * @returns - new element with queue items
//    */
//   public getCityQueueUI(city: CityInfo) {
//     const container = document.createElement('div');
//     container.classList.add('master-queue');

//     const citySchedule = this.getCitySchedule(city);
//     if (!citySchedule) return container;

//     this.createUIQueueItems(container, citySchedule);
//     return container;
//   }

//   /**
//    * Rerenders all master-queue elements in the DOM.
//    * If no argument is provided, rerenders queue for current city (or clears if non-existent).
//    * @param arg - city schedule/city info corresponding to the queue to rerender
//    */
//   public rerenderAllUIQueues(arg?: CitySchedule | CityInfo) {
//     const citySchedule = arg ?
//       Object.keys(arg)
//         .includes('name')
//         ? this.getCitySchedule(arg as CityInfo)
//         : arg as CitySchedule
//       : this.getCitySchedule(this.citySwitchManager.getCurrentCity()!);

//     document.querySelectorAll('.master-queue').forEach(el => {
//       el.innerHTML = '';
//       if (citySchedule) {
//         this.createUIQueueItems(el as HTMLElement, citySchedule);
//       }
//     })
//   }

//   /**
//    * Creates UI elements for given city schedule with complete delete buttons functionality 
//    * and appends them to provided container.
//    * @param container - container to append queue items to
//    * @param schedule - city schedule to create queue items for
//    */
//   private createUIQueueItems(container: HTMLElement, schedule: CitySchedule) {
//     const queue = schedule.queue;

//     queue.forEach((item, index) => {
//       const queueItem = document.createElement('div');
//       queueItem.classList.add('master-queue-item');
//       // NOTE: innerHtml looks ugly, consider doing it in JS when complexity grows
//       queueItem.innerHTML = `
//         <span class="master-queue-item-position">${index + 1}</span>
//         <div class="master-queue-item-delete">&#x2715;</div>
//         <div class="master-queue-item-level-bar">
//           ${item.ui.lvlBar}
//         </div>
//         <div class="master-queue-item-image ${item.ui.queueImageClass ?? ''}" 
//           style="${item.ui.queueBgImgProp
//           ? `background-image: ${item.ui.queueBgImgProp};`
//           : ''}"
//         >
//         </div>
//         <div class="master-queue-item-info">
//           <span class="desc1">
//           ${item.ui.title}
//           </span>
//           ${item.ui.description
//           ? `<span class="desc2">${item.ui.description}</span>`
//           : ''
//         }
//         </div>
//       `;

//       const deleteButton = queueItem.querySelector('.master-queue-item-delete');
//       deleteButton?.addEventListener('click', () => {
//         this.onQueueItemDelete(schedule, item, index);
//       });
//       container.appendChild(queueItem);
//     });
//   }

//   private onQueueItemDelete(citySchedule: CitySchedule, item: QueueItem, queueIndex: number) {
//     let shouldRunNext = false;
//     // jeżeli jest to pierwszy element kolejki
//     if (queueIndex === 0) {
//       // && jeżeli jest więcej elementów w kolejce
//       if (citySchedule.queue.length > 1) {
//         // && jeżeli jest timeout (czyli manager wykonuje jakąś scheudowaną operację)
//         if (citySchedule?.timeoutData.timeoutId) {
//           // jeżeli użytkownik nie potwierdził usunięcia elementu
//           if (!this.simpleConfirmationDialog('Czy na pewno chcesz usunąć pierwszy element z kolejki? Spowoduje to przejście do następnego elementu.')) {
//             return;
//           }
//           this.shiftQueueAndClearCallbacks(citySchedule);
//           shouldRunNext = true;
//         } else {
//           // jeżeli nie ma timeouta (czyli manager nie wykonuje żadnej scheudowanej operacji np. nie wystartował)
//           this.shiftQueueAndClearCallbacks(citySchedule);
//         }
//       } else {
//         // && jeżeli nie ma więcej elementów w kolejce
//         this.shiftQueueAndClearCallbacks(citySchedule);
//       }
//     } else {
//       // w przeciwnym wypadku (nie pierwszy element)
//       citySchedule.queue.splice(queueIndex, 1);
//     }

//     const itemsToRevalidate = citySchedule.queue.filter((item, index) => index >= queueIndex && item.itemType === 'builder')
//       .map(el => ({ ui: el.ui, details: el.itemDetails }));

//     this.getExecutor(item.itemType).postDeleteAction?.(itemsToRevalidate, queueIndex);
//     this.reevaluateProviderCities(citySchedule);
//     this.persistSchedule();
//     this.rerenderAllUIQueues(citySchedule);

//     if (this.isTableOpened()) {
//       this.rehydrateTable();
//     }

//     if (shouldRunNext) {
//       this.runNextAction(citySchedule);
//     }
//   }

//   private persistSchedule() {
//     localStorage.setItem(MasterQueue.LOCAL_STORAGE_KEY, JSON.stringify(
//       this.queue.filter(citySchedule => citySchedule.queue.length > 0)
//         .map((citySchedule: CitySchedule) => ({
//           city: citySchedule.city,
//           queue: citySchedule.queue
//         }))
//     ));
//   }

//   private isTableOpened = () => {
//     return document.getElementById(MasterQueue.TABLE_ID)?.hidden === false;
//   }

//   // TODO: hydrate schedule from local storage and add load method in ~constructor
//   private loadSchedule() {
//     const schedule = localStorage.getItem(MasterQueue.LOCAL_STORAGE_KEY);
//     if (schedule) {
//       const parsedQueue: CitySchedule[] = JSON.parse(schedule);
//       const hydratedQueue = this.hydrateSchedule(parsedQueue);
//       console.log('loaded master-queue schedule:', parsedQueue);
//       this.queue = hydratedQueue;
//     } else {
//       this.queue = [];
//     }
//   }

//   private hydrateSchedule(schedule: CitySchedule[]) {
//     return schedule.map(citySchedule => {
//       const city = this.citySwitchManager.getCityByName(citySchedule.city.name);
//       if (!city) return null;

//       // city has method inside which needs to be hydrated
//       citySchedule.city = city;
//       // during persistance it's not saved, but is required for proper functioning
//       citySchedule.timeoutData = {};

//       // supllier citises contain CityInfo which needs to be hydrated
//       citySchedule.queue.forEach(queueItem => {
//         queueItem.supplierCities = queueItem.supplierCities
//           .map(city => this.citySwitchManager.getCityByName(city.name) ?? null)
//           .filter(Boolean) as CityInfo[];

//         this.executors.get(queueItem.itemType)?.hydrateItem(queueItem.itemDetails);
//       });
//       return citySchedule;
//     }).filter(Boolean) as CitySchedule[];
//   }


//   private simpleConfirmationDialog(message: string) {
//     return window.confirm(message);
//   }


//   public getScheduleForCity<T>(city: CityInfo, type?: QueueItemType) {
//     if (type) {
//       return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue
//         .filter(item => item.itemType === type)
//         .map(item => item.itemDetails)
//         ?? [];
//     }
//     return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue ?? []
//   }

//   public getNavigation(type: 'master', container?: HTMLElement): HTMLElement;
//   public getNavigation(type: 'city' | 'all', arg1: CitySchedule | CityInfo, container?: HTMLElement): void;
//   public getNavigation(type: 'master' | 'city' | 'all', arg1?: HTMLElement | CitySchedule | CityInfo, arg2?: HTMLElement): HTMLElement | void {
//     const div = document.createElement('div');
//     div.classList.add('master-queue-navigation');

//     if (type === 'master') {
//       const navigation = this.getMasterNavigationButtons();
//       if (arg1 instanceof HTMLElement) {
//         Object.values(navigation).forEach(button => {
//           arg1.appendChild(button);
//         })
//       } else {
//         Object.values(navigation).forEach(button => {
//           div.appendChild(button);
//         })
//         return div;
//       }
//     } else if (type === 'city') {

//       const navigation = this.getQueueNavigationButtons(arg1 as CitySchedule | CityInfo);
//       if (arg2 instanceof HTMLElement) {
//         Object.values(navigation).forEach(button => {
//           arg2.appendChild(button);
//         })
//       } else {
//         Object.values(navigation).forEach(button => {
//           div.appendChild(button);
//         })
//         return div;
//       }
//     } else if (type === 'all') {
//       const queueNavigation = this.getQueueNavigationButtons(arg1 as CitySchedule | CityInfo);
//       const masterNavigation = this.getMasterNavigationButtons();

//       if (arg2 instanceof HTMLElement) {
//         Object.values(queueNavigation).forEach(button => {
//           arg2.appendChild(button);
//         })
//         Object.values(masterNavigation).forEach(button => {
//           arg2.appendChild(button);
//         })
//       } else {
//         Object.values(queueNavigation).forEach(button => {
//           div.appendChild(button);
//         })
//         Object.values(masterNavigation).forEach(button => {
//           div.appendChild(button);
//         })
//         return div;
//       }
//     }
//   }

//   private clearAllSchedules() {
//     this.queue.forEach(citySchedule => {
//       this.clearCityScheduleAction(citySchedule);
//       citySchedule.queue = [];
//     })
//     this.persistSchedule();
//   }

//   public getMasterNavigationButtons(): {
//     runAllButton: HTMLButtonElement,
//     resetAllButton: HTMLButtonElement,
//     deleteAllButton: HTMLButtonElement,
//     pauseAllButton: HTMLButtonElement,
//   } {
//     const runAllButton = document.createElement('button');
//     const resetAllButton = document.createElement('button');
//     const deleteAllButton = document.createElement('button');
//     const pauseAllButton = document.createElement('button');
//     runAllButton.textContent = 'Run all';
//     resetAllButton.textContent = 'Reset all';
//     deleteAllButton.textContent = 'Delete all';
//     pauseAllButton.textContent = 'Pause all';

//     runAllButton.classList.add('run-all-button');
//     resetAllButton.classList.add('reset-all-button');
//     deleteAllButton.classList.add('clear-all-button');
//     pauseAllButton.classList.add('pause-all-button');

//     runAllButton.addEventListener('click', () => {
//       for (const citySchedule of this.queue) {
//         this.runScheduleIfNotRunning(citySchedule);
//       }
//       this.setUITableStatuses('running');
//       if (this.isTableOpened()) {
//         // this.rehydrateTable();
//       }
//     })
//     resetAllButton.addEventListener('click', () => {
//       this.rerunAllSchedules();
//       if (this.isTableOpened()) {
//         // this.rehydrateTable();
//         this.setUITableStatuses('running');
//       }
//     })
//     deleteAllButton.addEventListener('click', () => {
//       this.clearAllSchedules();
//       if (this.isTableOpened()) {
//         this.rehydrateTable();
//       }
//     })
//     pauseAllButton.addEventListener('click', () => {
//       this.pauseAllSchedules();
//       if (this.isTableOpened()) {
//         // this.rehydrateTable();
//         this.setUITableStatuses('idle');
//       }
//     })

//     return {
//       runAllButton,
//       resetAllButton,
//       deleteAllButton,
//       pauseAllButton,
//     }
//   }

//   public getQueueNavigationButtons(queueIdentifier: CityInfo | CitySchedule): {
//     runThisButton: HTMLButtonElement,
//     restartThisButton: HTMLButtonElement,
//     pauseThisButton: HTMLButtonElement,
//     deleteThisButton: HTMLButtonElement,
//   } {
//     const runThisButton = document.createElement('button');
//     const restartThisButton = document.createElement('button');
//     const pauseThisButton = document.createElement('button');
//     const deleteThisButton = document.createElement('button');

//     runThisButton.textContent = 'Run';
//     restartThisButton.textContent = 'Restart';
//     pauseThisButton.textContent = 'Pause';
//     deleteThisButton.textContent = 'Delete';

//     runThisButton.classList.add('run-this-button');
//     restartThisButton.classList.add('reset-this-button');
//     pauseThisButton.classList.add('pause-this-button');
//     deleteThisButton.classList.add('clear-this-button');

//     const citySchedule = Object.keys(queueIdentifier).includes('city')
//       ? (queueIdentifier as CitySchedule)
//       : this.queue.find(schedule => schedule.city.name === (queueIdentifier as CityInfo).name)!;

//     runThisButton.addEventListener('click', () => {
//       if (citySchedule && !citySchedule.currentAction) {
//         this.runNextAction(citySchedule)
//       };
//       if (this.isTableOpened()) {
//         this.setUITableStatuses('running', citySchedule);
//         // this.rehydrateTable();
//       }
//     })
//     restartThisButton.addEventListener('click', () => {
//       if (citySchedule) {
//         this.clearCityScheduleAction(citySchedule);
//         this.runNextAction(citySchedule);
//         if (this.isTableOpened()) {
//           // this.rehydrateTable();
//           this.setUITableStatuses('running', citySchedule);
//         }
//       }
//     })
//     pauseThisButton.addEventListener('click', () => {
//       console.log('pauseThisButton clicked, schedule:', citySchedule);
//       if (citySchedule) {
//         console.log('should clear city schedule action');
//         this.clearCityScheduleAction(citySchedule);
//         if (this.isTableOpened()) {
//           // this.rehydrateTable();
//           this.setUITableStatuses('idle', citySchedule);
//         }
//       }
//     })
//     deleteThisButton.addEventListener('click', () => {
//       this.clearScheduleActionForCity(citySchedule.city);
//       this.rerenderAllUIQueues();
//       if (this.isTableOpened()) {
//         this.rehydrateTable();
//       }
//     })

//     return {
//       runThisButton,
//       restartThisButton,
//       pauseThisButton,
//       deleteThisButton,
//     }
//   }

//   private pauseAllSchedules() {
//     this.queue.forEach(citySchedule => {
//       this.clearCityScheduleAction(citySchedule);
//     })
//   }

//   private simpleScheduleLoadConfirmationDialog(cityScheduleList: CitySchedule[]) {
//     let message = `Czy chcesz kontynuować poprzednią sesje rekrutacji?`;
//     cityScheduleList.forEach(citySchedule => {
//       if (citySchedule.queue.length) {
//         message += `\n${citySchedule.city.name}:\n${citySchedule.queue.map(q => {
//           switch (q.itemType) {
//             case 'recruiter':
//               const queueItem = q.itemDetails as RecruiterQueueItem;
//               const unitName = queueItem.unitContextInfo.unitSelector.split('.').at(-1);
//               return `\t${unitName} x ${queueItem.amountLeft} ${queueItem.amountType === 'slots' ? 'slotów' : 'jednostek'}`
//             case 'builder':
//               const builderItem = q.itemDetails as BuilderQueueItem;
//               return `\t${builderItem.building.name} -> ${builderItem.toLvl}`
//           }
//         }).join('\n')}`;
//       }
//     })
//     const confirm = window.confirm(message);
//     return confirm;
//   }

//   public getScheduledActionTimes() {
//     return this.queue.map(citySchedule => citySchedule.timeoutData.executionTime).filter(Boolean) as number[]
//   }

//   public handleMasterQueueConfigChange(configChange: TConfigChanges['masterQueue']) {
//     if (configChange.autoReevaluate) {
//       this.reevaluateProviderCities();
//     }
//   }

//   /**
//    * Removes item from queue by id or reference. If item was first in queue its scheduled operation will be canceled.
//    * @param city - city to remove item from
//    * @param identifier - either item id (string) or queue item reference
//    */
//   public removeItem(city: CityInfo, identifier: string | QueueItem): void {
//     const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
//     if (!citySchedule) return;

//     const itemIndex = typeof identifier === "string"
//       ? citySchedule.queue.findIndex(item => item.id === identifier)
//       : citySchedule.queue.findIndex(item => item === identifier);

//     if (itemIndex === -1) return;

//     if (itemIndex === 0) {
//       this.clearCityScheduleAction(citySchedule);
//     }

//     citySchedule.queue.splice(itemIndex, 1);
//     this.persistSchedule();
//   }

//   public unshiftAndRun(city: CityInfo, item: Omit<QueueItem, 'id'>) {
//     let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
//     if (!citySchedule) {
//       citySchedule = this.addToQueue(city, item);
//     } else {
//       this.clearCityScheduleAction(citySchedule);

//       citySchedule.queue.unshift({
//         id: crypto.randomUUID(),
//         ...item
//       });
//     }
//     this.persistSchedule();
//     this.runNextAction(citySchedule);
//   }

//   public shareCityResources(city: CityInfo) {
//     this.resourcesWhiteList.push(city);
//     this.reevaluateProviderCities();
//   }

//   private removeCityFromSupplierCityList(city: CityInfo) {
//     const lengthBefore = this.resourcesWhiteList.length;
//     this.resourcesWhiteList = this.resourcesWhiteList.filter(city => city.name !== city.name);
//     const lengthAfter = this.resourcesWhiteList.length;
//     // if (lengthBefore !== lengthAfter) {
//     //   this.reevaluateProviderCities();
//     // }
//   }
// }/*


import gpsConfig from "../../../gps.config";
import { TConfigChanges } from "../../config-popup/config-popup";
import ConfigManager from "../../utility/config-manager";
import ResourceLock from "../../utility/resource-lock";
import { BuilderQueueItem } from "../city/builder/city-builder";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import { RecruiterQueueItem } from "../recruiter/recruiter";
import masterQueueCss from './master-queue.css';

import EventEmitter from "events";
import Service from "../../utility/service";
import masterQueueTableCss from './master-queue-table.css';
import masterQueueTableHtml from './master-queue-table.prod.html';

export enum QueuePriority {
  High = 'high',
  Normal = 'normal',
}

export type QueueItemType = 'recruiter' | 'builder' | 'municipal utility';
export type TimeoutPurpose = 'slot' | 'resources' | 'charms' | string;
export type TimeoutType = 'execution' | 'waiting'
export type ScheduleOperationDetails<T> = {
  id: string;
  city: CityInfo;
  queueItem: T;
  onFinishCallback: () => void;
  setScheduleTimeout: (
    operationCallback: () => Promise<void> | void,
    executionTime: number,
    timeoutType: TimeoutType,
    purpose?: TimeoutPurpose
  ) => void;
  shiftQueueAndNext: () => void;
}

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
    queueBgImgProp?: string,
    queueImageClass?: string,
    title: string,
    description?: string,
    lvlBar?: string,
  }

  blocking?: boolean,
  executionTime?: number,
  repetitionPolicy?: RepetitionPolicy,
  directOperation?: () => Promise<void>

  priority: QueuePriority
  maxShipmentTime: number,
  supplierCities: CityInfo[],
  itemDetails: any
}

type NonBlockingQueueComplex = Partial<Record<QueueItemType, NonBlockingQueue>>

type NonBlockingQueue = {
  queue: QueueItem[],
  timeoutData: {
    timeoutId?: NodeJS.Timeout;
    executionTime?: number;
    purpose?: TimeoutPurpose;
  };
}

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
}

interface QueueExecutorRegistry {
  registerExecutor<T>(type: QueueItemType, executor: QueueExecutor<T>): void;
  getExecutor<T>(type: QueueItemType): QueueExecutor<T>;
}

interface QueueExecutor<T> {
  execute(operation: ScheduleOperationDetails<T>): Promise<void>;
  postDeleteAction?: (queue: { ui: QueueItem['ui'], details: T }[], deleteIndex: number) => void | Promise<void>;
  hydrateItem: (itemDetails: T) => Promise<void>;
  persistItem: (itemDetails: T) => void;
}


export default class MasterQueue extends EventEmitter implements Service, QueueExecutorRegistry {
  private static readonly TABLE_CONTAINER_ID = 'master-queue-table-container';
  private static readonly TABLE_ID = 'master-queue-table';
  private static readonly TABLE_EMPTY_ID = 'master-queue-table-empty';
  private static readonly TABLE_FOOTER_ID = 'master-queue-table-footer';
  private static readonly TABLE_TOGGLE_BUTTON_ID = 'master-queue-table-toggle-button';
  private static readonly TABLE_CLOSE_BUTTON_ID = 'master-queue-table-close-icon';

  private static readonly LOCAL_STORAGE_KEY = 'master-queue';
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
    document.querySelector<HTMLButtonElement>(`#${MasterQueue.TABLE_TOGGLE_BUTTON_ID}`)!.addEventListener('click', () => {
      if (tableContainer.hidden) {
        this.rehydrateTable();
        tableContainer.hidden = false;
      } else {
        tableContainer.hidden = true;
      }
    });
    document.getElementById(MasterQueue.TABLE_CLOSE_BUTTON_ID)!.addEventListener('click', () => {
      tableContainer.hidden = true;
    });
  }

  private rehydrateTable() {
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
    this.reevaluateProviderCities();
    this.addResourceLockChangeListener();
    this.addOncityChangeLister();
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
      this.clearCityScheduleTimeouts(citySchedule);
    })
  }

  private addResourceLockChangeListener() {
    const listener = (city: CityInfo) => {
      console.log('resource-lock-change:', city);
      this.reevaluateProviderCities();
      this.persistSchedule();
    }
    this.resourceLockChangeListener = listener;
    this.resourceLock.addListener('resource-lock-change', listener);
  }

  private addOncityChangeLister() {
    const listener = (city: CityInfo) => {
      const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
      this.rerenderAllUIQueues(citySchedule);
    }
    this.cityChangeListener = listener;
    this.citySwitchManager.addListener('cityChange', listener);
  }

  public addToQueue(city: CityInfo, item: Omit<QueueItem, 'id'>) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = {
        city,
        queue: [{
          id: crypto.randomUUID(),
          ...item
        }],
        nonBlockingQueueComplex: {},
        timeoutData: {}
      }
      this.queue.push(citySchedule);
    } else {
      // item ma wysoki priorytet
      if (item.priority === QueuePriority.High && citySchedule.queue.length) {
        // kolejka jest w trakcie działania - dodaj na drugie miejsce
        if (citySchedule.currentAction) {
          citySchedule.queue.splice(1, 0, {
            id: crypto.randomUUID(),
            ...item
          })
        } else {
          // kolejka jest nieaktywna - dodaj na początek
          citySchedule.queue.unshift({
            id: crypto.randomUUID(),
            ...item
          })
        }
      } else {
        // item ma zwykły priorytet lub nie ma nic w kolejce - dodaj na koniec
        citySchedule.queue.push({
          id: crypto.randomUUID(),
          ...item
        });
      }
    }

    this.reevaluateProviderCities(citySchedule);
    this.rerenderAllUIQueues(citySchedule);
    if (this.isTableOpened()) {
      this.rehydrateTable();
    }
    this.persistSchedule();
    this.emit('masterQueueChanged', this.queue);
    return citySchedule;
  }

  public runSchedule(city: CityInfo) {
    const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) return;
    this.runNextAction(citySchedule);
  }

  public restartAllSchedules() {
    this.queue.forEach(citySchedule => {
      // reset info holders
      this.clearCityScheduleTimeouts(citySchedule);
      // run next action
      this.runNextAction(citySchedule);
    })
  }

  public clearScheduleActionForCity(city: CityInfo) {
    this.queue = this.queue.filter(citySchedule => {
      if (citySchedule.city.name === city.name) {
        this.clearCityScheduleTimeouts(citySchedule);
        return false;
      }
      return true;
    });
    this.persistSchedule();
  }

  private clearCityScheduleTimeouts(citySchedule: CitySchedule) {
    citySchedule.currentAction = null;
    (citySchedule.timeoutData ??= {}).executionTime = undefined;
    clearTimeout(citySchedule.timeoutData.timeoutId);
    clearInterval(citySchedule.timeoutData.timeoutId);
    citySchedule.timeoutData.timeoutId = undefined;
  }

  public async rerunAllSchedules() {
    for (const citySchedule of this.queue) {
      // reset info holders
      this.clearCityScheduleTimeouts(citySchedule);
      // run next action
      await this.runNextAction(citySchedule);
    }
  }

  private runScheduleIfNotRunning(citySchedule: CitySchedule) {
    if (citySchedule.currentAction || citySchedule.timeoutData.timeoutId) return;
    this.runNextAction(citySchedule);
  }

  private async onItemExecutionFinish(citySchedule: CitySchedule) {
    // TODO: this is the place to handle execution policy (cycles)
    const finishedItem = citySchedule.queue[0];
    if (finishedItem.repetitionPolicy) {
      finishedItem.repetitionPolicy.currentIteration++;
      if ((finishedItem.repetitionPolicy.count && finishedItem.repetitionPolicy.count < finishedItem.repetitionPolicy.currentIteration)
        || finishedItem.repetitionPolicy.while && (await finishedItem.repetitionPolicy.while())
        || finishedItem.repetitionPolicy.until && (await finishedItem.repetitionPolicy.until())
      ) {
        // clear callbacks just in case
        this.clearCityScheduleTimeouts(citySchedule);

        if (finishedItem.repetitionPolicy.interval) {
          // TODO: implement this later, for now don't add this functionality
          // finishedItem.executionTime = Date.now() + finishedItem.repetitionPolicy.interval;
        }
        this.persistSchedule();
        await this.runNextAction(citySchedule);
      }
    } else {
      await this.shiftQueueAndRunNext(citySchedule);
    }
  }

  private async shiftQueueAndRunNext(citySchedule: CitySchedule) {
    // clean info holders
    this.shiftQueueCleanAndPersist(citySchedule);

    // run next action
    await this.runNextAction(citySchedule);
  }

  private async runNextAction(citySchedule: CitySchedule) {
    // run next action
    const nextQueueItem = citySchedule?.queue[0];
    if (!nextQueueItem) return;

    citySchedule.currentAction = nextQueueItem.itemType;

    // TODO: call proper method from specific service API
    /**
     * Flow wywołuje metodę odpowiedniego managera przekazując mu:
     * @param queueItem - na którym jest wywołana
     * @param onFinishCallback - callback który zostaje wywołany po zakończeniu działania (by kolejka wiedziała kiedy zacząć działanie na następnym elemencie)
     * @param setScheduleTimeout - callback który ustawia timeout i datę następnego wywołania, jeżeli item ma timeout
     */
    try {
      // if it comes back from non-blocking queue nad had specific callback assigned -> perform it instead
      if (nextQueueItem.directOperation) {
        await nextQueueItem.directOperation();
        return
      }

      const executor = this.getExecutor(nextQueueItem.itemType);
      await executor.execute({
        id: nextQueueItem.id,
        city: citySchedule.city,
        queueItem: nextQueueItem.itemDetails,
        onFinishCallback: () => { this.onItemExecutionFinish(citySchedule) },
        setScheduleTimeout: (operationCallback, executionTime, timeoutType: TimeoutType, purpose) => {
          this.setScheduleTimeout(citySchedule, operationCallback, executionTime, timeoutType, nextQueueItem, purpose)
        },
        shiftQueueAndNext: () => { this.shiftQueueAndRunNext(citySchedule) }
      });
    } catch (error) {
      console.error(`Failed to execute queue item: ${error}, running next one`);
      this.runNextAction(citySchedule);
    }
  }

  /**
   * Shifts queue, clears timeout and resets current action and schedule date. 
   * Reevaluates provider cities if autoRevalidate is enabled.
   * @param schedule - city schedule to shift
   */
  private shiftQueueCleanAndPersist(schedule: CitySchedule) {
    schedule.queue.shift();
    this.clearCityScheduleTimeouts(schedule);
    this.reevaluateProviderCities(schedule);
    this.persistSchedule();
    this.rerenderAllUIQueues(schedule);
    if (this.isTableOpened()) {
      this.rehydrateTable();
    }
    this.emit('masterQueueChanged', this.queue);
  }

  /**
   * Special method (like "shiftQueueCleanAndPersist" but without persist and UI refresh) used on item deletion 
   * to first perform queue modifications and only then persist and rehydrate ui manually.
   * @param schedule 
   */
  private shiftQueueAndClearCallbacks(schedule: CitySchedule) {
    schedule.queue.shift();
    this.clearCityScheduleTimeouts(schedule);
    this.emit('masterQueueChanged', this.queue);
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
      })
    } else {
      const statusCell = table.querySelector<HTMLDivElement>(`div.tr[data-city="${citySchedule.city.name}"] .master-queue-state`);
      console.log('row:', statusCell);
      if (statusCell) {
        statusCell.classList.remove('idle', 'running');
        statusCell.classList.add(status);
        statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      }
    }
  }

  /**
   * If autoReevaluate is enabled:
   * - reevaluates provider cities for all city schedules considering:
   *   - queued cities (as consumers)
   *   - white list cities (as providers)
   *   - locked cities (as consumers)
   * If schedule argument is provided and schedule queue length is in [0, 1] then reevaluates all items, otherwise reevaluates only items from specified schedule
   * @param schedule - city schedule to reevaluate
   */
  private reevaluateProviderCities(schedule?: CitySchedule) {
    if (this.config.masterQueue.autoReevaluate) {
      // domyślnie miasta które są zakolejkowane są wyłączane z grupy dostawców, chyba że są w białej liście np. bo chwilowo nie mogą utylizować surowców
      const queuedCityNames = this.queue.filter(citySchedule => citySchedule.queue.length > 0).map(citySchedule => citySchedule.city.name);
      const whiteListCityNames = this.resourcesWhiteList.map(city => city.name);
      const lockedCityNames = this.resourceLock.getLockList().map(city => city.name);

      const consumerCityNames = new Set<string>([
        // miasta które są zakolejkowane ale nie są w białej liście
        ...queuedCityNames.filter(queuedCity => !whiteListCityNames.includes(queuedCity)),
        // miasta które są zablokowane (mają większy priorytet niż white list)
        ...lockedCityNames
      ]);

      const allCities = this.citySwitchManager.getCityList();
      const providerCities = allCities.filter(city => !consumerCityNames.has(city.name));

      // jeżeli w kolejce jest 0 lub 1 elementów, to znaczy że to potencjalnie punkt krytyczny gdy trzeba reewaluować dostawców wszystkich elementów
      if (schedule && !([0, 1].includes(schedule.queue.length))) {
        // reevaluate only current city schedule, because newly added items may have empty array of supplierCities
        schedule.queue.forEach(item => {
          item.itemDetails.supplierCities = providerCities;
        })
        return;
      };

      this.queue.forEach(citySchedule => {
        citySchedule.queue.forEach(item => {
          item.itemDetails.supplierCities = providerCities;
        })
      })
    }
  }

  private addCityToSuppliersList(city: CityInfo) {
    if (!this.resourcesWhiteList.map(city => city.name).includes(city.name)) {
      this.resourcesWhiteList.push(city);
    }
  }

  // private setScheduleTimeout(citySchedule: CitySchedule, timeoutId: NodeJS.Timeout, executionTime: number, purpose: 'slot' | 'resources' | 'other') {
  private setScheduleTimeout(
    citySchedule: CitySchedule,
    operationCallback: () => Promise<void> | void,
    executionTime: number,
    timeoutType: TimeoutType, // part of execution (resources arrival) | waiting (for slot, charms etc)
    queueItem: QueueItem,
    purpose?: TimeoutPurpose
  ) {
    const minimumBlockingTime = 1000 * 60 * 30;
    // item is sequential (blocks until executed)
    if (queueItem.blocking) {
      // if blocking item needs to wait for longer than "minimumBlockingTime" then it can share its resources
      if (timeoutType === 'waiting') {
        if ((executionTime - Date.now()) > minimumBlockingTime) {
          console.log(`${citySchedule.city.name}: ${citySchedule.queue[0].itemType} awaits for ${purpose}, adding to suppliers list`);
          this.addCityToSuppliersList(citySchedule.city);
          this.reevaluateProviderCities();
        }
      }
      // creating timeout that will execute operationCallback and remove city from suppliers list
      const timeoutId = setTimeout(async () => {
        if (timeoutType === 'waiting') {
          this.removeCityFromSupplierCityList(citySchedule.city);
          // NOTE: rethink if reevaluation there is optimal and necessary
          this.reevaluateProviderCities();
        }
        await operationCallback();
      }, executionTime);

      citySchedule.timeoutData = {
        timeoutId,
        executionTime: executionTime - Date.now(),
        purpose
      }
    }
    // non-blocking 
    else {
      // indirect (waiting for charms, slots, etc.) and waiting time is longer than minimum blocking time
      if (timeoutType === 'waiting' && (executionTime - Date.now()) > minimumBlockingTime) {
        // TODO: fix safety, ensure its initialized and exsists
        let nonBlockingQueueObj = citySchedule.nonBlockingQueueComplex?.[queueItem.itemType];
        if (!nonBlockingQueueObj) {
          nonBlockingQueueObj = {
            queue: [],
            timeoutData: {}
          }
          citySchedule.nonBlockingQueueComplex[queueItem.itemType] = nonBlockingQueueObj;
        }
        // it will be executed instead of plain "exeucte" method
        queueItem.directOperation = async () => await operationCallback();
        nonBlockingQueueObj.queue.push(queueItem);
        nonBlockingQueueObj.timeoutData = {
          timeoutId: setTimeout(() => {
            /*
             -move all type-related queue back to the main queue
            */
            this.respectfulUnshiftQueueItems(citySchedule, nonBlockingQueueObj!.queue)
          }, executionTime - Date.now()),
          executionTime,
          purpose
        }

      }
      // non-blocking 'execution' callback - so it must block
      else {
        const timeoutId = setTimeout(async () => await operationCallback(), executionTime - Date.now());
        citySchedule.timeoutData = {
          timeoutId,
          executionTime: executionTime - Date.now(),
          purpose
        }
      }
    }
  }

  /**
   * Puts queue items to the queue front, or at 1-st index if first element is already during execution and runs if idle.
   * @param citySchedule 
   * @param items 
   */
  public respectfulUnshiftQueueItems(citySchedule: CitySchedule, items: QueueItem[]) {
    if (citySchedule.currentAction || citySchedule.timeoutData.timeoutId) {
      citySchedule.queue.splice(1, 0, ...items);
    } else {
      citySchedule.queue.unshift(...items);
      this.runNextAction(citySchedule);
    }
  }

  public getBusyCities() {
    return this.queue.filter(citySchedule => citySchedule.queue.length > 0).map(citySchedule => citySchedule.city);
  }

  public getCityRecruiterSchedule(city: CityInfo): RecruiterQueueItem[] {
    return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue.filter(item => item.itemType === 'recruiter').map(item => item.itemDetails) as RecruiterQueueItem[] ?? [];
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
    const citySchedule = arg ?
      Object.keys(arg)
        .includes('name')
        ? this.getCitySchedule(arg as CityInfo)
        : arg as CitySchedule
      : this.getCitySchedule(this.citySwitchManager.getCurrentCity()!);

    document.querySelectorAll('.master-queue').forEach(el => {
      el.innerHTML = '';
      if (citySchedule) {
        this.createUIQueueItems(el as HTMLElement, citySchedule);
      }
    })
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
          style="${item.ui.queueBgImgProp
          ? `background-image: ${item.ui.queueBgImgProp};`
          : ''}"
        >
        </div>
        <div class="master-queue-item-info">
          <span class="desc1">
          ${item.ui.title}
          </span>
          ${item.ui.description
          ? `<span class="desc2">${item.ui.description}</span>`
          : ''
        }
        </div>
      `;

      const deleteButton = queueItem.querySelector('.master-queue-item-delete');
      deleteButton?.addEventListener('click', () => {
        this.onQueueItemDelete(schedule, item, index);
      });
      container.appendChild(queueItem);
    });
  }

  private onQueueItemDelete(citySchedule: CitySchedule, item: QueueItem, queueIndex: number) {
    let shouldRunNext = false;
    // jeżeli jest to pierwszy element kolejki
    if (queueIndex === 0) {
      // && jeżeli jest więcej elementów w kolejce
      if (citySchedule.queue.length > 1) {
        // && jeżeli jest timeout (czyli manager wykonuje jakąś scheudowaną operację)
        if (citySchedule?.timeoutData.timeoutId) {
          // jeżeli użytkownik nie potwierdził usunięcia elementu
          if (!this.simpleConfirmationDialog('Czy na pewno chcesz usunąć pierwszy element z kolejki? Spowoduje to przejście do następnego elementu.')) {
            return;
          }
          this.shiftQueueAndClearCallbacks(citySchedule);
          shouldRunNext = true;
        } else {
          // jeżeli nie ma timeouta (czyli manager nie wykonuje żadnej scheudowanej operacji np. nie wystartował)
          this.shiftQueueAndClearCallbacks(citySchedule);
        }
      } else {
        // && jeżeli nie ma więcej elementów w kolejce
        this.shiftQueueAndClearCallbacks(citySchedule);
      }
    } else {
      // w przeciwnym wypadku (nie pierwszy element)
      citySchedule.queue.splice(queueIndex, 1);
    }

    const itemsToRevalidate = citySchedule.queue.filter((item, index) => index >= queueIndex && item.itemType === 'builder')
      .map(el => ({ ui: el.ui, details: el.itemDetails }));

    this.getExecutor(item.itemType).postDeleteAction?.(itemsToRevalidate, queueIndex);
    this.reevaluateProviderCities(citySchedule);
    this.persistSchedule();
    this.rerenderAllUIQueues(citySchedule);

    if (this.isTableOpened()) {
      this.rehydrateTable();
    }

    if (shouldRunNext) {
      this.runNextAction(citySchedule);
    }
  }

  private persistSchedule() {
    localStorage.setItem(MasterQueue.LOCAL_STORAGE_KEY, JSON.stringify(
      this.queue.filter(citySchedule => citySchedule.queue.length > 0)
        .map((citySchedule: CitySchedule) => ({
          city: citySchedule.city,
          queue: citySchedule.queue
        }))
    ));
  }

  private isTableOpened = () => {
    return document.getElementById(MasterQueue.TABLE_ID)?.hidden === false;
  }

  // TODO: hydrate schedule from local storage and add load method in ~constructor
  private loadSchedule() {
    const schedule = localStorage.getItem(MasterQueue.LOCAL_STORAGE_KEY);
    if (schedule) {
      const parsedQueue: CitySchedule[] = JSON.parse(schedule);
      const hydratedQueue = this.hydrateSchedule(parsedQueue);
      console.log('loaded master-queue schedule:', parsedQueue);
      this.queue = hydratedQueue;
    } else {
      this.queue = [];
    }
  }

  private hydrateSchedule(schedule: CitySchedule[]) {
    return schedule.map(citySchedule => {
      const city = this.citySwitchManager.getCityByName(citySchedule.city.name);
      if (!city) return null;

      // city has method inside which needs to be hydrated
      citySchedule.city = city;
      // during persistance it's not saved, but is required for proper functioning
      citySchedule.timeoutData = {};

      // supllier citises contain CityInfo which needs to be hydrated
      citySchedule.queue.forEach(queueItem => {
        queueItem.supplierCities = queueItem.supplierCities
          .map(city => this.citySwitchManager.getCityByName(city.name) ?? null)
          .filter(Boolean) as CityInfo[];

        this.executors.get(queueItem.itemType)?.hydrateItem(queueItem.itemDetails);
      });
      return citySchedule;
    }).filter(Boolean) as CitySchedule[];
  }


  private simpleConfirmationDialog(message: string) {
    return window.confirm(message);
  }


  public getScheduleForCity<T>(city: CityInfo, type?: QueueItemType) {
    if (type) {
      return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue
        .filter(item => item.itemType === type)
        .map(item => item.itemDetails)
        ?? [];
    }
    return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue ?? []
  }

  public getNavigation(type: 'master', container?: HTMLElement): HTMLElement;
  public getNavigation(type: 'city' | 'all', arg1: CitySchedule | CityInfo, container?: HTMLElement): void;
  public getNavigation(type: 'master' | 'city' | 'all', arg1?: HTMLElement | CitySchedule | CityInfo, arg2?: HTMLElement): HTMLElement | void {
    const div = document.createElement('div');
    div.classList.add('master-queue-navigation');

    if (type === 'master') {
      const navigation = this.getMasterNavigationButtons();
      if (arg1 instanceof HTMLElement) {
        Object.values(navigation).forEach(button => {
          arg1.appendChild(button);
        })
      } else {
        Object.values(navigation).forEach(button => {
          div.appendChild(button);
        })
        return div;
      }
    } else if (type === 'city') {

      const navigation = this.getQueueNavigationButtons(arg1 as CitySchedule | CityInfo);
      if (arg2 instanceof HTMLElement) {
        Object.values(navigation).forEach(button => {
          arg2.appendChild(button);
        })
      } else {
        Object.values(navigation).forEach(button => {
          div.appendChild(button);
        })
        return div;
      }
    } else if (type === 'all') {
      const queueNavigation = this.getQueueNavigationButtons(arg1 as CitySchedule | CityInfo);
      const masterNavigation = this.getMasterNavigationButtons();

      if (arg2 instanceof HTMLElement) {
        Object.values(queueNavigation).forEach(button => {
          arg2.appendChild(button);
        })
        Object.values(masterNavigation).forEach(button => {
          arg2.appendChild(button);
        })
      } else {
        Object.values(queueNavigation).forEach(button => {
          div.appendChild(button);
        })
        Object.values(masterNavigation).forEach(button => {
          div.appendChild(button);
        })
        return div;
      }
    }
  }

  private clearAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.clearCityScheduleTimeouts(citySchedule);
      citySchedule.queue = [];
    })
    this.persistSchedule();
  }

  public getMasterNavigationButtons(): {
    runAllButton: HTMLButtonElement,
    resetAllButton: HTMLButtonElement,
    deleteAllButton: HTMLButtonElement,
    pauseAllButton: HTMLButtonElement,
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

    runAllButton.addEventListener('click', () => {
      for (const citySchedule of this.queue) {
        this.runScheduleIfNotRunning(citySchedule);
      }
      this.setUITableStatuses('running');
      if (this.isTableOpened()) {
        // this.rehydrateTable();
      }
    })
    resetAllButton.addEventListener('click', () => {
      this.rerunAllSchedules();
      if (this.isTableOpened()) {
        // this.rehydrateTable();
        this.setUITableStatuses('running');
      }
    })
    deleteAllButton.addEventListener('click', () => {
      this.clearAllSchedules();
      if (this.isTableOpened()) {
        this.rehydrateTable();
      }
    })
    pauseAllButton.addEventListener('click', () => {
      this.pauseAllSchedules();
      if (this.isTableOpened()) {
        // this.rehydrateTable();
        this.setUITableStatuses('idle');
      }
    })

    return {
      runAllButton,
      resetAllButton,
      deleteAllButton,
      pauseAllButton,
    }
  }

  public getQueueNavigationButtons(queueIdentifier: CityInfo | CitySchedule): {
    runThisButton: HTMLButtonElement,
    restartThisButton: HTMLButtonElement,
    pauseThisButton: HTMLButtonElement,
    deleteThisButton: HTMLButtonElement,
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
      if (citySchedule && !citySchedule.currentAction) {
        this.runNextAction(citySchedule)
      };
      if (this.isTableOpened()) {
        this.setUITableStatuses('running', citySchedule);
        // this.rehydrateTable();
      }
    })
    restartThisButton.addEventListener('click', () => {
      if (citySchedule) {
        this.clearCityScheduleTimeouts(citySchedule);
        this.runNextAction(citySchedule);
        if (this.isTableOpened()) {
          // this.rehydrateTable();
          this.setUITableStatuses('running', citySchedule);
        }
      }
    })
    pauseThisButton.addEventListener('click', () => {
      console.log('pauseThisButton clicked, schedule:', citySchedule);
      if (citySchedule) {
        console.log('should clear city schedule action');
        this.clearCityScheduleTimeouts(citySchedule);
        if (this.isTableOpened()) {
          // this.rehydrateTable();
          this.setUITableStatuses('idle', citySchedule);
        }
      }
    })
    deleteThisButton.addEventListener('click', () => {
      this.clearScheduleActionForCity(citySchedule.city);
      this.rerenderAllUIQueues();
      if (this.isTableOpened()) {
        this.rehydrateTable();
      }
    })

    return {
      runThisButton,
      restartThisButton,
      pauseThisButton,
      deleteThisButton,
    }
  }

  private pauseAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.clearCityScheduleTimeouts(citySchedule);
    })
  }

  private simpleScheduleLoadConfirmationDialog(cityScheduleList: CitySchedule[]) {
    let message = `Czy chcesz kontynuować poprzednią sesje rekrutacji?`;
    cityScheduleList.forEach(citySchedule => {
      if (citySchedule.queue.length) {
        message += `\n${citySchedule.city.name}:\n${citySchedule.queue.map(q => {
          switch (q.itemType) {
            case 'recruiter':
              const queueItem = q.itemDetails as RecruiterQueueItem;
              const unitName = queueItem.unitContextInfo.unitSelector.split('.').at(-1);
              return `\t${unitName} x ${queueItem.amountLeft} ${queueItem.amountType === 'slots' ? 'slotów' : 'jednostek'}`
            case 'builder':
              const builderItem = q.itemDetails as BuilderQueueItem;
              return `\t${builderItem.building.name} -> ${builderItem.toLvl}`
          }
        }).join('\n')}`;
      }
    })
    const confirm = window.confirm(message);
    return confirm;
  }

  public getScheduledActionTimes() {
    return this.queue.flatMap(citySchedule => {
      return [citySchedule.timeoutData.executionTime].concat(Object.values(citySchedule.nonBlockingQueueComplex).map(item => item.timeoutData.executionTime));
    }).filter(Boolean) as number[]
    // return this.queue.map(citySchedule => citySchedule.timeoutData.executionTime).filter(Boolean) as number[]
  }

  public handleMasterQueueConfigChange(configChange: TConfigChanges['masterQueue']) {
    if (configChange.autoReevaluate) {
      this.reevaluateProviderCities();
    }
  }

  /**
   * Removes item from queue by id or reference. If item was first in queue its scheduled operation will be canceled.
   * @param city - city to remove item from
   * @param identifier - either item id (string) or queue item reference
   */
  public removeItem(city: CityInfo, identifier: string | QueueItem): void {
    const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) return;

    const itemIndex = typeof identifier === "string"
      ? citySchedule.queue.findIndex(item => item.id === identifier)
      : citySchedule.queue.findIndex(item => item === identifier);

    if (itemIndex === -1) return;

    if (itemIndex === 0) {
      this.clearCityScheduleTimeouts(citySchedule);
    }

    citySchedule.queue.splice(itemIndex, 1);
    this.persistSchedule();
  }

  public unshiftAndRun(city: CityInfo, item: Omit<QueueItem, 'id'>) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = this.addToQueue(city, item);
    } else {
      this.clearCityScheduleTimeouts(citySchedule);

      citySchedule.queue.unshift({
        id: crypto.randomUUID(),
        ...item
      });
    }
    this.persistSchedule();
    this.runNextAction(citySchedule);
  }

  public shareCityResources(city: CityInfo) {
    this.resourcesWhiteList.push(city);
    this.reevaluateProviderCities();
  }

  private removeCityFromSupplierCityList(city: CityInfo) {
    const lengthBefore = this.resourcesWhiteList.length;
    this.resourcesWhiteList = this.resourcesWhiteList.filter(city => city.name !== city.name);
    const lengthAfter = this.resourcesWhiteList.length;
    // if (lengthBefore !== lengthAfter) {
    //   this.reevaluateProviderCities();
    // }
  }
}
