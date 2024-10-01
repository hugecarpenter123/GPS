import ConfigManager from "../../utility/config-manager";
import { addDelay } from "../../utility/plain-utility";
import { cancelHover, triggerHover, waitForElement } from "../../utility/ui-utility";

export default class ResourceManager {
  private static instance: ResourceManager;
  private configManager: ConfigManager;
  private minPopulationBuffer: number;
  private storeAlmostFullPercentage: number;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    // NOTE: error with fetching this conig data ! probabaly storage sinchronization problem
    this.minPopulationBuffer = this.configManager.getConfig()?.resources?.minPopulationBuffer ?? 100;
    this.storeAlmostFullPercentage = this.configManager.getConfig()?.resources?.storeAlmostFullPercentage ?? 0.9;
  }

  public static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager();
    }
    return this.instance;
  }

  public async start() {
  }

  public stop() {
  }

  public async getStoreCapacity() {
    // let maxSizeElement: HTMLDivElement | null = null;
    // do {
    //   triggerHover(document.querySelector<HTMLDivElement>('[data-type="wood"] .amount.ui-game-selectable')!);
    //   await addDelay(100);
    // } while (!(maxSizeElement = document.querySelector<HTMLDivElement>('.island_resource_info span:nth-of-type(2)')))

    triggerHover(document.querySelector<HTMLDivElement>('[data-type="wood"] .amount.ui-game-selectable')!);
    const maxSizeText = await waitForElement('.island_resource_info span:nth-of-type(2)');
    const storeMaxSize = parseInt(maxSizeText?.textContent?.match(/\d+/)?.[0] || '0');
    cancelHover(document.querySelector<HTMLDivElement>('[data-type="wood"] .amount.ui-game-selectable')!);
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
}