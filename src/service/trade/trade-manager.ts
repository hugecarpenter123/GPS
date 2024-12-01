import { info } from "console";
import { FarmTimeInterval } from "../../../gps.config";
import { InfoError } from "../../utility/info-error";
import { addDelay, shuffle, textToMs, waitUntil } from "../../utility/plain-utility";
import { performComplexClick, triggerHover, waitForElementInterval, waitForElementsInterval } from "../../utility/ui-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import ResourceManager from "../resources/resource-manager";

type CityTradeItem = Record<string, number>;
type CityTradeMap = Record<string, CityTradeItem[]>;
/**
 * RequiredResourcesInfo is split into target and toStack because, during evaluation how many resources needs to be stacked
 * Trade movements may not be taken into consideration and most of the resources (or all) are already on the way. Without it, trader would 
 * have to fetch all resources no matter already existing trade movements.
 */
type RequiredResourcesInfo = {
  target: {
    wood: number;
    iron: number;
    stone: number;
  },
  toStack: {
    wood: number;
    iron: number;
    stone: number;
  }
}
type StackResourcesResult = {
  fullyStacked: boolean;
  timeMs?: number;
  resources?: RequiredResourcesInfo;
}

export class TradeManager {
  private static instance: TradeManager;
  private citySwitchManager!: CitySwitchManager;
  private tradeMap: CityTradeMap = {};
  private resourceManager!: ResourceManager;

  private constructor() { }

  public static async getInstance(): Promise<TradeManager> {
    if (!TradeManager.instance) {
      TradeManager.instance = new TradeManager();
      TradeManager.instance.citySwitchManager = await CitySwitchManager.getInstance();
      TradeManager.instance.resourceManager = await ResourceManager.getInstance();
    }
    return TradeManager.instance;
  }

  private async initTradeMap(forCities?: CityInfo[], initial?: CityTradeMap) {
    const cityList = forCities ?? this.citySwitchManager.getCityList();
    this.tradeMap = initial ?? cityList.reduce((acc, city) => {
      acc[city.name] = [];
      return acc;
    }, {} as CityTradeMap);

    for (const city of cityList) {
      const alreadyAddedCities = this.tradeMap[city.name]?.map(obj => Object.keys(obj)[0]) || [];
      const fromCities = cityList.filter(c => ![city.name, ...alreadyAddedCities].includes(c.name));
      for (const fromCity of fromCities) {
        await fromCity.switchAction(false);
        await addDelay(100);
        const tradeTime: number = this.getTradeTime();
        this.tradeMap[city.name].push({ [fromCity.name]: tradeTime });
        this.tradeMap[fromCity.name].push({ [city.name]: tradeTime });
      }
    }
  }

  private async loadTradeMap() {
    const tradeMap: CityTradeMap | null = JSON.parse(localStorage.getItem('tradeMap') || '{}');
    if (!tradeMap) {
      await this.initTradeMap();
    } else {
      const cityList = this.citySwitchManager.getCityList();
      const loadedCityList = Object.keys(tradeMap);
      if (loadedCityList.length !== cityList.length || loadedCityList.some(city => !cityList.map(c => c.name).includes(city))) {
        // jeżeli załadowana mapa miast nie zawiera wszystkich miast z prawdziwej listy miast to
        // 1. jeżeli dlugość jest ta sama, ale są inne miasta, to usuń dodatkowe miastas i wykonaj mapowanie dla innych
        // 2. jeżeli prawdziwa lista miast jest krótsza, to znajdź dodatkowe miasta i usuń je
        // 3. jeżeli prawdziwa lista miast jest dłuższa, znajdź dodatkowe miasta i wykonaj mapowanie
        await this.tryPatchTradeMap(tradeMap);
      }
      this.tradeMap = tradeMap;
    }
  }

  private async tryPatchTradeMap(loadedTradeMap: CityTradeMap) {
    const cityList = this.citySwitchManager.getCityList();
    const loadedCityList = Object.keys(loadedTradeMap);
    const missingCitiesFromLoaded = cityList.filter(c => !loadedCityList.includes(c.name));
    const missingCitiesFromReal = loadedCityList.filter(c => !cityList.map(c => c.name).includes(c));
    missingCitiesFromLoaded.forEach(async c => {
      await this.initTradeMap([c], loadedTradeMap);
    });
    missingCitiesFromReal.forEach(async c => {
      delete loadedTradeMap[c];
    });
  }

