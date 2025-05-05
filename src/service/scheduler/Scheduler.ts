/*
 * Scheduler catch block: Latest operation not found - error stopped sync execution
 */

import { TConfig } from '../../../gps.config';
import { TConfigChanges } from '../../config-popup/config-popup';
import ConfigManager from '../../utility/config-manager';
import { addDelay, HHMMSS_toMS, msToHHMMSS, waitWhile } from '../../utility/plain-utility';
import Service from '../../utility/Service';
import Lock from '../../utility/ui-lock';
import { setInputValue, waitForElement, waitForElementInterval } from '../../utility/ui-utility';
import ArmyMovement from '../army/army-movement';
import CharmsUtility, { CharmDetails } from '../charms/charms-utility';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import MasterManager from '../master/master-manager';
import GeneralInfo from '../master/ui/general-info';

import { SchedulerTableUtility, useSchedulerTable } from './scheduler-table-ui';
import { SchedulerUIExtensionUIUtility, useSchedulerUIExtensionUI } from './scheduler-ui-extension';

export enum OperationType {
  Attack = 'Attack',
  Support = 'Support',
  Withdraw = 'Withdraw',
}

export type AttackStrategy = any;

export type rework_ScheduleItem = {
  id: string;
  operationType: OperationType;
  attackStrategy?: AttackStrategy;
  sourceCity: CityInfo;
  power: CharmDetails | null;
  includeHero: boolean;
  armyDetails: any;
  targetCityDetails: {
    name: string;
    coords: [string, string];
    selector: string;
  };
  timeDetails: {
    // całość w [ms]
    targetTime: number | null; // istnieje gdy konkretna data jest wybrana, w przeciwnym razie jest synchronizedWith
    movementDuration: number; // czas trwania ruchu jednostek
    targetTimeStart: number; // dolna granica tolerancji
    targetTimeDuration: number; // wartość bewzględna tolerancji
    exclusionTime: number; // czas w którym element rozpoczyna całość operacji, jeżeli "switchesOffManagers" to jest to czas ich wyłączeni, else === preparationTime
    exclusionDuration: number; // czas trwania całości operacji
    switchesOffManagers: boolean; // czy musi wyłączyć menadżery w ramach swojej operacji
    preparationTime: number; // czas w którym powinno rozpocząć się wypełnianie pól dla operacji
    executionStartTime: number;
  };
  synchronizedWith?: {
    scheduleId: string;
    deviation: number; // [ms]
  };
  precision?: {
    tolerance: number; // [ms]
    allowedToleranceIfFailed?: number; // [ms]
  };
  movementId: string | null;
  actionTimeout: NodeJS.Timeout | null;
  dependantSchduleItems: { scheduleId: string; deviation: number }[];
};

type DisplayFormattedSchedulerItem = {
  id: string;
  operationType: OperationType;
  attackStrategy?: AttackStrategy;
  sourceCity: Omit<CityInfo, 'switchAction'>;
  power: CharmDetails | null;
  includeHero: boolean;
  armyDetails: any;
  targetCityDetails: {
    name: string;
    coords: [string, string];
    selector: string;
  };
  timeDetails: {
    targetTime: string | null;
    movementDuration: string;
    targetTimeStart: string;
    targetTimeDuration: string;
    exclusionTime: string;
    exclusionDuration: string;
    switchesOffManagers: boolean;

    switchOffManagersTime: string | null;
    preparationTime: string;
    executionStartTime: string;
  };
  synchronizedWith?: {
    scheduleId: string;
    deviation: number;
  };
  precision?: {
    tolerance: number;
    allowedToleranceIfFailed?: number;
  };
  movementId: string | null;
  dependantSchduleItems: { scheduleId: string; deviation: number }[];
};

type rework_PreregisteredScheduleItem = Omit<rework_ScheduleItem, 'timeDetails'> & {
  timeDetails: {
    targetTime: number | null;
    movementDuration: number;
  };
};

export type SchedulerUIExtensionSubmitDetails = {
  timeDetails: {
    targetTime: number | null;
  };
  precision?: {
    tolerance: number;
    allowedToleranceIfFailed?: number;
  };
  syncWith?: {
    scheduleId: string;
    deviation: number;
  };
};

export type SchedulerExecute = (
  item: rework_ScheduleItem,
  utils: {
    successCallback: (landedTime: number, movementId: string) => void;
    failureCallback: (reason?: string) => void;
    assignTimeout: (timeoutId: NodeJS.Timeout) => void;
  },
) => Promise<void> | void;

export interface SchedulerExecutor {
  execute: SchedulerExecute;
}

export default class Scheduler implements Service {
  public static readonly MIN_PRECEDENCE_TIME_MS = 10 * 1000;
  public static readonly TURN_OFF_MANAGERS_TIME_MS = 15 * 1000;
  public static readonly TIME_TO_RESTORE_MANAGERS_AFTER_ACTION = 1000 * 60; // 1min
  public static readonly PREPARATION_TIME_MS = 4 * 1000;

