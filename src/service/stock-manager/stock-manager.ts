import { addDelay, doUntil, waitUntil } from "../../utility/plain-utility";
import Lock from "../../utility/ui-lock";
import { waitForElementInterval } from "../../utility/ui-utility";
import ResourceManager from "../resources/resource-manager";

interface StockMainLoop {
  intervalId?: NodeJS.Timeout | null;
  scheduleDate?: Date | null;
}

interface Stock {
  wood: [number, number];
  stone: [number, number];
  iron: [number, number];
}

export default class StockManager {
  public static readonly STOCK_INTERVAL = 1000 * 20;
  private static instance: StockManager;
  private run: boolean = false;
  private lock!: Lock;
  private resourceManager!: ResourceManager;

  private mainLoop: StockMainLoop = {
    intervalId: null,
    scheduleDate: null,
  };

  private constructor() {
    console.log('StockManager constructor');
  }

  public static async getInstance() {
    if (!StockManager.instance) {
      StockManager.instance = new StockManager();
      StockManager.instance.lock = Lock.getInstance();
      StockManager.instance.resourceManager = await ResourceManager.getInstance();
    }
    return StockManager.instance;
  }

  public isRunning() {
    return this.run;
  }

  public start() {
    this.run = true;
    console.log('StockManager started');
    this.runMainLoop();
  }

  public stop() {
    this.run = false;
    console.log('StockManager stopped');
    if (this.mainLoop.intervalId) {
      clearInterval(this.mainLoop.intervalId);
      this.mainLoop.intervalId = null;
      this.mainLoop.scheduleDate = null;
    }
  }

  private async runMainLoop() {
    await this.checkStock();
    this.scheduleNextStockCheck();
  }

  private scheduleNextStockCheck(date?: Date) {
    this.mainLoop.scheduleDate = date ?? new Date(Date.now() + StockManager.STOCK_INTERVAL);
    this.mainLoop.intervalId = setInterval(async () => {
      await this.checkStock();
    }, StockManager.STOCK_INTERVAL);
  }

  private async checkStock() {
    try {
      this.lock.acquire();
      // go to city view
      document.querySelector<HTMLElement>('[name="city_overview"]')?.click();

      // go to market
      await waitForElementInterval('#building_main_area_market', { interval: 200, retries: 6 })
        .then(el => el.click());

      // get selling stock
      await waitForElementInterval('[data-pagenr="1"].gp_page_caption', { interval: 200, retries: 6 })
        .then(el => el.click());
      await waitUntil(() => !document.querySelector('[data-pagenr="1"].gp_page_caption')?.classList.contains('active'));

      // parse capacity
      const capacity = {
        current: Number(document.querySelector<HTMLInputElement>('.pg_capacity .curr')?.textContent),
        max: Number(document.querySelector<HTMLInputElement>('.pg_capacity .max')?.textContent),
      };
      console.log(capacity);

      // parse stock
      const stock = this.getStock();

      // force try to sell
      await this.performSell(stock, capacity);
    } catch (error) {
      console.error('stock-manager.checkStock.catch:', error);
    } finally {
      this.lock.release();
    }
  }

  private getStock(): Stock {
    return {
      wood: [
        Number(document.querySelector('.resource[data-type="wood"] .current')?.textContent),
        Number(document.querySelector('.resource[data-type="wood"] .max')?.textContent),
      ],
      stone: [
        Number(document.querySelector('.resource[data-type="stone"] .current')?.textContent),
        Number(document.querySelector('.resource[data-type="stone"] .max')?.textContent),
      ],
      iron: [
        Number(document.querySelector('.resource[data-type="iron"] .current')?.textContent),
        Number(document.querySelector('.resource[data-type="iron"] .max')?.textContent),
      ],
    };
  }

  private async performSell(stock: Stock, capacity: { current: number, max: number }) {
    // let capacityLeft = capacity.max - capacity.current;
    // const resourcesInfo = this.resourceManager.getResourcesInfo();
    const sortedStock = Object.entries(stock).sort(([resourceA, [currentA, maxA]], [resourceB, [currentB, maxB]]) => {
      return (maxA - currentA) - (maxB - currentB);
    });
    console.log('sortedStock', sortedStock);

    for (const [resource, [current, max]] of sortedStock) {
      if (current > 0) {
        // const amount = Math.min(max - current, (resourcesInfo as any)[resource].amount as number, capacityLeft);
        // document.querySelector<HTMLInputElement>(`.spinner_horizontal.sp_resource[data-type="${resource}"] input`)!
        //   .value = amount.toString();
        // capacityLeft -= amount;
        document.querySelectorAll<HTMLElement>(`.resource[data-type="${resource}"] .button_increase`)
          .forEach(el => {
            if (el.offsetParent) {
              for (let i = 0; i < 30; i++) {
                el.click();
              }
            }
          });
      }
    }
    await addDelay(100);
    document.querySelectorAll<HTMLElement>('.button_new.btn_find_rates')
      .forEach(el => {
        if (el.offsetParent) {
          el.click();
        }
      });

    await addDelay(100);
    const confirmButton = await waitForElementInterval('.confirm_order .button_new.btn_confirm', { interval: 333, retries: 4 })
      .catch(() => { });
    if (confirmButton) {
      confirmButton.click();
    }

    // cleanup
    document.querySelector<HTMLElement>('.classic_window.market .btn_wnd.close')?.click();
  }
}