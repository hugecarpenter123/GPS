import ConfigManager from "../../utility/config-manager";
import { addDelay } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { cancelHover, triggerHover, waitForElement, waitForElementInterval } from "../../utility/ui-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";

export default class ResourceManager {
  private static instance: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;
  private configManager: ConfigManager;
  private minPopulationBuffer: number;
  private storeAlmostFullPercentage: number;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.minPopulationBuffer = this.configManager.getConfig()?.resources?.minPopulationBuffer ?? 100;
    this.storeAlmostFullPercentage = this.configManager.getConfig()?.resources?.storeAlmostFullPercentage ?? 0.9;
  }

  public static async getInstance(): Promise<ResourceManager> {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager();
      ResourceManager.instance.lock = Lock.getInstance();
      ResourceManager.instance.citySwitchManager = await CitySwitchManager.getInstance();
    }
    return this.instance;
  }

  public async start() {
  }

  public stop() {
  }

  public async getStoreCapacity() {
    const resourceItem = await waitForElement('[data-type="wood"] .amount.ui-game-selectable')
    let maxSizeElement: HTMLDivElement | null = null;
    do {
      triggerHover(resourceItem);
      await addDelay(333);
    } while (!(maxSizeElement = document.querySelector<HTMLDivElement>('.island_resource_info span:nth-of-type(2)')))
    const maxSizeText = maxSizeElement.textContent;
    const storeMaxSize = parseInt(maxSizeText?.match(/\d+/)?.[0] || '0');
    cancelHover(resourceItem);
    return storeMaxSize;
  }

  public getPopulation() {
    const population = Number(document.querySelector<HTMLDivElement>('[data-type="population"] .amount.ui-game-selectable')!.textContent);
    return population;
  }

  public async getResourcesInfo() {
    const wood = Number((await waitForElement('[data-type="wood"] .amount.ui-game-selectable')).textContent);
    const stone = Number((await waitForElement('[data-type="stone"] .amount.ui-game-selectable')).textContent);
    const iron = Number((await waitForElement('[data-type="iron"] .amount.ui-game-selectable')).textContent);
    const population = Number((await waitForElement('[data-type="population"] .amount.ui-game-selectable')).textContent);

    const resourceItem = await waitForElement('[data-type="wood"] .amount.ui-game-selectable')
    let maxSizeElement: HTMLDivElement | null = null;
    do {
      triggerHover(resourceItem);
      await addDelay(333);
    } while (!(maxSizeElement = document.querySelector<HTMLDivElement>('.island_resource_info span:nth-of-type(2)')))
    const maxSizeText = maxSizeElement.textContent;
    const storeMaxSize = parseInt(maxSizeText?.match(/\d+/)?.[0] || '0');
    cancelHover(resourceItem);

    const resourcesInfo = {
      wood: {
        amount: wood,
        isAlmostFull: wood > this.storeAlmostFullPercentage * storeMaxSize,
        isFull: wood === storeMaxSize,
      },
      stone: {
        amount: stone,
        isAlmostFull: stone > this.storeAlmostFullPercentage * storeMaxSize,
        isFull: stone === storeMaxSize,
      },
      iron: {
        amount: iron,
        isAlmostFull: iron > this.storeAlmostFullPercentage * storeMaxSize,
        isFull: iron === storeMaxSize,
      },
      population: {
        amount: population,
        isLow: population < this.minPopulationBuffer,
      },
      storeMaxSize
    }

    return resourcesInfo;
  }

  /**
   * Switches to the given city and checks if it meets resources requirements.
   * @param requiredResources 
   * @param city 
   * @returns 
   */
  public async hasEnoughResources(requiredResources: { wood: number, stone: number, iron: number }, city?: CityInfo) {
    if (city) {
      await city.switchAction();
    }
    const wood = Number(document.querySelector<HTMLLIElement>('[data-type="wood"] .amount.ui-game-selectable')!.textContent);
    const stone = Number(document.querySelector<HTMLLIElement>('[data-type="stone"] .amount.ui-game-selectable')!.textContent);
    const iron = Number(document.querySelector<HTMLLIElement>('[data-type="iron"] .amount.ui-game-selectable')!.textContent);
    return wood >= requiredResources.wood && stone >= requiredResources.stone && iron >= requiredResources.iron;
  }

  /*
  Jak ma działać funkcjonalność przesyłania surowców między miastami i rekrutowanie `pod korek`?
  W pierwszej kolejności w koszarach musi być przycisk z oknem dialogowym, w którym się podaje takie informacje:
  -co chcesz rekrutować
  -ile slotów (number | 'max')
  -z jakich miast można pobierać surowce (checkboxy)
  -podgląd obecnej kolejki recruitera

  po przekazaniu tych informacji rekruter:
  -szacuje ile będzie kosztować (0.9 - 1.0 x) surowców zakolejkowanie jednego slota do fulla danej jednostki
  -idzie do poglądu handlu z wiosek z których może przesyłać surowce robi pełną turę po miastach do momentu uzbierania potrzebnej ilości
   i przesyła surowce
   - jeżeli po przeleceniu wszystkich wiosek nie jest wstanie uzbierać to czeka 10 minut i robi pochód od nowa
   - jeżeli uzbiera (wysłał): sprawdza czas ostatniego wejścia handlu i planuje rekrutację wtedy
  */

}