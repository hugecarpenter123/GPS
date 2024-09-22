import ConfigPopup from "../../ui/config-popup";
import CitySwitchManager from "../city/city-switch-manager";
import FarmManager from "../farm/farm-manager";
import Scheduler from "../scheduler/Scheduler";

export default class MasterManager {
  private static instance: MasterManager
  private farmManager!: FarmManager;
  private switchManager!: CitySwitchManager;
  private scheduler!: Scheduler;
  private configMenuWindow!: ConfigPopup;
  private constructor() {
    // Private constructor to prevent direct instantiation
  }

  public static async getInstance(): Promise<MasterManager> {
    if (!MasterManager.instance) {
      MasterManager.instance = new MasterManager();
      MasterManager.instance.farmManager = FarmManager.getInstance();
      MasterManager.instance.switchManager = await CitySwitchManager.getInstance();
      MasterManager.instance.scheduler = await Scheduler.getInstance();
      MasterManager.instance.initConfigDialog();
    }
    return MasterManager.instance;
  }

  private async initConfigDialog() {
    this.configMenuWindow = new ConfigPopup();
    this.configMenuWindow.addListener('managersChange', async () => {
      console.log('managersChange event triggered');
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
    })
    this.configMenuWindow.render();
  }

  public run(): void {
    // TODO: run all previously running managers
    this.farmManager.start();
  }

  public stopAll(): void {
    // TODO: stop all managers    
    this.farmManager.stop();
  }
}