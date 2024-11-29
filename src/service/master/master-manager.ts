import { FarmTimeInterval, TConfig } from "../../../gps.config";
import ConfigPopup, { TConfigChanges } from "../../config-popup/config-popup";
import ConfigManager from "../../utility/config-manager";
import { addDelay, getCookie, hasAnyValue, setCookie } from "../../utility/plain-utility";
import CityBuilder from "../city/builder/city-builder";
import CitySwitchManager from "../city/city-switch-manager";
import FarmManager from "../farm/farm-manager";
import Recruiter from "../recruiter/recruiter";
import Scheduler from "../scheduler/Scheduler";
import GeneralInfo from "./ui/general-info";

export type Managers = 'farmManager' | 'scheduler' | 'builder' | 'recruiter';

export default class MasterManager {
  private static instance: MasterManager
  private config!: TConfig;
  private farmManager!: FarmManager;
  private switchManager!: CitySwitchManager;
  private scheduler!: Scheduler;
  private builder!: CityBuilder;
  private recruiter!: Recruiter;
  private configMenuWindow!: ConfigPopup;
  private generalInfo!: GeneralInfo;

  private pausedManagersSnapshot: {
    [key in Managers]: boolean;
  } = {
      farmManager: false,
      scheduler: false,
      builder: false,
      recruiter: false,
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
      MasterManager.instance.recruiter = await Recruiter.getInstance();
      MasterManager.instance.initCaptchaPrevention();
      // MasterManager.instance.initRefreshUtility();
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

  private async runManagersFromConfig(configChanges?: TConfigChanges): Promise<void> {
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
    if (this.configMenuWindow.isRecruiterChecked()) {
      if (!this.recruiter.isRunning()) {
        console.log('Recruiter will be started...')
        this.recruiter.start();
      }
    } else {
      if (this.recruiter.isRunning()) {
        console.log('Recruiter will be stopped...')
        this.recruiter.stop();
      }
    }

    if (configChanges) {
      if (hasAnyValue(configChanges.recruiter, true)) {
        this.recruiter.handleRecruiterConfigChange(configChanges.recruiter);
      }
    }
  }

  private async initConfigDialog() {
    this.configMenuWindow = new ConfigPopup();
    this.configMenuWindow.addListener('managersChange', async (configChanges: TConfigChanges) => {
      await this.runManagersFromConfig(configChanges);
    })
    await this.configMenuWindow.render();

    if (this.config.general.forcedRefresh || getCookie('forceRestart')) {
      console.log('forcedRefresh/forceRestart', this.config.general.forcedRefresh, getCookie('forceRestart'));
      this.config.general.forcedRefresh = false;
      setCookie('forceRestart', false);

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
    if (!except.includes('scheduler') && this.scheduler.isRunning()) {
      this.scheduler.stop();
      this.pausedManagersSnapshot.scheduler = true;
    }
    if (!except.includes('builder') && this.builder.isRunning()) {
      this.builder.stop();
      this.pausedManagersSnapshot.builder = true;
    }
    if (!except.includes('recruiter') && this.recruiter.isRunning()) {
      this.recruiter.stop();
      this.pausedManagersSnapshot.recruiter = true;
    }
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
  }

  public pauseRunningManagersIfNeeded(actionTime: number, except: Managers[]): void {
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
    if (!except.includes('farmManager') && this.farmManager.isRunning()) {
      const farmTimes = this.farmManager.getFarmScheduleTimes();
      const farmTimesCollides = farmTimes.some(farmingTime =>
        farmingTime &&
        farmingTime.getTime() <= actionTime &&
        Math.abs((farmingTime.getTime() - actionTime)) <= 1000 * 20);
      if (farmTimesCollides) {
        this.farmManager.stop();
        this.pausedManagersSnapshot.farmManager = true;
      }
    }
    // TODO: more robust check in the future since it will have its own schedule
    if (!except.includes('recruiter') && this.recruiter.isRunning()) {
      const recruiterTimes = this.recruiter.getRecruitmentScheduleTimes();
      const recruiterTimesCollides = recruiterTimes.some((recruitingTime: number) =>
        recruitingTime &&
        recruitingTime <= actionTime &&
        Math.abs((recruitingTime - actionTime)) <= 1000 * 30);
      if (recruiterTimesCollides) {
        this.recruiter.stop();
        this.pausedManagersSnapshot.recruiter = true;
      }
    }
    if (!except.includes('scheduler') && this.scheduler.isRunning()) {
      this.scheduler.stop();
      this.pausedManagersSnapshot.scheduler = true;
    }
    if (!except.includes('builder') && this.builder.isRunning()) {
      const builderTimes = this.builder.getBuilderScheduleTimes();
      const builderTimesCollides = builderTimes.some(builderTime =>
        builderTime &&
        builderTime.getTime() <= actionTime &&
        Math.abs((builderTime.getTime() - actionTime)) <= 1000 * 20);
      if (builderTimesCollides) {
        this.builder.stop();
        this.pausedManagersSnapshot.builder = true;
      }
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
        case 'recruiter':
          if (isPaused && !except.includes('recruiter')) {
            this.recruiter.start();
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