  private async saveTradeMap() {
    localStorage.setItem('tradeMap', JSON.stringify(this.tradeMap));
  }

  private async goToTradeMode(city: CityInfo, fromCity: CityInfo) {
    await city.switchAction();
    console.log('goToTradeMode, city:', city, 'fromCity:', fromCity);
    let counter = 0;
    do {
      counter++;
      await fromCity.switchAction(false);
      await performComplexClick(document.querySelector<HTMLElement>(`#town_${city.cityId}`)).catch(() => { console.log(`no town ${city.cityId} found`) });
      await addDelay(500);
    } while (!document.querySelector<HTMLElement>('#trading') && counter < 5)
    if (counter >= 5) throw new InfoError('Couldn\'t click trading option', {})
    document.querySelector<HTMLElement>('#trading')!.click();
  }

  private async closeTradeMode() {
    await waitUntil(() => {
      const closeBtn = document.querySelector('.ui-dialog-titlebar-close');
      return !closeBtn || !(closeBtn.parentElement?.nextSibling as HTMLElement)?.querySelector('#trade');
    }, { delay: 400, maxIterations: 3, onError: () => {/* do nothing */ } });
    (document.querySelector('.ui-dialog-titlebar-close') as HTMLElement)?.click();
  }

  private getTradeTime(): number {
    const tradeTimeText = document.querySelector<HTMLElement>('#duration_container .way_duration')?.textContent;
    return textToMs(tradeTimeText!.slice(1));
  }

  /**
   * Goes through the cities and stacks resources, returns time in ms to last shipment or -1 if not enough resources, which means
   * that stacking should be rescheduled
   * @requires Lock
   */
  private async stackResources(resourceInfo: RequiredResourcesInfo, city: CityInfo, fromCities: CityInfo[], maxShipmentTime: number): Promise<StackResourcesResult> {
    console.log('stackResources', resourceInfo);
    // stack resources from cities
    let highestTime = -1;
    console.log('going to trade mode');
    const shuffledFromCities = shuffle([...fromCities]);
    await this.goToTradeMode(city, shuffledFromCities[0]);
    const stillNeededResources = { ...resourceInfo.toStack };

    // check if resources are alredy non its way
    let [woodRealState, stoneRealState, ironRealState] =
      Array.from(document.querySelectorAll('.amounts'))
        ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];

