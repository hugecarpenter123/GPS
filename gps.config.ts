import { CityInfo } from './src/service/city/city-switch-manager';

export enum FarmTimeInterval {
  FirstOption = 5 * 60 * 1000,
  SecondOption = 20 * 60 * 1000,
  ThirdOption = 90 * 60 * 1000,
  FourthOption = 4 * 60 * 60 * 1000,
}

const config = {
  scheduler: {},
  recruiter: {},
  builder: {},
  academy: {},
  farmer: {
    farmInterval: FarmTimeInterval.FirstOption,
    humanize: false,
    farmingCities: [] as CityInfo[],
  },
  masterQueue: {},
  resources: {
    minPopulationBuffer: 170, // buffer na kolona
    storeAlmostFullPercentage: 0.9,
  },
  general: {
    timeDifference: 11 * 1000 + 500,
    antyTimingMs: 10000,
    applicationRefreshInterval: 32 * 60 * 1000, // 32 minutes
    forcedRefresh: false,
    farmer: true,
    builder: true,
    masterQueue: true,
    recruiter: true,
    scheduler: true,
    academy: true,
  },
};

export type Managers = 'scheduler' | 'builder' | 'recruiter' | 'academy' | 'farmer' | 'masterQueue';
export type TConfig = typeof config;
export default config;
