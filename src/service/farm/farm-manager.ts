import EventEmitter from "events";
import gpsConfig, { FarmTimeInterval } from "../../../gps.config";
import ConfigManager from "../../utility/config-manager";
import { addDelay, getRandomMs, textToMs } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, waitForElement, waitForElementFromNode, waitForElements, waitForElementsInterval } from "../../utility/ui-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";

type ScheduleItem = {
  scheduledDate: Date;
  timeout: NodeJS.Timeout;
  city: CityInfo;
}

export default class FarmManager extends EventEmitter {
  private static instance: FarmManager;
  private citySwitch!: CitySwitchManager;
  private configManager!: ConfigManager;
  private config!: typeof gpsConfig.farmConfig;
  private schedulerArray: ScheduleItem[] = [];
  private messageDialogObserver: MutationObserver | null = null;
  private humanMessageDialogObserver: MutationObserver | null = null;
  private lock!: Lock;

  private RUN: boolean = false;

  private constructor() {
    super();
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<FarmManager> {
    if (!FarmManager.instance) {
      FarmManager.instance = new FarmManager();
      FarmManager.instance.citySwitch = await CitySwitchManager.getInstance()
      FarmManager.instance.config = ConfigManager.getInstance().getConfig().farmConfig;
      FarmManager.instance.lock = Lock.getInstance();
    }
    return FarmManager.instance;
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
      console.log('farmVillages, take lock', city.name);
      await this.farmVillagesFlow(city);
    } catch (e) {
      console.warn('FarmManager.farmVillages().catch', e);
    } finally {
      this.disconnectObservers();
      console.log('farmVillages, release lock', city.name);
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
      console.log('farmVillagesFlow, switch to city', city.name);
      await city.switchAction();

      let timeout: number = this.config.farmInterval;

      this.config.humanize ? addDelay(getRandomMs(400, 1200)) : addDelay(333);

      // Selectors mapping and timeout check
      const villages = await waitForElementsInterval('a.owned.farm_town[data-same_island="true"]', { timeout: 3000 }).catch(() => null);
      console.log('\t-villages to farm:', villages?.length);

      if (!villages || villages.length === 0) return;
      const villageStyleSelectors = Array.from(villages).map(v => {
        return `[style="${v.getAttribute('style')}"]`
      })

      const villagesAmount = villageStyleSelectors.length;
      this.mountMessageDialogsObservers(city);

      console.log('\t-start farming villages');
      for (const [i, villageSelector] of villageStyleSelectors.entries()) {
        console.log(`\t-checking village: ${villageSelector}, from town: ${city.name}`);

        let counter = 0;
        do {
          await performComplexClick(document.querySelector<HTMLElement>(villageSelector)!);
          // console.log('\t-clicked village element on the map (found/not found):', !!document.querySelector<HTMLElement>(villageSelector));
          await addDelay(100);
          if (counter === 3) throw new Error('Farm villages dialog didn\'t show up');
          counter++;
        } while (!(await waitForElement('.farm_towns', 1000).catch(() => false)));
        this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);

        const farmOptionIndex = this.getFarmOptionIndex();

        counter = 0;
        do {
          await waitForElements('.btn_claim_resources.button.button_new', 500)
            .then((els) => els[farmOptionIndex].click())
            .catch(() => { });
          // console.log('\t-clicked button (found/not found):', !!document.querySelectorAll<HTMLElement>('.btn_claim_resources.button.button_new')[farmOptionIndex]);
          if (counter === 3) throw new Error('Farm button not found');
          counter++;
          await addDelay(100);
        } while (!await waitForElement('.actions_locked_banner.cooldown', 1500).catch(() => false));
        this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);

        if (i === villagesAmount - 1) {
          timeout = await this.getUnlockTimeOrNull(await waitForElement('.farm_towns'), 2000) ?? this.config.farmInterval;
        }

        document.querySelector<HTMLElement>('.btn_wnd.close')?.click();
        this.config.humanize ? await addDelay(getRandomMs(400, 1200)) : addDelay(100);
      }

      document.querySelector<HTMLElement>('.btn_wnd.close')?.click();
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
    // const cityList = this.citySwitch.getCityList();

    // Quickfix, init farming only for one city per island
    const cityList = this.citySwitch.getCityList().reduce((acc: CityInfo[], cityInfo) => {
      if (!cityInfo.isleId || !acc.some(el => el.isleId === cityInfo.isleId)) {
        acc.push(cityInfo);
      }
      return acc;
    }, []);

    try {
      console.log('initFarmAllVillages, wait for lock');
      await this.lock.acquire();
      console.log('initFarmAllVillages, take lock');
      for (const cityInfo of cityList) {
        await this.farmVillagesFlow(cityInfo);
      }
      if (cityList.length !== 1) await cityList[0].switchAction();
    } catch (e) {
      console.warn('FarmManager.initFarmAllVillages().catch', e);
    } finally {
      this.lock.release();
      this.messageDialogObserver?.disconnect();
      this.emit('farmingFinished');
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
  private mountMessageDialogsObservers = async (city: CityInfo) => {
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

    if (!this.humanMessageDialogObserver) {
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
    switch (this.config.farmInterval) {
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
    switch (this.config.farmInterval) {
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
    this.schedulerArray.forEach(item => {
      clearTimeout(item.timeout);
    })
    this.schedulerArray = [];
  }

  public isRunning(): boolean {
    return this.RUN;
  }
}