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
  },
  general: {
    antyTimingMs: 9000,
    applicationRefreshInterval: 30 * 60 * 1000, // 30 minutes
    forcedRefresh: false,
    switch: true,
    farm: true,
    builder: true,
    guard: false,
  }
}
export type TConfig = typeof config;
export default config;