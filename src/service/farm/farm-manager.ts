import EventEmitter from "events";
import gpsConfig, { FarmTimeInterval } from "../../../gps.config";
import ConfigManager from "../../utility/config-manager";
import { addDelay, calculateTimeToNextOccurrence, formatDateToSimpleString, getRandomMs, textToMs } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, waitForElement, waitForElementFromNode, waitForElementInterval, waitForElements, waitForElementsInterval } from "../../utility/ui-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import GeneralInfo from "../master/ui/general-info";

type ScheduleItem = {
  scheduledDate: Date;
  timeout: NodeJS.Timeout;
  city: CityInfo;
}

type CaptainSchedulerItem = {
  scheduledDate: Date;
  timeout: NodeJS.Timeout;
}

enum FarmingSolution {
  Captain,
  Manual
}

export default class FarmManager extends EventEmitter {
  private static instance: FarmManager;
  private citySwitch!: CitySwitchManager;
  private configManager!: ConfigManager;
  private generalInfo!: GeneralInfo;
  private config!: typeof gpsConfig;
  private schedulerArray: ScheduleItem[] = [];
  private captainScheduler: CaptainSchedulerItem | null = null;
  private messageDialogObserver: MutationObserver | null = null;
  private humanMessageDialogObserver: MutationObserver | null = null;
  private lock!: Lock;
  private farmSolution: FarmingSolution = FarmingSolution.Manual;
  private RUN: boolean = false;

