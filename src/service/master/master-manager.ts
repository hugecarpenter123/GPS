import type Service from '~/utility/Service';
import { MANAGER_KEYS, type Managers, TConfig } from '../../../gps.config';
import { ConfigPopupUtility, TConfigChanges, useConfigPopup } from '../../config-popup/config-popup';
import ConfigManager from '../../utility/config-manager';
import { addDelay, getCookie, setCookie, waitWhile } from '../../utility/plain-utility';
import { Academy } from '../academy/academy';
import ArmyMovement from '../army/army-movement';
import CityBuilder from '../city/builder/city-builder';
import CitySwitchManager from '../city/city-switch-manager';
import BanditCampManager from '../farm/bandit-camp-manager';
import Farmer from '../farm/farm-manager';
import MasterQueue from '../master-queue-rework/master-queue';
import Recruiter from '../recruiter/recruiter';
import Scheduler from '../scheduler/Scheduler';

export default class MasterManager {
  private static instance: MasterManager;
  private config!: TConfig;
  private farmer!: Farmer;
  private bandit!: BanditCampManager;
  private switchManager!: CitySwitchManager;
  private scheduler!: Scheduler;
  private builder!: CityBuilder;
  private recruiter!: Recruiter;
  private masterQueue!: MasterQueue;
  private academy!: Academy;
  private configPopupWindow!: ConfigPopupUtility;
  private captchaObserver!: ReturnType<typeof setTimeout>;
  private refreshTimeoutId?: ReturnType<typeof setTimeout>;

  private pausedManagersSnapshot: Record<Managers, boolean> = {
    farmer: false,
    bandit: false,
    scheduler: false,
    builder: false,
    recruiter: false,
    masterQueue: false,
    academy: false,
  };

  private constructor() {}

  public static async getInstance(): Promise<MasterManager> {
    if (!MasterManager.instance) {
      MasterManager.instance = new MasterManager();
      MasterManager.instance.config = ConfigManager.getInstance().getConfig();
      MasterManager.instance.switchManager = await CitySwitchManager.getInstance();
      MasterManager.instance.farmer = await Farmer.getInstance();
      MasterManager.instance.bandit = await BanditCampManager.getInstance();
      MasterManager.instance.scheduler = await Scheduler.getInstance();
      MasterManager.instance.builder = await CityBuilder.getInstance();
      MasterManager.instance.recruiter = await Recruiter.getInstance();
      MasterManager.instance.academy = await Academy.getInstance();
      MasterManager.instance.masterQueue = await MasterQueue.getInstance();
      MasterManager.instance.initCaptchaPrevention();
      MasterManager.instance.initConfigDialog();
      MasterManager.instance.exposeToWindow();
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
          onError: () => {
            clearInterval(this.captchaObserver);
            if (this.config.app.signoutOnCaptchaFailure) {
              // TODO: consider reloading game page with autoStart cookie
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
          this.bandit,
          this.masterQueue,
          this.recruiter,
          this.builder,
          this.scheduler,
          this.academy,
        ].every(manager => {
          return manager
            .getScheduledActionTimes()
            .filter(([start, duration]) => start + (duration ?? 60000) < Date.now())
            .every(([start]) => Date.now() + 60000 < start);
        });

        if (canRefresh) {
          setCookie('autoStart', 1);
          window.location.reload();
        } else {
          console.log('[cyclicalRefresh]: cannot refresh now, retry in 2 minutes');
          this.createRefreshTimeout(2 * 60 * 1000);
        }
      },
      timeout ?? this.config.cyclicalRefresh.intervalMs + (Math.floor(Math.random() * 121) - 60) * 1000,
    );
  }

