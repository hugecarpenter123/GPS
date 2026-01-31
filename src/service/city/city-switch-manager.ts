import EventEmitter from 'events';
import { addDelay, waitWhile } from '../../utility/plain-utility';
import {
  getBrowserExecutionContextInfo,
  waitForElement,
  waitForElementInterval,
  waitForElements,
} from '../../utility/ui-utility';
import GeneralInfo from '../master/ui/general-info';

export type CityInfo = {
  name: string;
  cityId: string | null;
  isleId: string;
  switchAction: (jumpToTown?: boolean) => Promise<void>;
};

export default class CitySwitchManager extends EventEmitter {
  private static readonly LOCAL_STORAGE_CITY_LIST_KEY = 'cityList';
  private static instance: CitySwitchManager;
  private RUN: boolean = false;
  private generalInfo!: GeneralInfo;
  private cityList: CityInfo[] = [];
  private constructor() {
    super();
  }

  public static async getInstance(): Promise<CitySwitchManager> {
    if (!CitySwitchManager.instance) {
      CitySwitchManager.instance = new CitySwitchManager();
      CitySwitchManager.instance.generalInfo = GeneralInfo.getInstance();
      await CitySwitchManager.instance.initCityList();
      CitySwitchManager.instance.mountObserver();
    }
    return CitySwitchManager.instance;
  }

