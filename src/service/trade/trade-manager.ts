import { InfoError } from "../../utility/info-error";
import { addDelay, textToMs, waitUntil } from "../../utility/plain-utility";
import { performComplexClick } from "../../utility/ui-utility";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";

type CityTradeItem = Record<string, number>;
type CityTradeMap = Record<string, CityTradeItem[]>;

export class TradeManager {
  private static instance: TradeManager;
  private citySwitchManager!: CitySwitchManager;
  private tradeMap: CityTradeMap = {};

  private constructor() { }

  public static async getInstance(): Promise<TradeManager> {
    if (!TradeManager.instance) {
      TradeManager.instance = new TradeManager();
      TradeManager.instance.citySwitchManager = await CitySwitchManager.getInstance();
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

}