export enum FarmTimeInterval {
  FiveMinutes = 5 * 60 * 1000,
  TenMinutes = 10 * 60 * 1000,
  TwentyMinutes = 20 * 60 * 1000,
  FortyMinutes = 40 * 60 * 1000,
  OneHourAndHalf = 90 * 60 * 1000,
  ThreeHours = 3 * 60 * 60 * 1000,
  FourHours = 4 * 60 * 60 * 1000,
  EightHours = 8 * 60 * 60 * 1000,
}

const config = {
  resources: {
    minPopulationBuffer: 100,
    storeAlmostFullPercentage: 0.9,
  },
  farmConfig: {
    farmInterval: FarmTimeInterval.FiveMinutes
  },
  general: {
    antyTimingMs: 3000,
  }
}
export type TConfig = typeof config;
export default config;