  private mountObserver() {
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          this.emit('cityChange', this.getCurrentCity());
          console.log('cityChange:', this.getCurrentCity());
        }
      }
    }).observe(document.querySelector<HTMLElement>('.town_name_area .town_name.js-rename-caption')!, {
      childList: true,
    });
  }

  private async initCityListWithCurator() {
    document.querySelector<HTMLDivElement>('.toolbar_button.premium')?.click();
    await waitForElementInterval('#town_overviews-towns_overview').then(el => el.click());
    const cityListEl = await waitForElementInterval('#table_scroll_content');
    const cityList: CityInfo[] = Array.from(cityListEl.querySelectorAll('li')).map(li => {
      const name = li.querySelector<HTMLDataListElement>('.gp_town_link')?.innerText;
      if (!name) throw new Error('City name not found');
      const cityIdMatch = li.id.match(/\d+/);
      if (!cityIdMatch) throw new Error('City ID not found');
      const cityId = cityIdMatch[0];
      const isleId = li
        .querySelector<HTMLSpanElement>(`#town_${cityId}_coords span`)
        ?.innerText.replace(/\s+/g, '')
        .replace(',', '_');
      if (!isleId) throw new Error('Isle ID not found');
      return {
        name,
        cityId,
        isleId,
        switchAction: this.switchActionForCity(name, cityId),
      };
    });

    document.querySelector<HTMLElement>('.ui-dialog-titlebar-close')?.click();

    return cityList;
  }

  private async initCityListRaw(townList: NodeListOf<HTMLElement>) {
    const cityList: CityInfo[] = [];

    for (const town of townList) {
      const cityId = town.parentElement!.getAttribute('data-townid');
      await this.openTownList();
      // for (const el of townList) {
      for (const el of Array.from(await waitForElements('.group_towns span.town_name', 3000))) {
        if (el.textContent === town.textContent) {
          (el as HTMLElement).click();
          break;
        }
      }
      await addDelay(100);
      // here switch to city in order to element be in the dom
      document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town')!.click();
      console.log('\t-click', document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town'));

      const isleId =
        Array.from((await waitForElement(`#town_${cityId}`, 3000))?.classList ?? [])
          .find(cls => cls.match(/town_\d+_\d+_\d+/))
          ?.match(/town_(\d+_\d+)_\d+/)?.[1] ?? '';
      const name = town.textContent!;

      cityList.push({
        name,
        cityId,
        isleId,
        switchAction: this.switchActionForCity(name, cityId!),
      });
    }
    console.log('CitySwitchManager: city list initialized:', cityList);
    await this.goBackToFirstTown();

    if (!cityList.length) {
      throw new Error('Critical error: No cities found');
    }

    return cityList;
  }

  /**
   * Method parses list of city, and creates shortcut access.
   */
  private async initCityList() {
    let infoId!: number;
    try {
      infoId = this.generalInfo.showInfo('City Switch Manager:', 'City list initialization', 'info');

      // gets dropdown trigger that contains city info
      const dropdownTrigger = await waitForElementInterval('.town_groups_dropdown.btn_toggle_town_groups_menu');
      dropdownTrigger.click();
      let townListElement;
      while (!(townListElement = await waitForElementInterval('.group_towns', { timeout: 1000 }).catch(() => null))) {
        document.querySelector<HTMLElement>('.btn_toggle_town_groups_menu')!.click();
        await addDelay(100);
      }
      // gets all spans with city names
      const townList = townListElement.querySelectorAll<HTMLElement>('span.town_name');
      // maps it into {name, cityId} for comparison purposes
      const DOMCityListInfo = Array.from(townList).map(el => ({
        name: el.textContent!,
        cityId: el.parentElement!.getAttribute('data-townid'),
      }));

      // gets item from localstorage
      const storageCityList = localStorage.getItem(CitySwitchManager.LOCAL_STORAGE_CITY_LIST_KEY);
      // if exists checks its compatibility with the real DOM element
      if (storageCityList) {
        const storageCityListParsed: CityInfo[] = JSON.parse(storageCityList);
        if (storageCityListParsed.length !== townList.length) {
          /* continue */
        } else {
          let matchFlag = true;
          for (const storageCity of storageCityListParsed) {
            if (
              !DOMCityListInfo.find(
                DOMCityInfo => DOMCityInfo.name === storageCity.name && DOMCityInfo.cityId === storageCity.cityId,
              )
            ) {
              console.log(`storageCity: ${JSON.stringify(storageCity)} didn't match, reinitialize.`);
              matchFlag = false;
              break;
            }
          }
          if (matchFlag) {
            // If all are matched, don't go through all cities on the UI, return cached version
            this.cityList = this.hydrateCityList(storageCityListParsed);
            return;
          }
        }
      }

      let cityList: CityInfo[];

      // TODO: with curator needs to be fixed, for now use old raw method
      // if (await this.isCuratorActive()) {
      //   cityList = await this.initCityListWithCurator();
      // } else {
      //   cityList = await this.initCityListRaw(townList);
      // }

      cityList = await this.initCityListRaw(townList);

      this.cityList = cityList;
      this.persist();
    } catch (error) {
      throw error;
    } finally {
      if (infoId) {
        this.generalInfo.hideInfo(infoId);
      }
    }
  }

  private async isCuratorActive() {
    return !!(await waitForElementInterval('.advisor_frame.curator')).querySelector('.curator_active');
  }

  private async openTownList() {
    let townListElement = document.querySelector('.group_towns');
    while (!townListElement || Array.from(townListElement?.querySelectorAll('.town_name') ?? []).length < 1) {
      document.querySelector<HTMLElement>('.town_groups_dropdown.btn_toggle_town_groups_menu')?.click();
      await waitWhile(() => !(townListElement = document.querySelector('.group_towns')), {
        delay: 200,
        maxIterations: 10,
        onError: () => {},
      });
    }
  }

  /**
   * Adds switchAction method which gets lost through localStorage serialization process.
   * @param storageCityList
   * @returns
   */
  private hydrateCityList(storageCityList: CityInfo[]) {
    for (const cityInfo of storageCityList) {
      cityInfo.switchAction = this.switchActionForCity(cityInfo.name, cityInfo.cityId!);
    }
    return storageCityList;
  }

  private persist() {
    localStorage.setItem(CitySwitchManager.LOCAL_STORAGE_CITY_LIST_KEY, JSON.stringify(this.cityList));
  }

  private switchActionForCity = (cityName: string, cityId: string) => {
    return async (jumpToTown: boolean = true) => {
      try {
        let masterTownName = document.querySelector('div.town_name')!;
        while (masterTownName.textContent !== cityName) {
          await this.openTownList();
          const townListElement = document.querySelector('.group_towns');
          const targetTown = Array.from(townListElement!.querySelectorAll('span.town_name')).find(
            el => el.textContent === cityName,
          );

          (targetTown as HTMLElement).click();

          await waitWhile(() => masterTownName!.textContent !== cityName, { delay: 150, maxIterations: 10 });
        }
        if (jumpToTown) {
          document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town')!.click();
          await waitWhile(() => !document.querySelector(`#town_${cityId}`), { delay: 200, maxIterations: 10 });
        }
      } catch (e) {
        console.warn('[CitySwitch]: switchAction catch:', e, getBrowserExecutionContextInfo());
      }
    };
  };

  private async goBackToFirstTown() {
    document.querySelector<HTMLElement>('.btn_next_town.button_arrow.right')!.click();
    document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town')!.click();
  }

  private async clickArrowUntilCityFound(cityName: string) {
    const cityWrapper = document.querySelector(`.town_name_area`)!;
    const arrowLeft = cityWrapper.querySelector<HTMLElement>('.btn_prev_town.button_arrow.left')!;
    const arrowRight = cityWrapper.querySelector<HTMLElement>('.btn_next_town.button_arrow.right')!;
    do {
      arrowRight.click();
      await addDelay(1500);
      if (document.querySelector('div.town_name')!.textContent === cityName) {
        return;
      }
    } while (arrowRight.classList.contains('disabled'));

    do {
      arrowLeft.click();
      await addDelay(1500);
      if (document.querySelector('div.town_name')!.textContent === cityName) {
        return;
      }
    } while (!arrowLeft.classList.contains('disabled'));
  }

  public getCurrentCity() {
    const name = document.querySelector('div.town_name')?.textContent ?? '';
    console.log('name:', name);
    console.log('cityList:', this.cityList);
    return this.getCityByName(name);
  }

  public getCityByName(name: string) {
    return this.cityList.find(city => city.name === name);
  }

  public getCityList() {
    return this.cityList;
  }

  public isRunning(): boolean {
    return this.RUN;
  }

  public run() {
    this.RUN = true;
  }

  public stop() {
    // TODO: stop potential scheduled switchActions
    this.RUN = false;
  }

  public async goNextTown(jumpToTown: boolean = true) {
    const currentCityName = document.querySelector('div.town_name')!.textContent!;
    document.querySelector<HTMLElement>('.btn_next_town.button_arrow.right')!.click();
    if (jumpToTown) {
      document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town')!.click();
    }
    if (this.cityList.length > 1) {
      await waitWhile(() => document.querySelector('div.town_name')!.textContent! === currentCityName, {
        delay: 100,
        maxIterations: 10,
      });
    } else {
      await addDelay(100);
    }
  }

  public async gotoPreviousTown(jumpToTown: boolean = true) {
    const currentCityName = document.querySelector('div.town_name')!.textContent!;
    document.querySelector<HTMLElement>('.btn_prev_town.button_arrow.left')!.click();
    if (jumpToTown) {
      document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town')!.click();
    }
    if (this.cityList.length > 1) {
      await waitWhile(() => document.querySelector('div.town_name')!.textContent! === currentCityName, {
        delay: 100,
        maxIterations: 10,
      });
    } else {
      await addDelay(100);
    }
  }
}
