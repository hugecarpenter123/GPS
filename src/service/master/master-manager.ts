import { FarmTimeInterval, TConfig } from "../../../gps.config";
import ConfigPopup from "../../config-popup/config-popup";
import ConfigManager from "../../utility/config-manager";
import { addDelay } from "../../utility/plain-utility";
import CityBuilder from "../city/builder/city-builder";
import CitySwitchManager from "../city/city-switch-manager";
import FarmManager from "../farm/farm-manager";
import Scheduler from "../scheduler/Scheduler";
import GeneralInfo from "./ui/general-info";
import generalInfoTemplate from "./ui/info-template.html";
type Managers = 'farmManager' | 'switchManager' | 'scheduler' | 'builder';

export default class MasterManager {
  private static instance: MasterManager
  private config!: TConfig;
  private farmManager!: FarmManager;
  private switchManager!: CitySwitchManager;
  private scheduler!: Scheduler;
  private builder!: CityBuilder;
  private configMenuWindow!: ConfigPopup;
  private generalInfo!: GeneralInfo;

  private pausedManagersSnapshot: {
    [key in Managers]: boolean;
  } = {
      farmManager: false,
      switchManager: false,
      scheduler: false,
      builder: false,
    };
  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<MasterManager> {
    if (!MasterManager.instance) {
      MasterManager.instance = new MasterManager();
      MasterManager.instance.generalInfo = GeneralInfo.getInstance();
      MasterManager.instance.config = ConfigManager.getInstance().getConfig();
      MasterManager.instance.switchManager = await CitySwitchManager.getInstance();
      MasterManager.instance.farmManager = await FarmManager.getInstance();
      MasterManager.instance.scheduler = await Scheduler.getInstance();
      MasterManager.instance.builder = await CityBuilder.getInstance();
      MasterManager.instance.initCaptchaPrevention();
      MasterManager.instance.initRefreshUtility();
      MasterManager.instance.initConfigDialog();
    }
    return MasterManager.instance;
  }

  private initRefreshUtility(timeout?: number) {
    setTimeout(async () => {
      const scheduler = await Scheduler.getInstance();
      const canRefresh = !scheduler.isRunning() || scheduler.canSafelyRefresh();

      if (canRefresh) {
        console.log('canRefresh, will refresh', canRefresh);
        console.log('timeout ?? this.config.general.applicationRefreshInterval', timeout ?? this.config.general.applicationRefreshInterval);
        console.log('this.config.general.applicationRefreshInterval', this.config.general.applicationRefreshInterval);
        this.config.general.forcedRefresh = true;
        ConfigManager.getInstance().persistConfig();
        await addDelay(10000);
        window.location.reload();
      } else {
        console.log('canRefresh', canRefresh);
        this.initRefreshUtility(5 * 1000 * 60);
      }
    }, timeout ?? (this.config.general.applicationRefreshInterval + (Math.floor(Math.random() * 121) - 60)) * 1000);
  }

