import { TConfigChanges } from '~/config-popup/config-popup';
import Service from '~/utility/Service';
import { FarmTimeInterval, TConfig } from '../../../gps.config';
import ConfigManager from '../../utility/config-manager';
import { InfoError } from '../../utility/info-error';
import {
  addDelay,
  calculateTimeToNextOccurrence,
  dateToHHMMSS,
  doWhile,
  getBrowserStateSnapshot,
  getElementStateSnapshot,
  getRandomMs,
  HHMMSS_toMS,
  waitWhile,
} from '../../utility/plain-utility';
import Lock, { LockOperationCancelledError } from '../../utility/ui-lock';
import {
  getBrowserExecutionContextInfo,
  performComplexClick,
  performOnDocumentVisibilityReturn,
  waitForElementInterval,
  waitForElementsInterval,
} from '../../utility/ui-utility';
import CitySwitchManager, { CityInfo } from '../city/city-switch-manager';
import GeneralInfo from '../master/ui/general-info';
import { EventEmitter } from 'events';

type ScheduleItem = {
  scheduledDate: Date;
  timeout: ReturnType<typeof setTimeout>;
  city: CityInfo;
};

type CaptainSchedulerItem = {
  scheduledDate: Date;
  timeout: ReturnType<typeof setTimeout>;
};

export enum FarmingSolution {
  Captain,
  Manual,
}

export default class Farmer extends EventEmitter implements Service<'farmer'> {
  private static instance: Farmer;
  private citySwitch!: CitySwitchManager;
  private configManager!: ConfigManager;
  private generalInfo!: GeneralInfo;
  private config!: TConfig;
  private schedule: ScheduleItem[] = [];
  private captainSchedule: CaptainSchedulerItem | null = null;
  private messageDialogObserver: MutationObserver | null = null;
  private humanMessageDialogObserver: MutationObserver | null = null;
  private lock!: Lock;
  private RUN: boolean = false;
  private tryCount: Record<string, number> = {};

