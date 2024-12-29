import { scheduler } from "timers/promises";
import gpsConfig from "../../../gps.config";
import { Building } from "../city/builder/buildings";
import CityBuilder, { BuilderQueueItem } from "../city/builder/city-builder";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import Recruiter, { RecruiterQueueItem } from "../recruiter/recruiter";
import ConfigManager from "../../utility/config-manager";
import ResourceLock from "../../utility/resource-lock";
import masterQueueCss from './master-queue.css';
import { IService } from "../../utility/Service";
import { TConfigChanges } from "../../config-popup/config-popup";

/*
Każdy manager, któremu zależy na kolejności i sychronizacji z innymi elementami
może się kolejkować w tej kolejce. Jeżeli kolejność nie odgrywa roli nie musi korzystać.

-Każdy item posiada callbacka do wywołania swojego flow.
  :Manger odustepnia API "execute()", który wrappuje actionCallbacka, by zapisać jego timeout jako props (do poźniejszgo wstrzymwania)
*/

type QueueItemDetails = (RecruiterQueueItem | BuilderQueueItem) & {
  supplierCities: CityInfo[];
  maxShipmentTime: number
};

export type ScheduleOperationDetails = {
  city: CityInfo;
  queueItem: RecruiterQueueItem;
  onFinishCallback: () => void;
  setScheduleTimeout: (timeoutId: NodeJS.Timeout, nextScheduleDate: number) => void;
  shiftQueueAndNext: () => void;
}

export type QueueItem = {
  itemType: 'recruiter' | 'builder';
  itemDetails: QueueItemDetails
}

export type CitySchedule = {
  city: CityInfo;
  queue: QueueItem[];
  currentAction?: 'recruiter' | 'builder' | null;
  timeoutId?: NodeJS.Timeout | null;
  scheduleDate?: Date | null;
}


