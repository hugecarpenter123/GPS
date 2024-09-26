import ConfigPopup from "../../ui/config-popup";
import CitySwitchManager from "../city/city-switch-manager";
import FarmManager from "../farm/farm-manager";
import Scheduler from "../scheduler/Scheduler";

type Managers = 'farmManager' | 'switchManager' | 'scheduler';

export default class MasterManager {
  private static instance: MasterManager
  private farmManager!: FarmManager;
  private switchManager!: CitySwitchManager;
  private scheduler!: Scheduler;
  private configMenuWindow!: ConfigPopup;

  private pausedManagersSnapshot: {
    [key in Managers]: boolean;
  } = {
      farmManager: false,
      switchManager: false,
      scheduler: false,
    };
  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<MasterManager> {
    if (!MasterManager.instance) {
      MasterManager.instance = new MasterManager();
      MasterManager.instance.farmManager = await FarmManager.getInstance();
      MasterManager.instance.switchManager = await CitySwitchManager.getInstance();
      MasterManager.instance.scheduler = await Scheduler.getInstance();
      MasterManager.instance.initConfigDialog();
    }
    return MasterManager.instance;
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
    this.configMenuWindow.render();
  }

  public run(): void {
    this.runManagersFromConfig();
  }

  public pauseRunningManagers(except: Managers[]): void {
    if (!except.includes('farmManager')) {
      this.farmManager.stop();
    }
    if (!except.includes('switchManager')) {
      this.switchManager.stop();
    }
    if (!except.includes('scheduler')) {
      this.scheduler.stop();
    }
    this.pausedManagersSnapshot = {
      farmManager: !this.farmManager.isRunning(),
      switchManager: !this.switchManager.isRunning(),
      scheduler: !this.scheduler.isRunning(),
    };
    console.log('pauseRunningManagers', this.pausedManagersSnapshot);
  }

  public resumeRunningManagers(except: Managers[]): void {
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
      }
    });

    Object.keys(this.pausedManagersSnapshot).forEach((key) => {
      if (except.includes(key as Managers)) {
        this.pausedManagersSnapshot[key as Managers] = false;
      }
    });
  }

  public stopAll(): void {
    this.farmManager.stop();
    this.switchManager.stop();
    this.scheduler.stop();
  }
}