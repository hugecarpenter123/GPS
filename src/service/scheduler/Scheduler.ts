import { TConfig } from "../../../gps.config";
import ConfigManager from "../../utility/config-manager";
import { InfoError } from "../../utility/info-error";
import { addDelay, getBrowserStateSnapshot, getElementStateSnapshot, textToMs } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, setInputValue, triggerHover, waitForElement, waitForElementInterval, waitForElements } from "../../utility/ui-utility";
import ArmyMovement from "../army/army-movement";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import MasterManager from "../master/master-manager";
import GeneralInfo from "../master/ui/general-info";
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
  timeoutPreparation: NodeJS.Timeout | null;
  timeoutPreAction: NodeJS.Timeout | null;
  timeoutAction: NodeJS.Timeout | null;
}

type ScheduleItem = {
  id: string;
  operationType: OperationType;
  attackTypeSelector?: string;
  attackStrategySelector?: string;
  powerSelector?: string | null;
  movementId: string | null;
  undoMovementAction: (() => void) | null;
  targetDate: Date;
  actionDate: Date;
  realActionTime: number;
  sourceCity: CityInfo;
  targetCitySelector: string;
  targetCityName: string;
  data: any;
  includeHero?: boolean;
  /**
   * Przechowuje timeouty do anulowania operacji, które są wykonują etapy przygotowawcze do operacji oraz samą operację
   */
  timeoutStructure: TimeoutStructure;
  /**
   * Anuluje timeouty, usuwa item z schedulera, przywraca działanie managerów i zwalnia locka
   */
  cancelSchedule: () => Promise<void>;
  /**
   * Po wykonaniu operacji, przywraca działanie managerów, zwalnia locka a po 10/0 minutach usuwa item z schedulera
   */
  postActionCleanup: () => Promise<void>;
}

export default class Scheduler {
  public static readonly MIN_PRECEDENCE_TIME_MS = 10 * 1000;
  public static readonly TURN_OFF_MANAGERS_TIME_MS = 20 * 1000;
  public static readonly PREPARATION_TIME_MS = 10 * 1000;

  private static instance: Scheduler;
  private lock!: Lock;
  private isLockTakenByScheduler: boolean = false;
  private generalInfo!: GeneralInfo;
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
      Scheduler.instance.generalInfo = GeneralInfo.getInstance();
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
      // const inputData = Array.from(node.querySelectorAll<HTMLInputElement>('.unit_input')).map(inputEl => {
      //   return inputEl.value ? {
      //     name: inputEl.getAttribute('name')!,
      //     value: inputEl.value
      //   } : null
      // }).filter(data => data !== null);

      // hero related
      const includeHero = node.querySelector<HTMLElement>('.cbx_include_hero')?.classList.contains('checked');
      // -------------

      // operation type related
      const operationType = node.firstElementChild!.getAttribute('data-type') === 'attack' ? OperationType.ARMY_ATTACK : OperationType.ARMY_SUPPORT;
      const attackTypeSelector = operationType === OperationType.ARMY_ATTACK ?
        (`[data-attack='${(document.querySelector('.attack_type.checked') as HTMLElement)?.dataset['attack']}']`) : undefined;

      const allCheckedStrategies = document.querySelectorAll<HTMLElement>('.attack_strategy.checked');
      const lastCheckedStrategy = Array.from(allCheckedStrategies).at(-1);
      const attackStrategySelector = lastCheckedStrategy ? `#${lastCheckedStrategy?.id}` : undefined;
      // -------------

      // power related
      const powerElement = document.querySelector<HTMLElement>('.spells.power.power_icon45x45');
      let powerSelector = null;
      if (!powerElement?.classList.contains('no_power')) {
        const powerDataName = powerElement?.classList.item(3);
        powerSelector = `[data-power_id='${powerDataName}']`;
      }
      // -------------

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

      document.querySelector<HTMLInputElement>('[data-menu_name="Info"]')!.click();
      await addDelay(100);

      const targetCityName = await waitForElementInterval('#towninfo_towninfo .game_header.bold', { interval: 500, timeout: 2000 }).then(el => (el as HTMLElement).textContent!.trim());
      const id = `${operationType}_${sourceCity!.name}_${targetCityName}_${actionDate.getTime()}`;


      await waitForElementInterval('.info_jump_to_town', { interval: 500, retries: 3 })
        .then(el => el.click())
        .catch(() => {
          this.error = 'Schedule failed. Failed to switch to the city for grids.'
          return;
        });

