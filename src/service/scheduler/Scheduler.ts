import { TConfig } from "../../../gps.config";
import ConfigManager from "../../utility/config-manager";
import { addDelay, textToMs } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, setInputValue, triggerHover, waitForElement } from "../../utility/ui-utility";
import ArmyMovement from "../army/army-movement";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import MasterManager from "../master/master-manager";
import buttonPanelExtension from './button-panel-extension.html';
import schedulerListHtml from './scheduler-list-prod.html';
import schedulerListCss from './scheduler-list.css';

enum OperationType {
  ARMY_ATTACK,
  ARMY_SUPPORT,
  ARMY_WITHDRAW,
  RESOURCE_SHIPMENT,
}

type TimeoutStructure = {
  timeout30s: NodeJS.Timeout | null;
  timeout10s: NodeJS.Timeout | null;
  timeoutAction: NodeJS.Timeout | null;
}

type ScheduleItem = {
  operationType: OperationType;
  movementId: string | null;
  undoMovementAction: (() => void) | null;
  targetDate: Date;
  actionDate: Date;
  sourceCity: CityInfo;
  targetCityIdSelector: string;
  data: any;
  /**
   * Przechowuje timeouty do anulowania operacji, które są wykonują etapy przygotowawcze do operacji oraz samą operację
   */
  timeoutStructure: TimeoutStructure;
  /**
   * Anuluje timeouty, usuwa item z schedulera, przywraca działanie managerów i zwalnia locka
   */
  cancelSchedule: () => void;
  /**
   * Po wykonaniu operacji, przywraca działanie managerów, zwalnia locka a po 10 minutach usuwa item z schedulera
   */
  postActionCleanup: () => void;
}

export default class Scheduler {
  public static readonly MIN_PRECEDENCE_TIME_MS = 10 * 1000;
  public static readonly TURN_OFF_MANAGERS_TIME_MS = 30 * 1000;
  public static readonly PREPARATION_TIME_MS = 10 * 1000;

  private static instance: Scheduler;
  private lock!: Lock;
  private isLockTakenByScheduler: boolean = false;
  private masterManager!: MasterManager;
  private config!: TConfig;
  private citySwitchManager!: CitySwitchManager;
  private scheduler: ScheduleItem[] = [];
  private _error: string | null = null;
  private _hydrationError: string | null = null;
  private _info: string | null = null;
  private RUN: boolean = true;
  private armyMovement!: ArmyMovement;

  privateconstructor() { }