  private async runManagersFromConfig(autorun?: boolean) {
    this.initCyclicalRefresh();

    MANAGER_KEYS.forEach(managerKey => {
      if (this.config[managerKey].enabled) {
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

  private handleConfigSubmit(configChanges: TConfigChanges) {
    MANAGER_KEYS.forEach(managerKey => {
      const changes = configChanges[managerKey];
      if (changes && this.hasNonEnabledChanges(changes)) {
        this[managerKey].onConfigChange(changes);
      }
    });

    if (configChanges.cyclicalRefresh?.enabled || configChanges.cyclicalRefresh?.intervalMs) {
      this.initCyclicalRefresh();
    }

    MANAGER_KEYS.forEach(managerKey => {
      if (this.config[managerKey].enabled) {
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

  private hasNonEnabledChanges(changes: Record<string, boolean>): boolean {
    return Object.entries(changes).some(([key, value]) => key !== 'enabled' && value === true);
  }

  private initCyclicalRefresh() {
    clearTimeout(this.refreshTimeoutId);
    if (this.config.cyclicalRefresh.enabled) {
      this.createRefreshTimeout();
    }
  }

  private async initConfigDialog() {
    this.configPopupWindow = useConfigPopup();
    this.configPopupWindow.addListener('managersChange', async (configChanges: TConfigChanges) => {
      this.handleConfigSubmit(configChanges);
    });

    const autoStart = getCookie('autoStart') === 1;
    await this.configPopupWindow.mount({ initialConfig: this.config, open: !autoStart });

    if (autoStart) {
      console.log('autoStart', this.config.cyclicalRefresh.enabled, autoStart);
      setCookie('autoStart', 0, { maxAge: -1 });
      await this.runManagersFromConfig(true);
    }
  }

  public run(): void {
    this.runManagersFromConfig();
  }

  private forEachManager(callback: (manager: Service<keyof TConfigChanges>, key: Managers) => void) {
    (
      [
        [this.farmer, 'farmer'],
        [this.bandit, 'bandit'],
        [this.masterQueue, 'masterQueue'],
        [this.recruiter, 'recruiter'],
        [this.builder, 'builder'],
        [this.scheduler, 'scheduler'],
        [this.academy, 'academy'],
      ] as [Service<keyof TConfigChanges>, Managers][]
    ).forEach(([manager, key]) => callback(manager, key));
  }

  public pauseRunningManagers(except: Managers[]): void {
    this.forEachManager((manager, key) => {
      if (!except.includes(key) && manager.isRunning()) {
        console.log(`${key} will be paused...`);
        manager.pause();
        this.pausedManagersSnapshot[key] = true;
      }
    });
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
  }

  public pauseRunningManagersIfNeeded(actionTime: number, except: Managers[]): void {
    this.forEachManager((manager, key) => {
      if (!except.includes(key) && manager.isRunning()) {
        const scheduledActionTimes = manager.getScheduledActionTimes();
        const isCollision = scheduledActionTimes.some(
          ([scheduleTimeStart]) =>
            scheduleTimeStart <= actionTime && Math.abs(actionTime - scheduleTimeStart) <= 30_000,
        );
        if (isCollision) {
          manager.pause();
          this.pausedManagersSnapshot[key] = true;
        }
      }
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
    this.config.cyclicalRefresh.enabled = true;
    ConfigManager.getInstance().persist();
    window.location.reload();
  }

  public stopAll(): void {
    this.farmer.stop();
    this.bandit.stop();
    this.switchManager.stop();
    this.scheduler.stop();
    this.builder.stop();
    this.recruiter.stop();
    this.academy.stop();
    this.masterQueue.stop();
  }

  private async exposeToWindow(): Promise<void> {
    window.GPS = {
      master: MasterManager.instance,
      farmer: this.farmer,
      bandit: this.bandit,
      switchManager: this.switchManager,
      builder: this.builder,
      recruiter: this.recruiter,
      scheduler: this.scheduler,
      masterQueue: this.masterQueue,
      academy: this.academy,
      armyMovement: ArmyMovement.getInstance(),
    };
    console.log('[GPS]: Debug API exposed to window.GPS');
  }
}
