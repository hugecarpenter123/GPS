import type Service from '~/utility/Service';
import { FarmTimeInterval, type Managers, TConfig } from '../../../gps.config';
import { ConfigPopupUtility, TConfigChanges, useConfigPopup } from '../../config-popup/config-popup';
import ConfigManager from '../../utility/config-manager';
import { getCookie, hasAnyValue, setCookie } from '../../utility/plain-utility';
import { Academy } from '../academy/academy';
import CityBuilder from '../city/builder/city-builder';
import CitySwitchManager from '../city/city-switch-manager';
import Farmer from '../farm/farm-manager';
import MasterQueue from '../master-queue-rework/master-queue';
import Recruiter from '../recruiter/recruiter';
import Scheduler from '../scheduler/Scheduler';

export default class MasterManager {
  private static instance: MasterManager;
  private config!: TConfig;
  private farmer!: Farmer;
  private switchManager!: CitySwitchManager;
  private scheduler!: Scheduler;
  private builder!: CityBuilder;
  private recruiter!: Recruiter;
  private masterQueue!: MasterQueue;
  private academy!: Academy;
  private configPopupWindow!: ConfigPopupUtility;

  private pausedManagersSnapshot: {
    [key in Managers]: boolean;
  } = {
    farmer: false,
    scheduler: false,
    builder: false,
    recruiter: false,
    masterQueue: false,
    academy: false,
  };
  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<MasterManager> {
    if (!MasterManager.instance) {
      MasterManager.instance = new MasterManager();
      MasterManager.instance.config = ConfigManager.getInstance().getConfig();
      MasterManager.instance.switchManager = await CitySwitchManager.getInstance();
      MasterManager.instance.farmer = await Farmer.getInstance();
      MasterManager.instance.scheduler = await Scheduler.getInstance();
      MasterManager.instance.builder = await CityBuilder.getInstance();
      MasterManager.instance.recruiter = await Recruiter.getInstance();
      MasterManager.instance.academy = await Academy.getInstance();
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
    if (configChanges) {
      (
        Object.keys(configChanges)
          // exclude general config
          .filter(k => k !== 'general') as Managers[]
      ).forEach(k => {
        if (hasAnyValue(configChanges[k], true)) {
          this[k].onConfigChange(configChanges[k]);
        }
      });

      (Object.keys(configChanges.general) as Managers[]).forEach(managerKey => {
        if (this.config.general[managerKey]) {
          if (!this[managerKey].isRunning()) {
            console.log(`${managerKey} will be started...`);
            this[managerKey].start();
          }
        } else {
          if (this[managerKey].isRunning()) {
            console.log(`${managerKey} will be stopped...`);
            this[managerKey].stop();
          }
        }
      });
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

      this.config.farmer.farmInterval = FarmTimeInterval.FirstOption;
      ConfigManager.getInstance().persist();

      this.configPopupWindow.minimize();
      await this.runManagersFromConfig();
    }
  }

  public run(): void {
    this.runManagersFromConfig();
  }

  public pauseRunningManagers(except: Managers[]): void {
    (
      [
        [this.farmer, 'farmManager'],
        [this.masterQueue, 'masterQueue'],
        [this.recruiter, 'recruiter'],
        [this.builder, 'builder'],
        [this.scheduler, 'scheduler'],
        [this.academy, 'academy'],
      ] as [Service<keyof TConfigChanges>, Managers][]
    ).forEach(([manager, managerKey]) => {
      if (!except.includes(managerKey) && manager.isRunning()) {
        console.log(`${managerKey} will be paused...`);
        manager.pause();
        this.pausedManagersSnapshot[managerKey] = true;
      }
    });
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
  }

  public pauseRunningManagersIfNeeded(actionTime: number, except: Managers[]): void {
    const handlePauseManager = (manager: Service<keyof TConfigChanges>, managerKey: Managers) => {
      if (!except.includes(managerKey) && manager.isRunning()) {
        const scheduledActionTimes = manager.getScheduledActionTimes();
        const isCollision = scheduledActionTimes.some(
          // FUTURE: include scheduleTimeEnd condition if needed
          ([scheduleTimeStart, _scheduleTimeEnd]) =>
            scheduleTimeStart <= actionTime && Math.abs(actionTime - scheduleTimeStart) <= 1000 * 30,
        );
        if (isCollision) {
          manager.pause();
          this.pausedManagersSnapshot[managerKey] = true;
        }
      }
    };
    (
      [
        [this.farmer, 'farmManager'],
        [this.masterQueue, 'masterQueue'],
        [this.recruiter, 'recruiter'],
        [this.builder, 'builder'],
        [this.scheduler, 'scheduler'],
        [this.academy, 'academy'],
      ] as [Service<keyof TConfigChanges>, Managers][]
    ).forEach(args => {
      handlePauseManager(...args);
    });
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
  }

  public resumePausedManagers(except: Managers[]): void {
    console.log('resumeRunningManagers', this.pausedManagersSnapshot);
    (Object.entries(this.pausedManagersSnapshot) as [Managers, boolean][]).forEach(([key, isPaused]) => {
      if (isPaused && !except.includes(key)) {
        console.log(`${key} will be resumed...`);
        this[key].resume();
        this.pausedManagersSnapshot[key] = false;
      }
    });
  }

  public forceRefresh(): void {
    this.config.general.forcedRefresh = true;
    ConfigManager.getInstance().persist();
    window.location.reload();
  }

  public stopAll(): void {
    this.farmer.stop();
    this.switchManager.stop();
    this.scheduler.stop();
    this.builder.stop();
    this.recruiter.stop();
    this.academy.stop();
    this.masterQueue.stop();
  }
}
