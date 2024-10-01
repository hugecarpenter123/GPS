import EventEmitter from "events";
import gpsConfig, { FarmTimeInterval } from "../../../gps.config";
import ConfigManager from "../../utility/config-manager";
import { addDelay, areArraysContentsEqual as areArraysEqual, isMobile, textToMs } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { performComplexClick, waitForElement, waitForElementFromNode, waitForElements } from "../../utility/ui-utility";
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
  private previousVillageSelectors: string[] = [];
  private messageDialogObserver: MutationObserver | null = null;
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
      FarmManager.instance.configManager = ConfigManager.getInstance();
      FarmManager.instance.config = FarmManager.instance.configManager.getConfig().farmConfig;
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
      this.lock.acquire();
      await this.farmVillagesFlow(city);
    } catch (e) {
      console.warn('FarmManager.farmVillages().catch', e);
    } finally {
      this.lock.release();
      this.messageDialogObserver?.disconnect();
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
  private async farmVillagesFlow(city: CityInfo) {
    if (isMobile()) {
      await waitForElement('[name="island_view"]').then((islandView) => islandView?.click());
      await addDelay(333);
    }

    const villages = await waitForElements('a.owned.farm_town[data-same_island="true"]');

    if (!villages || villages.length === 0) return;
    const villageStyleSelectors = Array.from(villages).map(v => {
      return `[style="${v.getAttribute('style')}"]`
    })

    await performComplexClick(villages[0])
    const unlockTime = await this.getUnlockTimeOrNull(await waitForElement('.farm_towns'));
    if (unlockTime) {
      await waitForElement('.btn_wnd.close', 1000)
        .then((el) => el.click())
        .catch(() => { });

      this.scheduleNextFarmingOperationForCity(unlockTime, city);
      return;
    }

    // zrób nasłuchiwacza popopów z `class="js-window-main-container classic_window dialog  "` popup `confirmation`
    // buttony: `class="btn_cancel button_new"` albo `class="btn_confirm button_new"`
    this.mountMessageDailogObserver();

    for (const selector of villageStyleSelectors) {
      let village: HTMLElement | null = null;
      let farmOptions: NodeListOf<HTMLElement> | null = null;
      do {
        village = await waitForElement(selector);
        await performComplexClick(village);
        await addDelay(100);
      } while (!(farmOptions = await waitForElements('.action_card.resources_bpv .card_click_area', 333).catch(() => null)))

      const farmOptionIndex = this.getFarmOptionIndex(farmOptions!.length);
      farmOptions![farmOptionIndex].click();
      const closeButton = await waitForElement('.btn_wnd.close', 1000).catch(() => { });
      closeButton?.click();

      // Flaga, która sprawia natychmiastowe przerwanie pętli i zwrócienie locka
      if (!this.RUN) {
        return;
      }

      await addDelay(100);
    }

    // zaplanuj kolejny cykl
    this.scheduleNextFarmingOperationForCity(this.config.farmInterval, city);
  }

  /**
   * Bierze locka, iteruje przez wszystkie miasta, farmi wszystkie wioski danego miasta, dodaje osobnego callbacka dla każdego miasta.
   * Po przejściu powraca do pierwszego miasta, zwraca locka, a wioski będą farmione przez osobną metodę: 'farmVillages'.
   */
  private async initFarmAllVillages() {
    // const cityList = this.citySwitch.getCityList();

    // Quickfix, init farming only for one city per island
    const cityList = this.citySwitch.getCityList().reduce((acc: CityInfo[], cityInfo) => {
      if (!acc.some(el => el.isleId === cityInfo.isleId)) {
        acc.push(cityInfo);
      }
      return acc;
    }, []);

    try {
      this.lock.acquire();
      for (const cityInfo of cityList) {
        await cityInfo.switchAction();
        await addDelay(100);
        await this.farmVillagesFlow(cityInfo);
      }
      if (cityList.length !== 1) cityList[0].switchAction();
    } catch (e) {
      console.warn('FarmManager.farmVillages().catch', e);
    } finally {
      this.lock.release();
      this.messageDialogObserver?.disconnect();
      this.emit('farmingFinished');
    }
  }

  private scheduleNextFarmingOperationForCity = (timeInterval: number, city: CityInfo) => {
    const scheduledDate = new Date(Date.now() + timeInterval);
    const scheduleItem = {
      scheduledDate,
      timeout: null as NodeJS.Timeout | null,
      city
    }

    const timeout = setTimeout(async () => {
      await city.switchAction();
      await addDelay(100);
      this.farmVillages(city);

      this.schedulerArray = this.schedulerArray.filter(item => item !== scheduleItem)
    }, timeInterval);

    scheduleItem.timeout = timeout;
    this.schedulerArray.push(scheduleItem as ScheduleItem);
    console.log('scheduler:', this.schedulerArray);
  }

  /**
   * Metoda jest odpowiedzią na blokadę farmienia wynikającą z konieczności potwierdzenia farmienia w przypadku pełengo magazynu.
   * Metoda obserwuje czy pojawił się popup z promptem do potwierdzenia kontynuacji i klika akceptuj.
   */
  private mountMessageDailogObserver = async () => {
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
    observer.observe(document.body, { childList: true })
    this.messageDialogObserver = observer;
  }

  private async getUnlockTimeOrNull(window: HTMLElement): Promise<number | null> {
    const cooldownBar = await waitForElementFromNode(window, '.actions_locked_banner.cooldown', 500).catch(() => null);
    if (cooldownBar) {
      const unlcokTimeEl = cooldownBar.querySelector('.pb_bpv_unlock_time')
      return new Promise((res, rej) => {
        const getTextInterval = setInterval(() => {
          if (unlcokTimeEl?.textContent) {
            clearInterval(getTextInterval);
            res(textToMs(unlcokTimeEl.textContent))
          }
        }, 100)
      })
    }

    return null;
  }

  /**
   * Depending on the length of the farm options, it returns the index of the farm option to click.
   */
  private getFarmOptionIndex(farmOptionsLength: number) {
    if (farmOptionsLength === 4) {
      switch (this.config.farmInterval) {
        case FarmTimeInterval.FiveMinutes:
          return 0;
        case FarmTimeInterval.TwentyMinutes:
          return 1;
        case FarmTimeInterval.OneHourAndHalf:
          return 2;
        case FarmTimeInterval.FourHours:
          return 3;
        default:
          return 0;
      }
    } else {

      switch (this.config.farmInterval) {
        case FarmTimeInterval.FiveMinutes:
          return 0;
        case FarmTimeInterval.TenMinutes:
          return 4;
        case FarmTimeInterval.TwentyMinutes:
          return 1;
        case FarmTimeInterval.FortyMinutes:
          return 5;
        case FarmTimeInterval.OneHourAndHalf:
          return 2;
        case FarmTimeInterval.ThreeHours:
          return 6;
        case FarmTimeInterval.FourHours:
          return 3;
        case FarmTimeInterval.EightHours:
          return 7;
        default:
          return 0;
      }
    }
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