  private constructor() {
    super();
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<Farmer> {
    if (!Farmer.instance) {
      Farmer.instance = new Farmer();
      Farmer.instance.generalInfo = GeneralInfo.getInstance();
      Farmer.instance.citySwitch = await CitySwitchManager.getInstance();
      Farmer.instance.configManager = ConfigManager.getInstance();
      Farmer.instance.config = Farmer.instance.configManager.getConfig();
      Farmer.instance.lock = Lock.getInstance();
    }
    return Farmer.instance;
  }

  private getFarmingWay() {
    return document.querySelector('.advisor_frame.captain .advisor')?.classList.contains('captain_active')
      ? FarmingSolution.Captain
      : FarmingSolution.Manual;
  }

  public getFarmScheduleTimes() {
    return this.getFarmingWay() === FarmingSolution.Captain
      ? [this.captainSchedule?.scheduledDate]
      : this.schedule.map(item => item.scheduledDate);
  }

  public async farmWithCaptain() {
    let dialogsSnapshot: Element[] = [];
    let infoId!: number;
    try {
      await this.lock.performWithLock(
        async () => {
          infoId = this.generalInfo.showInfo('Farm Manager:', 'Farmienie z kapitanem.', 'info');
          console.log('[Farmer]: farmWithCaptain at', new Date());

          // checking opened dialogs to find know which will be opened
          dialogsSnapshot = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
          // end of checking opened dialogs

          // opening farm overview
          document.querySelector<HTMLElement>('[name="farm_town_overview"]')!.click();
          this.config.farmer.humanize ? await addDelay(getRandomMs(400, 1200)) : null;
          await waitWhile(() => !document.querySelector<HTMLElement>('#fto_town_list'), {
            delay: 200,
            maxIterations: 5,
          });
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
              console.log('[Farmer]: Cooldown wrapper found, not hidden');
              let cooldownTimeTextParsed;
              while (
                !(cooldownTimeTextParsed = cooldownWrapper
                  .querySelector('.ribbon_locked .unlock_time')
                  ?.textContent?.match(/\d{2}:\d{2}:\d{2}/)?.[0])
              ) {
                await addDelay(250);
              }
              const timeoutMS =
                calculateTimeToNextOccurrence(cooldownTimeTextParsed!) + this.configManager.getTimeDifference() + 1000;
              const scheduledDate = new Date(Date.now() + timeoutMS);

              console.log('[Farmer]: Schedule next farming operation for captain on:', scheduledDate);
              const scheduleTimeout = setTimeout(() => {
                console.log(
                  '[Farmer]: Performing scheduled farming operation for captain, at:',
                  dateToHHMMSS(new Date()),
                );
                this.farmWithCaptain();
              }, timeoutMS);

              if (this.captainSchedule?.timeout) clearTimeout(this.captainSchedule.timeout);

              this.captainSchedule = {
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
          console.log('[Farmer]: Clicked select all');
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
          this.config.farmer.humanize ? await addDelay(getRandomMs(400, 1200)) : null;

          const allCityLabels = document.querySelectorAll<HTMLElement>(`#fto_town_wrapper .gp_town_link`);
          for (const city of this.config.farmer.farmingCities) {
            for (const cityLabel of allCityLabels) {
              if (cityLabel.textContent === city.name) {
                const checbkox = cityLabel.parentElement!.querySelector<HTMLElement>('.checkbox.town_checkbox')!;
                if (!checbkox.classList.contains('checked')) {
                  console.log('[Farmer]: Clicking town checkbox', city.name);
                  checbkox.click();
                  await addDelay(100);
                  break;
                }
              }
            }
          }
          // end of selecting cities

          //selecting farm option
          console.log('[Farmer]: Select farm options');
          await addDelay(500);
          const farmOptions = document.querySelectorAll<HTMLElement>('.fto_time_checkbox')!;
          const farmOptionIndex = this.getFarmOptionIndex()!;
          !farmOptions[farmOptionIndex].classList.contains('checked') && farmOptions[farmOptionIndex].click();
          this.config.farmer.humanize ? await addDelay(getRandomMs(400, 1200)) : await addDelay(100);
          !farmOptions[farmOptionIndex + 4]?.classList.contains('checked') && farmOptions[farmOptionIndex + 4]?.click();
          this.config.farmer.humanize ? await addDelay(getRandomMs(400, 1200)) : await addDelay(100);
          // end of selecting farm option

          // collecting resources
          console.log('[Farmer]: Collecting resources');
          // document.querySelector<HTMLElement>('#fto_claim_button')!.click();
          await waitForElementInterval('#fto_claim_button', { retries: 4, interval: 400 })
            .then(el => el.click())
            .catch(() => {
              throw new Error('collecting resources failed, no button found');
            });
          this.config.farmer.humanize ? await addDelay(getRandomMs(400, 1200)) : null;
          // end of collecting resources

          // potentially confirm click confirm button
          await waitForElementInterval('.btn_confirm.button_new', { retries: 5, interval: 400 })
            .then(el => el.click())
            .catch(() => null);
          // end of confirm button click

          // finding new cooldown
          console.log('[Farmer]: Finding new cooldown');
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
            calculateTimeToNextOccurrence(newCooldownParsedTimeText!) + this.configManager.getTimeDifference() + 1000;
          const scheduledDate = new Date(Date.now() + timeout);
          console.log('[Farmer]: Schedule next farming operation for captain on:', scheduledDate);
          const scheduleTimeout = setTimeout(() => {
            console.log('[Farmer]: Performing scheduled farming operation for captain, at:', dateToHHMMSS(new Date()));
            this.farmWithCaptain();
          }, timeout);

          if (this.captainSchedule?.timeout) clearTimeout(this.captainSchedule.timeout);
          this.captainSchedule = {
            scheduledDate,
            timeout: scheduleTimeout,
          };

          console.log('[Farmer]: farmWithCaptain successful snapshot');
          delete this.tryCount['captain'];
        },
        {
          manager: 'farmer',
        },
      );
    } catch (e) {
      const key = 'captain';
      const browserContext = getBrowserExecutionContextInfo();
      console.warn('[Farmer]: farmWithCaptain catch:', e, browserContext);

      if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
        if (this.getFarmingWay() === FarmingSolution.Manual) {
          console.warn('[Farmer]: premium farming finished, switching to manual farming:');
          this.initFarmAllVillages();
        } else {
          console.warn('[Farmer]: visibility hidden, scheduling farming on visibility return:');
          if (browserContext.visibilityState === 'hidden') {
            performOnDocumentVisibilityReturn(() => this.farmWithCaptain());
          } else {
            this.tryCount[key] = (this.tryCount[key] ?? 0) + 1;
            if (this.tryCount[key] < 3) {
              console.warn(`[Farmer]: Retry count ${this.tryCount[key]}, will reschedule in 2 minutes`);
              if (this.captainSchedule?.timeout) clearTimeout(this.captainSchedule.timeout);
              this.captainSchedule = {
                timeout: setTimeout(
                  () => {
                    this.farmWithCaptain();
                  },
                  2 * 60 * 1000,
                ),
                scheduledDate: new Date(Date.now() + 2 * 60 * 1000),
              };
            } else {
              console.error(`[Farmer]: Critical error, retry limit exceeded for captain, stopping retries.`);
              delete this.tryCount[key];
            }
          }
        }
      }
    } finally {
      console.log('[Farmer]: Captain scheduler:', this.captainSchedule);
      this.tryCloseCurrentDialog(Array.from(dialogsSnapshot));
      this.generalInfo.hideInfo(infoId);
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
    let infoId!: number;
    try {
      console.log('[Farmer]: farmVillages, wait for lock', city.name);
      await this.lock.performWithLock(
        async () => {
          infoId = this.generalInfo.showInfo('Farm Manager:', `farmienie w mieście: ${city.name}`, 'info');
          console.log('[Farmer]: farmVillages, take lock', city.name);
          await this.performManualFarming(city);
          delete this.tryCount[city.name];
        },
        { manager: 'farmer' },
      );
    } catch (e) {
      const browserContext = getBrowserExecutionContextInfo();
      console.warn('[Farmer]: farmVillages catch:', e, getBrowserExecutionContextInfo());

      if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
        if (browserContext.visibilityState === 'hidden') {
          console.warn('[Farmer]:', 'visibility hidden, schedule farming after visibility is back');
          performOnDocumentVisibilityReturn(() => this.farmVillages(city));
        } else {
          this.tryCount[city.name] = (this.tryCount[city.name] ?? 0) + 1;
          if (this.tryCount[city.name] < 3) {
            console.warn(`[Farmer]: Retry count ${this.tryCount[city.name]}, will reschedule in 2 minutes`);
            this.scheduleNextFarmingOperationForCity(120000, city);
          } else {
            console.warn(
              `[Farmer]: Critical Error, retry count exceeded ${this.tryCount[city.name]}, stopping schedule for city.`,
            );
            delete this.tryCount[city.name];
          }
        }
      }
    } finally {
      this.generalInfo.hideInfo(infoId);
      this.emit('farmingFinished');
    }
  }

  private async performManualFarming(city: CityInfo) {
    try {
      console.log('[Farmer]: farmVillagesFlow, switch to city', city.name, new Date());
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
            console.log('[Farmer]: Clicked next');
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
          // one try, because when village name change, ui with buttons should be present as well
          retries: 1,
          interval: 200,
          fromNode: masterWindow!,
        })
          .then(els => {
            if (!els[farmOptionIndex].classList.contains('disabled')) {
              els[farmOptionIndex].click();
            }
          })
          .catch(() => {
            console.log('[Farmer]: Could not find farm option buttons');
            farmNotOwned = true;
          });

        // adjust criterion by which it is assessed that village is not owned
        if (farmNotOwned) {
          console.log('[Farmer]: Village is not owned, skipping');
          continue;
        }
        await waitWhile(() => !document.querySelector('.actions_locked_banner.cooldown'), {
          delay: 200,
          maxIterations: 10,
        });
        farmedVillageCounter++;
      }