export default class MasterQueue implements IService {
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
    // TODO: maybe don't initialize but everrytime call `await Recruiter.getInstance().execute(...)` ?
    this.recruiter = await Recruiter.getInstance();
    this.builder = await CityBuilder.getInstance();
    this.loadSchedule();
    this.addCSS();
    this.initialized = true;
  }

  private addCSS() {
    const style = document.createElement('style');
    style.textContent = masterQueueCss;
    document.head.appendChild(style);
  }

  public isRunning() {
    return this.RUN;
  }

  public async start() {
    this.RUN = true;
    this.addResourceLockChangeListener();
  }

  public async stop() {
    this.RUN = false;
    if (this.resourceLockChangeListener) {
      this.resourceLock.removeListener('resource-lock-change', this.resourceLockChangeListener);
    }
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

  public addToQueue(city: CityInfo, itemType: 'recruiter' | 'builder', queueItem: QueueItemDetails) {
    let citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) {
      citySchedule = {
        city,
        queue: [{
          itemType: itemType,
          itemDetails: queueItem
        }],
      }
      this.queue.push(citySchedule);
    } else {
      citySchedule.queue.push({
        itemType: itemType,
        itemDetails: queueItem
      });
    }
    this.reevaluateProviderCities(citySchedule);
    this.persistSchedule();
  }



  public runSchedule(city: CityInfo) {
    const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);
    if (!citySchedule) return;
    this.runNextAction(citySchedule);
  }

  public restartAllSchedules() {
    this.queue.forEach(citySchedule => {
      // reset info holders
      this.clearCityScheduleInfoHolders(citySchedule);
      // run next action
      this.runNextAction(citySchedule);
    })
  }

  public clearCitySchedule(city: CityInfo) {
    this.queue = this.queue.filter(citySchedule => {
      if (citySchedule.city.name === city.name) {
        this.clearCityScheduleInfoHolders(citySchedule);
        return false;
      }
      return true;
    });
    this.persistSchedule();
  }

  private clearCityScheduleInfoHolders(citySchedule: CitySchedule) {
    citySchedule.currentAction = null;
    citySchedule.scheduleDate = null;
    clearTimeout(citySchedule.timeoutId ?? undefined);
    citySchedule.timeoutId = null;
  }

  public safeRunAllSchedules() {
    this.queue.forEach(citySchedule => {
      // reset info holders
      this.clearCityScheduleInfoHolders(citySchedule);
      // run next action
      this.runNextAction(citySchedule);
    })
  }

  private async shiftQueueQndRunNext(citySchedule: CitySchedule) {
    // clean info holders
    this.shiftQueue(citySchedule);

    // run next action
    await this.runNextAction(citySchedule);
  }

  private async runNextAction(citySchedule: CitySchedule) {
    // run next action
    const nextQueueItem = citySchedule?.queue[0];
    if (!nextQueueItem) return;

    citySchedule.currentAction = nextQueueItem.itemType;
    citySchedule.scheduleDate = new Date();

    // TODO: call proper method from specific service API
    /**
     * Flow wywołuje metodę odpowiedniego managera przekazując mu:
     * @param queueItem - na którym jest wywołana
     * @param onFinishCallback - callback który zostaje wywołany po zakończeniu działania (by kolejka wiedziała kiedy zacząć działanie na następnym elemencie)
     * @param setScheduleTimeout - callback który ustawia timeout i datę następnego wywołania, jeżeli item ma timeout
     */
    if (citySchedule.currentAction === 'builder') {
      // TODO: implement later
      // await this.builder.performNext(
      //   nextQueueItem.item as BuilderQueueItem,
      //   () => { this.cleanAndRunNext(city) },
      //   (timeoutId: NodeJS.Timeout, nextScheduleDate: Date) => { this.setScheduleTimeout(city, timeoutId, nextScheduleDate) }
      // );
    } else if (citySchedule.currentAction === 'recruiter') {
      await this.recruiter.execute(
        {
          city: citySchedule.city,
          queueItem: nextQueueItem.itemDetails as RecruiterQueueItem,
          onFinishCallback: () => { this.shiftQueueQndRunNext(citySchedule) },
          setScheduleTimeout: (timeoutId: NodeJS.Timeout, nextScheduleDate: number) => { this.setScheduleTimeout(citySchedule, timeoutId, nextScheduleDate) },
          shiftQueueAndNext: () => { this.shiftQueueQndRunNext(citySchedule) }
        } as ScheduleOperationDetails
      );
    }
    // END run next action
  }

  /**
   * Shifts queue, clears timeout and resets current action and schedule date. 
   * Reevaluates provider cities if autoRevalidate is enabled.
   * @param schedule - city schedule to shift
   */
  private shiftQueue(schedule: CitySchedule) {
    schedule.queue.shift();
    this.clearCityScheduleInfoHolders(schedule);
    this.reevaluateProviderCities(schedule);
    this.persistSchedule();
  }

  private reevaluateProviderCities(schedule?: CitySchedule) {
    if (this.config.masterQueue.autoReevaluate) {
      // jeżeli w kolejce jest 0 lub 1 elementów, to znaczy że to potencjalnie punkt krytyczny gdy trzeba rewaluować dostawców
      if (!([0, 1].includes(schedule?.queue?.length ?? -1))) return;

      const queuedCities = this.queue.filter(citySchedule => citySchedule.queue.length > 0);
      const queuedCityNames = queuedCities.map(citySchedule => citySchedule.city.name);
      const lockedCityNames = this.resourceLock.getLockList().map(city => city.name);
      const providerCities = this.citySwitchManager.getCityList().filter(city => !queuedCityNames.includes(city.name) && !lockedCityNames.includes(city.name));
      this.queue.forEach(citySchedule => {
        citySchedule.queue.forEach(item => {
          item.itemDetails.supplierCities = providerCities;
        })
      })
    }
  }

  private setScheduleTimeout(citySchedule: CitySchedule, timeoutId: NodeJS.Timeout, nextScheduleDate: number) {
    citySchedule.timeoutId = timeoutId;
    citySchedule.scheduleDate = new Date(nextScheduleDate);
  }

  public getBusyCities() {
    return this.queue.filter(citySchedule => citySchedule.queue.length > 0).map(citySchedule => citySchedule.city);
  }

  public getCityRecruiterSchedule(city: CityInfo): RecruiterQueueItem[] {
    return this.queue.find(citySchedule => citySchedule.city.name === city.name)?.queue.filter(item => item.itemType === 'recruiter').map(item => item.itemDetails) as RecruiterQueueItem[];
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
   * @param citySchedule - city schedule to rerender
   */
  private rerenderAllUIQueues(citySchedule: CitySchedule) {
    document.querySelectorAll('.master-queue').forEach(el => {
      el.innerHTML = '';
      this.createUIQueueItems(el as HTMLElement, citySchedule);
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
          ${item.itemType === 'builder' ? (item.itemDetails as BuilderQueueItem).toLvl : null}
        </div>
        <div class="master-queue-item-image" 
          style="${item.itemType === 'builder'
          ? `background-image: ${(item.itemDetails as BuilderQueueItem).building.backgroundImageProp};`
          : null}"
          class="${item.itemType === 'recruiter'
          ? `${(item.itemDetails as RecruiterQueueItem).unitContextInfo.unitImageClass}`
          : null}"
        >
        </div>
        <div class="master-queue-item-info">
          <span class="desc1">
          ${(() => {
          switch (item.itemType) {
            case 'recruiter':
              return (item.itemDetails as RecruiterQueueItem).unitContextInfo.unitSelector.split('.')[1];
            case 'builder':
              return (item.itemDetails as BuilderQueueItem).building.name;
            default:
              return null;
          }
        })()}
          </span>
          <span class="desc2">${item.itemType === 'recruiter' && (item.itemDetails as RecruiterQueueItem).amountLeft + 'x ' + (item.itemDetails as RecruiterQueueItem).amountType}</span>
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
          // TODO: wrong - or not?? maybe it's ok
          // this.shiftQueueQndRunNext(citySchedule);
          this.shiftQueue(citySchedule);
          shouldRunNext = true;
        } else {
          // jeżeli nie ma timeouta (czyli manager nie wykonuje żadnej scheudowanej operacji np. nie wystartował)
          this.shiftQueue(citySchedule);
        }
      } else {
        // && jeżeli nie ma więcej elementów w kolejce
        this.shiftQueue(citySchedule);
      }
    } else {
      // w przeciwnym wypadku (nie pierwszy element)
      citySchedule.queue.splice(queueIndex, 1);
    }

    // post delete action depending on item type
    switch (item.itemType) {
      case 'builder':
        this.revalidateBuilderQueueItemLevels((item.itemDetails as BuilderQueueItem).building, queueIndex, citySchedule);
        break;
      case 'recruiter':
        // nothing to do here, just semantics
        break;
    }
    this.persistSchedule();
    // TODO: posssibly remove event listener from dead button (probably garbage collection will do it)
    // deleteBtn.removeEventListener('click', onDeleteClick)
    this.rerenderAllUIQueues(citySchedule);

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
    schedule.forEach(citySchedule => {
      citySchedule.city = this.citySwitchManager.getCityByName(citySchedule.city.name)!;
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
    });
    return schedule;
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

  public getQueueNavigation(city: CityInfo) {
    const container = document.createElement('div');
    container.classList.add('master-queue-navigation');
    const {
      runThisButton,
      resetThisButton,
      clearThisButton,
      runAllButton,
      resetAllButton,
      clearAllButton
    } = this.getQueueNavigationButtons(city);

    container.appendChild(runThisButton);
    container.appendChild(resetThisButton);
    container.appendChild(clearThisButton);
    container.appendChild(runAllButton);
    container.appendChild(resetAllButton);
    container.appendChild(clearAllButton);

    return container;
  }

  private clearAllSchedules() {
    this.queue.forEach(citySchedule => {
      this.clearCityScheduleInfoHolders(citySchedule);
      citySchedule.queue = [];
    })
    this.persistSchedule();
  }
  public getQueueNavigationButtons(city: CityInfo): {
    runThisButton: HTMLButtonElement,
    resetThisButton: HTMLButtonElement,
    clearThisButton: HTMLButtonElement,
    runAllButton: HTMLButtonElement,
    resetAllButton: HTMLButtonElement,
    clearAllButton: HTMLButtonElement,
  } {
    const runThisButton = document.createElement('button');
    const resetThisButton = document.createElement('button');
    const clearThisButton = document.createElement('button');
    const runAllButton = document.createElement('button');
    const resetAllButton = document.createElement('button');
    const clearAllButton = document.createElement('button');

    runThisButton.textContent = 'Run this';
    resetThisButton.textContent = 'Reset this';
    clearThisButton.textContent = 'Clear this';
    runAllButton.textContent = 'Run all';
    resetAllButton.textContent = 'Reset all';
    clearAllButton.textContent = 'Clear all';

    runThisButton.classList.add('run-this-button');
    resetThisButton.classList.add('reset-this-button');
    clearThisButton.classList.add('clear-this-button');
    runAllButton.classList.add('run-all-button');
    resetAllButton.classList.add('reset-all-button');
    clearAllButton.classList.add('clear-all-button');

    const citySchedule = this.queue.find(schedule => schedule.city.name === city.name);

    runThisButton.addEventListener('click', () => {
      citySchedule && this.runNextAction(citySchedule);
    })
    resetThisButton.addEventListener('click', () => {
      if (citySchedule) {
        this.clearCityScheduleInfoHolders(citySchedule);
        this.runNextAction(citySchedule);
      }
    })
    clearThisButton.addEventListener('click', () => {
      this.clearCitySchedule(city);
    })
    runAllButton.addEventListener('click', () => {
      this.safeRunAllSchedules();
    })
    resetAllButton.addEventListener('click', () => {
      this.safeRunAllSchedules();
    })
    clearAllButton.addEventListener('click', () => {
      this.clearAllSchedules();
    })

    return {
      runThisButton,
      resetThisButton,
      clearThisButton,
      runAllButton,
      resetAllButton,
      clearAllButton,
    }
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

}