  private constructor() {
    super();
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<FarmManager> {
    if (!FarmManager.instance) {
      FarmManager.instance = new FarmManager();
      FarmManager.instance.generalInfo = GeneralInfo.getInstance();
      FarmManager.instance.citySwitch = await CitySwitchManager.getInstance()
      FarmManager.instance.config = ConfigManager.getInstance().getConfig();
      FarmManager.instance.lock = Lock.getInstance();
      await FarmManager.instance.setFarmSolution();
    }
    return FarmManager.instance;
  }

  public async setFarmSolution() {
    const captainPresent = await waitForElement('.advisor_frame.captain .advisor', 4000)
      .then(el => el.classList.contains('captain_active'))
      .catch(() => false);

    this.farmSolution = captainPresent ? FarmingSolution.Captain : FarmingSolution.Manual;
    // this.farmSolution = FarmingSolution.Manual;
  }

  // public async farmWithCaptain() {
  //   try {
  //     await this.lock.acquire('FarmManager.farmWithCaptain()');
  //     this.generalInfo.showInfo('Farm Manager:', 'Farmienie z kapitanem.');
  //     console.log('farmWithCaptain at ', new Date());
  //     this.mountMessageDialogsObservers();

  //     // opening farm overview
  //     document.querySelector<HTMLElement>('[name="farm_town_overview"]')!.click();
  //     this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
  //     // end of opening farm overview

  //     // checking if there is a cooldown
  //     let cooldownWrapper = await waitForElementInterval('.ribbon_wrapper', { retries: 4, interval: 400 }).catch(() => {
  //       throw new Error('cooldownWrapper not found, cannot proceed');
  //     });

  //     if (!cooldownWrapper.classList.contains('hidden')) {
  //       console.log('cooldownWrapper found, not hidden');
  //       let cooldownText;
  //       while (!(cooldownText = cooldownWrapper.querySelector('.ribbon_locked .unlock_time')?.textContent)) {
  //         await addDelay(333);
  //       }
  //       const cooldownTimeTextParsed = cooldownText.match(/\d{2}:\d{2}:\d{2}/)?.[0];
  //       const timeout = calculateTimeToNextOccurrence(cooldownTimeTextParsed!) + 5000;
  //       const scheduledDate = new Date(Date.now() + timeout);

  //       console.log('schedule next farming operation for captain on:', scheduledDate);
  //       const scheduleTimeout = setTimeout(() => {
  //         console.log('performing scheduled farming operation for captain, at:', formatDateToSimpleString(new Date()));
  //         this.farmWithCaptain();
  //       }, timeout);

  //       this.captainScheduler = {
  //         scheduledDate,
  //         timeout: scheduleTimeout
  //       }
  //       document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();
  //       return;
  //     }
  //     // end of checking if there is a cooldown

  //     // selecting cities
  //     await waitForElement('#fto_town_wrapper .checkbox.select_all', 2000).then(el => el.click());
  //     console.log('clicked select all');
  //     this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : null;

  //     this.config.farmingCities.forEach(city => {
  //       for (const cityLabel of document.querySelectorAll<HTMLElement>(`#fto_town_wrapper .gp_town_link`)) {
  //         if (cityLabel.textContent === city.name) {
  //           const checbkox = cityLabel.parentElement!.querySelector<HTMLElement>('.checkbox.town_checkbox')!;
  //           if (!checbkox.classList.contains('checked')) {
  //             checbkox.click();
  //             break;
  //           }
  //         }
  //       }
  //     })
  //     console.log('select farming cities');
  //     // end of selecting cities

  //     //selecting farm option
  //     console.log('select farm options');
  //     await addDelay(500);
  //     const farmOptions = document.querySelectorAll<HTMLElement>('.fto_time_checkbox')!;
  //     const farmOptionIndex = this.getFarmOptionIndex()!;
  //     farmOptions[farmOptionIndex].click();
  //     this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
  //     farmOptions[farmOptionIndex + 4]?.click();
  //     this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
  //     // end of selecting farm option

  //     // collecting resources
  //     console.log('collecting resources');
  //     document.querySelector<HTMLElement>('#fto_claim_button')!.click();
  //     this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
  //     // end of collecting resources

  //     // finding new cooldown
  //     console.log('finding new cooldown');
  //     let newCooldownText;
  //     while (!(newCooldownText = document.querySelector('.ribbon_wrapper .ribbon_locked .unlock_time')?.textContent?.trim())) {
  //       await addDelay(333);
  //     }
  //     // end of finding new cooldown

  //     // calculating time to next occurrence
  //     const newCooldownTextParsed = newCooldownText!.match(/\d{2}:\d{2}:\d{2}/)?.[0];
  //     const timeout = calculateTimeToNextOccurrence(newCooldownTextParsed!) + 5000;
  //     const scheduledDate = new Date(Date.now() + timeout);
  //     console.log('schedule next farming operation for captain on:', scheduledDate);
  //     const scheduleTimeout = setTimeout(() => {
  //       console.log('performing scheduled farming operation for captain, at:', formatDateToSimpleString(new Date()));
  //       this.farmWithCaptain();
  //     }, timeout);

  //     this.captainScheduler = {
  //       scheduledDate,
  //       timeout: scheduleTimeout
  //     }
  //     document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();
  //   } catch (e) {
  //     console.warn('FarmManager.farmWithCaptain().catch', e);
  //   } finally {
  //     console.log('captain scheduler:', this.captainScheduler);
  //     this.disconnectObservers();
  //     this.generalInfo.hideInfo();
  //     this.lock.release();
  //   }
  // }
  public async farmWithCaptain(scheduled: boolean = false) {
    try {
      await this.lock.acquire('FarmManager.farmWithCaptain()');
      this.generalInfo.showInfo('Farm Manager:', 'Farmienie z kapitanem.');
      console.log('farmWithCaptain at ', new Date());
      this.mountMessageDialogsObservers();

      // opening farm overview
      document.querySelector<HTMLElement>('[name="farm_town_overview"]')!.click();
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
      // end of opening farm overview

      if (!scheduled) {
        // checking if there is a cooldown
        let cooldownWrapper = await waitForElementInterval('.ribbon_wrapper', { retries: 4, interval: 400 }).catch(() => {
          throw new Error('cooldownWrapper not found, cannot proceed');
        });

        if (!cooldownWrapper.classList.contains('hidden')) {
          console.log('cooldownWrapper found, not hidden');
          let cooldownText;
          while (!(cooldownText = cooldownWrapper.querySelector('.ribbon_locked .unlock_time')?.textContent)) {
            await addDelay(333);
          }
          const cooldownTimeTextParsed = cooldownText.match(/\d{2}:\d{2}:\d{2}/)?.[0];
          const timeout = calculateTimeToNextOccurrence(cooldownTimeTextParsed!) + this.config.general.timeDifference + 1000;
          const scheduledDate = new Date(Date.now() + timeout);

          console.log('schedule next farming operation for captain on:', scheduledDate);
          const scheduleTimeout = setTimeout(() => {
            console.log('performing scheduled farming operation for captain, at:', formatDateToSimpleString(new Date()));
            this.farmWithCaptain(true);
          }, timeout);

          this.captainScheduler = {
            scheduledDate,
            timeout: scheduleTimeout
          }
          document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();
          return;
        }
      }
      // end of checking if there is a cooldown

      while (document.querySelector<HTMLElement>('#fto_town_wrapper .button.button_new')?.classList.contains('disabled')) {
        await addDelay(500);
      }

      // selecting cities
      console.log('clicked select all');
      await waitForElementInterval('#fto_town_wrapper .checkbox.select_all', { retries: 4, interval: 500 })
      .then(el => el.click())
      .then(async () => {
        while (!document.querySelector<HTMLElement>('#fto_town_wrapper .checkbox.select_all')?.classList.contains('checked')) {
          await addDelay(500);
        }
      });
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : null;

      const allCityLabels = document.querySelectorAll<HTMLElement>(`#fto_town_wrapper .gp_town_link`);
      for (const city of this.config.farmConfig.farmingCities) {
        for (const cityLabel of allCityLabels) {
          if (cityLabel.textContent === city.name) {
            const checbkox = cityLabel.parentElement!.querySelector<HTMLElement>('.checkbox.town_checkbox')!;
            if (!checbkox.classList.contains('checked')) {
              console.log('clicking town checkbox', city.name);
              checbkox.click();
              await addDelay(100);
              break;
            }
          }
        }
      }
      // end of selecting cities

      //selecting farm option
      console.log('select farm options');
      await addDelay(500);
      const farmOptions = document.querySelectorAll<HTMLElement>('.fto_time_checkbox')!;
      const farmOptionIndex = this.getFarmOptionIndex()!;
      !farmOptions[farmOptionIndex].classList.contains('checked') && farmOptions[farmOptionIndex].click();
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
      !farmOptions[farmOptionIndex + 4]?.classList.contains('checked') && farmOptions[farmOptionIndex + 4]?.click();
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
      // end of selecting farm option

      // collecting resources
      console.log('collecting resources');
      document.querySelector<HTMLElement>('#fto_claim_button')!.click();
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
      // end of collecting resources

      // finding new cooldown
      console.log('finding new cooldown');
      let newCooldownText;
      while (!(newCooldownText = document.querySelector('.ribbon_wrapper .ribbon_locked .unlock_time')?.textContent?.trim())) {
        await addDelay(333);
      }
      // end of finding new cooldown

      // calculating time to next occurrence
      const newCooldownTextParsed = newCooldownText!.match(/\d{2}:\d{2}:\d{2}/)?.[0];
      const timeout = calculateTimeToNextOccurrence(newCooldownTextParsed!) + this.config.general.timeDifference + 1000;
      const scheduledDate = new Date(Date.now() + timeout);
      console.log('schedule next farming operation for captain on:', scheduledDate);
      const scheduleTimeout = setTimeout(() => {
        console.log('performing scheduled farming operation for captain, at:', formatDateToSimpleString(new Date()));
        this.farmWithCaptain(true);
      }, timeout);

      this.captainScheduler = {
        scheduledDate,
        timeout: scheduleTimeout
      }
      document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();
    } catch (e) {
      console.warn('FarmManager.farmWithCaptain().catch', e, 'will reschedule in 2 minutes');
      this.captainScheduler = {
        timeout: setTimeout(() => {
          this.farmWithCaptain();
        }, 2 * 60 * 1000),
        scheduledDate: new Date(Date.now() + 2 * 60 * 1000)
      }
    } finally {
      console.log('captain scheduler:', this.captainScheduler);
      this.disconnectObservers();
      this.generalInfo.hideInfo();
      this.lock.release();
    }
  }

  public async start() {
    if (!this.RUN) {
      console.log('FarmManager started');
      this.RUN = true;
      await this.initFarmAllVillages();
    }
  }

  /**
   * Obecna implementacja. Sprawdzenie pierwszej wioski z brzegu, czy posiada czas oczekiwania. 
   * -jeżeli nie, farmienie wszystkich posiadanych wiosek na wyspie (bez względu na stan)
   * -jeżeli tak (nawet jeżeli pozostałe nie mają czasu oczekiwania), ma miejsce oczekiwanie
   * 
   * Sposób działania w przypadku wielu miast gracza:
   * -Wzięcia locka raz na wszystkie miasta
   * -iteracja przez wszystkie miasta (switchowanie miast)
   * -farmienie jednym ciągiem tzn traktowanie, że wszystkie miasta mają zawsze ta samą strategię farmienia wiosek i są na tym samym czasie oczekiwania
   * 
   * Alternatywne podejście
   * -na każde miasto gracza jest osobny callback
   *  :w efekcie każde miasto może farmić swoje wioski z potencjalnie innym odsępem czasowym
   * -wszystkie wioski przypisane od miasta są traktowane jako jeden byt, czyli losowa wioska określa ten sam czas oczekiwania dla wszystkich innych
   * -sposób przechodzenia między wioskami ten sam: inicjalna funkcja start, która bierze Locka raz na wszystkie iteracje miast
   *  a potem farmienie przez callbacki
   */
  private async farmVillages(city: CityInfo) {
    try {
      console.log('farmVillages, wait for lock', city.name);
      await this.lock.acquire();
      this.generalInfo.showInfo('Farm Manager:', `farmienie w mieście: ${city.name}`);
      console.log('farmVillages, take lock', city.name);
      await this.farmVillagesFlow(city);
    } catch (e) {
      console.warn('FarmManager.farmVillages().catch', e);
    } finally {
      this.disconnectObservers();
      console.log('farmVillages, release lock', city.name);
      this.generalInfo.hideInfo();
      this.lock.release();
      this.emit('farmingFinished');
    }
  }

  /**
   * Make sure, that if there are 2 or more cities on the same isle not to duplicate farming operation and scheduling.
   * Although nothing bad or unpredictable will happen, it is a waste of resources. 
   * Solution
   * :store villages unique selectors, and check if previous ones (on condtition that there is more than 1 village) are not the same.
   *  -if previous ones are the same, omit
   *  -else allow normal flow
   */
  private async farmVillagesFlow(city: CityInfo, forced: boolean = false) {
    try {
      console.log('farmVillagesFlow, switch to city', city.name, new Date());
      await city.switchAction();

      let timeout: number = this.config.farmConfig.farmInterval;

      this.config.farmConfig.humanize ? addDelay(getRandomMs(400, 1200)) : addDelay(333);

      // Selectors mapping and timeout check
      const villages = await waitForElementsInterval('a.owned.farm_town[data-same_island="true"]', { timeout: 3000 }).catch(() => null);
      console.log('\t-villages to farm:', villages?.length);

      if (!villages || villages.length === 0) return;
      const villageStyleSelectors = Array.from(villages).map(v => {
        return `[style="${v.getAttribute('style')}"]`
      })

      const villagesAmount = villageStyleSelectors.length;
      this.mountMessageDialogsObservers(city);

      for (const [i, villageSelector] of villageStyleSelectors.entries()) {
        console.log(`\t-checking village: ${i}, from town: ${city.name}`);

        let counter = 0;
        do {
          console.log('\t-clicking village element on the map', counter);
          await performComplexClick(document.querySelector<HTMLElement>(villageSelector)!);
          console.log('\t-clicked village element on the map', counter);
          await addDelay(100);
          if (counter === 3) throw new Error('Farm villages dialog didn\'t show up');
          counter++;
        } while (!(await waitForElementInterval('.farm_towns', { retries: 3, interval: 500 }).catch(() => false)));
        this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);

        const farmOptionIndex = this.getFarmOptionIndex();

        counter = 0;
        do {
          console.log('\t-clicking farm button', counter);
          await waitForElements('.btn_claim_resources.button.button_new', 500)
            .then((els) => els[farmOptionIndex].click())
            .catch(() => { });
          console.log('\t-clicked farm button', counter);
          if (counter === 3) throw new Error('Farm button not found');
          counter++;
          await addDelay(100);
        } while (!await waitForElement('.actions_locked_banner.cooldown', 1500).catch(() => false));
        this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);

        if (i === villagesAmount - 1) {
          timeout = await this.getUnlockTimeOrNull(await waitForElement('.farm_towns'), 2000) ?? this.config.farmConfig.farmInterval;
        }

        console.log('\t-closing village window');
        await waitForElement('.btn_wnd.close', 2000).then(el => el.click()).catch(() => { })
        console.log('\t-closed village window');
        this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
      }

      this.disconnectObservers();
      this.scheduleNextFarmingOperationForCity(timeout + 1000, city);

    } catch (e) {
      console.warn('FarmManager.farmVillagesFlow().catch', e);
      await this.forceRepeatFarming(city);
    }
  }

  /**
   * Bierze locka, iteruje przez wszystkie miasta, farmi wszystkie wioski danego miasta, dodaje osobnego callbacka dla każdego miasta.
   * Po przejściu powraca do pierwszego miasta, zwraca locka, a wioski będą farmione przez osobną metodę: 'farmVillages'.
   */
  private async initFarmAllVillages() {
    if (this.farmSolution === FarmingSolution.Captain) {
      await this.farmWithCaptain();
    } else {
      const cityList = this.config.farmConfig.farmingCities.map(city => this.citySwitch.getCityList().find(c => c.name === city.name)!);

      try {
        console.log('initFarmAllVillages, wait for lock', new Date());
        await this.lock.acquire('FarmManager.initFarmAllVillages()');
        this.generalInfo.showInfo('Farm Manager:', 'Inicjalizacja/farmienie wszystkich wiosek.');
        console.log('initFarmAllVillages, take lock', new Date());
        for (const cityInfo of cityList) {
          await this.farmVillagesFlow(cityInfo);
        }
        if (cityList.length !== 1) await cityList[0].switchAction();
      } catch (e) {
        console.warn('FarmManager.initFarmAllVillages().catch', e);
      } finally {
        this.generalInfo.hideInfo();
        this.lock.release();
        this.messageDialogObserver?.disconnect();
        this.emit('farmingFinished');
      }
    }
  }

  private async forceRepeatFarming(city: CityInfo) {
    await city.switchAction();
    await this.farmVillagesFlow(city, true);
  }

  private disconnectObservers() {
    this.messageDialogObserver?.disconnect();
    this.humanMessageDialogObserver?.disconnect();
  }

  private scheduleNextFarmingOperationForCity = (timeInterval: number, city: CityInfo) => {
    const scheduledDate = new Date(Date.now() + timeInterval);
    const scheduleItem = {
      scheduledDate,
      timeout: null as NodeJS.Timeout | null,
      city
    }

    const timeout = setTimeout(async () => {
      this.schedulerArray = this.schedulerArray.filter(item => item !== scheduleItem)
      this.farmVillages(city);
    }, timeInterval);

    scheduleItem.timeout = timeout;
    this.schedulerArray.push(scheduleItem as ScheduleItem);
    console.log('scheduler:', this.schedulerArray);
  }

  /**
   * Metoda jest odpowiedzią na blokadę farmienia wynikającą z konieczności potwierdzenia farmienia w przypadku pełengo magazynu.
   * Metoda obserwuje czy pojawił się popup z promptem do potwierdzenia kontynuacji i klika akceptuj.
   */
  private mountMessageDialogsObservers = async (city?: CityInfo) => {
    if (!this.messageDialogObserver) {
      const observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node instanceof HTMLElement && node.getAttribute('class') === 'window_curtain ui-front show_curtain is_modal_window') {
                await addDelay(100);
                const confirmButton = node.querySelector('.btn_confirm.button_new') as HTMLElement;
                confirmButton.click();
                return;
              }
            }
          }
        }
      });
      this.messageDialogObserver = observer;
      this.messageDialogObserver.observe(document.body, { childList: true })
    }

    if (!this.humanMessageDialogObserver && city) {
      const observer = new MutationObserver(async (mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            observer.disconnect();
            await city.switchAction();
          }
        }
      })

      this.humanMessageDialogObserver = observer;
      observer.observe(document.querySelector('#human_message')!, { childList: true, subtree: true })
    }
    this.messageDialogObserver.observe(document.body, { childList: true })
  }

  private async getUnlockTimeOrNull(window: HTMLElement, timeout?: number): Promise<number | null> {
    const cooldownBar = await waitForElementFromNode(window, '.actions_locked_banner.cooldown', timeout ?? 500).catch(() => null);
    if (cooldownBar) {
      const unlcokTimeEl = cooldownBar.querySelector('.pb_bpv_unlock_time')
      return new Promise((res, rej) => {
        let counter = 0;
        const getTextInterval = setInterval(() => {
          if (unlcokTimeEl?.textContent) {
            clearInterval(getTextInterval);
            console.log('next unlock time:', unlcokTimeEl.textContent);
            res(textToMs(unlcokTimeEl.textContent))
          }
          else if (counter === 10) {
            clearInterval(getTextInterval);
            console.warn('nie znaleziono czasu odblokowania');
            res(null);
          }
          counter++;
        }, 100)
      })
    }

    return null;
  }

  /**
   * Depending on the length of the farm options, it returns the index of the farm option to click.
   */
  private getFarmOptionIndex() {
    switch (this.config.farmConfig.farmInterval) {
      case FarmTimeInterval.FirstOption:
        return 0;
      case FarmTimeInterval.SecondOption:
        return 1;
      case FarmTimeInterval.ThirdOption:
        return 2;
      case FarmTimeInterval.FourthOption:
        return 3;
      default:
        return 0;
    }
  }

  private getFarmOptionTimeRegex() {
    switch (this.config.farmConfig.farmInterval) {
      case FarmTimeInterval.FirstOption:
        return /(5|10)/;
      case FarmTimeInterval.SecondOption:
        return /^(20|40)/;
      case FarmTimeInterval.ThirdOption:
        return /^(1.*30|3\D+)/;
      case FarmTimeInterval.FourthOption:
        return /^(4|8)h/;
      default:
        return /^(5|10)/;
    }
  }

  private getFarmOption() {
    return Array.from(document.querySelectorAll<HTMLElement>('.btn_claim_resources.button.button_new'))
      .find((el) => this.getFarmOptionTimeRegex().test(el.textContent ?? ''));
  }

  public stop() {
    this.RUN = false;
    console.log('FarmManager stopped');
    // manual related
    this.schedulerArray.forEach(item => {
      clearTimeout(item.timeout);
    })
    this.schedulerArray = [];
    // captain related
    this.captainScheduler && clearTimeout(this.captainScheduler.timeout);
    this.captainScheduler = null;
  }

  public isRunning(): boolean {
    return this.RUN;
  }
}