      (await waitForElements('.minimized_windows_area .btn_wnd.close', 2000)).forEach(el => el.click());
      await addDelay(500);

      document.querySelector<HTMLInputElement>('.btn_save_location')?.click();
      await addDelay(100);

      await waitForElement('.save_coordinates input', 4000)
        .then(el => {
          setInputValue(el as HTMLInputElement, id);
          el.blur();
        })
        .catch(() => { throw new Error('Failed to save coordinates') });
      await addDelay(100);

      await waitForElement('.save_coordinates .btn_confirm', 3000)
        .then(el => (el as HTMLButtonElement).click())
        .catch(() => { throw new Error('Failed to confirm saving coordinates') });


      const scheduleTimeout: TimeoutStructure = {
        timeoutPreparation: null,
        timeoutPreAction: null,
        timeoutAction: null,
      }

      const schedulerItem: ScheduleItem = {
        id: id,
        operationType: operationType,
        attackTypeSelector: attackTypeSelector,
        attackStrategySelector: attackStrategySelector,
        powerSelector: powerSelector,
        targetDate: targetDate,
        targetCityName: targetCityName,
        actionDate: actionDate,
        realActionTime: actionDate.getTime() + this.config.general.timeDifference,
        sourceCity: sourceCity!,
        targetCitySelector: targetCitySelector,
        data: inputData,
        includeHero: includeHero,
        timeoutStructure: scheduleTimeout,
        movementId: null,
        undoMovementAction: null,
        cancelSchedule: async () => await this.cancelSchedule(schedulerItem),
        postActionCleanup: async () => await this.postActionCleanup(schedulerItem),
      }
      this.addActionTimeouts(schedulerItem);
      this.scheduler.push(schedulerItem);
      this.addSchedulerItemToUI(schedulerItem);
      localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
      this.info = 'Operation scheduled'
      console.log('Scheduler.extendAttackSupportUI.schedulerItem', schedulerItem);
    });
  }

  private async postActionCleanup(schedulerItem: ScheduleItem) {
    setTimeout(() => {
      this.removeSchedulerItemFromUI(schedulerItem);
      this.scheduler = this.scheduler.filter((item) => item !== schedulerItem);
      localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
    }, 0);
    if (this.isLockTakenByScheduler) this.lock.release();
    this.isLockTakenByScheduler = false;
    this.generalInfo.showInfo('Scheduler:', 'Czyszczenie cache po operacji.');
    await this.removeSavedCoords(schedulerItem.id);
    this.generalInfo.hideInfo();
    this.tryRestoreManagers();
  }

  private async cancelSchedule(schedulerItem: ScheduleItem) {
    this.generalInfo.showInfo('Scheduler:', 'Anulowanie operacji.');
    const { timeoutStructure } = schedulerItem;
    if (timeoutStructure.timeoutPreparation) clearTimeout(timeoutStructure.timeoutPreparation)
    if (timeoutStructure.timeoutPreAction) clearTimeout(timeoutStructure.timeoutPreAction)
    if (timeoutStructure.timeoutAction) clearTimeout(timeoutStructure.timeoutAction)
    if (this.isLockTakenByScheduler) {
      this.lock.release();
      this.isLockTakenByScheduler = false;
    }
    this.scheduler = this.scheduler.filter(item => item !== schedulerItem)
    localStorage.setItem('scheduler', JSON.stringify(this.scheduler));
    this.removeSchedulerItemFromUI(schedulerItem);
    await this.removeSavedCoords(schedulerItem.id);
    this.generalInfo.hideInfo();
    this.tryRestoreManagers();
  }

  private async removeSavedCoords(id: string) {
    Array.from(document.querySelectorAll<HTMLInputElement>('.content.js-dropdown-item-list .item.bookmark'))
      .find(el => el.textContent?.trim() === id)?.querySelector<HTMLElement>('.remove')?.click();

    await waitForElementInterval('.confirmation .btn_confirm', { interval: 500, timeout: 2000 })
      .then(el => (el as HTMLButtonElement).click());
  }

  private readCords(): [string, string] {
    const gridXInput = document.querySelector<HTMLInputElement>('.coord.coord_x.js-coord-x input[type="text"]')!;
    const gridYInput = document.querySelector<HTMLInputElement>('.coord.coord_y.js-coord-y input[type="text"]')!;
    return [gridXInput.value, gridYInput.value];
  }

  private addActionTimeouts(schedulerItem: ScheduleItem) {
    const {
      actionDate,
      realActionTime,
      timeoutStructure,
      targetCitySelector,
      data: inputData,
      operationType,
      attackTypeSelector,
      attackStrategySelector,
      powerSelector
    } = schedulerItem;

    const turnOffManagersTime = realActionTime - new Date().getTime() - Scheduler.TURN_OFF_MANAGERS_TIME_MS;
    // console.log('calculated turn off managers time:', turnOffManagersTime);
    timeoutStructure.timeoutPreparation = setTimeout(() => {
      this.generalInfo.showInfo('Scheduler:', 'pauzowanie kolidujących managerów przed operacją.')
      // console.log('NOW half minute before action, time is:', formatDateToSimpleString(new Date()))
      this.masterManager.pauseRunningManagersIfNeeded(realActionTime, ['scheduler']);
      const preparationTime = realActionTime - new Date().getTime() - Scheduler.PREPARATION_TIME_MS;
      timeoutStructure.timeoutPreAction = setTimeout(async () => {
        try {
          // console.log('NOW ten seconds before action, time is:', formatDateToSimpleString(new Date()), 'try take lock');
          await this.lock.forceAcquire({ manager: 'scheduler' });
          // console.log('lock taken');
          this.isLockTakenByScheduler = true;
          this.generalInfo.showInfo('Scheduler:', 'przygotowanie do operacji.')

          // console.log('switch to sourceCity:', schedulerItem.sourceCity);
          await schedulerItem.sourceCity.switchAction();

          // przejdź do współrzędnych
          document.querySelector<HTMLButtonElement>('.js-coord-button')?.click();
          const dropdownList = await waitForElement('.content.js-dropdown-item-list', 4000);
          const dropdownItem = Array.from(dropdownList.querySelectorAll<HTMLElement>(`.item.bookmark.option`))
            .find(el => el.textContent?.trim() === schedulerItem.id);
          if (!dropdownItem) throw new Error('Failed to find dropdown item');
          dropdownItem.click();
          await addDelay(400);

          // znajdź wioskę i kliknij odpowiednią operację
          document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click()
          const targetCityElement = await waitForElementInterval(targetCitySelector, { interval: 500, retries: 4 })
            .catch(() => {
              throw new InfoError('target city not found', {
                browserState: getBrowserStateSnapshot(),
              })
            })

          const targetCityElementSnapshot = getElementStateSnapshot(targetCityElement);
          // console.log('targetCityElement', targetCityElement);

          let counter = 0;
          do {
            await performComplexClick(targetCityElement);
            counter++;
            await addDelay(333);
          }
          while (!document.querySelector<HTMLElement>('#context_menu') && counter < 4)

          if (counter === 4) {
            const snapshot = {
              browserState: getBrowserStateSnapshot(),
              elementState: targetCityElementSnapshot,
            }
            throw new InfoError('target city not found', snapshot);
          }

          if (operationType === OperationType.ARMY_ATTACK) {
            console.log('operationType === OperationType.ARMY_ATTACK');
            (await waitForElementInterval('#attack', { interval: 500, timeout: 2000 })).click();
            console.log('attack clicked', document.querySelector<HTMLElement>('#attack'));
            attackTypeSelector && await waitForElementInterval(attackTypeSelector, { interval: 500, timeout: 2000 }).then(el => (el as HTMLElement).click());
            console.log('attackTypeSelector clicked', document.querySelector<HTMLElement>(attackTypeSelector!));
            attackStrategySelector && await waitForElementInterval(attackStrategySelector, { interval: 500, timeout: 2000 }).then(el => (el as HTMLElement).click())
            console.log('attackStrategySelector clicked', document.querySelector<HTMLElement>(attackStrategySelector!));

            if (powerSelector) {
              console.log('powerSelector', powerSelector);
              await waitForElementInterval('#spells_1', { interval: 500, timeout: 2000 }).then(el => (el as HTMLElement).click());
              console.log('spells_1', document.querySelector<HTMLElement>('#spells_1'));
              await waitForElementInterval(powerSelector, { interval: 500, timeout: 2000 }).then(el => (el as HTMLElement).click());
              console.log('powerSelector', document.querySelector<HTMLElement>(powerSelector));
            } else {
              console.log('no powerSelector');
            }
          } else {
            (await waitForElementInterval('#support', { interval: 500, timeout: 2000 })).click();
          }

          // wypełnij inputy
          console.log('fill inputData');
          for (const data of inputData) {
            if (data.value) {
              const input = await waitForElementInterval(`input[name="${data.name}"]`, { interval: 500, timeout: 2000 }) as HTMLInputElement;
              setInputValue(input, data.value);
              input.blur();
            }
          };

          if (schedulerItem.includeHero) {
            console.log('should include hero');
            (await waitForElementInterval('.cbx_include_hero')).click();
          }

          console.log('action prepared successfully, snapshot:', {
            browserState: getBrowserStateSnapshot(),
            elementState: targetCityElementSnapshot,
          });

        } catch (error) {
          if (error instanceof InfoError) {
            console.warn('Error during 10 seconds before action:', error.message, error.details);
          } else {
            console.error('Error during 10 seconds before action:', error);
          }
          this.error = 'Schedule failed. Check console for more details.'
          this.generalInfo.hideInfo();
          schedulerItem.cancelSchedule();
          return;
        }

        timeoutStructure.timeoutAction = setTimeout(async () => {
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
            schedulerItem.cancelSchedule();
            console.error('Error during action:', error);
            this.error = 'Schedule failed. Check console for more details.'
          } finally {
            schedulerItem.postActionCleanup();
          }
        }, realActionTime - new Date().getTime());

      }, preparationTime)

    }, turnOffManagersTime);
  }

  private goToCoords(coords: [string, string]) {
    const gridXInput = document.querySelector<HTMLInputElement>('.coord.coord_x.js-coord-x input[type="text"]')!;
    const gridYInput = document.querySelector<HTMLInputElement>('.coord.coord_y.js-coord-y input[type="text"]')!;
    setInputValue(gridXInput, coords[0]);
    setInputValue(gridYInput, coords[1]);
    document.querySelector<HTMLElement>('.btn_jump_to_coordination')!.click();
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
      schedulerItem.sourceCity = this.citySwitchManager.getCityByName(schedulerItem.sourceCity.name)!; //TODO: possible erorr

      if (!this.canAddSchedulerItem(schedulerItem.actionDate)) {
        console.warn('unsafe operation, failed to be scheudled during hydration');
        this.hydrationError = `${schedulerItem.sourceCity.name} ${schedulerItem.operationType === OperationType.ARMY_ATTACK ? 'attack' : 'support'} operation  at '${schedulerItem.targetDate}' on city "${schedulerItem.targetCitySelector}" failed to be scheduled during hydration.`;
        return;
      }

      schedulerItem.cancelSchedule = async () => await this.cancelSchedule(schedulerItem);
      schedulerItem.postActionCleanup = async () => await this.postActionCleanup(schedulerItem);

      this.addActionTimeouts(schedulerItem);
      this.scheduler.push(schedulerItem);
      this.addSchedulerItemToUI(schedulerItem);
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
    const tableContainer = document.querySelector<HTMLDivElement>('#table-container');
    toggleButton?.addEventListener('click', () => {
      tableContainer?.classList.toggle('hidden');
    });

    const closeIcon = document.querySelector<HTMLDivElement>('.close-icon');
    closeIcon?.addEventListener('click', () => {
      tableContainer?.classList.add('hidden');
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
    row.insertCell().textContent = schedulerItem.targetCityName;
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
    console.log('removeSchedulerItemFromUI', schedulerItem);
    const table = document.querySelector<HTMLTableElement>('#scheduler-lookup-table tbody');
    const row = table!.querySelector(`[data-scheduler-item-id="${this.getSchedulerItemId(schedulerItem)}"]`);
    row?.remove();
    this.handleIfSchedulerListIsEmpty();
  }

  private getSchedulerItemId(schedulerItem: ScheduleItem): string {
    return `${schedulerItem.operationType}_${schedulerItem.sourceCity.name}_${schedulerItem.targetCityName}_${schedulerItem.actionDate.getTime()}`;
  }

  private handleIfSchedulerListIsEmpty(): void {
    const noSchedules = document.querySelector<HTMLTableElement>('#no-schedules');
    if (this.scheduler.length === 0) {
      noSchedules!.classList.remove('hidden');
    } else {
      noSchedules!.classList.add('hidden');
    }
  }

  public canSafelyRefresh(): boolean {
    return this.scheduler.length === 0 || this.scheduler.every((item) => item.actionDate > new Date(new Date().getTime() + 120 * 1000));
  }
}