  // id="recaptcha_window"
  // document.querySelector('[class="recaptcha-checkbox-border"]')
  // document.querySelector('#recaptcha_window [class="caption js-caption"]').click()
  private initCaptchaPrevention() {
    new MutationObserver(async (mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          const recaptchaWindow = document.querySelector('#recaptcha_window');
          const captchaCurtain = document.querySelector('#captcha_curtain');
          if (recaptchaWindow) {
            const checkbox = recaptchaWindow.querySelector<HTMLElement>('[class="recaptcha-checkbox-border"]');
            if (checkbox) {
              await addDelay(4000);
              checkbox.click();
              const caption = recaptchaWindow.querySelector<HTMLElement>('#recaptcha_window [class="caption js-caption"]');
              if (caption) {
                await addDelay(4000);
                caption.click();
              }
            }
          } else if (captchaCurtain) {
            const checkbox = captchaCurtain.querySelector<HTMLElement>('[class="captcha-checkbox-border"]');
            if (checkbox) {
              await addDelay(2000);
              checkbox.click();
              const caption = captchaCurtain.querySelector<HTMLElement>('#captcha_curtain [class="caption js-caption"]');
              if (caption) {
                await addDelay(2000);
                caption.click();
              }
            }
          }
        }
      }
    }).observe(document.body, { childList: true });
  }

  private async runManagersFromConfig(): Promise<void> {
    if (this.configMenuWindow.isSwitchChecked()) {
      if (!this.switchManager.isRunning()) {
        console.log('switchManager will be started...')
        this.switchManager.run();
      }
    } else {
      if (this.switchManager.isRunning()) {
        console.log('switchManager will be stopped...')
        this.switchManager.stop();
      }
    }
    if (this.configMenuWindow.isBuilderChecked()) {
      if (!this.builder.isRunning()) {
        console.log('Builder will be started...')
        this.builder.start();
      }
    } else {
      if (this.builder.isRunning()) {
        console.log('Builder will be stopped...')
        this.builder.stop();
      }
    }
    if (this.configMenuWindow.isFarmChecked()) {
      if (!this.farmManager.isRunning()) {
        console.log('FarmManager will be started...')
        await this.farmManager.start();
      }
    } else {
      if (this.farmManager.isRunning()) {
        console.log('FarmManager will be stopped...')
        this.farmManager.stop();
      }
    }
  }

  private async initConfigDialog() {
    this.configMenuWindow = new ConfigPopup();
    this.configMenuWindow.addListener('managersChange', async () => {
      await this.runManagersFromConfig();
    })
    await this.configMenuWindow.render();

    if (this.config.general.forcedRefresh || GM_getValue('forceRestart')) {
      console.log('forcedRefresh/forceRestart', this.config.general.forcedRefresh, GM_getValue('forceRestart'));
      this.config.general.forcedRefresh = false;
      GM_setValue('forceRestart', false);

      this.config.farmConfig.farmInterval = FarmTimeInterval.FirstOption;
      ConfigManager.getInstance().persistConfig();

      this.configMenuWindow.minimize();
      await this.runManagersFromConfig();
    }
  }

  public run(): void {
    this.runManagersFromConfig();
  }

  public pauseRunningManagers(except: Managers[]): void {
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
    if (!except.includes('farmManager') && this.farmManager.isRunning()) {
      this.farmManager.stop();
      this.pausedManagersSnapshot.farmManager = true;
    }
    if (!except.includes('switchManager') && this.switchManager.isRunning()) {
      this.switchManager.stop();
      this.pausedManagersSnapshot.switchManager = true;
    }
    if (!except.includes('scheduler') && this.scheduler.isRunning()) {
      this.scheduler.stop();
      this.pausedManagersSnapshot.scheduler = true;
    }
    if (!except.includes('builder') && this.builder.isRunning()) {
      this.builder.stop();
      this.pausedManagersSnapshot.builder = true;
    }
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
  }

  public resumeRunningManagers(except: Managers[]): void {
    console.log('resumeRunningManagers', this.pausedManagersSnapshot);
    Object.entries(this.pausedManagersSnapshot).forEach(([key, isPaused]) => {
      switch (key) {
        case 'farmManager':
          if (isPaused && !except.includes('farmManager')) {
            this.farmManager.start();
          }
          break;
        case 'switchManager':
          if (isPaused && !except.includes('switchManager')) {
            this.switchManager.run();
          }
          break;
        case 'scheduler':
          if (isPaused && !except.includes('scheduler')) {
            this.scheduler.run();
          }
          break;
        case 'builder':
          if (isPaused && !except.includes('builder')) {
            this.builder.start();
          }
          break;
      }
    });

    Object.keys(this.pausedManagersSnapshot).forEach((key) => {
      if (except.includes(key as Managers)) {
        this.pausedManagersSnapshot[key as Managers] = false;
      }
    });
  }

  public forceRefresh(): void {
    this.config.general.forcedRefresh = true;
    ConfigManager.getInstance().persistConfig();
    window.location.reload();
  }

  public stopAll(): void {
    this.farmManager.stop();
    this.switchManager.stop();
    this.scheduler.stop();
    this.builder.stop();
  }
}