import { CityInfo } from "./src/service/city/city-switch-manager";

export enum FarmTimeInterval {
  FirstOption = 5 * 60 * 1000,
  SecondOption = 20 * 60 * 1000,
  ThirdOption = 90 * 60 * 1000,
  FourthOption = 4 * 60 * 60 * 1000,
}

const config = {
  resources: {
    minPopulationBuffer: 100,
    storeAlmostFullPercentage: 0.9,
  },
  farmConfig: {
    farmInterval: FarmTimeInterval.FirstOption,
    humanize: false,
    farmingCities: [] as CityInfo[],
  },
  general: {
    timeDifference: (11 * 1000) + 500,
    antyTimingMs: 10000,
    applicationRefreshInterval: 32 * 60 * 1000, // 32 minutes
    forcedRefresh: false,
    switch: true,
    farm: true,
    builder: true,
    guard: false,
  }
}
export type TConfig = typeof config;
export default config;