import { it } from 'node:test';
import { TConfig } from '../../../gps.config';
import { TConfigChanges } from '../../config-popup/config-popup';
import ConfigManager from '../../utility/config-manager';
import { addDelay, textToMs, waitWhile } from '../../utility/plain-utility';
import Service from '../../utility/service';
import Lock from '../../utility/ui-lock';
import { setInputValue, waitForElement, waitForElementInterval } from '../../utility/ui-utility';
import ArmyMovement from '../army/army-movement';
import CharmsUtility, { CharmDetails } from '../charms/charms-utility';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import MasterManager from '../master/master-manager';
import GeneralInfo from '../master/ui/general-info';

import { SchedulerTableUtility, useSchedulerTable } from './scheduler-table-ui';
import { SchedulerUIExtensionUIUtility, useSchedulerUIExtensionUI } from './scheduler-ui-extension';
import { isInternalThread } from 'worker_threads';
import { fail } from 'assert';

export enum OperationType {
  Attack,
  Support,
  Withdraw,
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
    targetTime: number | null; // istnieje gdy konkretna data jest wybrana, w przeciwnym razie jest synchronizedWith
    movementDuration: number;
    // actionTime: number | null; // theoretical actionTime (real is + time difference)
    targetTimeStart: number;
    targetTimeDuration: number;
    exclusionTime: number;
    exclusionDuration: number;
    switchesOffManagers: boolean;
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
  actionTimeout: NodeJS.Timeout | null;
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
    failureCallback: () => void;
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
  private isLockTakenByScheduler: boolean = false;
  private generalInfo!: GeneralInfo;
  private masterManager!: MasterManager;
  private config!: TConfig;
  private citySwitchManager!: CitySwitchManager;
  private rework_schedule: rework_ScheduleItem[] = [];
  private landedSchedules: rework_ScheduleItem[] = [];
  private _error: string | null = null;
  private _hydrationError: string | null = null;
  private _info: string | null = null;
  private RUN: boolean = true;
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
    return Scheduler.instance;
  }

  // service implementation ----------
  public start() {
    this.RUN = true;
    this.mountCityDialogObserver();
    this.loadScheduleFromStorage();
    // TODO: add props that needs to be added to render the table
    this.schedulerTableUI.mount({ schedule: this.rework_schedule });
    this.rework_schedule.forEach(s => this.activateSchedule(s));
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
    clearTimeout(item.actionTimeout ?? undefined);
  }

  /**
   * Wykonawce ma interesować minimum informacji, wykonawca nie dba o to co ustawiać. Wykonawca robi robotę i zwraca informacje o efekcie swojej pracy.
   * Zakres pracy wykonawcy:
   * -przejście do miasta docelowego
   * -ustawienie pól do operacji + odczekanie
   * -wykonanie operacji w zależności od tego czy opeacja jest precyzyjna czy nie
   * -zwrócenie info o efekcie pracy: successCallback / failureCallback
   */
  private activateSchedule(item: rework_ScheduleItem) {
    item.actionTimeout = setTimeout(
      () => {
        this.masterManager.pauseRunningManagers(['scheduler']);
        // real action there
        item.actionTimeout = setTimeout(
          () => {
            // TODO
            const successCallback = (landedTime: number, movementId: string) => {
              item.movementId = movementId;
              const dependantSchduleItemIds = item.dependantSchduleItems.map(i => i.scheduleId);
              const dependantSchduleItems = this.rework_schedule.filter(e => dependantSchduleItemIds.includes(e.id));
              if (dependantSchduleItemIds.length) {
                this.hydrateDependantSchedules(dependantSchduleItems, landedTime);
              }
              // dodaj element do listy operacji, które da się wycofać w razie W
              this.landedSchedules.push(item);

              // po 10 minutaach usuń element z tej listy bo po tym czasie nie da się anulować tej operacji i tak
              setTimeout(() => {
                this.landedSchedules = this.landedSchedules.filter(e => !e);
              }, 600000);
              this.tryRestoreManagers();
            };
            // TODO
            const failureCallback = () => {
              const dependantSchduleItemIds = item.dependantSchduleItems.map(i => i.scheduleId);
              // usuń zależne elementy
              if (dependantSchduleItemIds.length) {
                this.rework_schedule = this.rework_schedule.filter(el => !dependantSchduleItemIds.includes(el.id));
              }
              // usuń ze schedula
              this.rework_schedule = this.rework_schedule.filter(el => el.id !== item.id);
              this.tryRestoreManagers();
            };

            const assignTimeout = (timeoutId: NodeJS.Timeout) => {
              item.actionTimeout = timeoutId;
            };
            // TODO
            this.armyMovement.execute(item, {
              assignTimeout,
              successCallback,
              failureCallback,
            });
          },
          // jeżeli item obejmuje wyłączenie managerów, to odczekaj czas potrzebny do ich wyłączenia i uruchom preparation
          // jezeli item nie obejmuje tego, to oznacza że exclusionTime === preparationTime -> więc wykonaj natychmiast
          item.timeDetails.switchesOffManagers
            ? Date.now() - (this.config.general.timeDifference + Scheduler.TURN_OFF_MANAGERS_TIME_MS)
            : 0,
        );
      },
      // exclustion time = preparation time || managers switch off time, timeDiff w przypadku gdy czas JS jest inny od czasu aplikacji
      Date.now() - (this.config.general.timeDifference + item.timeDetails.exclusionTime),
    );
  }

  // TODO
  private hydrateDependantSchedules(items: rework_ScheduleItem[], landedTime: number) {
    items.forEach(schedule => {
      schedule.timeDetails.targetTime = landedTime;
      this.assignTimeDetailsToItem(schedule);
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

  private readCords(): [string, string] {
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
    storageScheduler.forEach(schedulerItem => this.hydrateSchedulerItem(schedulerItem));
    this.rework_schedule = storageScheduler;
  }

  private hydrateSchedulerItem(schedulerItem: rework_ScheduleItem) {
    if (schedulerItem.operationType === OperationType.Attack || schedulerItem.operationType === OperationType.Support) {
      const sourceCity = this.citySwitchManager.getCityByName(schedulerItem.sourceCity.name);
      // at this point source city doesn't exist, so it's not possible to add operation to scheduler
      if (!sourceCity) {
        return;
      }
      schedulerItem.sourceCity = sourceCity;

      if (!this.canAddSchedule(schedulerItem)) {
        console.warn('unsafe operation, failed to be scheudled during hydration');
        this.hydrationError = `${schedulerItem.sourceCity.name} ${
          schedulerItem.operationType === OperationType.Attack ? 'attack' : 'support'
        } operation  at on city "${schedulerItem.targetCityDetails.name}" failed to be scheduled during hydration.`;
        return;
      }

      // this.addActionTimeouts(schedulerItem);
      // this.schedule.push(schedulerItem);
      // this.addSchedulerItemToUI(schedulerItem);
    }
  }

  private set error(error: string | null) {
    const errorElement = document.querySelector<HTMLElement>('#schedule-error');
    if (error) {
      if (errorElement) {
        errorElement.textContent = error;
      }
      this.generalInfo.showError('Scheduler:', error, 5000);
    } else {
      if (errorElement) {
        errorElement.textContent = '';
      }
    }
    this._error = error;
  }

  private set hydrationError(error: string | null) {
    // TODO: add error display container
    this._hydrationError = error;
  }

  private set info(info: string | null) {
    const infoElement = document.querySelector<HTMLElement>('#schedule-info');
    if (info) {
      if (infoElement) {
        infoElement.textContent = info;
        setTimeout(() => {
          infoElement.textContent = '';
        }, 4000);
      }
    } else {
      if (infoElement) {
        infoElement.textContent = '';
      }
    }
    this._info = info;
  }

  /**
   * Sprawdza czy przywrócenie działania managerów nie koliduje z obecną kolejką schedulera, (minumum 60s do najbliższej akcji)
   * jeżeli nie koliduje to przywraca działanie managerów.
   */
  private tryRestoreManagers(): void {
    if (this.rework_schedule.length === 0) {
      console.log('RESTORE MANAGERS');
      this.masterManager.resumeRunningManagers(['scheduler']);
    } else {
      const isScheduleSoonEnough = this.rework_schedule.some(el => {
        return el.timeDetails.exclusionTime < Date.now() + Scheduler.TIME_TO_RESTORE_MANAGERS_AFTER_ACTION;
      });
      if (!isScheduleSoonEnough) {
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

  private getFormattedInputValueFromDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Miesiące są indeksowane od 0
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
      this.error = null;
      // get way duration time
      const wayDurationText = node.querySelector('.way_duration')!.textContent!.slice(1);
      const wayDurationMs = textToMs(wayDurationText);
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
      const coords = this.readCords();

      document.querySelector<HTMLInputElement>('[data-menu_name="Info"]')!.click();
      await addDelay(100);

      const targetCityName = await waitForElementInterval('#towninfo_towninfo .game_header.bold', {
        interval: 333,
        timeout: 2000,
      }).then(el => (el as HTMLElement).textContent!.trim());

      const id = `${operationType}_${sourceCity!.name}_${targetCityName}_${Date.now()}`;

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
      console.warn('handleScheduleSubmit:', e);
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
      // precyzyjny
      if (registeredItem.precision) {
        registeredItem.timeDetails.targetTimeStart =
          referentialSchedule.timeDetails.targetTimeStart +
          registeredItem.synchronizedWith.deviation +
          (registeredItem.precision.tolerance < 0 ? registeredItem.precision.tolerance : 0);

        registeredItem.timeDetails.targetTimeDuration =
          referentialSchedule.timeDetails.targetTimeDuration + Math.abs(registeredItem.precision.tolerance);

        const preparationTime =
          registeredItem.timeDetails.targetTimeStart -
          registeredItem.timeDetails.movementDuration -
          this.config.general.antyTimingMs -
          Scheduler.PREPARATION_TIME_MS;

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration +
          this.config.general.antyTimingMs -
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

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration -
          registeredItem.timeDetails.exclusionTime;
      }
      if (!this.canAddSchedule(registeredItem)) {
        throw new Error('Cannot add, becasuse schedule item is conflicting');
      }
      await this.saveCoords(registeredItem.id, registeredItem.targetCityDetails.selector);
      referentialSchedule.dependantSchduleItems.push(registeredItem.synchronizedWith!);
      this.rework_schedule.push(registeredItem);
    }
    // niesynchronizowany - trzba dodać timeouty odrazu (bo wiadomo jakie są czasy itp)
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

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration +
          this.config.general.antyTimingMs -
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

        const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
        registeredItem.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

        registeredItem.timeDetails.exclusionTime =
          preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

        registeredItem.timeDetails.exclusionDuration =
          registeredItem.timeDetails.targetTimeStart +
          registeredItem.timeDetails.targetTimeDuration -
          registeredItem.timeDetails.exclusionTime;
      }
      if (!this.canAddSchedule(registeredItem)) {
        throw new Error('Cannot add, becasuse schedule item is conflicting');
      }
      // operacja jest relatywna, czyli wymaga KONKRETNEGO STANU UI - otwartej karty info miasta
      await this.saveCoords(registeredItem.id, registeredItem.targetCityDetails.selector);
      this.rework_schedule.push(registeredItem);
      this.activateSchedule(registeredItem);
    }

    this.info = 'Operation scheduled';
    this.schedulerTableUI.update(this.rework_schedule);
    this.persist();
  }

  // TODO
  private recalculateExclusionTimes() {
    this.rework_schedule.forEach(schedule => {});
  }

  private canAddSchedule(newSchedule: rework_ScheduleItem) {
    return this.rework_schedule.every(existingSchedule => {
      return (
        newSchedule.timeDetails.exclusionTime >
          existingSchedule.timeDetails.exclusionTime + existingSchedule.timeDetails.exclusionDuration &&
        newSchedule.timeDetails.exclusionTime + newSchedule.timeDetails.exclusionDuration <
          existingSchedule.timeDetails.exclusionTime
      );
    });
  }

  /**
   * Calculates and assigns time details to ABSOLUTE-timed schedule (not relative), asesses if managers needs to be switched off as a part of the flow
   */
  private assignTimeDetailsToItem(item: rework_ScheduleItem) {
    if (item.precision) {
      item.timeDetails.targetTimeStart =
        item.timeDetails.targetTime! + (item.precision!.tolerance < 0 ? item.precision!.tolerance : 0);

      item.timeDetails.targetTimeDuration = Math.abs(item.precision?.tolerance!);

      const preparationTime =
        item.timeDetails.targetTimeStart -
        item.timeDetails.movementDuration -
        this.config.general.antyTimingMs -
        Scheduler.PREPARATION_TIME_MS;

      const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
      item.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

      item.timeDetails.exclusionTime =
        preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

      item.timeDetails.exclusionDuration =
        item.timeDetails.targetTimeStart +
        item.timeDetails.targetTimeDuration +
        this.config.general.antyTimingMs -
        item.timeDetails.exclusionTime;
    }
    // nieprecyzjny wykonuje się dokładnie we wskazanym czasie (bez uwzględniania czasu prób (+/-AT))
    else {
      item.timeDetails.targetTimeStart = item.timeDetails.targetTime!;

      item.timeDetails.targetTimeDuration = 0;

      const preparationTime =
        item.timeDetails.targetTimeStart - item.timeDetails.movementDuration - Scheduler.PREPARATION_TIME_MS;

      const areManagersActiveAtTheTimeOfPreparation = this.getAreManagersActiveAt(preparationTime);
      item.timeDetails.switchesOffManagers = areManagersActiveAtTheTimeOfPreparation;

      item.timeDetails.exclusionTime =
        preparationTime - (areManagersActiveAtTheTimeOfPreparation ? Scheduler.TURN_OFF_MANAGERS_TIME_MS : 0);

      item.timeDetails.exclusionDuration =
        item.timeDetails.targetTimeStart + item.timeDetails.targetTimeDuration - item.timeDetails.exclusionTime;
    }
  }

  private getAreManagersActiveAt(time: number) {
    this.rework_schedule.every(schedule => {
      return (
        schedule.timeDetails.exclusionTime < time &&
        schedule.timeDetails.exclusionTime +
          schedule.timeDetails.exclusionDuration +
          Scheduler.TIME_TO_RESTORE_MANAGERS_AFTER_ACTION >
          time
      );
    });
    return false;
  }

  public canSafelyRefresh(): boolean {
    return (
      this.rework_schedule.length === 0 ||
      this.rework_schedule.every(item => item.timeDetails.exclusionTime > Date.now() + 120 * 1000)
    );
  }
}
