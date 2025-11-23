import { FarmTimeInterval, TConfig } from '../../../gps.config';
import { ConfigPopupUtility, TConfigChanges, useConfigPopup } from '../../config-popup/config-popup';
import ConfigManager from '../../utility/config-manager';
import { getCookie, hasAnyValue, setCookie } from '../../utility/plain-utility';
import CityBuilder from '../city/builder/city-builder';
import CitySwitchManager from '../city/city-switch-manager';
import FarmManager from '../farm/farm-manager';
import MasterQueue from '../master-queue/master-queue';
import Recruiter from '../recruiter/recruiter';
import Scheduler from '../scheduler/Scheduler';
import GeneralInfo from './ui/general-info';

export type Managers = 'farmManager' | 'scheduler' | 'builder' | 'recruiter' | 'masterQueue';

export default class MasterManager {
  private static instance: MasterManager;
  private config!: TConfig;
  private farmManager!: FarmManager;
  private switchManager!: CitySwitchManager;
  private scheduler!: Scheduler;
  private builder!: CityBuilder;
  private recruiter!: Recruiter;
  private masterQueue!: MasterQueue;
  private configPopupWindow!: ConfigPopupUtility;
  private generalInfo!: GeneralInfo;

  private pausedManagersSnapshot: {
    [key in Managers]: boolean;
  } = {
    farmManager: false,
    scheduler: false,
    builder: false,
    recruiter: false,
    masterQueue: false,
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
      MasterManager.instance.masterQueue = await MasterQueue.getInstance();
      // MasterManager.instance.initCaptchaPrevention();
      // MasterManager.instance.initRefreshUtility();
      MasterManager.instance.initConfigDialog();
    }
    return MasterManager.instance;
  }

  // private initRefreshUtility(timeout?: number) {
  //   setTimeout(
  //     async () => {
  //       const scheduler = await Scheduler.getInstance();
  //       const canRefresh = !scheduler.isRunning() || scheduler.canSafelyRefresh();

  //       if (canRefresh) {
  //         console.log('canRefresh, will refresh', canRefresh);
  //         console.log(
  //           'timeout ?? this.config.general.applicationRefreshInterval',
  //           timeout ?? this.config.general.applicationRefreshInterval,
  //         );
  //         console.log('this.config.general.applicationRefreshInterval', this.config.general.applicationRefreshInterval);
  //         this.config.general.forcedRefresh = true;
  //         ConfigManager.getInstance().persistConfig();
  //         await addDelay(10000);
  //         window.location.reload();
  //       } else {
  //         console.log('canRefresh', canRefresh);
  //         this.initRefreshUtility(5 * 1000 * 60);
  //       }
  //     },
  //     timeout ?? (this.config.general.applicationRefreshInterval + (Math.floor(Math.random() * 121) - 60)) * 1000,
  //   );
  // }

  private async runManagersFromConfig(configChanges?: TConfigChanges): Promise<void> {
    console.log('runManagersFromConfig', configChanges);
    // if config changes are present, perform them before potentially starting the manager
    if (configChanges) {
      if (hasAnyValue(configChanges.masterQueue, true)) {
        this.masterQueue.onConfigChange(configChanges.masterQueue);
      }
      if (hasAnyValue(configChanges.builder, true)) {
        this.builder.onConfigChange(configChanges.builder);
      }
    }

    // scheduler first because if it needs to perform anything straight away then it must block the rest
    if (this.config.general.scheduler) {
      if (!this.scheduler.isRunning()) {
        console.log('Scheduler will be started...');
        this.scheduler.start();
      }
    } else {
      if (this.scheduler.isRunning()) {
        console.log('Scheduler will be stopped...');
        this.scheduler.stop();
      }
    }
    if (this.config.general.masterQueue) {
      if (!this.masterQueue.isRunning()) {
        console.log('MasterQueue will be started...');
        this.masterQueue.start();
      }
    } else {
      if (this.masterQueue.isRunning()) {
        console.log('MasterQueue will be stopped...');
        this.masterQueue.stop();
      }
    }
    if (this.config.general.builder) {
      if (!this.builder.isRunning()) {
        console.log('Builder will be started...');
        this.builder.start();
      }
    } else {
      if (this.builder.isRunning()) {
        console.log('Builder will be stopped...');
        this.builder.stop();
      }
    }
    if (this.config.general.farm) {
      if (!this.farmManager.isRunning()) {
        console.log('FarmManager will be started...');
        await this.farmManager.start();
      }
    } else {
      if (this.farmManager.isRunning()) {
        console.log('FarmManager will be stopped...');
        this.farmManager.stop();
      }
    }
    if (this.config.general.recruiter) {
      if (!this.recruiter.isRunning()) {
        console.log('Recruiter will be started...');
        this.recruiter.start();
      }
    } else {
      if (this.recruiter.isRunning()) {
        console.log('Recruiter will be stopped...');
        this.recruiter.stop();
      }
    }
  }

  private async initConfigDialog() {
    /*
     TODO: tutaj zostanie przekazana instancja klasy renderującej konfiguracji każdego menadżera
     w taki sposób, że config popup będzie nieświadomy konfiguracji żadnego z menadżerów, będzie tylko renderował ich własny UI
     oraz poinformuje master-managera i submicie okna. Następnie master-manager poinformuje każdego z managerów (w odpowiedniej kolenojści)
     o tym by się dostosowały do zmian.
     */
    this.configPopupWindow = useConfigPopup();
    this.configPopupWindow.addListener('managersChange', async (configChanges: TConfigChanges) => {
      await this.runManagersFromConfig(configChanges);
    });
    /*
    NOTE: na ten moment utility samo decyduje jak renderować ustawienia każdego z managerów (w tym posługuje się np CitySwitchem), 
    samo komunikuje się z configManagerem by zapisać zmiany itp.
    */
    await this.configPopupWindow.mount(this.config);

    if (this.config.general.forcedRefresh || getCookie('forceRestart')) {
      console.log('forcedRefresh/forceRestart', this.config.general.forcedRefresh, getCookie('forceRestart'));
      this.config.general.forcedRefresh = false;
      setCookie('forceRestart', false);

      this.config.farmConfig.farmInterval = FarmTimeInterval.FirstOption;
      ConfigManager.getInstance().persistConfig();

      this.configPopupWindow.minimize();
      await this.runManagersFromConfig();
    }
  }

  public run(): void {
    this.runManagersFromConfig();
  }

  public pauseRunningManagers(except: Managers[]): void {
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
    if (!except.includes('masterQueue') && this.masterQueue.isRunning()) {
      console.log('masterQueue will be paused...');
      this.masterQueue.stop();
      this.pausedManagersSnapshot.masterQueue = true;
    }
    if (!except.includes('farmManager') && this.farmManager.isRunning()) {
      console.log('farmManager will be paused...');
      this.farmManager.stop();
      this.pausedManagersSnapshot.farmManager = true;
    }
    if (!except.includes('scheduler') && this.scheduler.isRunning()) {
      console.log('scheduler will be paused...');
      this.scheduler.stop();
      this.pausedManagersSnapshot.scheduler = true;
    }
    if (!except.includes('builder') && this.builder.isRunning()) {
      console.log('builder will be paused...');
      this.builder.stop();
      this.pausedManagersSnapshot.builder = true;
    }
    if (!except.includes('recruiter') && this.recruiter.isRunning()) {
      console.log('recruiter will be paused...');
      this.recruiter.stop();
      this.pausedManagersSnapshot.recruiter = true;
    }
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
  }

  public pauseRunningManagersIfNeeded(actionTime: number, except: Managers[]): void {
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
    if (!except.includes('farmManager') && this.farmManager.isRunning()) {
      const farmTimes = this.farmManager.getFarmScheduleTimes();
      const farmTimesCollides = farmTimes.some(
        farmingTime =>
          farmingTime &&
          farmingTime.getTime() <= actionTime &&
          Math.abs(farmingTime.getTime() - actionTime) <= 1000 * 20,
      );
      if (farmTimesCollides) {
        this.farmManager.stop();
        this.pausedManagersSnapshot.farmManager = true;
      }
    }
    // NOTE: remake as masterqueue holds now all operations
    if (!except.includes('masterQueue') && this.masterQueue.isRunning()) {
      const masterQueueTimes = this.masterQueue.getMasterQueueScheduleTimes();
      const masterQueueTimesCollide = masterQueueTimes.some(
        (masterQueueScheduleTime: number) =>
          masterQueueScheduleTime &&
          masterQueueScheduleTime <= actionTime &&
          Math.abs(masterQueueScheduleTime - actionTime) <= 1000 * 30,
      );
      if (masterQueueTimesCollide) {
        this.masterQueue.stop();
        this.pausedManagersSnapshot.masterQueue = true;
      }
    }
    if (!except.includes('recruiter') && this.recruiter.isRunning()) {
      this.recruiter.stop();
      this.pausedManagersSnapshot.recruiter = true;
    }
    if (!except.includes('scheduler') && this.scheduler.isRunning()) {
      this.scheduler.stop();
      this.pausedManagersSnapshot.scheduler = true;
    }
    if (!except.includes('builder') && this.builder.isRunning()) {
      const builderTimes = this.builder.getBuilderScheduleTimes();
      const builderTimesCollides = builderTimes.some(
        builderTime =>
          builderTime &&
          builderTime.getTime() <= actionTime &&
          Math.abs(builderTime.getTime() - actionTime) <= 1000 * 20,
      );
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
            console.log('farmManager will be resumed...');
            this.farmManager.start();
          }
          break;
        case 'recruiter':
          if (isPaused && !except.includes('recruiter')) {
            console.log('recruiter will be resumed...');
            this.recruiter.start();
          }
          break;
        case 'scheduler':
          if (isPaused && !except.includes('scheduler')) {
            console.log('scheduler will be resumed...');
            this.scheduler.start();
          }
          break;
        case 'builder':
          if (isPaused && !except.includes('builder')) {
            console.log('builder will be resumed...');
            this.builder.start();
          }
          break;
        case 'masterQueue':
          if (isPaused && !except.includes('masterQueue')) {
            console.log('masterQueue will be resumed...');
            this.masterQueue.start();
          }
          break;
      }
    });

    Object.keys(this.pausedManagersSnapshot).forEach(key => {
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
    this.recruiter.stop();
    this.masterQueue.stop();
  }
}