      console.log('[Farmer]: Post loop actions');
      const cooldownTime = await this.getUnlockTimeOrNull(masterWindow!);
      // const timeoutTime = Math.min(cooldownTime ?? Infinity, this.config.farmConfig.farmInterval);
      await waitForElementInterval('.btn_wnd.close')
        .then(el => el.click())
        .catch(() => {});

      this.scheduleNextFarmingOperationForCity(cooldownTime ?? this.config.farmer.farmInterval + 1000, city);
    } catch (e) {
      throw e;
    } finally {
      this.disconnectObservers();
    }
  }

  /**
   * Bierze locka, iteruje przez wszystkie miasta, farmi wszystkie wioski danego miasta, dodaje osobnego callbacka dla każdego miasta.
   * Po przejściu powraca do pierwszego miasta, zwraca locka, a wioski będą farmione przez osobną metodę: 'farmVillages'.
   */
  private async initFarmAllVillages() {
    if (this.getFarmingWay() === FarmingSolution.Captain) {
      await this.farmWithCaptain();
    } else {
      const cityList = this.config.farmer.farmingCities.map(
        city => this.citySwitch.getCityList().find(c => c.name === city.name)!,
      );
      let infoId!: number;
      try {
        console.log('[Farmer]: initFarmAllVillages, wait for lock', new Date());
        await this.lock.performWithLock(
          async () => {
            infoId = this.generalInfo.showInfo('Farm Manager:', 'Inicjalizacja/farmienie wszystkich wiosek.', 'info');
            console.log('[Farmer]: initFarmAllVillages, take lock', new Date());
            for (const cityInfo of cityList) {
              await this.performManualFarming(cityInfo);
            }
            delete this.tryCount['initial'];
            if (cityList.length !== 1) await cityList[0].switchAction();
          },
          { manager: 'farmer' },
        );
      } catch (e) {
        const browserContext = getBrowserExecutionContextInfo();
        console.warn('[Farmer]: initFarmAllVillages catch:', e, browserContext);
        if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
          if (browserContext.visibilityState === 'hidden') {
            console.warn('[Farmer]:', 'visibility hidden, initializing schedule farming after visibility is back');
            performOnDocumentVisibilityReturn(() => this.initFarmAllVillages());
          } else {
            this.tryCount['initial'] = (this.tryCount['initial'] ?? 0) + 1;
            console.warn('[Farmer]: retry count:', this.tryCount['initial']);
            if (this.tryCount['initial'] < 3) {
              this.initFarmAllVillages();
            } else {
              delete this.tryCount['initial'];
              console.warn('[Farmer]: critical error, retry count exceeded, abandoning the execution');
            }
          }
        }
      } finally {
        this.generalInfo.hideInfo(infoId);
        this.emit('farmingFinished');
      }
    }
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
      timeout: null as ReturnType<typeof setTimeout> | null,
      city,
    };

    this.schedule = this.schedule.filter(s => {
      if (s.city.name === city.name) {
        console.warn('[Farmer]: removing duplicate farming schedule for city before assigning new one');
        clearTimeout(s.timeout);
        return false;
      }
      return true;
    });

    scheduleItem.timeout = setTimeout(async () => {
      this.schedule = this.schedule.filter(item => item.city.name !== scheduleItem.city.name);
      this.farmVillages(city);
    }, timeInterval);

    this.schedule.push(scheduleItem as ScheduleItem);
    console.log('[Farmer]: schedule:', this.schedule);
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
      retries: 5,
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
            console.log('[Farmer]: Next unlock time:', unlcokTimeEl.textContent);
            res(HHMMSS_toMS(unlcokTimeEl.textContent));
          } else if (counter === 10) {
            clearInterval(getTextInterval);
            console.warn('[Farmer]: Nie znaleziono czasu odblokowania');
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
    switch (this.config.farmer.farmInterval) {
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

  public stop() {
    this.RUN = false;
    console.log('[Farmer]: FarmManager stopped');
    // manual related
    this.schedule.forEach(item => {
      clearTimeout(item.timeout);
    });
    this.schedule = [];
    // captain related
    if (this.captainSchedule?.timeout) clearTimeout(this.captainSchedule.timeout);
    this.captainSchedule = null;
  }

  public async start() {
    if (!this.RUN) {
      console.log('[Farmer]: FarmManager started');
      this.RUN = true;
      await this.initFarmAllVillages();
    }
  }

  public pause() {
    if (this.captainSchedule) {
      clearTimeout(this.captainSchedule.timeout);
    } else {
      this.schedule.forEach(s => clearTimeout(s.timeout));
    }
  }
  public async resume() {
    if (this.getFarmingWay() === FarmingSolution.Captain) {
      await this.farmWithCaptain();
    } else {
      this.schedule.forEach(citySchedule => {
        citySchedule.timeout = setTimeout(() => {
          this.schedule = this.schedule.filter(item => item !== citySchedule);
          this.farmVillages(citySchedule.city);
        }, citySchedule.scheduledDate.getTime() - Date.now());
      });
    }
  }
  public getScheduledActionTimes() {
    return this.captainSchedule
      ? ([[this.captainSchedule.scheduledDate.getTime(), 3000]] as [[number, number]])
      : (this.schedule.map(s => [s.scheduledDate.getTime(), 5000]) as [[number, number]]);
  }

  public onConfigChange(configChanges: Partial<TConfigChanges['farmer']>) {
    if (configChanges.farmingCities && this.RUN) {
      if (this.getFarmingWay() === FarmingSolution.Manual) {
        this.schedule.forEach(s => clearTimeout(s.timeout));
        this.schedule = [];
        this.initFarmAllVillages();
      }
    }
  }

  public isRunning(): boolean {
    return this.RUN;
  }
}
