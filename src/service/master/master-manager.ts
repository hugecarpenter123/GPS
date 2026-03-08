import type Service from '~/utility/Service';
import { FarmTimeInterval, type Managers, TConfig } from '../../../gps.config';
import { ConfigPopupUtility, TConfigChanges, useConfigPopup } from '../../config-popup/config-popup';
import ConfigManager from '../../utility/config-manager';
import { addDelay, getCookie, hasAnyValue, setCookie, waitWhile } from '../../utility/plain-utility';
import { Academy } from '../academy/academy';
import CityBuilder from '../city/builder/city-builder';
import CitySwitchManager from '../city/city-switch-manager';
import Farmer from '../farm/farm-manager';
import MasterQueue from '../master-queue-rework/master-queue';
import Recruiter from '../recruiter/recruiter';
import Scheduler from '../scheduler/Scheduler';
import { unescape } from 'querystring';

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
  private captchaObserver!: NodeJS.Timeout;
  private refreshTimeoutId?: NodeJS.Timeout;

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
      MasterManager.instance.initCaptchaPrevention();
      MasterManager.instance.initConfigDialog();
    }
    return MasterManager.instance;
  }

  private initCaptchaPrevention() {
    this.captchaObserver = setInterval(async () => {
      const captcha = Array.from(document.querySelectorAll('body>[id*="captcha"]')).find(el => el.hasChildNodes());
      if (captcha) {
        console.warn('captcha detected at:', new Date().toISOString());
        await addDelay(3000);
        captcha.querySelector<HTMLDivElement>('#checkbox')?.click();
        await addDelay(4000);
        captcha.querySelector<HTMLDivElement>('.btn_confirm')?.click();
        await waitWhile(() => captcha.isConnected, {
          delay: 1000,
          maxIterations: 6,
          // TODO: refresh or disconnect from the webapp - currently disconnect
          onError: () => {
            clearInterval(this.captchaObserver);
            if (this.config.general.signoutOnCaptchaFailure) {
              window.location.replace('about:blank');
            }
          },
        });
      }
    }, 20000);
  }

  private createRefreshTimeout(timeout?: number) {
    this.refreshTimeoutId = setTimeout(
      async () => {
        const canRefresh = [
          this.farmer,
          this.masterQueue,
          this.recruiter,
          this.builder,
          this.scheduler,
          this.academy,
        ].every(manager => {
          return manager
            .getScheduledActionTimes()
            .filter(([start, duration]) => start + (duration ?? 60000) < Date.now())
            .every(([start]) => {
              return Date.now() + 60000 < start;
            });
        });

        if (canRefresh) {
          setCookie('autoStart', 1);
          window.location.reload();
        } else {
          console.log('[cyclicalRefresh]: cannot refresh now, retry in 2 minutes');
          this.createRefreshTimeout(2 * 1000 * 60);
        }
      },
      timeout ?? (this.config.cyclicalRefresh.interval + (Math.floor(Math.random() * 121) - 60)) * 1000,
    );
  }

  /**
   *
   * @param configChanges
   * @param autorun some managers in order to execute operations need argument to "start" method
   */
  private async runManagersFromConfig(autorun?: boolean) {
    // BUGgy - works for now but not ideal
    (Object.keys(this.config.general) as Managers[]).forEach(managerKey => {
      // so that only managers are handled by below's logic
      if (!this[managerKey]) return;

      this.initCyclicalRefresh();

      if (this.config.general[managerKey]) {
        if (!this[managerKey].isRunning()) {
          console.log(`${managerKey} will be started...`);
          this[managerKey].start(autorun);
        }
      } else {
        if (this[managerKey].isRunning()) {
          console.log(`${managerKey} will be stopped...`);
          this[managerKey].stop();
        }
      }
    });
  }

  private handleConfigChanges(configChanges: TConfigChanges) {
    (
      Object.keys(configChanges)
        // exclude non managers config
        .filter(k => !['general', 'autoRelogin', 'cyclicalRefresh'].includes(k)) as Managers[]
    ).forEach(k => {
      if (hasAnyValue(configChanges[k], true)) {
        this[k].onConfigChange(configChanges[k]);
      }
    });

    // NOTE: autoRelogin configChange handling happens inside the popup
    if (configChanges.general.cyclicalRefresh || configChanges.cyclicalRefresh.interval) {
      this.initCyclicalRefresh();
    }

    (Object.keys(configChanges.general) as Managers[]).forEach(managerKey => {
      // so that only managers are handled by below's logic
      if (!this[managerKey]) return;

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

  /**
   * Based on the config either removes the timeout or sets it (overwrite).
   */
  private initCyclicalRefresh() {
    if (this.config.cyclicalRefresh) {
      clearTimeout(this.refreshTimeoutId);
      this.createRefreshTimeout();
    } else {
      clearTimeout(this.refreshTimeoutId);
    }
  }

  /**
   * The very entry of the **Master Manager**.
   */
  private async initConfigDialog() {
    /*
     TODO: tutaj zostanie przekazana instancja klasy renderującej konfiguracji każdego menadżera
     w taki sposób, że config popup będzie nieświadomy konfiguracji żadnego z menadżerów, będzie tylko renderował ich własny UI
     oraz poinformuje master-managera i submicie okna. Następnie master-manager poinformuje każdego z managerów (w odpowiedniej kolenojści)
     o tym by się dostosowały do zmian.
     */
    this.configPopupWindow = useConfigPopup();
    this.configPopupWindow.addListener('managersChange', async (configChanges: TConfigChanges) => {
      this.handleConfigChanges(configChanges);
    });

    const autoStart = getCookie('autoStart') === 1;
    /*
    NOTE: na ten moment utility samo decyduje jak renderować ustawienia każdego z managerów (w tym posługuje się np CitySwitchem), 
    samo komunikuje się z configManagerem by zapisać zmiany itp.
    */
    await this.configPopupWindow.mount({ initialConfig: this.config, open: !autoStart });

    if (autoStart) {
      console.log('autoStart', this.config.general.cyclicalRefresh, autoStart);
      setCookie('autoStart', '0', { maxAge: -1 });
      // autorun for MasterQueue to execute scheduld operations
      await this.runManagersFromConfig(true);
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
    this.config.general.cyclicalRefresh = true;
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
