import gpsConfig, { TConfig } from '../../gps.config';
import { addDelay } from './plain-utility';
import StorageManager from './storage-manager';

interface RuntimeState {
  timeDifference: number;
}

export default class ConfigManager {
  public static readonly LOCAL_STORAGE_KEY = 'config';
  private static instance: ConfigManager;
  private config!: TConfig;
  private runtime: RuntimeState = { timeDifference: 0 };
  private storageManager!: StorageManager;

  private constructor() {}

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
      ConfigManager.instance.storageManager = StorageManager.getInstance();
      ConfigManager.instance.config = ConfigManager.instance.initConfig();
      ConfigManager.instance.initTimeDifference();
    }
    return ConfigManager.instance;
  }

  private async initTimeDifference() {
    let timeText = document.querySelector('.server_time_area')?.textContent?.split(' ')[0] ?? '';
    while (!timeText.match(/\d{2}:\d{2}:\d{2}/)) {
      await addDelay(333);
      timeText = document.querySelector('.server_time_area')?.textContent?.split(' ')[0] ?? '';
    }
    const time = timeText.split(':');
    const appNow = new Date();
    appNow.setHours(parseInt(time[0]));
    appNow.setMinutes(parseInt(time[1]));
    appNow.setSeconds(parseInt(time[2]));
    this.runtime.timeDifference = Date.now() - appNow.getTime();

    console.log(`server time: ${appNow}\nreal time: ${new Date()}\ndiff in [s]: ${this.runtime.timeDifference / 1000}`);
  }

  private initConfig(): TConfig {
    const stored = this.storageManager.read(ConfigManager.LOCAL_STORAGE_KEY);
    if (!stored || !this.isConfigStructureEqual(stored, gpsConfig, ['farmingCities'])) {
      this.storageManager.write(ConfigManager.LOCAL_STORAGE_KEY, gpsConfig);
      return structuredClone(gpsConfig);
    }
    return stored;
  }

  private isConfigStructureEqual(config: any, reference: any, exceptKeys: string[] = []): boolean {
    return (
      Object.keys(config).length === Object.keys(reference).length &&
      Object.keys(config).every(key => {
        if (!(key in reference)) return false;
        if (!exceptKeys.includes(key) && typeof config[key] === 'object' && config[key] !== null) {
          return this.isConfigStructureEqual(config[key], reference[key], exceptKeys);
        }
        return typeof config[key] === typeof reference[key];
      })
    );
  }

  public getConfig(): TConfig {
    return this.config;
  }

  public getRuntime(): RuntimeState {
    return this.runtime;
  }

  public getTimeDifference(): number {
    return this.runtime.timeDifference;
  }

  public persist(): void {
    this.storageManager.write(ConfigManager.LOCAL_STORAGE_KEY, this.config);
  }

  public getConfigValue<K extends keyof TConfig>(key: K): TConfig[K] {
    return this.config[key];
  }
}