  public static async getInstance(): Promise<Scheduler> {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
      Scheduler.instance.lock = Lock.getInstance();
      Scheduler.instance.armyMovement = ArmyMovement.getInstance();
      Scheduler.instance.masterManager = await MasterManager.getInstance();
      Scheduler.instance.citySwitchManager = await CitySwitchManager.getInstance();
      Scheduler.instance.config = ConfigManager.getInstance().getConfig();
      Scheduler.instance.addUIExtenstion();
      Scheduler.instance.addSchedulerListConfigWindow();
      Scheduler.instance.synchronizeSchedulerWithStorage();
    }
    return Scheduler.instance;
  }

  private async addUIExtenstion() {
    await this.mountCityDialogObserver();
  }

  public async run() {
    this.RUN = true;
  }

  public async stop() {
    this.RUN = false;
  }

  public isRunning(): boolean {
    return this.RUN;
  }

  /**
   * Potrzebny będzie dodatkowy identyfikator ruchu, ponieważ z danego miasta, do danego miasta może miec miejsce wiele ruchów 
   * i wówczas może zostać anulowany zły ruch. Nie jest to zatem bezpieczna metoda na tą chilę.
   * Możliwe rozwiązania:
   * -Mozna zamontować obserwera ruchów wojsk, przekażać mu samo usuwającego się callbacka, któyry otrzyma informację o najnowszym ruchu
   *  np. unikalne [id="movement_1820489002"], które zostanie przypisane do danego obiektu ruchu. Wówczas cancelowanie ruchów, będzie odbywało się
   *  po tym id. Przed przypisaniem 'movementId' do obiektu schedulera, będzie miało miejsce sprawdzenie czy parametry ataku się zgadzają, na wypadek, gdyby
   *  najbliższym ruchem się okazała napaść na wioskę (której nie da się anulować bo nie należy do właściciela)
   */
  private async undoArmyMovement(fromTown: CityInfo, id: string) {
    await fromTown.switchAction();
    await addDelay(100);
    const hoverElement = document.querySelector('#toolbar_activity_commands') as HTMLElement;
    triggerHover(hoverElement);
    document.querySelector<HTMLDivElement>(`#${id}`)?.click()
  }


  /**
   * Ma rozpoznawać, czy znajduje się na karcie ATAK/OBRONA
   * Ma dodać schdule button i inputy do podania czasu wykonania operacji.
   * Na schedule click:
   * -zczytać i zapamiętać wartości imputów
   * -zczytać czas podróży jednostek i obliczyć na podstawie tych danych timeout
   * -zczytać wioskę źródłową oraz gridy wioski na której operacja ma być wykonana
   * -dodać obiekt ScheduleItem do listy oraz do LocaleStorage oraz ustawic timeout
   * -timeout powinien usunąć wszstko co z nim związane powykonaniu operacji
   */
  private async extendAttackSupportUI(node: HTMLElement): Promise<void> {
    // observer mounted, argument is the grand parent of the button panel
    const buttonWrapper = node.querySelector('.button_wrapper')!;
    const div = document.createElement('div');
    div.innerHTML = buttonPanelExtension;
    buttonWrapper.appendChild(div);

    // Element ready, logic below:
    const inputDateElement = document.querySelector<HTMLInputElement>('#schedule-date')!;
    // prefill date input with current date
    inputDateElement.value = this.getFormattedInputValueFromDate(new Date());

    const scheduleButton = div.querySelector('#schedule-button')!;
    scheduleButton.addEventListener('click', async () => {
      this.error = null;
      // get way duration time
      const wayDurationText = node.querySelector('.way_duration')!.textContent!.slice(1);
      const wayDurationMs = textToMs(wayDurationText);
      // get input data (all unit inputs)
      const inputData = Array.from(node.querySelectorAll<HTMLInputElement>('.unit_input')).map(inputEl => {
        return {
          name: inputEl.getAttribute('name')!,
          value: inputEl.value
        }
      })

      const operationType = node.firstElementChild!.getAttribute('data-type') === 'attack' ? OperationType.ARMY_ATTACK : OperationType.ARMY_SUPPORT;
      const inputDateValue = inputDateElement.value
      // Wartość z inputu type="date" będzie w formacie "YYYY-MM-DD"
      // Na przykład: "2023-05-25" dla 25 maja 2023

      // #schedule-time      
      const inputTimeValue = document.querySelector<HTMLInputElement>('#schedule-time')!.value
      const targetDate = this.getDateFromDateTimeInputValues(inputDateValue, inputTimeValue);
      const actionDate = new Date(targetDate.getTime() - wayDurationMs);
      const sourceCity = this.citySwitchManager.getCurrentCity()
      // attack_support_tab_target_9542
      const targetCitySelector = '#town_' + Array.from(node.classList).find(cls => cls.match(/attack_support_tab_target_\d+/))!.match(/\d+/)![0];

      // console.log('parsed info:')
      // console.log('inputData:', inputData)
      // console.log('operationType', operationType === OperationType.ARMY_ATTACK ? 'attack' : 'support')
      // console.log('targetCitySelector', targetCitySelector);
      // console.log('sourceCity', sourceCity);
      // console.log('wayDuration ms/timeString:', wayDurationMs, msToTimeString(wayDurationMs))
      // console.log('targetDate', formatDateToSimpleString(targetDate));
      // console.log('actionDate (targetDate - wayDuration)', formatDateToSimpleString(actionDate));

      if (!this.canAddSchedulerItem(actionDate)) {
        console.warn('unsafe operation, failed to be scheudled');
        this.error = 'Schedule failed. Cannot safely schedule operation.';
        return;
      }
      // jezeli inputy nie są wypełnione, nie dodawaj do schedulera
      if (!inputData.some(data => data.value)) {
        this.error = 'Schedule failed. All units are empty.';
        return;
      }

      const scheduleTimeout: TimeoutStructure = {
        timeout30s: null,
        timeout10s: null,
        timeoutAction: null,
      }

      const schedulerItem: ScheduleItem = {
        operationType: operationType,
        targetDate: targetDate,
        actionDate: actionDate,
        sourceCity: sourceCity,
        targetCityIdSelector: targetCitySelector,
        data: inputData,
        timeoutStructure: scheduleTimeout,
        movementId: null,
        undoMovementAction: null,
        cancelSchedule: () => {
          if (scheduleTimeout.timeout30s) clearTimeout(scheduleTimeout.timeout30s)
          if (scheduleTimeout.timeout10s) clearTimeout(scheduleTimeout.timeout10s)
          if (scheduleTimeout.timeoutAction) clearTimeout(scheduleTimeout.timeoutAction)
          if (this.isLockTakenByScheduler) {
            this.lock.release();
            this.isLockTakenByScheduler = false;
          }
          this.scheduler = this.scheduler.filter(item => item !== schedulerItem)
          localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
          this.tryRestoreManagers();
        },
        postActionCleanup: () => {
          setTimeout(() => {
            this.scheduler = this.scheduler.filter((item) => item !== schedulerItem);
            localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
          }, 0);
          if (this.isLockTakenByScheduler) this.lock.release();
          this.isLockTakenByScheduler = false;
          this.tryRestoreManagers();
        }
      }

      const halfMinuteBeforeAction = actionDate.getTime() - new Date().getTime() - Scheduler.TURN_OFF_MANAGERS_TIME_MS;
      scheduleTimeout.timeout30s = setTimeout(() => {
        // console.log('NOW half minute before action, time is:', formatDateToSimpleString(new Date()))
        this.masterManager.pauseRunningManagers(['scheduler']);

        const tenSecondsBeforeAction = actionDate.getTime() - new Date().getTime() - 10 * 1000;
        scheduleTimeout.timeout10s = setTimeout(async () => {
          try {
            // console.log('NOW ten seconds before action, time is:', formatDateToSimpleString(new Date()))
            await this.lock.acquire();
            this.isLockTakenByScheduler = true;
            // znajdź wioskę i kliknij odpowiednią operację
            document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click()
            performComplexClick((await waitForElement(targetCitySelector)))
            if (operationType === OperationType.ARMY_ATTACK) {
              (await waitForElement('#attack')).click();
            } else {
              (await waitForElement('#support')).click();
            }

            // wypełnij inputy
            for (const data of inputData) {
              const input = await waitForElement(`input[name="${data.name}"]`) as HTMLInputElement;
              setInputValue(input, data.value);
            };

          } catch (error) {
            console.error('Error during 10 seconds before action:', error);
            this.error = 'Schedule failed. Check console for more details.'
            schedulerItem.cancelSchedule();
            return;
          }

          scheduleTimeout.timeoutAction = setTimeout(async () => {
            try {
              // console.log('NOW ACTION, time is:', formatDateToSimpleString(new Date()))
              // console.log('now time + way duration:', formatDateToSimpleString(new Date(new Date().getTime() + wayDurationMs)))
              if (operationType === OperationType.ARMY_ATTACK) {
                (await waitForElement('#btn_attack_town')).click();
              } else {
                (await waitForElement('.attack_support_window a .middle')).click();
              }

              this.armyMovement.setCallback((id: string) => {
                schedulerItem.movementId = id;
                schedulerItem.undoMovementAction = () => this.undoArmyMovement(schedulerItem.sourceCity, id);
              });

              document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();
              this.error = null;
            } catch (error) {
              console.error('Error during action:', error);
              this.error = 'Schedule failed. Check console for more details.'
            } finally {
              schedulerItem.postActionCleanup();
            }
          }, actionDate.getTime() - new Date().getTime());

        }, tenSecondsBeforeAction)

      }, halfMinuteBeforeAction);

      this.scheduler.push(schedulerItem);
      this.addSchedulerItemToUI(schedulerItem);
      localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
      this.info = 'Operation scheduled'
      console.log('Scheduler.extendAttackSupportUI.schedulerItem', schedulerItem);
    });
  }

  /*
  Wczytuje storage, w którym znajduje się niebędne info do wykonania timeoutów z planem operacji.
  Iteruje po każdym itemie i uzupełnia jego objekt o id timeoutów, oraz funkcję do anulowania operacji.
  */
  private synchronizeSchedulerWithStorage() {
    const storageScheduler = JSON.parse(localStorage.getItem('scheduler') || '[]') as ScheduleItem[];
    storageScheduler.forEach(schedulerItem => this.hydrateSchedulerItem(schedulerItem));
    this.handleIfSchedulerListIsEmpty();
  }

  private hydrateSchedulerItem(schedulerItem: ScheduleItem) {
    if (schedulerItem.operationType === OperationType.ARMY_ATTACK || schedulerItem.operationType === OperationType.ARMY_SUPPORT) {
      schedulerItem.actionDate = new Date(schedulerItem.actionDate)
      schedulerItem.targetDate = new Date(schedulerItem.targetDate)
      schedulerItem.sourceCity = this.citySwitchManager.getCityByName(schedulerItem.sourceCity.name);

      if (!this.canAddSchedulerItem(schedulerItem.actionDate)) {
        console.warn('unsafe operation, failed to be scheudled during hydration');
        this.hydrationError = `${schedulerItem.sourceCity.name} ${schedulerItem.operationType === OperationType.ARMY_ATTACK ? 'attack' : 'support'} operation  at '${schedulerItem.targetDate}' on city "${schedulerItem.targetCityIdSelector}" failed to be scheduled during hydration.`;
        return;
      }

      schedulerItem.cancelSchedule = () => {
        if (schedulerItem.timeoutStructure.timeout30s) clearTimeout(schedulerItem.timeoutStructure.timeout30s)
        if (schedulerItem.timeoutStructure.timeout10s) clearTimeout(schedulerItem.timeoutStructure.timeout10s)
        if (schedulerItem.timeoutStructure.timeoutAction) clearTimeout(schedulerItem.timeoutStructure.timeoutAction)
        if (this.isLockTakenByScheduler) this.lock.release();
        this.isLockTakenByScheduler = false;
        this.scheduler = this.scheduler.filter((item) => item !== schedulerItem);
        localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
        this.tryRestoreManagers();
      }

      schedulerItem.postActionCleanup = () => {
        // TODO: w pzyszłości item powinien byc usuwany 10 minut później, bo będzie można zaplanować jego odwołanie zawczasu
        setTimeout(() => {
          this.scheduler = this.scheduler.filter((item) => item !== schedulerItem);
          localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
          this.removeSchedulerItemFromUI(schedulerItem);
          this.handleIfSchedulerListIsEmpty();
        }, 0);
        if (this.isLockTakenByScheduler) this.lock.release();
        this.isLockTakenByScheduler = false;
        this.tryRestoreManagers();
      }

      const halfMinuteBeforeAction = schedulerItem.actionDate.getTime() - new Date().getTime() - Scheduler.TURN_OFF_MANAGERS_TIME_MS;
      schedulerItem.timeoutStructure.timeout30s = setTimeout(() => {
        // console.log('NOW half minute before action, time is:', formatDateToSimpleString(new Date()))
        this.masterManager.pauseRunningManagers(['scheduler']);

        const tenSecondsBeforeAction = schedulerItem.actionDate.getTime() - new Date().getTime() - 10 * 1000;
        schedulerItem.timeoutStructure.timeout10s = setTimeout(async () => {
          try {
            // console.log('NOW ten seconds before action, time is:', formatDateToSimpleString(new Date()))
            await this.lock.acquire();
            this.isLockTakenByScheduler = true;
            // znajdź wioskę i kliknij odpowiednią operację
            document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click()
            performComplexClick((await waitForElement(schedulerItem.targetCityIdSelector)))
            if (schedulerItem.operationType === OperationType.ARMY_ATTACK) {
              (await waitForElement('#attack')).click();
            } else {
              (await waitForElement('#support')).click();
            }

            // wypełnij inputy
            for (const data of schedulerItem.data) {
              const input = await waitForElement(`input[name="${data.name}"]`) as HTMLInputElement;
              setInputValue(input, data.value);
            };

          } catch (error) {
            console.error('Error during 10 seconds before action:', error);
            this.error = 'Schedule failed. Check console for more details.'
            schedulerItem.cancelSchedule();
            return;
          }

          schedulerItem.timeoutStructure.timeoutAction = setTimeout(async () => {
            try {
              // console.log('NOW ACTION, time is:', formatDateToSimpleString(new Date()))
              // console.log('now time + way duration:', formatDateToSimpleString(new Date(new Date().getTime() + wayDurationMs)))
              if (schedulerItem.operationType === OperationType.ARMY_ATTACK) {
                (await waitForElement('#btn_attack_town')).click();
              } else {
                (await waitForElement('.attack_support_window a .middle')).click();
              }

              this.armyMovement.setCallback((id: string) => {
                schedulerItem.movementId = id;
                schedulerItem.undoMovementAction = () => this.undoArmyMovement(schedulerItem.sourceCity, id);
              });

              document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();

              this.error = null;
            } catch (error) {
              console.error('Error during action:', error);
              this.error = 'Schedule failed. Check console for more details.'
            } finally {
              schedulerItem.postActionCleanup();
            }
          }, schedulerItem.actionDate.getTime() - new Date().getTime());

        }, tenSecondsBeforeAction)

      }, halfMinuteBeforeAction);

      this.scheduler.push(schedulerItem);
      this.addSchedulerItemToUI(schedulerItem);
      console.log('Scheduler.hydrateSchedulerItem.item', schedulerItem);
    }
  }

  private set error(error: string | null) {
    const errorElement = document.querySelector<HTMLElement>('#schedule-error');
    if (error) {
      if (errorElement) {
        errorElement.textContent = error;
      }
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
   * Sprawdza czy można dodać operację do schedulera ze względu na czas do wykonania operacji oraz czas do najbliższej akcji w schedulerze.
   * Jezeli odstęp czasowy pomiędzy tą operacją a teraz lub najbliższą zaplanowaną operacją jest mniejszy niż 10s zwraca fałsz.
   */
  private canAddSchedulerItem(actionDate: Date): boolean {
    // jeżeli czas do wykonbania operacji jest większy niż 10s, sprawdź czy czas do najbliższej akcji jest większy niż 10s
    if (actionDate.getTime() - new Date().getTime() > 10 * 1000) {
      // jeżeli scheduler jest pusty, można dodać operację
      if (this.scheduler.length === 0) {
        return true;
      }
      const hasNoInterlacingTimes = !this.scheduler.some((item) => {
        if (Math.abs(item.actionDate.getTime() - actionDate.getTime()) < 10 * 1000) {
          console.log('Interlacing times:', item.actionDate, actionDate);
          console.log('\t:', item.actionDate.getTime() - actionDate.getTime(), (item.actionDate.getTime() - actionDate.getTime()) / 1000);
          return true;
        }
        console.log('Not interlacing times:', item.actionDate, actionDate);
        return false;
      });
      return hasNoInterlacingTimes;
    }
    // jeżeli czas do wykonbania operacji jest mniejszy niż 10s, nie podejmuj się operacji
    else {
      return false;
    }
  }
  /**
   * Sprawdza czy przywrócenie działania managerów nie koliduje z obecną kolejką schedulera, (minumum 60s do najbliższej akcji)
   * jeżeli nie koliduje to przywraca działanie managerów.
   */
  private tryRestoreManagers(): void {
    if (this.scheduler.length === 0) {
      console.log('RESTORE MANAGERS')
      this.masterManager.resumeRunningManagers(['scheduler']);
    } else {
      // znajdź najbliższą akcję w schedulerze
      const now = new Date();
      const nextClosestActionTime = this.scheduler.reduce((acc: Date | null, item: ScheduleItem) => {
        if (item.actionDate < now) {
          return acc;
        }
        if (acc && acc < item.actionDate) {
          return acc;
        }
        return item.actionDate;
      }, null);

      if (nextClosestActionTime) {
        const timeDiff = nextClosestActionTime.getTime() - new Date().getTime();
        // jeżeli czas do najbliższej akcji jest większy niż 60s to przywróć działanie managerów
        if (timeDiff > 60 * 1000) {
          console.log('RESTORE MANAGERS')
          this.masterManager.resumeRunningManagers(['scheduler']);
        } else {
          console.log('DO NOT RESTORE MANAGERS')
        }
        return
      }
      // jeżeli czas Data jest zaprzeszła, przywróć działanie managerów
      this.masterManager.resumeRunningManagers(['scheduler']);
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
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains('attack_support_window')) {
              this.extendAttackSupportUI(node as HTMLElement);
              return
            }
          }
        }
      }
    })
    observer.observe(parentNode, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  private async mountCityDialogObserver(): Promise<void> {
    let unobserveAttackSupportSubpages: (() => void) | null = null;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE &&
              (node as HTMLElement).getAttribute('class') === 'ui-dialog ui-corner-all ui-widget ui-widget-content ui-front ui-draggable ui-resizable js-window-main-container') {
              unobserveAttackSupportSubpages = this.mountAttackSupportSubpageObserver(node as HTMLElement);
              return;
            }
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE &&
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
    })

    observer.observe(document.body, {
      childList: true,
    });
  }

  private addSchedulerListConfigWindow(): void {
    const style = document.createElement('style');
    style.textContent = schedulerListCss;
    document.head.appendChild(style);

    const schedulerListConfigWindow = document.createElement('div');
    schedulerListConfigWindow.innerHTML = schedulerListHtml;
    document.body.appendChild(schedulerListConfigWindow);

    this.addSchedulerListConfigListeners();
  }

  private addSchedulerListConfigListeners(): void {
    const toggleButton = document.querySelector<HTMLButtonElement>('#scheduler-toggle-button');
    toggleButton?.addEventListener('click', () => {
      const tableContainer = document.querySelector<HTMLDivElement>('#table-container');
      tableContainer?.classList.toggle('hidden');
    });
  }

  private addSchedulerItemToUI(schedulerItem: ScheduleItem): void {
    const table = document.querySelector<HTMLTableElement>('#scheduler-lookup-table tbody');
    const row = table!.insertRow();
    const id = this.getSchedulerItemId(schedulerItem);
    row.setAttribute('data-scheduler-item-id', id);

    const operaitonTypeCell = row.insertCell();
    operaitonTypeCell.textContent = schedulerItem.operationType === OperationType.ARMY_ATTACK ? 'Attack' : 'Support';
    operaitonTypeCell.classList.add(schedulerItem.operationType === OperationType.ARMY_ATTACK ? 'attack' : 'support');
    row.insertCell().textContent = schedulerItem.sourceCity.name;
    row.insertCell().textContent = schedulerItem.targetCityIdSelector;
    row.insertCell().textContent = schedulerItem.actionDate.toLocaleTimeString();
    row.insertCell().textContent = schedulerItem.targetDate.toLocaleTimeString();

    const cancelButtonCell = row.insertCell();
    const cancelButton = document.createElement('button');
    cancelButton.classList.add('cancel-button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      schedulerItem.cancelSchedule();
      this.removeSchedulerItemFromUI(schedulerItem);
    });
    cancelButtonCell.appendChild(cancelButton);
    this.handleIfSchedulerListIsEmpty();
  }

  private removeSchedulerItemFromUI(schedulerItem: ScheduleItem): void {
    const table = document.querySelector<HTMLTableElement>('#scheduler-lookup-table tbody');
    const row = table!.querySelector(`[data-scheduler-item-id="${this.getSchedulerItemId(schedulerItem)}"]`);
    row!.remove();
    this.handleIfSchedulerListIsEmpty();
  }

  private getSchedulerItemId(schedulerItem: ScheduleItem): string {
    return schedulerItem.operationType + schedulerItem.sourceCity.name + schedulerItem.targetCityIdSelector + schedulerItem.targetDate.getTime() + schedulerItem.actionDate.getTime();
  }

  private handleIfSchedulerListIsEmpty(): void {
    const noSchedules = document.querySelector<HTMLTableElement>('#no-schedules');
    if (this.scheduler.length === 0) {
      noSchedules!.classList.remove('hidden');
    } else {
      noSchedules!.classList.add('hidden');
    }
  }

}