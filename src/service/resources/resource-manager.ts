import ConfigManager from "../../utility/config-manager";
import { waitForElement } from "../../utility/ui-utility";

export default class ResourceManager {
  private static instance: ResourceManager;
  private configManager: ConfigManager;
  private minPopulationBuffer: number;
  private storeAlmostFullPercentage: number;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
    this.minPopulationBuffer = this.configManager.getConfig().resources.minPopulationBuffer;
    this.storeAlmostFullPercentage = this.configManager.getConfig().resources.storeAlmostFullPercentage;
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

  public async getResources() {
    const wood = Number(await waitForElement('[data-type="wood"] .amount.ui-game-selectable'));
    const stone = Number(await waitForElement('[data-type="stone"] .amount.ui-game-selectable'));
    const iron = Number(await waitForElement('[data-type="iron"] .amount.ui-game-selectable'));
    const population = Number(await waitForElement('[data-type="population"] .amount.ui-game-selectable'));

    const maxSizeText = (await waitForElement('.island_resource_info span:nth-of-type(2)')).textContent;
    const storeMaxSize = parseInt(maxSizeText?.match(/\d+/)?.[0] || '0');

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