  private static instance: Scheduler;
  private lock!: Lock;
  private generalInfo!: GeneralInfo;
  private masterManager!: MasterManager;
  private config!: TConfig;
  private citySwitchManager!: CitySwitchManager;
  private rework_schedule: rework_ScheduleItem[] = [];
  private landedSchedules: rework_ScheduleItem[] = [];
  private RUN: boolean = false;
  private armyMovement!: ArmyMovement;
  private schedulerUIExtensionUI!: SchedulerUIExtensionUIUtility;
  private schedulerTableUI!: SchedulerTableUtility;
  private cityDialogObserver?: MutationObserver;
  private attackSupportCardObserver?: MutationObserver;

  privateconstructor() {}

  public static async getInstance(): Promise<Scheduler> {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
      Scheduler.instance.lock = Lock.getInstance();
      Scheduler.instance.generalInfo = GeneralInfo.getInstance();
      Scheduler.instance.armyMovement = ArmyMovement.getInstance();
      Scheduler.instance.masterManager = await MasterManager.getInstance();
      Scheduler.instance.citySwitchManager = await CitySwitchManager.getInstance();
      Scheduler.instance.config = ConfigManager.getInstance().getConfig();
      // ui
      Scheduler.instance.schedulerUIExtensionUI = useSchedulerUIExtensionUI();
      Scheduler.instance.schedulerTableUI = useSchedulerTable();
    }
    console.log('Scheduler instance created');
    return Scheduler.instance;
  }

  // service implementation ----------
  public start() {
    if (!this.RUN) {
      this.RUN = true;
      this.mountCityDialogObserver();
      this.loadScheduleFromStorage();
      this.schedulerTableUI.mount({
        scheduleList: this.rework_schedule,
        onCancel: (item: rework_ScheduleItem) => this.removeScheduleItem(item),
      });
      this.rework_schedule.forEach(s => this.activateSchedule(s));
    }
  }
  public async stop() {
    this.RUN = false;
    // ui
    this.schedulerTableUI.unmount();
    this.schedulerUIExtensionUI.unmount();
    // observers
    this.cityDialogObserver?.disconnect();
    this.attackSupportCardObserver?.disconnect();
    // operations:
    this.stopAllSchedules();
  }
  public isRunning(): boolean {
    return this.RUN;
  }
  // TODO:
  getScheduledActionTimes: (() => number[]) | undefined;
  // TODO:
  onConfigChange: ((configChanges: Partial<TConfigChanges>) => void) | undefined;
  // END service implementation --------

  private stopAllSchedules() {
    this.rework_schedule.forEach(e => clearTimeout(e.actionTimeout ?? undefined));
  }

  private stopSchedule(item: rework_ScheduleItem) {
    console.log('stopSchedule.item:', item);
    clearTimeout(item?.actionTimeout ?? undefined);
  }

  /**
   * Wykonawcę ma interesować minimum informacji, wykonawca nie dba o to co ustawiać. Wykonawca robi robotę i zwraca informacje o efekcie swojej pracy.
   * Zakres pracy wykonawcy:
   * -przejście do miasta docelowego
   * -ustawienie pól do operacji + odczekanie
   * -wykonanie operacji w zależności od tego czy opeacja jest precyzyjna czy nie
   * -zwrócenie info o efekcie pracy: successCallback / failureCallback
   */
  private async activateSchedule(item: rework_ScheduleItem) {
    try {
      await new Promise((res, rej) => {
        item.actionTimeout = setTimeout(
          async () => {
            // first timeout can be either PREPARATION or MANAGERS PAUSE
            if (item.timeDetails.switchesOffManagers) {
              this.generalInfo.showInfo(
                'Scheduler: ',
                `pausing managers before "${item.operationType}" on city "${item.targetCityDetails.name}" at: ${new Date(
                  item.timeDetails.targetTime!,
                ).toLocaleString(navigator.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })}`,
              );
            } else {
              await this.lock.forceAcquire({ method: 'activateSchedule', manager: 'scheduler' });
              this.generalInfo.showInfo(
                'Scheduler: ',
                `performing "${item.operationType}" on city "${item.targetCityDetails.name}" at: ${new Date(
                  item.timeDetails.targetTime!,
                ).toLocaleString(navigator.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })}`,
              );
            }

            // even though they may have been already stopped by other action, it doesn't hurt to call this just in case
            this.masterManager.pauseRunningManagers(['scheduler']);
            // real action there
            item.actionTimeout = setTimeout(
              async () => {
                // if previous timeout was switching off the managers, then this one should acquire LOCK and perform preparation
                if (item.timeDetails.switchesOffManagers) {
                  await this.lock.forceAcquire({ method: 'activateSchedule', manager: 'scheduler' });
                  this.generalInfo.showInfo(
                    'Scheduler: ',
                    `performing "${item.operationType}" on city "${item.targetCityDetails.name} at: ${new Date(
                      item.timeDetails.targetTime!,
                    ).toLocaleString(navigator.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}"`,
                  );
                }
                const successCallback = async (landedTime: number, movementId: string) => {
                  item.movementId = movementId;
                  const dependantSchduleItemIds = item.dependantSchduleItems.map(i => i.scheduleId);
                  const dependantSchduleItems = this.rework_schedule.filter(e =>
                    dependantSchduleItemIds.includes(e.id),
                  );
                  console.log('dependant schedule items:', dependantSchduleItems);
                  if (dependantSchduleItemIds.length) {
                    this.hydrateDependantSchedules(dependantSchduleItems, landedTime);
                  }
                  // dodaj element do listy operacji, które da się wycofać w razie W
                  this.landedSchedules.push(item);

                  // po 10 minutaach usuń element z tej listy bo po tym czasie nie da się anulować tej operacji i tak
                  setTimeout(() => {
                    this.landedSchedules = this.landedSchedules.filter(e => !e);
                  }, 600000);

                  await this.postActionCleanup(item);

                  // allows to go to finally block
                  res(null);
                };

                const failureCallback = (reason?: string) => {
                  this.removeScheduleItem(item);

                  // allows to go to finally block and release the lock
                  if (reason) rej(reason);
                  else
                    rej(
                      `Something went wrong when performing ${item.operationType} on "${item.targetCityDetails.name}"`,
                    );
                };

                const assignTimeout = (timeoutId: NodeJS.Timeout) => {
                  item.actionTimeout = timeoutId;
                };

                this.armyMovement.execute(item, {
                  assignTimeout,
                  successCallback,
                  failureCallback,
                });
              },
              // jeżeli item obejmuje wyłączenie managerów, to odczekaj czas potrzebny do ich wyłączenia i wywołaj execute w momencie preparation
              // jezeli item nie obejmuje wyłączenia managerów, to oznacza że exclusionTime === preparationTime -> więc wykonaj natychmiast
              item.timeDetails.preparationTime + this.config.general.timeDifference - Date.now(),
            );
          },
          // exclustion time = preparation time || managers switch off time, timeDiff w przypadku gdy czas JS jest inny od czasu aplikacji
          item.timeDetails.exclusionTime + this.config.general.timeDifference - Date.now(),
        );
      });
    } catch (e) {
      this.generalInfo.showError('Scheduler: ', `Schedule failed - "${e}"`, 4000);
      console.warn('Scheduler catch block:', e);
      const dependantSchduleItemIds = item.dependantSchduleItems.map(i => i.scheduleId);
      // usuń zależne elementy
      if (dependantSchduleItemIds.length) {
        this.rework_schedule = this.rework_schedule.filter(el => !dependantSchduleItemIds.includes(el.id));
      }
      // usuń ze schedula
      await this.postActionCleanup(item);
    } finally {
      this.generalInfo.hideInfo();
      this.lock.release();
      this.tryRestoreManagers();
    }
  }

  /**
   * Removes element from scheduler list, updates table ui and persist newest state.
   */
  private async postActionCleanup(item: rework_ScheduleItem) {
    await this.removeSavedCoords(item.id);
    this.rework_schedule = this.rework_schedule.filter(i => i !== item);
    this.updateUITable();
    // this.tryRestoreManagers();
    this.persist();
  }

  private updateUITable() {
    this.schedulerTableUI.update({
      scheduleList: this.rework_schedule,
      onCancel: item => this.removeScheduleItem(item),
    });
  }

  /**
   * Removes saved coords, stops schedule if running, removes schedule item from the queue along with all dependant schedules,
   * updates the ui and persists the latest scheduler state.
   * @param item
   */
  private async removeScheduleItem(item: rework_ScheduleItem) {
    console.log('removed schedule item', item);
    await this.removeSavedCoords(item.id);
    this.stopSchedule(item);
    this.rework_schedule = this.rework_schedule.filter(i => i !== item);

    const dependantSchduleItemIds = item.dependantSchduleItems.map(i => i.scheduleId);
    // usuń zależne elementy
    if (dependantSchduleItemIds.length) {
      this.rework_schedule = this.rework_schedule.filter(el => !dependantSchduleItemIds.includes(el.id));
    }

    this.updateUITable();
    this.persist();
    // if removal happens midtime, then managers won't be restored automatically so call this (if managers are running they won't be called anyways)
    this.tryRestoreManagers();
  }

  private hydrateDependantSchedules(items: rework_ScheduleItem[], landedTime: number) {
    items.forEach(schedule => {
      schedule.timeDetails.targetTime = landedTime;
      // table needs to see it's undefined to fill data for unsynchronized (is's raw at the moment)
      schedule.synchronizedWith = undefined;
      this.assignTimeDetailsToItem(schedule);
      this.updateUITable();
      this.activateSchedule(schedule);
    });
  }

  private async removeSavedCoords(id: string) {
    Array.from(document.querySelectorAll<HTMLInputElement>('.content.js-dropdown-item-list .item.bookmark'))
      .find(el => el.textContent?.trim() === id)
      ?.querySelector<HTMLElement>('.remove')
      ?.click();

    await waitForElementInterval('.confirmation .btn_confirm', {
      interval: 500,
      timeout: 2000,
    })
      .then(el => (el as HTMLButtonElement).click())
      .catch(e => console.warn('removeSavedCoords catch:', e));
  }

  private readCoords(): [string, string] {
    const gridXInput = document.querySelector<HTMLInputElement>('.coord.coord_x.js-coord-x input[type="text"]')!;
    const gridYInput = document.querySelector<HTMLInputElement>('.coord.coord_y.js-coord-y input[type="text"]')!;
    return [gridXInput.value, gridYInput.value];
  }

  private goToCoords(coords: [string, string]) {
    const gridXInput = document.querySelector<HTMLInputElement>('.coord.coord_x.js-coord-x input[type="text"]')!;
    const gridYInput = document.querySelector<HTMLInputElement>('.coord.coord_y.js-coord-y input[type="text"]')!;
    setInputValue(gridXInput, coords[0]);
    setInputValue(gridYInput, coords[1]);
    document.querySelector<HTMLElement>('.btn_jump_to_coordination')!.click();
  }

  private async closeAllDialogs(type: 'opened' | 'minimized' | 'all', force: boolean = false) {
    if (type === 'opened' || type === 'all') {
      for (const el of document.querySelectorAll<HTMLElement>('.ui-dialog-titlebar-close')) {
        el.click();
        await waitForElementInterval(`.dialog_buttons [href="#${force ? 'confirm' : 'cancel'}"]`, {
          interval: 400,
          retries: 1,
        })
          .then(() => el.click())
          .catch(() => {});
      }
    }
    if (type === 'minimized' || type === 'all') {
      for (const el of document.querySelectorAll<HTMLElement>('.minimized_windows_area .btn_wnd.close')) {
        el.click();
        await waitForElementInterval(`.dialog_buttons [href="#${force ? 'confirm' : 'cancel'}"]`, {
          interval: 400,
          retries: 1,
        })
          .then(() => el.click())
          .catch(() => {});
      }
    }
  }

  private loadScheduleFromStorage() {
    const storageScheduler = JSON.parse(localStorage.getItem('scheduler') || '[]') as rework_ScheduleItem[];
    console.log('storageScheduler:', storageScheduler);
    const hyratedSchedule = storageScheduler
      .map(preHydratedItem => this.hydrateSchedulerItem(preHydratedItem))
      .filter(e => e !== null);
    this.rework_schedule = hyratedSchedule;

    // hydration may reject some items, but they still are in the storage
    this.persist();
  }

  private hydrateSchedulerItem(schedulerItem: rework_ScheduleItem): rework_ScheduleItem | null {
    console.log('hydrate scheduler item called, preHydratedItem:', schedulerItem);
    if (schedulerItem.operationType === OperationType.Attack || schedulerItem.operationType === OperationType.Support) {
      console.log('this.citySwitchManager:', this.citySwitchManager);
      const sourceCity = this.citySwitchManager.getCityByName(schedulerItem.sourceCity.name);
      // at this point source city doesn't exist, so it's not possible to add operation to scheduler
      if (!sourceCity) {
        return null;
      }
      schedulerItem.sourceCity = sourceCity;

      if (!this.canAddSchedule(schedulerItem)) {
        console.warn('Scheduler hydration rejected item:', schedulerItem);
        return null;
      }

      return schedulerItem;
    }
    return null;
  }

  private set error(error: string | null) {
    if (error) {
      this.generalInfo.showError('Scheduler: ', error, 4000);
    }
  }

  private set hydrationError(error: string | null) {
    if (error) {
      this.generalInfo.showError('Scheduler-hydration: ', error, 4000);
    }
  }

  private set info(info: string | null) {
    if (info) {
      this.generalInfo.showInfo('Scheduler: ', info, 4000);
    }
  }

  /**
   * Sprawdza czy przywrócenie działania managerów nie koliduje z obecną kolejką schedulera, (minumum 60s do najbliższej akcji)
   * oraz czy nie wydarzy się to w trakcie działania jakiegokolwiek schedula.
   * Jeżeli nie koliduje to przywraca działanie managerów.
   * (LEGIT)
   */
  private tryRestoreManagers(): void {
    if (this.rework_schedule.length === 0) {
      console.log('RESTORE MANAGERS');
      this.masterManager.resumeRunningManagers(['scheduler']);
    } else {
      const now = Date.now();
      const isTooSoonOrMidTime = this.rework_schedule.some(el => {
        const elExclusionStartTime = el.timeDetails.exclusionTime;
        const elExclusionEndTime = el.timeDetails.exclusionTime + el.timeDetails.exclusionDuration;
        return (
          elExclusionStartTime < now + Scheduler.TIME_TO_RESTORE_MANAGERS_AFTER_ACTION ||
          (elExclusionStartTime < now && now < elExclusionEndTime)
        );
      });
      if (!isTooSoonOrMidTime) {
        console.log('RESTORE MANAGERS');
        this.masterManager.resumeRunningManagers(['scheduler']);
      }
    }
  }

  private getDateFromDateTimeInputValues(inputDateValue: string, inputTimeValue: string) {
    const timeRegex = /(\d{2})\D*(\d{2})\D*(\d{2})/;
    const match = inputTimeValue.match(timeRegex);
    if (!match || !inputDateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
      throw new Error('Invalid time format');
    }
    const [, hours, minutes, seconds] = match;
    const parsedTime = `${hours}:${minutes}:${seconds}`;
    return new Date(`${inputDateValue}T${parsedTime}`);
  }

  private mountAttackSupportSubpageObserver(parentNode: HTMLElement): () => void {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (node as HTMLElement).classList.contains('attack_support_window')
            ) {
              // element do którego na koniec będzie dodane rozszerzenie
              const buttonWrapper = (node as HTMLElement).querySelector('.button_wrapper')!;
              // kontener do którego będzie wyrenderowane rozszerzenie
              const container = document.createElement('div');
              // render
              this.schedulerUIExtensionUI.mount(container, {
                schedueList: this.rework_schedule,
                onSubmit: async (details: SchedulerUIExtensionSubmitDetails) =>
                  await this.handleScheduleSubmit(details, node as HTMLElement),
              });
              // dodanie do UI wyrenderowanego komponentu
              buttonWrapper.appendChild(container);
              return;
            }
          }
        }
      }
    });
    observer.observe(parentNode, { childList: true, subtree: true });
    this.attackSupportCardObserver = observer;
    return () => observer.disconnect();
  }

  private async mountCityDialogObserver(): Promise<void> {
    let unobserveAttackSupportSubpages: (() => void) | null = null;
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (node as HTMLElement).getAttribute('class') ===
                'ui-dialog ui-corner-all ui-widget ui-widget-content ui-front ui-draggable ui-resizable js-window-main-container'
            ) {
              unobserveAttackSupportSubpages = this.mountAttackSupportSubpageObserver(node as HTMLElement);
              return;
            }
          }
          for (const node of mutation.removedNodes) {
            if (
              node.nodeType === Node.ELEMENT_NODE &&
              (node as HTMLElement).getAttribute('role') === 'dialog' &&
              (node as HTMLElement).classList.contains('ui-dialog') &&
              (node as HTMLElement).classList.contains('js-window-main-container')
            ) {
              if (unobserveAttackSupportSubpages) {
                unobserveAttackSupportSubpages();
                unobserveAttackSupportSubpages = null;
                return;
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
    });
    this.cityDialogObserver = observer;
  }

  private handleScheduleSubmit = async (details: SchedulerUIExtensionSubmitDetails, node: HTMLElement) => {
    try {
      // get way duration time
      const wayDurationText = node.querySelector('.way_duration')!.textContent!.slice(1);
      const wayDurationMs = HHMMSS_toMS(wayDurationText);
      // get input data (all unit inputs)
      // const inputData = Array.from(node.querySelectorAll<HTMLInputElement>('.unit_input')).map(inputEl => {
      //   return {
      //     name: inputEl.getAttribute('name')!,
      //     value: inputEl.value,
      //   };
      // });
      const inputData = Array.from(node.querySelectorAll<HTMLInputElement>('.unit_input'))
        .map(inputEl => {
          return inputEl.value
            ? {
                name: inputEl.getAttribute('name')!,
                value: inputEl.value,
              }
            : null;
        })
        .filter(el => el !== null);

      // jezeli inputy nie są wypełnione, nie dodawaj do schedulera
      if (!inputData.length) {
        this.error = 'Schedule failed. All units are empty.';
        return;
      }

      // hero related
      const includeHero = node.querySelector<HTMLElement>('.cbx_include_hero')?.classList.contains('checked');
      // -------------

      // operation type related
      const operationType =
        node.firstElementChild!.getAttribute('data-type') === 'attack' ? OperationType.Attack : OperationType.Support;
      const attackStrategy =
        operationType === OperationType.Attack
          ? (document.querySelector('.attack_type.checked') as HTMLElement)?.dataset['attack']
          : undefined;

      const allCheckedStrategies = document.querySelectorAll<HTMLElement>('.attack_strategy.checked');
      const lastCheckedStrategy = Array.from(allCheckedStrategies).at(-1);
      // -------------

      // power related
      const powerElement = document.querySelector<HTMLElement>('.spells.power.power_icon45x45');
      let powerDataName = null;
      if (!powerElement?.classList.contains('no_power')) {
        powerDataName = powerElement?.classList.item(3);
      }
      // -------------

      // #schedule-time
      const sourceCity = this.citySwitchManager.getCurrentCity();

      // attack_support_tab_target_9542
      const targetCitySelector =
        '#town_' +
        Array.from(node.classList)
          .find(cls => cls.match(/attack_support_tab_target_\d+/))!
          .match(/\d+/)![0];

      const coords = this.readCoords();

      document.querySelector<HTMLInputElement>('[data-menu_name="Info"]')!.click();
      await addDelay(100);

      const targetCityName = await waitForElementInterval('#towninfo_towninfo .game_header.bold', {
        interval: 333,
        timeout: 2000,
      }).then(el => (el as HTMLElement).textContent!.trim());

      const id = new Date().toLocaleString();

      const schedulerItem: rework_PreregisteredScheduleItem = {
        id: id,
        operationType: operationType,
        attackStrategy: attackStrategy, // - TODO
        sourceCity: sourceCity!,
        power: powerDataName ? (CharmsUtility.getCharmByPowerId(powerDataName) ?? null) : null, // - TODO
        includeHero: !!includeHero,
        armyDetails: inputData,
        targetCityDetails: {
          name: targetCityName,
          coords,
          selector: targetCitySelector,
        },
        precision: details.precision,
        timeDetails: {
          targetTime: details.timeDetails.targetTime,
          movementDuration: wayDurationMs,
        },
        synchronizedWith: details.syncWith,
        actionTimeout: null,
        movementId: null,
        dependantSchduleItems: [],
      };

      // spróbuj zarejestrować - niepowodzenie rzuca error
      await this.tryRegisterSchedule(schedulerItem);
    } catch (e) {
      console.warn('handleScheduleSubmit catch block:', e);
      if (e instanceof Error) this.error = e.message;
      else this.error = 'Schedule failed for unknkown reason, call your local dev';
    } finally {
      // nothing
    }
  };

  private persist() {
    localStorage.setItem('scheduler', JSON.stringify(this.rework_schedule));
  }

  /**
   * @requires opened city info card
   */
  private async saveCoords(id: string, targetCitySelector: string) {
    await waitForElementInterval('.info_jump_to_town', {
      interval: 333,
      retries: 6,
    })
      .then(el => el.click())
      .catch(() => {
        this.error = 'Nie udało się przeskoczyć do wioski, aby zapisać współrzędne.';
        return;
      });

    await waitWhile(() => !document.querySelector<HTMLElement>(targetCitySelector), {
      onError: () => {
        this.error = 'Nie udało się zapisać współrzędnych wioski, zamknij okna innych wiosek i spróbuj ponownie.';
        throw new Error('Target city not found during scheduling process');
      },
    });

    await this.closeAllDialogs('minimized');
    await addDelay(100);

    document.querySelector<HTMLInputElement>('.btn_save_location')?.click();
    await addDelay(100);

    await waitForElement('.save_coordinates input', 3000)
      .then(el => {
        setInputValue(el as HTMLInputElement, id);
        el.blur();
      })
      .catch(() => {
        this.error = 'Error during saving coordinates, try again.';
        throw new Error('Failed to save coordinates');
      });
    await addDelay(100);

    await waitForElement('.save_coordinates .btn_confirm', 3000)
      .then(el => (el as HTMLButtonElement).click())
      .catch(() => {
        this.error = 'Error during saving coordinates, try again.';
        throw new Error('Failed to confirm saving coordinates');
      });
  }

  /**
   * Calculates timeDetails and adds to the item, checks if item can be added to schedule, saves coords in the ui, sets timeouts if possible,
   * pushes new item to the schedule, shows info, persists the data and rerenders the table. Throws Error if something was not possible or unsuccessful.
   * @requires opened city info window (for saveCoords implementation)
   * @param item
   */
  private async tryRegisterSchedule(item: rework_PreregisteredScheduleItem) {
    const registeredItem = item as rework_ScheduleItem;

    // synchronizowany
    if (registeredItem.timeDetails.targetTime === null && !!registeredItem.synchronizedWith) {
      const referentialSchedule = this.rework_schedule.find(s => s.id === item.synchronizedWith?.scheduleId)!;
      console.log('referentialScheduleItem:', referentialSchedule);
      // precyzyjny
      if (registeredItem.precision) {
        registeredItem.timeDetails.targetTimeStart =
          referentialSchedule.timeDetails.targetTimeStart +
          registeredItem.synchronizedWith.deviation +
          (registeredItem.precision.tolerance < 0 ? registeredItem.precision.tolerance : 0);

        console.log(
          `referentialSchedule.timeDetails.targetTimeDuration: ${msToHHMMSS(referentialSchedule.timeDetails.targetTimeDuration)} + registeredItem.precision.tolerance: ${msToHHMMSS(registeredItem.precision.tolerance)}`,
        );
        registeredItem.timeDetails.targetTimeDuration =
          referentialSchedule.timeDetails.targetTimeDuration + Math.abs(registeredItem.precision.tolerance);
        console.log(
          registeredItem.timeDetails.targetTimeDuration,
          msToHHMMSS(registeredItem.timeDetails.targetTimeDuration),
        );

        const preparationTime =
          registeredItem.timeDetails.targetTimeStart -
          registeredItem.timeDetails.movementDuration -
          this.config.general.antyTimingMs -
          Scheduler.PREPARATION_TIME_MS;

        registeredItem.timeDetails.preparationTime = preparationTime;
        registeredItem.timeDetails.executionStartTime = preparationTime + Scheduler.PREPARATION_TIME_MS;

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration +
          this.config.general.antyTimingMs -
          registeredItem.timeDetails.movementDuration -
          registeredItem.timeDetails.exclusionTime;
      }
      // w teorii tylko debil by użył tej opcji
      // nieprecyzjny wykonuje się dokładnie we wskazanym czasie (bez uwzględniania czasu prób (+/-AT))
      else {
        registeredItem.timeDetails.targetTimeStart =
          referentialSchedule.timeDetails.targetTimeStart + registeredItem.synchronizedWith.deviation;

        registeredItem.timeDetails.targetTimeDuration = referentialSchedule.timeDetails.targetTimeDuration;

        const preparationTime =
          registeredItem.timeDetails.targetTimeStart -
          registeredItem.timeDetails.movementDuration -
          Scheduler.PREPARATION_TIME_MS;

        registeredItem.timeDetails.preparationTime = preparationTime;
        registeredItem.timeDetails.executionStartTime = preparationTime + Scheduler.PREPARATION_TIME_MS;

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration -
          registeredItem.timeDetails.movementDuration -
          registeredItem.timeDetails.exclusionTime;
      }

      console.log('prechecked registeredItem:', this.displayFormattedSchedulerItem(registeredItem));
      if (!this.canAddSchedule(registeredItem)) {
        throw new Error('Cannot add, becasuse schedule item is conflicting');
      }
      await this.saveCoords(registeredItem.id, registeredItem.targetCityDetails.selector);
      referentialSchedule.dependantSchduleItems.push({
        scheduleId: registeredItem.id,
        deviation: registeredItem.synchronizedWith.deviation,
      });
      this.rework_schedule.push(registeredItem);
    }
    // niesynchronizowany - trzeba dodać timeouty odrazu (bo wiadomo jakie są czasy itp)
    else {
      // precyzyjny
      if (registeredItem.precision) {
        registeredItem.timeDetails.targetTimeStart =
          registeredItem.timeDetails.targetTime! +
          (registeredItem.precision!.tolerance < 0 ? registeredItem.precision!.tolerance : 0);

        registeredItem.timeDetails.targetTimeDuration = Math.abs(registeredItem.precision?.tolerance!);

        const preparationTime =
          registeredItem.timeDetails.targetTimeStart -
          registeredItem.timeDetails.movementDuration -
          this.config.general.antyTimingMs -
          Scheduler.PREPARATION_TIME_MS;

        registeredItem.timeDetails.preparationTime = preparationTime;
        registeredItem.timeDetails.executionStartTime = preparationTime + Scheduler.PREPARATION_TIME_MS;

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration +
          this.config.general.antyTimingMs -
          registeredItem.timeDetails.movementDuration -
          registeredItem.timeDetails.exclusionTime;
      }
      // nieprecyzjny wykonuje się dokładnie we wskazanym czasie (bez uwzględniania czasu prób (+/-AT))
      else {
        registeredItem.timeDetails.targetTimeStart = registeredItem.timeDetails.targetTime!;

        registeredItem.timeDetails.targetTimeDuration = 0;

        const preparationTime =
          registeredItem.timeDetails.targetTimeStart -
          registeredItem.timeDetails.movementDuration -
          Scheduler.PREPARATION_TIME_MS;

        registeredItem.timeDetails.preparationTime = preparationTime;
        registeredItem.timeDetails.executionStartTime = preparationTime + Scheduler.PREPARATION_TIME_MS;

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration -
          registeredItem.timeDetails.movementDuration -
          registeredItem.timeDetails.exclusionTime;
      }
      console.log('prechecked registeredItem:', this.displayFormattedSchedulerItem(registeredItem));

      if (!this.canAddSchedule(registeredItem)) {
        throw new Error('Cannot add, becasuse schedule item is conflicting');
      }
      // operacja jest relatywna, czyli wymaga KONKRETNEGO STANU UI - otwartej karty info miasta
      await this.saveCoords(registeredItem.id, registeredItem.targetCityDetails.selector);
      this.rework_schedule.push(registeredItem);
      this.activateSchedule(registeredItem);
    }

    console.log('registeredItem:', this.displayFormattedSchedulerItem(registeredItem));
    this.info = 'Operation scheduled';
    this.updateUITable();
    this.persist();
  }

  // TODO
  private recalculateExclusionTimes() {
    this.rework_schedule.forEach(schedule => {});
  }

  /* TODO: must be optimized in the future
  -during hydration

  /**
   * Says if item is not scheduled in the past and don't conflict with existing schedule items. (LEGIT)
   */
  private canAddSchedule(newSchedule: rework_ScheduleItem) {
    const isInThePast = newSchedule.timeDetails.exclusionTime < Date.now();
    return (
      !isInThePast &&
      this.rework_schedule.every(existingSchedule => {
        const existingItemExclusionnStartTime = existingSchedule.timeDetails.exclusionTime;
        const existingItemExclusionEndTime =
          existingSchedule.timeDetails.exclusionTime + existingSchedule.timeDetails.exclusionDuration;

        const newItemExclusionnStartTime = newSchedule.timeDetails.exclusionTime;
        const newItemExclusionEndTime =
          newSchedule.timeDetails.exclusionTime + newSchedule.timeDetails.exclusionDuration;

        console.log(`existing schedule exluctions time: ${new Date(existingItemExclusionnStartTime).toLocaleString().split(', ')[1]}-${new Date(existingItemExclusionEndTime).toLocaleString().split(', ')[1]}
        new schedule exluctions time: ${new Date(newItemExclusionnStartTime).toLocaleString().split(', ')[1]}-${new Date(newItemExclusionEndTime).toLocaleString().split(', ')[1]}`);

        // początek lub koniec dodawanego schedula nie może występować w środku innego
        // oraz początek/koniec istniejącego nie może występować w dodawanym
        return !(
          (existingItemExclusionnStartTime < newItemExclusionnStartTime &&
            newItemExclusionnStartTime < existingItemExclusionEndTime) ||
          (existingItemExclusionnStartTime < newItemExclusionEndTime &&
            newItemExclusionEndTime < existingItemExclusionEndTime) ||
          // reverse
          (newItemExclusionnStartTime < existingItemExclusionEndTime &&
            existingItemExclusionnStartTime < newItemExclusionEndTime) ||
          (newItemExclusionnStartTime < existingItemExclusionEndTime &&
            existingItemExclusionEndTime < newItemExclusionEndTime)
        );
      })
    );
  }

  /**
   * Calculates and assigns time details to ABSOLUTE-timed schedule (not relative), asesses if managers needs to be switched off as a part of the flow
   */
  private assignTimeDetailsToItem(item: rework_ScheduleItem) {
    // precyzyjny
    if (item.precision) {
      item.timeDetails.targetTimeStart =
        item.timeDetails.targetTime! + (item.precision!.tolerance < 0 ? item.precision!.tolerance : 0);

      item.timeDetails.targetTimeDuration = Math.abs(item.precision?.tolerance!);

      const preparationTime =
        item.timeDetails.targetTimeStart -
        item.timeDetails.movementDuration -
        this.config.general.antyTimingMs -
        Scheduler.PREPARATION_TIME_MS;

      item.timeDetails.preparationTime = preparationTime;
      item.timeDetails.executionStartTime = preparationTime + Scheduler.PREPARATION_TIME_MS;

      const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
      item.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

      item.timeDetails.exclusionTime =
        preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

      item.timeDetails.exclusionDuration =
        item.timeDetails.targetTimeStart +
        item.timeDetails.targetTimeDuration +
        this.config.general.antyTimingMs -
        item.timeDetails.movementDuration -
        item.timeDetails.exclusionTime;
    }
    // nieprecyzjny wykonuje się dokładnie we wskazanym czasie (bez uwzględniania czasu prób (+/-AT))
    else {
      item.timeDetails.targetTimeStart = item.timeDetails.targetTime!;

      item.timeDetails.targetTimeDuration = 0;

      const preparationTime =
        item.timeDetails.targetTimeStart - item.timeDetails.movementDuration - Scheduler.PREPARATION_TIME_MS;

      item.timeDetails.preparationTime = preparationTime;
      item.timeDetails.executionStartTime = preparationTime + Scheduler.PREPARATION_TIME_MS;

      const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
      item.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

      item.timeDetails.exclusionTime =
        preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

      item.timeDetails.exclusionDuration =
        item.timeDetails.targetTimeStart +
        item.timeDetails.targetTimeDuration -
        item.timeDetails.movementDuration -
        item.timeDetails.exclusionTime;
    }
  }

  private getAreManagersActiveAt(time: number) {
    return this.rework_schedule.every(schedule => {
      return (
        schedule.timeDetails.exclusionTime < time &&
        schedule.timeDetails.exclusionTime +
          schedule.timeDetails.exclusionDuration +
          Scheduler.TIME_TO_RESTORE_MANAGERS_AFTER_ACTION >
          time
      );
    });
  }

  // TODO: rethink when needed
  public canSafelyRefresh = () => false;

  private displayFormattedSchedulerItem(item: rework_ScheduleItem): DisplayFormattedSchedulerItem {
    const isPrecise = !!item.precision;
    return {
      ...item,
      timeDetails: {
        ...item.timeDetails,
        exclusionDuration: msToHHMMSS(item.timeDetails.exclusionDuration), // to [s]
        exclusionTime: new Date(item.timeDetails.exclusionTime).toLocaleString(),
        movementDuration: msToHHMMSS(item.timeDetails.movementDuration), // to [s]
        targetTime: item.timeDetails.targetTime ? new Date(item.timeDetails.targetTime).toLocaleString() : null,
        targetTimeDuration: msToHHMMSS(item.timeDetails.targetTimeDuration), // to [s]
        targetTimeStart: new Date(item.timeDetails.targetTimeStart).toLocaleString(),

        switchOffManagersTime: item.timeDetails.switchesOffManagers ? msToHHMMSS(item.timeDetails.exclusionTime) : null,
        preparationTime: new Date(
          item.timeDetails.targetTimeStart -
            item.timeDetails.movementDuration -
            Scheduler.PREPARATION_TIME_MS -
            (isPrecise ? this.config.general.antyTimingMs : 0),
        ).toLocaleString(),
        executionStartTime: new Date(
          item.timeDetails.targetTimeStart -
            item.timeDetails.movementDuration -
            (isPrecise ? this.config.general.antyTimingMs : 0),
        ).toLocaleString(),
      },
      precision: item.precision
        ? {
            allowedToleranceIfFailed: item.precision.allowedToleranceIfFailed,
            tolerance: item.precision.tolerance / 1000,
          }
        : item.precision,
      synchronizedWith: item.synchronizedWith
        ? { ...item.synchronizedWith, deviation: item.synchronizedWith.deviation / 1000 }
        : item.synchronizedWith,
    };
  }
}