    while (woodRealState?.length !== 2 || stoneRealState?.length !== 2 || ironRealState?.length !== 2) {
      await addDelay(400);
      [woodRealState, stoneRealState, ironRealState] =
        Array.from(document.querySelectorAll('.amounts'))
          ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];
    }
    console.log('woodRealState:', woodRealState, 'stoneRealState:', stoneRealState, 'ironRealState:', ironRealState);

    if (woodRealState![0] >= resourceInfo.target.wood && stoneRealState![0] >= resourceInfo.target.stone && ironRealState![0] >= resourceInfo.target.iron) {
      await this.closeTradeMode();
      return {
        fullyStacked: true,
        timeMs: 1000 * 60 * 5,
      }
    }
    // END check if resources are alredy non its way

    let prevWayDurationText = '-1';
    // w tym miejscue jest trade mode
    for (const supplierCity of shuffledFromCities) {
      console.log('stacking resources from:', supplierCity.name);
      let resourcesSent = false;
      let currentShipmentTimeMS = 0;
      let currentTradeCapacity = 0;
      // przejdź do miasta z którego się przesyła surowce
      console.log('switching to without jumping:', supplierCity.name);
      await supplierCity.switchAction(false);
      // upewnia się że miasto zostało przełączone przez porównanie czasu dostawy
      let currentWayDurationText: string | undefined | null = null;
      let counter = 0;
      do {
        counter++;
        await addDelay(500);
        currentWayDurationText = document.querySelector<HTMLElement>('#duration_container .way_duration')?.textContent;
      } while ((!currentWayDurationText || currentWayDurationText === prevWayDurationText) && counter < 6);
      if (counter >= 6) console.warn('stackResources.while.counter:', counter);
      prevWayDurationText = currentWayDurationText!;
      console.log('currentWayDurationText:', currentWayDurationText);
      await addDelay(333);

      currentShipmentTimeMS = textToMs(currentWayDurationText!.slice(1));
      console.log('currentShipmentTimeMS:', currentShipmentTimeMS);
      console.log('maxShipmentTime:', maxShipmentTime);
      if (currentShipmentTimeMS > maxShipmentTime) continue;

      // zczytaj surki z obecnego miasta
      const resources = await this.resourceManager.getResourcesInfo();
      console.log('resources:', resources);
      // dowiedz się jaki jest max trade capaacity
      currentTradeCapacity = await waitForElementInterval('#big_progressbar .curr').then(el => Number(el.textContent));
      console.log('currentTradeCapacity:', currentTradeCapacity);
      // zczytaj wartości z progress barów na temat tego co jest w mieście i co do niego już idzie i nadpisz wartości
      const [woodRealState, stoneRealState, ironRealState] =
        Array.from(document.querySelectorAll('.amounts'))
          ?.map(el => el.textContent?.match(/\d+ +\/ +\d+/)?.[0]?.split('/')?.map(v => Number(v))) ?? [];
      console.log('woodRealState:', woodRealState, 'stoneRealState:', stoneRealState, 'ironRealState:', ironRealState);

      // minimalnie 100 surowców (wymóg gry)
      if (stillNeededResources.iron !== 0) {
        stillNeededResources.iron = ironRealState![0] + stillNeededResources.iron >= Math.floor(0.9 * ironRealState![1])
          ? Math.max(100, Math.floor(ironRealState![1] * 0.9) - ironRealState![0])
          : Math.max(100, stillNeededResources.iron);
      }

      if (stillNeededResources.stone !== 0) {
        stillNeededResources.stone = stoneRealState![0] + stillNeededResources.stone >= Math.floor(0.9 * stoneRealState![1])
          ? Math.max(100, Math.floor(stoneRealState![1] * 0.9) - stoneRealState![0])
          : Math.max(100, stillNeededResources.stone);
      }

      if (stillNeededResources.wood !== 0) {
        stillNeededResources.wood = woodRealState![0] + stillNeededResources.wood >= Math.floor(0.9 * woodRealState![1])
          ? Math.max(100, Math.floor(woodRealState![1] * 0.9) - woodRealState![0])
          : Math.max(100, stillNeededResources.wood);
      }

      console.log('stillNeededResources after checking:', stillNeededResources);


      if (stillNeededResources.wood > 0 && currentTradeCapacity >= 100 && resources.wood.amount >= 100) {
        const woodInput = await waitForElementInterval('#trade_type_wood input', { interval: 333, retries: 4 });
        const woodAmountToSend = Math.min(stillNeededResources.wood, resources.wood.amount, currentTradeCapacity);
        console.log('setting min wood value out of:', [stillNeededResources.wood, resources.wood.amount, currentTradeCapacity]);
        (woodInput as HTMLInputElement).value = woodAmountToSend.toString();
        stillNeededResources.wood -= woodAmountToSend;
        currentTradeCapacity -= woodAmountToSend;
        resourcesSent = true;
        console.log('remainning capacity:', currentTradeCapacity);
      }
      if (stillNeededResources.iron > 0 && currentTradeCapacity >= 100 && resources.iron.amount >= 100) {
        const ironInput = await waitForElementInterval('#trade_type_iron input', { interval: 333, retries: 4 })
        const ironAmountToSend = Math.min(stillNeededResources.iron, resources.iron.amount, currentTradeCapacity);
        console.log('setting min iron value out of:', [stillNeededResources.iron, resources.iron.amount, currentTradeCapacity]);
        (ironInput as HTMLInputElement).value = ironAmountToSend.toString();
        stillNeededResources.iron -= ironAmountToSend;
        currentTradeCapacity -= ironAmountToSend;
        resourcesSent = true;
        console.log('remainning capacity:', currentTradeCapacity);
      }
      if (stillNeededResources.stone > 0 && currentTradeCapacity >= 100 && resources.stone.amount >= 100) {
        const stoneInput = await waitForElementInterval('#trade_type_stone input', { interval: 333, retries: 4 })
        const stoneAmountToSend = Math.min(stillNeededResources.stone, resources.stone.amount, currentTradeCapacity);
        console.log('setting min stone value out of:', [stillNeededResources.stone, resources.stone.amount, currentTradeCapacity]);
        (stoneInput as HTMLInputElement).value = stoneAmountToSend.toString();
        stillNeededResources.stone -= stoneAmountToSend;
        currentTradeCapacity -= stoneAmountToSend;
        resourcesSent = true;
        console.log('remainning capacity:', currentTradeCapacity);
      }
      console.log(`-------------\nclicking trade button, while inputs values are: 
        woodInput:${document.querySelector<HTMLInputElement>('#trade_type_wood input')?.value} 
        stoneInput:${document.querySelector<HTMLInputElement>('#trade_type_stone input')?.value} 
        ironInput:${document.querySelector<HTMLInputElement>('#trade_type_iron input')?.value}
        capacity is: ${currentTradeCapacity}
        stillNeededResources: ${JSON.stringify(stillNeededResources)}
        `);

      // click trade button if resources are to be sent (inputs fields filled)
      if (resourcesSent) document.querySelector<HTMLElement>('.btn_trade_button.button_new')?.click();
      if (currentShipmentTimeMS > highestTime && resourcesSent) highestTime = currentShipmentTimeMS;
      if (stillNeededResources.wood <= 0 && stillNeededResources.iron <= 0 && stillNeededResources.stone <= 0) {
        break;
      }
    }
    await this.closeTradeMode();
    if (stillNeededResources.wood > 0 || stillNeededResources.iron > 0 || stillNeededResources.stone > 0) {
      console.log('not fully stacked, timeMs:', highestTime);
      return {
        fullyStacked: false,
        timeMs: highestTime + 3000,
        resources: { toStack: stillNeededResources, target: resourceInfo.target }
      }
    }
    // return time in ms to last shipment
    console.log('fully stacked, timeMs:', highestTime);
    return {
      fullyStacked: true,
      timeMs: highestTime + 3000,
    }
  }

  private async getIncomingResourcesInfo(within: number): Promise<{ resources: { wood: number, stone: number, iron: number }, lastShipmentTime: number }> {
    let lastShipmentTime = -1;
    const result = { wood: 0, stone: 0, iron: 0 };
    const supplyingTradeItems = Array.from(await waitForElementsInterval('.item.trade.option', { interval: 333, retries: 2 }).catch(() => []))
      .filter(el => el.querySelector('.returning'));
    for (const item of supplyingTradeItems) {
      // get info el
      const infoEl = document.querySelector<HTMLElement>('#popup_content div')
      // clean its content to be sure always new values are read via hover
      if (infoEl) infoEl.textContent = '';
      // get shipment time
      const currShipmentTime = textToMs(item.querySelector<HTMLElement>('.time')?.textContent!);
      if (currShipmentTime > within) continue;
      if (currShipmentTime > lastShipmentTime) lastShipmentTime = currShipmentTime;

      let wood;
      let stone;
      let iron;
      do {
        triggerHover(item);
        await addDelay(250);
        wood = Number(item.querySelector<HTMLImageElement>('img[src$="game/res/wood.png"]')?.nextSibling?.textContent?.trim());
        stone = Number(item.querySelector<HTMLImageElement>('img[src$="game/res/stone.png"]')?.nextSibling?.textContent?.trim());
        iron = Number(item.querySelector<HTMLImageElement>('img[src$="game/res/iron.png"]')?.nextSibling?.textContent?.trim());
      } while (!infoEl || infoEl.textContent === '' || [wood, stone, iron].some(v => isNaN(v)));
      result.wood += wood || 0;
      result.stone += stone || 0;
      result.iron += iron || 0;
    }
    return { resources: result, lastShipmentTime };
  }

}