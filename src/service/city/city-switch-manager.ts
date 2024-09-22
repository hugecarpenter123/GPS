import { waitForElement } from "../../utility/ui-utility";

export type CityInfo = {
  name: string;
  switchAction: () => Promise<void>;
}

export default class CitySwitchManager {
  private static instance: CitySwitchManager;
  private RUN: boolean = false;
  private cityList: CityInfo[] = [];
  private constructor() { }

  public static async getInstance(): Promise<CitySwitchManager> {
    if (!CitySwitchManager.instance) {
      CitySwitchManager.instance = new CitySwitchManager();
      CitySwitchManager.instance.cityList = await CitySwitchManager.instance.initCityList();
    }
    return CitySwitchManager.instance;
  }


  /**
   * Method parses list of city, and creates shortcut access.
   */
  private async initCityList(): Promise<CityInfo[]> {
    const dropdownTrigger = await waitForElement('.caption.js-viewport');
    dropdownTrigger.click();
    const townListElement = await waitForElement('.group_towns');
    const townList = townListElement.querySelectorAll('span.town_name');
    const cityList = Array.from(townList).map(town => ({
      name: town.textContent || 'unresolved',
      switchAction: async () => {
        try {
          let townListElement = await waitForElement('.group_towns', 500).catch(() => null);
          if (!townListElement) {
            const dropdownTrigger = await waitForElement('.caption.js-viewport');
            dropdownTrigger.click();
          }
          townListElement = await waitForElement('.group_towns', 3000);
          const targetTown = Array.from(townListElement!.querySelectorAll('span.town_name'))
            .find(el => el.textContent === town.textContent);
          (targetTown as HTMLElement).click()
        } catch (e) {
          console.warn('switchAction.catch:', e);
        }
      }
    }));

    console.log('CitySwitchManager.cityList.initialized:', cityList)

    return cityList;
  }


  public getCurrentCity() {
    const name = document.querySelector('div.town_name')?.textContent ?? '';
    console.log('getCurrentCity.name:', name);
    return this.getCityByName(name);
  }

  public getCityByName(name: string) {
    console.log('getCityByName:', this.cityList.find(city => city.name === name))
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