import { type TConfig } from 'gps.config';
import ConfigManager from '~/utility/config-manager';
import ArmyMovement from './army-movement';

export default class Avoider {
  private error: string | null = null;
  private configManager!: ConfigManager;
  private config!: TConfig;
  private armyMovement!: ArmyMovement;

  private static instance: Avoider;
  private constructor() {}

  public static getInstance(): Avoider {
    if (!Avoider.instance) {
      Avoider.instance = new Avoider();
      Avoider.instance.configManager = ConfigManager.getInstance();
      Avoider.instance.config = Avoider.instance.configManager.getConfig();
      Avoider.instance.armyMovement = ArmyMovement.getInstance();
      Avoider.instance.mountObserver();
    }
    return Avoider.instance;
  }
  private mountObserver() {}
}
