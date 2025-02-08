/*
Funkcjonalności do zrobienia:
-start all - powinno uruchamiać wszystkie kolejki ale nie naraz, tylko jedna po drugiej - naprawić
-jeżeli kolejka buildera/recruiter jest pełna, a następny element musi czekać na miejsce w kolejce - udostępnj surowce
  -w momencie wywołania metody uruchamiającej element musi być znana liczba pustych slotów w kolejce
  -może to być wykonane podczas zakończenia poprzedniego elementu za pomocą callbacku z informacjązwrotną
  -ale jeżeli kolejka startuje (więc nie ma poprzedniego elementu) to może to być przekazane w callbacku setTimeout jako informacja o tym do czego służy timeout

-status kolejki - nie updatuje się gdy kolejka miastowa się zacieła - naprawić
 */

import gpsConfig from "../../../gps.config";
import { TConfigChanges } from "../../config-popup/config-popup";
import ConfigManager from "../../utility/config-manager";
import ResourceLock from "../../utility/resource-lock";
import { IService } from "../../utility/Service";
import { Building } from "../city/builder/buildings";
import CityBuilder, { BuilderQueueItem } from "../city/builder/city-builder";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import Recruiter, { RecruiterQueueItem } from "../recruiter/recruiter";
import masterQueueCss from './master-queue.css';
import masterQueueTableCss from './master-queue-table.css';
import masterQueueTableHtml from './master-queue-table.prod.html';

type QueueItemDetails = (RecruiterQueueItem | BuilderQueueItem) & {
  supplierCities: CityInfo[];
  maxShipmentTime: number
};

export type TimeoutPurpose = 'slot' | 'resources' | 'charms' | 'other';

export type ScheduleOperationDetails<T> = {
  id: string;
  city: CityInfo;
  queueItem: T;
  onFinishCallback: () => void;
  // setScheduleTimeout: (timeoutId: NodeJS.Timeout, nextScheduleDate: number) => void;
  setScheduleTimeout: (
    operationCallback: () => Promise<void> | void,
    timeToExecution: number,
    purpose: TimeoutPurpose) => void;
  shiftQueueAndNext: () => void;
}

export type QueueItem = {
  id: string;
  itemType: 'recruiter' | 'builder';
  itemDetails: QueueItemDetails
}

export type CitySchedule = {
  city: CityInfo;
  queue: QueueItem[];
  currentAction?: 'recruiter' | 'builder' | null;
  timeoutId?: NodeJS.Timeout | null;
  scheduleDate?: Date | null;
  timeoutData?: {
    timeoutId: NodeJS.Timeout;
    executionTime: number;
    purpose: TimeoutPurpose;
  } | null;
}


export default class MasterQueue implements IService {
  private static readonly TABLE_ID = 'master-queue-table';
  private static readonly TABLE_EMPTY_ID = 'master-queue-table-empty';
  private static readonly TABLE_FOOTER_ID = 'master-queue-table-footer';
  private static readonly TABLE_TOGGLE_BUTTON_ID = 'master-queue-table-toggle-button';
  private static readonly TABLE_CLOSE_BUTTON_ID = 'master-queue-table-close-button';

  private static readonly LOCAL_STORAGE_KEY = 'master-queue';
  private config!: typeof gpsConfig;
  private initialized: boolean = false;
  private queue: CitySchedule[];
  private recruiter!: Recruiter;
  private builder!: CityBuilder;
  private citySwitchManager!: CitySwitchManager;
  private resourceLock!: ResourceLock;
  private RUN: boolean = false;
  private resourceLockChangeListener?: (city: CityInfo) => void;
  private cityChangeListener?: (city: CityInfo) => void;
  private resourcesWhiteList: CityInfo[] = [];

