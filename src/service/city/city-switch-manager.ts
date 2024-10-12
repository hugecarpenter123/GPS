import EventEmitter from "events";
import { performComplexClick, waitForElement, waitForElements } from "../../utility/ui-utility";
import { addDelay } from "../../utility/plain-utility";
import GeneralInfo from "../master/ui/general-info";

export type CityInfo = {
  name: string;
  cityId: string | null;
  isleId: string;
  switchAction: () => Promise<void>;
}

export default class CitySwitchManager extends EventEmitter {
  private static instance: CitySwitchManager;
  private RUN: boolean = false;
  private generalInfo!: GeneralInfo;
  private cityList: CityInfo[] = [];
  private constructor() { super(); }

  public static async getInstance(): Promise<CitySwitchManager> {
    if (!CitySwitchManager.instance) {
      CitySwitchManager.instance = new CitySwitchManager();
      CitySwitchManager.instance.generalInfo = GeneralInfo.getInstance();
      CitySwitchManager.instance.cityList = await CitySwitchManager.instance.initCityList();
      CitySwitchManager.instance.mountObserver();
    }
    return CitySwitchManager.instance;
  }

  private mountObserver() {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          this.emit('cityChange', this.getCurrentCity());
          console.log('cityChange:', this.getCurrentCity());
        }
      }
    }).observe(document.querySelector<HTMLElement>('.town_name_area .town_name.js-rename-caption')!, { childList: true });
  }


  /**
   * Method parses list of city, and creates shortcut access.
   */
  private async initCityList(): Promise<CityInfo[]> {
    this.generalInfo.showInfo('City Switch Manager:', 'Inicjalizacja listy miast');
    const dropdownTrigger = await waitForElement('.town_groups_dropdown.btn_toggle_town_groups_menu');
    dropdownTrigger.click();
    let townListElement;
    while (!(townListElement = await waitForElement('.group_towns', 1000).catch(() => null))) {
      document.querySelector<HTMLElement>('.btn_toggle_town_groups_menu')!.click();
      await addDelay(100);
    }
    const townList = townListElement.querySelectorAll('span.town_name');

    const cityList: CityInfo[] = [];

    for (const town of townList) {
      console.log('initCityList.town:', town);
      const cityId = town.parentElement!.getAttribute('data-townid');
      console.log('\t-cityId:', cityId);
      await this.openTownList();
      console.log('\t-openTownList');
      // for (const el of townList) {
      for (const el of Array.from(await waitForElements('.group_towns span.town_name', 3000))) {
        console.log('\t\t-element to match, element searched:', el.textContent, town.textContent);
        if (el.textContent === town.textContent) {
          console.log('\t\t\t-found matched element:', el, 'click it');
          (el as HTMLElement).click();
          break;
        }
      };
      await addDelay(100);
      // here switch to city in order to element be in the dom
      document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town')!.click();
      console.log('\t-click', document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town'));

      const isleId = Array.from((await waitForElement(`#town_${cityId}`, 3000))?.classList ?? [])
        .find(cls => cls.match(/town_\d+_\d+_\d+/))
        ?.match(/town_(\d+_\d+)_\d+/)?.[1] ?? '';
      const name = town.textContent!;

      cityList.push({
        name,
        cityId,
        isleId,
        switchAction: async () => {
          try {
            if (document.querySelector('div.town_name')!.textContent !== name) {
              let townListElement = document.querySelector('.group_towns');
              if (!townListElement) {
                do {
                  await waitForElement('.town_groups_dropdown.btn_toggle_town_groups_menu', 1000).then(el => el.click()).catch(() => null);
                  await addDelay(333);
                } while (!(townListElement = await waitForElement('.group_towns', 1500).catch(() => null)));
              }
              const targetTown = Array.from(townListElement!.querySelectorAll('span.town_name'))
                .find(el => el.textContent === name);

              (targetTown as HTMLElement).click();

              do {
                await addDelay(100);
              } while (document.querySelector('div.town_name')!.textContent !== name);
            }
            document.querySelector<HTMLElement>('.btn_jump_to_town.circle_button.jump_to_town')!.click();
            await addDelay(100);
          } catch (e) {
            console.warn('switchAction.catch:', e);
          }
        }
      });
    }
    console.log('CitySwitchManager.cityList.initialized:', cityList)
    await this.goBackToFirstTown();
    this.generalInfo.hideInfo();
    return cityList;
  }

  private async openTownList() {
    if (!(await waitForElement('.group_towns', 1000).catch(() => null))) {
      const dropdownTrigger = await waitForElement('.town_groups_dropdown.btn_toggle_town_groups_menu');
      dropdownTrigger.click();
    }
  }

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

}

function sleep(arg0: number) {
  throw new Error("Function not implemented.");
}
