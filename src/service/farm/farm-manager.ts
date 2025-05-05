import EventEmitter from 'events';
import gpsConfig, { FarmTimeInterval } from '../../../gps.config';
import ConfigManager from '../../utility/config-manager';
import {
  addDelay,
  calculateTimeToNextOccurrence,
  doWhile,
  dateToHHMMSS,
  getBrowserStateSnapshot,
  getElementStateSnapshot,
  getRandomMs,
  HHMMSS_toMS,
  waitWhile,
} from '../../utility/plain-utility';
import Lock from '../../utility/ui-lock';
import {
  performComplexClick,
  waitForElement,
  waitForElementFromNode,
  waitForElementInterval,
  waitForElements,
  waitForElementsInterval,
} from '../../utility/ui-utility';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import GeneralInfo from '../master/ui/general-info';
import { InfoError } from '../../utility/info-error';

type ScheduleItem = {
  scheduledDate: Date;
  timeout: NodeJS.Timeout;
  city: CityInfo;
};

type CaptainSchedulerItem = {
  scheduledDate: Date;
  timeout: NodeJS.Timeout;
};

export enum FarmingSolution {
  Captain,
  Manual,
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
      FarmManager.instance.citySwitch = await CitySwitchManager.getInstance();
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
  }

  public getFarmSolution() {
    return this.farmSolution;
  }

  public getFarmScheduleTimes() {
    return this.farmSolution === FarmingSolution.Captain
      ? [this.captainScheduler?.scheduledDate]
      : this.schedulerArray.map(item => item.scheduledDate);
  }

  public async farmWithCaptain(scheduled: boolean = false) {
    let dialogsSnapshot: Element[] = [];
    try {
      await this.lock.acquire({ method: 'farmWithCaptain', manager: 'farmManager' });
      this.generalInfo.showInfo('Farm Manager:', 'Farmienie z kapitanem.');
      console.log('farmWithCaptain at ', new Date());

      // checking opened dialogs to find know which will be opened
      dialogsSnapshot = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
      // end of checking opened dialogs

      // opening farm overview
      document.querySelector<HTMLElement>('[name="farm_town_overview"]')!.click();
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : null;
      await waitWhile(() => !document.querySelector<HTMLElement>('#fto_town_list'), { delay: 200, maxIterations: 5 });
      // end of opening farm overview

      // checking if there is a cooldown
      {
        if (!document.querySelector('.fto_town.active')) {
          document.querySelector<HTMLElement>('.fto_town')!.click();
        }
        let cooldownWrapper = await waitForElementInterval('.ribbon_wrapper', { retries: 10, interval: 200 }).catch(
          () => {
            throw new InfoError('cooldownWrapper not found, cannot proceed', {
              browserState: getBrowserStateSnapshot(),
              elementState: getElementStateSnapshot(document.querySelector<HTMLElement>('.ribbon_wrapper')!),
            });
          },
        );

        if (!cooldownWrapper.classList.contains('hidden')) {
          console.log('cooldownWrapper found, not hidden');
          let cooldownTimeTextParsed;
          while (
            !(cooldownTimeTextParsed = cooldownWrapper
              .querySelector('.ribbon_locked .unlock_time')
              ?.textContent?.match(/\d{2}:\d{2}:\d{2}/)?.[0])
          ) {
            await addDelay(250);
          }
          const timeout =
            calculateTimeToNextOccurrence(cooldownTimeTextParsed!) + this.config.general.timeDifference + 1000;
          const scheduledDate = new Date(Date.now() + timeout);

          console.log('schedule next farming operation for captain on:', scheduledDate);
          const scheduleTimeout = setTimeout(() => {
            console.log('performing scheduled farming operation for captain, at:', dateToHHMMSS(new Date()));
            this.farmWithCaptain(true);
          }, timeout);

          this.captainScheduler = {
            scheduledDate,
            timeout: scheduleTimeout,
          };
          return;
        }
      }
      // end of checking if there is a cooldown

      while (
        document.querySelector<HTMLElement>('#fto_town_wrapper .button.button_new')?.classList.contains('disabled')
      ) {
        await addDelay(100);
      }

      // selecting cities
      console.log('clicked select all');
      await waitForElementInterval('#fto_town_wrapper .checkbox.select_all', { retries: 4, interval: 500 })
        .then(el => el.click())
        .then(async () => {
          while (
            !document
              .querySelector<HTMLElement>('#fto_town_wrapper .checkbox.select_all')
              ?.classList.contains('checked')
          ) {
            await addDelay(100);
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
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : await addDelay(100);
      !farmOptions[farmOptionIndex + 4]?.classList.contains('checked') && farmOptions[farmOptionIndex + 4]?.click();
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : await addDelay(100);
      // end of selecting farm option

      // collecting resources
      console.log('collecting resources');
      // document.querySelector<HTMLElement>('#fto_claim_button')!.click();
      await waitForElementInterval('#fto_claim_button', { retries: 4, interval: 400 })
        .then(el => el.click())
        .catch(() => {
          throw new Error('collecting resources failed, no button found');
        });
      this.config.farmConfig.humanize ? await addDelay(getRandomMs(400, 1200)) : null;
      // end of collecting resources

      // potentially confirm click confirm button
      await waitForElementInterval('.btn_confirm.button_new', { retries: 5, interval: 400 })
        .then(el => el.click())
        .catch(() => null);
      // end of confirm button click

      // finding new cooldown
      console.log('finding new cooldown');
      let newCooldownParsedTimeText;
      let counter = 0;
      while (
        !(newCooldownParsedTimeText = document
          .querySelector('.ribbon_wrapper .ribbon_locked .unlock_time')
          ?.textContent?.trim()
          .match(/\d{2}:\d{2}:\d{2}/)?.[0]) &&
        counter < 5
      ) {
        await addDelay(400);
        counter++;
      }
      if (counter === 8) throw new Error('new cooldown not found, cannot schedule properly');
      // end of finding new cooldown

      // calculating time to next occurrence
      const timeout =
        calculateTimeToNextOccurrence(newCooldownParsedTimeText!) + this.config.general.timeDifference + 1000;
      const scheduledDate = new Date(Date.now() + timeout);
      console.log('schedule next farming operation for captain on:', scheduledDate);
      const scheduleTimeout = setTimeout(() => {
        console.log('performing scheduled farming operation for captain, at:', dateToHHMMSS(new Date()));
        this.farmWithCaptain(true);
      }, timeout);

      this.captainScheduler = {
        scheduledDate,
        timeout: scheduleTimeout,
      };

      console.log('farmManager.farmWithCaptain.succesfullSnapchot', getBrowserStateSnapshot());
    } catch (e) {
      if (e instanceof InfoError) {
        console.warn('FarmManager.farmWithCaptain().catch', e.message, e.details, 'will reschedule in 2 minutes');
      } else {
        console.warn('FarmManager.farmWithCaptain().catch', e, 'will reschedule in 2 minutes');
      }
      this.captainScheduler = {
        timeout: setTimeout(
          () => {
            this.farmWithCaptain();
          },
          2 * 60 * 1000,
        ),
        scheduledDate: new Date(Date.now() + 2 * 60 * 1000),
      };
    } finally {
      console.log('captain scheduler:', this.captainScheduler);
      this.tryCloseCurrentDialog(Array.from(dialogsSnapshot));
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

  private tryCloseCurrentDialog(dialogsSnapshot: Element[]) {
    const allDialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const currentDialog = Array.from(allDialogs).find(el => !dialogsSnapshot.includes(el));
    currentDialog?.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();
  }

  private async ensureAllChecbkoxesUnchecked() {
    const mainCityChecbkox = await waitForElementInterval('#fto_town_wrapper .checkbox.select_all', {
      timeout: 2000,
      interval: 400,
    });
    if (mainCityChecbkox.classList.contains('checked')) {
      mainCityChecbkox.click();
      await addDelay(100);
    }
    const allCityChecbkoxes = await waitForElementsInterval('#fto_town_wrapper .checkbox.town_checkbox', {
      timeout: 2000,
      interval: 400,
    });
    for (const checkbox of allCityChecbkoxes) {
      if (checkbox.classList.contains('checked')) {
        checkbox.click();
        await addDelay(100);
      }
    }
  }

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

  private async farmVillagesFlow(city: CityInfo, forced: boolean = false) {
    try {
      console.log('farmVillagesFlow, switch to city', city.name, new Date());
      await city.switchAction();

      // Selectors mapping and timeout check
      const villages = await waitForElementsInterval('a.owned.farm_town[data-same_island="true"]', {
        timeout: 3000,
      }).catch(() => null);

      if (!villages || villages.length === 0) return;

      this.mountMessageDialogsObservers(city);

      let masterWindow: HTMLDivElement | null = null;
      await doWhile(
        () => !(masterWindow = document.querySelector('body > .window_curtain >.classic_window.farm_town')),
        async () => {
          await performComplexClick(document.querySelector<HTMLElement>('a.owned.farm_town[data-same_island="true"]')!);
        },
        { delay: 333, maxIterations: 7 },
      );

      let previousVillageName: string | null = null;
      let farmedVillageCounter = 0;

      while (farmedVillageCounter !== villages.length) {
        const currentVillageName = masterWindow!.querySelector<HTMLElement>('.village_name')?.textContent;

        if (previousVillageName === currentVillageName) {
          // await masterWindow!.querySelector<HTMLElement>('.village_info .btn_next')?.click();
          await waitForElementInterval('.village_info .btn_next', {
            retries: 10,
            interval: 200,
            fromNode: masterWindow!,
          }).then(el => {
            console.log('\t-clicked next');
            el.click();
          });
          await waitWhile(
            () => {
              const nextVillageName = masterWindow!.querySelector<HTMLElement>('.village_name')?.textContent;
              return !nextVillageName?.length || previousVillageName === nextVillageName;
            },
            { delay: 200, maxIterations: 10 },
          );
        }
        previousVillageName = masterWindow!.querySelector<HTMLElement>('.village_name')!.textContent;

        const farmOptionIndex = this.getFarmOptionIndex();
        let farmNotOwned = false;
        await waitForElementsInterval('.btn_claim_resources.button.button_new', {
          retries: 10,
          interval: 200,
          fromNode: masterWindow!,
        })
          .then(els => {
            if (!els[farmOptionIndex].classList.contains('disabled')) {
              els[farmOptionIndex].click();
            }
          })
          .catch(() => {
            console.log('\t-could not find farm option buttons');
            farmNotOwned = true;
          });

        // adjust criterion by which it is assessed that village is not owned
        if (farmNotOwned) {
          console.log('\t-village is not owned, skipping');
          continue;
        }
        await waitWhile(() => !document.querySelector('.actions_locked_banner.cooldown'), {
          delay: 200,
          maxIterations: 10,
        });
        farmedVillageCounter++;
      }

      console.log('post loop actions');
      const cooldownTime = await this.getUnlockTimeOrNull(masterWindow!);
      // const timeoutTime = Math.min(cooldownTime ?? Infinity, this.config.farmConfig.farmInterval);
      await waitForElement('.btn_wnd.close', 2000)
        .then(el => el.click())
        .catch(() => {});

      // NOTE: check if this is called in the finally block (remove duplicate if so)
      this.disconnectObservers();
      this.scheduleNextFarmingOperationForCity(cooldownTime ?? this.config.farmConfig.farmInterval + 1000, city);
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
      const cityList = this.config.farmConfig.farmingCities.map(
        city => this.citySwitch.getCityList().find(c => c.name === city.name)!,
      );

      try {
        console.log('initFarmAllVillages, wait for lock', new Date());
        await this.lock.acquire({ method: 'initFarmAllVillages', manager: 'farmManager' });
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
    this.messageDialogObserver = null;
    this.humanMessageDialogObserver?.disconnect();
    this.humanMessageDialogObserver = null;
  }

  private scheduleNextFarmingOperationForCity = (timeInterval: number, city: CityInfo) => {
    const scheduledDate = new Date(Date.now() + timeInterval);
    const scheduleItem = {
      scheduledDate,
      timeout: null as NodeJS.Timeout | null,
      city,
    };

    const timeout = setTimeout(async () => {
      this.schedulerArray = this.schedulerArray.filter(item => item !== scheduleItem);
      this.farmVillages(city);
    }, timeInterval);

    scheduleItem.timeout = timeout;
    this.schedulerArray.push(scheduleItem as ScheduleItem);
    console.log('scheduler:', this.schedulerArray);
  };

  /**
   * Metoda jest odpowiedzią na blokadę farmienia wynikającą z konieczności potwierdzenia farmienia w przypadku pełengo magazynu.
   * Metoda obserwuje czy pojawił się popup z promptem do potwierdzenia kontynuacji i klika akceptuj.
   */
  private mountMessageDialogsObservers = (city?: CityInfo) => {
    if (!this.messageDialogObserver) {
      const observer = new MutationObserver(async mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (
                node instanceof HTMLElement &&
                node.getAttribute('class') === 'window_curtain ui-front show_curtain is_modal_window'
              ) {
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
      this.messageDialogObserver.observe(document.body, { childList: true });
    }

    // NOTE: potentially misuse, beter to move this logic into awaiting block instead of observer
    if (!this.humanMessageDialogObserver && city) {
      const observer = new MutationObserver(async mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            observer.disconnect();
            await city.switchAction();
          }
        }
      });

      this.humanMessageDialogObserver = observer;
      observer.observe(document.querySelector('#human_message')!, { childList: true, subtree: true });
    }
    this.messageDialogObserver.observe(document.body, { childList: true });
  };

  private async getUnlockTimeOrNull(node: HTMLElement): Promise<number | null> {
    const cooldownBar = await waitForElementInterval('.actions_locked_banner.cooldown', {
      retries: 10,
      interval: 200,
      fromNode: node,
    }).catch(() => null);
    if (cooldownBar) {
      const unlcokTimeEl = cooldownBar.querySelector('.pb_bpv_unlock_time');
      return new Promise((res, rej) => {
        let counter = 0;
        const getTextInterval = setInterval(() => {
          if (unlcokTimeEl?.textContent) {
            clearInterval(getTextInterval);
            console.log('next unlock time:', unlcokTimeEl.textContent);
            res(HHMMSS_toMS(unlcokTimeEl.textContent));
          } else if (counter === 10) {
            clearInterval(getTextInterval);
            console.warn('nie znaleziono czasu odblokowania');
            res(null);
          }
          counter++;
        }, 100);
      });
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
    return Array.from(document.querySelectorAll<HTMLElement>('.btn_claim_resources.button.button_new')).find(el =>
      this.getFarmOptionTimeRegex().test(el.textContent ?? ''),
    );
  }

  public stop() {
    this.RUN = false;
    console.log('FarmManager stopped');
    // manual related
    this.schedulerArray.forEach(item => {
      clearTimeout(item.timeout);
    });
    this.schedulerArray = [];
    // captain related
    this.captainScheduler && clearTimeout(this.captainScheduler.timeout);
    this.captainScheduler = null;
  }

  public isRunning(): boolean {
    return this.RUN;
  }
}