  private constructor() {
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

  private async init() {
    // TODO: maybe don't initialize but everytime call `await Recruiter.getInstance().execute(...)` ?
    this.recruiter = await Recruiter.getInstance();
    this.builder = await CityBuilder.getInstance();
    this.loadSchedule();
    this.addCSS();
    this.addTable();
    this.initialized = true;
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
    const table = document.getElementById(MasterQueue.TABLE_ID)!;
    const tableFooter = document.querySelector<HTMLElement>(`#${MasterQueue.TABLE_FOOTER_ID}`)!;
    this.getNavigation('master', tableFooter);
    document.querySelector<HTMLButtonElement>(`#${MasterQueue.TABLE_TOGGLE_BUTTON_ID}`)!.addEventListener('click', () => {
      if (table.hidden) {
        this.rehydrateTable();
        table.hidden = false;
      } else {
        table.hidden = true;
      }
    });
    document.getElementById(MasterQueue.TABLE_CLOSE_BUTTON_ID)!.addEventListener('click', () => {
      table.hidden = true;
    });
  }

  private rehydrateTable() {
    // NOTE: on rework replace tbody with div.tbody
    // TODO: also wtf is this? why this check?
    const tableBody = document.querySelector<HTMLTableSectionElement>(`#${MasterQueue.TABLE_ID} tbody`);
    if (!tableBody) return;

    const isTableEmpty = this.queue.filter(citySchedule => citySchedule.queue.length > 0).length === 0;
    const tableFooter = document.getElementById(MasterQueue.TABLE_FOOTER_ID)!;
    if (isTableEmpty) {
      tableFooter.hidden = true;
    } else {
      tableFooter.hidden = false;
    }

    // TODO: on table rework replace tr and td with `div.tr` and `div.td`
    // NOTE: or have all elements created first in array, then clear and then add
    // first clear table
    tableBody.innerHTML = `
    <tr id="master-queue-table-empty" ${isTableEmpty ? '' : 'hidden'}>
      <td colspan="4" style="padding: 12px;" align="center">No schedules</td>
    </tr>`;

    // then hydrate table
    // TODO: on table rework replace td/tr with `div.td` and `div.tr`
    for (const citySchedule of this.queue) {
      if (citySchedule.queue.length === 0) continue;
      const row = document.createElement('tr');
      row.dataset.city = citySchedule.city.name;

      // city Cell
      const cityCell = document.createElement('td');
      cityCell.textContent = citySchedule.city.name;
      row.appendChild(cityCell);

      // queue Cell
      const queueCell = document.createElement('td');
      const queueCellContent = document.createElement('div');
      queueCellContent.classList.add('queue-cell');
      this.createUIQueueItems(queueCellContent, citySchedule);
      queueCell.appendChild(queueCellContent);
      row.appendChild(queueCell);

      // state Cell
      const stateCell = document.createElement('td');
      stateCell.classList.add('master-queue-state');
      stateCell.classList.add(citySchedule.currentAction ? 'running' : 'idle');
      stateCell.textContent = citySchedule.currentAction ? 'Running' : 'Idle';
      row.appendChild(stateCell);

      // actions Cell
      const actionsCell = document.createElement('td');
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
    const toggleButton = document.getElementById(`${MasterQueue.TABLE_TOGGLE_BUTTON_ID}`)!;
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
      this.clearCityScheduleAction(citySchedule);
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

  public addToQueue(city: CityInfo, itemType: 'recruiter' | 'builder', queueItem: QueueItemDetails) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = {
        city,
        queue: [{
          id: crypto.randomUUID(),
          itemType: itemType,
          itemDetails: queueItem
        }],
      }
      this.queue.push(citySchedule);
    } else {
      citySchedule.queue.push({
        id: crypto.randomUUID(),
        itemType: itemType,
        itemDetails: queueItem
      });
    }

    this.reevaluateProviderCities(citySchedule);
    this.rerenderAllUIQueues(citySchedule);
    if (this.isTableOpened()) {
      this.rehydrateTable();
    }
    this.persistSchedule();

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
      this.clearCityScheduleAction(citySchedule);
      // run next action
      this.runNextAction(citySchedule);
    })
  }

  public clearCitySchedule(city: CityInfo) {
    this.queue = this.queue.filter(citySchedule => {
      if (citySchedule.city.name === city.name) {
        this.clearCityScheduleAction(citySchedule);
        return false;
      }
      return true;
    });
    this.persistSchedule();
  }

  private clearCityScheduleAction(citySchedule: CitySchedule) {
    citySchedule.currentAction = null;
    citySchedule.scheduleDate = null;
    clearTimeout(citySchedule.timeoutId ?? undefined);
    clearInterval(citySchedule.timeoutId ?? undefined);
    citySchedule.timeoutId = null;
  }

  public async rerunAllSchedules() {
    for (const citySchedule of this.queue) {
      // reset info holders
      this.clearCityScheduleAction(citySchedule);
      // run next action
      await this.runNextAction(citySchedule);
    }
  }

  private runScheduleIfNotRunning(citySchedule: CitySchedule) {
    if (citySchedule.currentAction || citySchedule.timeoutId) return;
    this.runNextAction(citySchedule);
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
    if (citySchedule.currentAction === 'builder') {
      await this.builder.execute(
        {
          id: nextQueueItem.id,
          city: citySchedule.city,
          queueItem: nextQueueItem.itemDetails as BuilderQueueItem,
          onFinishCallback: () => { this.shiftQueueAndRunNext(citySchedule) },
          setScheduleTimeout: (operationCallback: () => Promise<void> | void, timeToExecution: number, purpose: TimeoutPurpose) => { this.setScheduleTimeout(citySchedule, operationCallback, timeToExecution, purpose) },
          shiftQueueAndNext: () => { this.shiftQueueAndRunNext(citySchedule) }
        } as ScheduleOperationDetails<BuilderQueueItem>
      );
    } else if (citySchedule.currentAction === 'recruiter') {
      await this.recruiter.execute(
        {
          id: nextQueueItem.id,
          city: citySchedule.city,
          queueItem: nextQueueItem.itemDetails as RecruiterQueueItem,
          onFinishCallback: () => { this.shiftQueueAndRunNext(citySchedule) },
          setScheduleTimeout: (operationCallback: () => Promise<void> | void, timeToExecution: number, purpose: TimeoutPurpose) => { this.setScheduleTimeout(citySchedule, operationCallback, timeToExecution, purpose) },
          shiftQueueAndNext: () => { this.shiftQueueAndRunNext(citySchedule) }
        } as ScheduleOperationDetails<RecruiterQueueItem>
      );
    }
    // END run next action
  }

  /**
   * Shifts queue, clears timeout and resets current action and schedule date. 
   * Reevaluates provider cities if autoRevalidate is enabled.
   * @param schedule - city schedule to shift
   */
  private shiftQueueCleanAndPersist(schedule: CitySchedule) {
    schedule.queue.shift();
    this.clearCityScheduleAction(schedule);
    this.reevaluateProviderCities(schedule);
    this.persistSchedule();
    this.rerenderAllUIQueues(schedule);
    if (this.isTableOpened()) {
      this.rehydrateTable();
    }
  }

  private shiftQueueAndClearCallbacks(schedule: CitySchedule) {
    schedule.queue.shift();
    this.clearCityScheduleAction(schedule);
  }

  /**
   * Sets specified status for all table rows or for specified city schedule row.
   * @param status - status to set
   * @param citySchedule - city schedule to set status for
   */
  private setUITableStatuses(status: 'idle' | 'running', citySchedule?: CitySchedule) {
    const table = document.getElementById(MasterQueue.TABLE_ID)!;
    if (!citySchedule) {
      table.querySelectorAll<HTMLTableRowElement>('tr .master-queue-state').forEach(statusCell => {
        statusCell.classList.remove('idle', 'running');
        statusCell.classList.add(status);
        statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      })
    } else {
      // TODO: on table rework replace tr with `div.tr` because there will be miration from native table api
      const statusCell = table.querySelector<HTMLTableRowElement>(`tr[data-city="${citySchedule.city.name}"] .master-queue-state`);
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
    timeToExecution: number,
    purpose: TimeoutPurpose
  ) {
    if (purpose === 'slot' || purpose === 'charms') {
      if (timeToExecution - Date.now() > 1000 * 60 * 30) {
        this.addCityToSuppliersList(citySchedule.city);
        this.reevaluateProviderCities();
      }
    }

    // creating timeout that will execute operationCallback and remove city from suppliers list
    const timeoutId = setTimeout(async () => {
      if (purpose === 'slot' || purpose === 'charms') {
        this.removeCityFromSupplierCityList(citySchedule.city);
        // NOTE: rethink if reevaluation there is optimal and necessary
        this.reevaluateProviderCities();
      }
      await operationCallback();
    }, timeToExecution);


    // NOTE: to be deleted later when migrated to new timeout system
    citySchedule.timeoutId = timeoutId;
    citySchedule.scheduleDate = new Date(Date.now() + timeToExecution);
    // END NOTE

    // TODO: ensure its cleared on timeout clear
    citySchedule.timeoutData = {
      timeoutId,
      executionTime: Date.now() + timeToExecution,
      purpose
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
          ${item.itemType === 'builder' ? (item.itemDetails as BuilderQueueItem).toLvl : ''}
        </div>
        <div class="master-queue-item-image ${item.itemType === 'recruiter'
          ? `${(item.itemDetails as RecruiterQueueItem).unitContextInfo.unitImageClass}`
          : ''}" 
          style="${item.itemType === 'builder'
          ? `background-image: ${(item.itemDetails as BuilderQueueItem).building.backgroundImageProp};`
          : ''}"
        >
        </div>
        <div class="master-queue-item-info">
          <span class="desc1">
          ${(() => {
          switch (item.itemType) {
            case 'recruiter':
              return (item.itemDetails as RecruiterQueueItem).unitContextInfo.unitImageClass.split(' ')[1];
            case 'builder':
              return (item.itemDetails as BuilderQueueItem).building.name;
            default:
              return null;
          }
        })()}
          </span>
          ${(() => {
          switch (item.itemType) {
            case 'recruiter':
              return `<span class="desc2">${(item.itemDetails as RecruiterQueueItem).amountLeft + 'x ' + (item.itemDetails as RecruiterQueueItem).amountType}</span>`;
            default:
              return '';
          }
        })()}
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
        if (citySchedule?.timeoutId) {
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

    // post delete action depending on item type
    switch (item.itemType) {
      case 'builder':
        // this.revalidateBuilderQueueItemLevels((item.itemDetails as BuilderQueueItem).building, queueIndex, citySchedule);
        const itemsToRevalidate = citySchedule.queue
          .filter((item, index) => index >= queueIndex && item.itemType === 'builder')
          .map(item => item.itemDetails as BuilderQueueItem);
        this.builder.revalidateQueueItemLevels((item.itemDetails as BuilderQueueItem).building, queueIndex, itemsToRevalidate);
        break;
      case 'recruiter':
        // nothing to do here, just semantics
        break;
    }
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
        .map(citySchedule => ({
          city: citySchedule.city,
          queue: citySchedule.queue
        }))
    ));
  }

  private isTableOpened = () => {
    return document.getElementById('master-queue-table')?.hidden === false;
  }

  // TODO: hydrate schedule from local storage and add load method in ~constructor
  private loadSchedule() {
    const schedule = localStorage.getItem(MasterQueue.LOCAL_STORAGE_KEY);
    if (schedule) {
      const parsedQueue: CitySchedule[] = JSON.parse(schedule);
      const hydratedQueue = this.hydrateSchedule(parsedQueue);
      this.queue = hydratedQueue;
    } else {
      this.queue = [];
    }
  }

  private hydrateSchedule(schedule: CitySchedule[]) {
    return schedule.map(citySchedule => {
      const city = this.citySwitchManager.getCityByName(citySchedule.city.name);
      if (!city) return null;

      citySchedule.city = city;
      citySchedule.queue.forEach(queueItem => {

        queueItem.itemDetails.supplierCities = queueItem.itemDetails.supplierCities
          .map(city => this.citySwitchManager.getCityByName(city.name) ?? null)
          .filter(Boolean) as CityInfo[];

        switch (queueItem.itemType) {
          case 'recruiter':
            // NOTE: for semantics
            break;
          case 'builder':
            // TODO: implement later additional hydration
            break;
        }
      });
      return citySchedule;
    }).filter(Boolean) as CitySchedule[];
  }


  private simpleConfirmationDialog(message: string) {
    return window.confirm(message);
  }

  public revalidateBuilderQueueItemLevels(building: Building, fromIndex: number, citySchedule: CitySchedule) {
    // NOTE: ponieważ wszystkie elementy zostają renderowane na nowo, nie ma co tworzyć `data-id` itp
    citySchedule.queue.forEach((item, index) => {
      if (index >= fromIndex && item.itemType === 'builder') {
        const builderItem = item.itemDetails as BuilderQueueItem;
        if (builderItem.building.name === building.name) {
          builderItem.toLvl--;
        }
      }
    })
  }

  public getBuilderScheduleForCity(city: CityInfo): BuilderQueueItem[] {
    return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue
      .filter(item => item.itemType === 'builder')
      .map(item => item.itemDetails) as BuilderQueueItem[]
      ?? [];
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
      this.clearCityScheduleAction(citySchedule);
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
        this.clearCityScheduleAction(citySchedule);
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
        this.clearCityScheduleAction(citySchedule);
        if (this.isTableOpened()) {
          // this.rehydrateTable();
          this.setUITableStatuses('idle', citySchedule);
        }
      }
    })
    deleteThisButton.addEventListener('click', () => {
      this.clearCitySchedule(citySchedule.city);
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
      this.clearCityScheduleAction(citySchedule);
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

  public getMasterQueueScheduleTimes() {
    return this.queue.map(citySchedule => citySchedule.scheduleDate).filter(Boolean).map(date => date!.getTime());
  }

  public handleMasterQueueConfigChange(configChange: TConfigChanges['masterQueue']) {
    if (configChange.autoReevaluate) {
      this.reevaluateProviderCities();
    }
  }

  /**
   * Removes item from queue by id. If item was first in queue its scheduled operatin will be canceled.
   * CAUTION: It will not autimatically 
   * @param city - city to remove item from
   * @param id - id of the item to remove
   */
  public removeItemById(city: CityInfo, id: string) {
    const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) return;
    const itemsIndex = citySchedule.queue.findIndex(item => item.id === id);
    if (itemsIndex === -1) return;
    if (itemsIndex === 0) {
      this.clearCityScheduleAction(citySchedule);
    }
    citySchedule.queue.splice(itemsIndex, 1);
    this.persistSchedule();
  }

  public unshiftAndRun(city: CityInfo, itemType: 'recruiter' | 'builder', itemDetails: RecruiterQueueItem | BuilderQueueItem) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = this.addToQueue(city, itemType, itemDetails);
    } else {
      this.clearCityScheduleAction(citySchedule);

      citySchedule.queue.unshift({
        id: crypto.randomUUID(),
        itemType,
        itemDetails
      });
    }
    this.persistSchedule();
    this.runNextAction(citySchedule);
  }

  public shareCityResources(city: CityInfo) {
    this.resourcesWhiteList.push(city);
    this.reevaluateProviderCities();
  }


  private async decideIfCityShouldBeSupplier(citySchedule: CitySchedule) {
    const nextItem = citySchedule.queue[0];
    const { isRealQueueFull, timeToFreeSlot } = nextItem.itemType === 'builder'
      ? await this.builder.isRealQueueFull(citySchedule.city)
      : await this.recruiter.isRealQueueFull((nextItem.itemDetails as RecruiterQueueItem).type, citySchedule.city);

    // oznacza, że nastepny element musi czekać na zwolnienie miejsca w kolejce - więc może udostępnić swoje zasoby w tym czasie
    if (isRealQueueFull) {
      const timeToCallback = Date.now() - timeToFreeSlot;

      if (timeToCallback > 1000 * 60 * 20) {
        if (!this.resourcesWhiteList.map(city => city.name).includes(citySchedule.city.name)) {
          this.resourcesWhiteList.push(citySchedule.city);
        }
      } else {
        // const lengthBefore = this.resourcesWhiteList.length;
        this.resourcesWhiteList = this.resourcesWhiteList.filter(city => city.name !== city.name);
        // const lengthAfter = this.resourcesWhiteList.length;
      }
    }
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