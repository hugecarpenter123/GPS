import gpsConfig from '../../gps.config';
import { addDelay } from './plain-utility';
import StorageManager from './storage-manager';

export default class ConfigManager {
  private static instance: ConfigManager;
  private config!: typeof gpsConfig;
  private storageManager!: StorageManager;

  private constructor() {}

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
      ConfigManager.instance.storageManager = StorageManager.getInstance();
      ConfigManager.instance.config = ConfigManager.instance.initConfig();
      ConfigManager.instance.setTimeDifference(); // TODO: should be blocking actually
    }
    return ConfigManager.instance;
  }
  private async setTimeDifference() {
    let timeText = document.querySelector('.server_time_area')!.textContent!.split(' ')[0];
    while (!timeText.match(/\d{2}:\d{2}:\d{2}/)) {
      await addDelay(333);
      timeText = document.querySelector('.server_time_area')!.textContent!.split(' ')[0];
    }
    let time = timeText.split(':');
    let appNow = new Date();
    appNow.setHours(parseInt(time[0]));
    appNow.setMinutes(parseInt(time[1]));
    appNow.setSeconds(parseInt(time[2]));
    this.config.general.timeDifference = Date.now() - appNow.getTime();

    console.log(
      `server time: ${appNow}\nreal time: ${new Date()}\ndiff in [s]: ${this.config.general.timeDifference / 1000}`,
    );
  }

  private initConfig(): typeof gpsConfig {
    const config = this.storageManager.readFromLocalStorage('config');
    if (!config || !this.isConfigStructureEqual(config, gpsConfig, ['farmingCities'])) {
      this.storageManager.writeToLocalStorage('config', gpsConfig);
      return gpsConfig;
    }
    return config;
  }

  private isConfigStructureEqual(config: any, gpsConfig: any, exceptKeys: string[] = []): boolean {
    return (
      Object.keys(config).length === Object.keys(gpsConfig).length &&
      Object.keys(config).every(key => {
        if (!(key in gpsConfig)) {
          return false;
        }
        if (!exceptKeys.includes(key) && typeof config[key] === 'object' && config[key] !== null) {
          return this.isConfigStructureEqual(config[key], gpsConfig[key], exceptKeys);
        }
        return typeof config[key] === typeof gpsConfig[key];
      })
    );
  }

  public getConfig(): typeof gpsConfig {
    return this.config;
  }

  public persistConfig(): void {
    this.storageManager.writeToLocalStorage('config', this.config);
  }

  public getConfigValue(key: keyof typeof gpsConfig): any {
    return this.config[key];
  }
}
