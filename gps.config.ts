import { CityInfo } from './src/service/city/city-switch-manager';

export enum FarmTimeInterval {
  FirstOption = 5 * 60_1000,
  SecondOption = 20 * 60_1000,
  ThirdOption = 90 * 60_1000,
  FourthOption = 4 * 60 * 60_1000,
}

const config = {
  farmer: {
    enabled: true,
    farmInterval: FarmTimeInterval.FirstOption,
    humanize: false,
    farmingCities: [] as CityInfo[],
  },
  builder: {
    enabled: true,
  },
  recruiter: {
    enabled: true,
  },
  scheduler: {
    enabled: true,
  },
  academy: {
    enabled: true,
  },
  masterQueue: {
    enabled: true,
  },
  autoRelogin: {
    enabled: false,
    delayMs: 5 * 60 * 1000,
  },
  cyclicalRefresh: {
    enabled: false,
    intervalMs: 60 * 60 * 1000,
  },
  app: {
    antyTimingMs: 10000,
    signoutOnCaptchaFailure: true,
  },
  resources: {
    minPopulationBuffer: 170,
    storeAlmostFullPercentage: 0.9,
  },
};

export const MANAGER_KEYS = ['farmer', 'builder', 'recruiter', 'scheduler', 'academy', 'masterQueue'] as const;
export type Managers = (typeof MANAGER_KEYS)[number];
export type TConfig = typeof config;
export default config;
