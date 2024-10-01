import configPopupCss from './config-popup.css';
import configPopupHtml from './config-popup.html';

import EventEmitter from "events";
import ConfigManager from "../utility/config-manager";
import { FarmTimeInterval, TConfig } from "../../gps.config";

export default class ConfigPopup extends EventEmitter {
  private configManager: ConfigManager;
  private config: TConfig;

  private switch: boolean;
  private farm: boolean;
  private builder: boolean;
  private guard: boolean;

  private farmInterval: FarmTimeInterval;

  constructor() {
    super();
    this.configManager = ConfigManager.getInstance();
    this.config = this.configManager.getConfig();

    this.switch = true;
    this.farm = true;
    this.builder = true;
    this.guard = false;

    this.farmInterval = this.config.farmConfig.farmInterval;
  }

  public isSwitchChecked = () => {
    return this.switch;
  };
  public isFarmChecked = () => {
    return this.farm;
  };

  public isBuilderChecked = () => {
    return this.builder;
  };

  public isGuardChecked = () => {
    return this.guard;
  };

  public getPlunderConfig = () => {
  }

  private initEventListeners(): void {
    const container = document.querySelector('#config-popup-container') as HTMLElement;
    const switchCheckbox = container.querySelector('#city-switch');
    const plunderCheckbox = container.querySelector('#farm');
    const builderCheckbox = container.querySelector('#builder');
    const guardCheckbox = container.querySelector('#guard');
    const timeIntervalSelect = container.querySelector('#time-interval-select');
    const showTrigger = container.querySelector('.show-trigger');
    const closeTrigger = container.querySelector('#close-popup');
    if (!container) throw new Error('"#config-popup-container" couldn\'t be found.')

    closeTrigger!.addEventListener('click', () => {
      if (!container.classList.contains('minimized')) container.classList.add('minimized');
    })

    container.querySelectorAll('#button-panel button').forEach((btn) => btn.addEventListener('click', () => {
      if ((btn as HTMLButtonElement).type === 'reset') {
        (switchCheckbox as HTMLInputElement)!.checked = false;
        this.switch = false;
        (plunderCheckbox as HTMLInputElement)!.checked = false;
        this.farm = false;
        (builderCheckbox as HTMLInputElement)!.checked = false;
        this.builder = false;
        (guardCheckbox as HTMLInputElement)!.checked = false;
        this.guard = false;
      }

      // update config related fields and persist them to local storage if changed
      if (this.config.farmConfig.farmInterval !== this.farmInterval) {
        this.config.farmConfig.farmInterval = this.farmInterval;
        this.configManager.persistConfig();
      }

      container.classList.add('minimized');
      this.emit('managersChange');
    }));

    showTrigger!.addEventListener('click', () => {
      container.classList.contains('minimized') && container.classList.remove('minimized')
    });

    switchCheckbox!.addEventListener('change', () => {
      this.switch = (switchCheckbox as HTMLInputElement).checked;
    });
    plunderCheckbox!.addEventListener('change', () => {
      this.farm = (plunderCheckbox as HTMLInputElement).checked;
    });
    builderCheckbox!.addEventListener('change', () => {
      this.builder = (builderCheckbox as HTMLInputElement).checked;
    });
    guardCheckbox!.addEventListener('change', () => {
      this.guard = (guardCheckbox as HTMLInputElement).checked;
    });
    timeIntervalSelect!.addEventListener('change', () => {
      this.farmInterval = Number((timeIntervalSelect as HTMLSelectElement).value)
    })


    // farm section

    const farmSection = container.querySelector('#farm')?.parentElement;
    const farmSectionContainer = farmSection!.querySelector('.expandable-section');
    const farmSectionArrow = farmSection!.querySelector('.arrow-down');

    farmSectionArrow!.addEventListener('click', () => {
      farmSectionContainer!.classList.toggle('hidden');
      farmSectionArrow!.classList.toggle('rotate');
    });
    // END farm section
  }

  private createInitialElement() {
    const container = document.createElement('div');
    container.innerHTML = configPopupHtml;

    // get initial data from config and change
    (container.querySelector('#city-switch') as HTMLInputElement)!.checked = this.switch;
    (container.querySelector('#farm') as HTMLInputElement)!.checked = this.farm;
    (container.querySelector('#builder') as HTMLInputElement)!.checked = this.builder;
    (container.querySelector('#guard') as HTMLInputElement)!.checked = this.guard;

    const intervalSelectElement = (container.querySelector('#time-interval-select') as HTMLSelectElement)
    const farmIntervalValuesUnparsed = Object.values(FarmTimeInterval);
    const farmIntervalValues = farmIntervalValuesUnparsed.slice((farmIntervalValuesUnparsed.length / 2), -1);
    farmIntervalValues.forEach((value) => {
      const option = document.createElement('option')
      option.value = value.toString()
      option.textContent = this.mapTimeIntervalKeyToText(value as FarmTimeInterval);
      intervalSelectElement.appendChild(option);
    });

    (container.querySelector('#time-interval-select') as HTMLSelectElement)!.value = FarmTimeInterval.FiveMinutes.toString();
    return container;
  }

  private mapTimeIntervalKeyToText(value: FarmTimeInterval): string {
    switch (value) {
      case FarmTimeInterval.FiveMinutes:
        return "5m";
      case FarmTimeInterval.TenMinutes:
        return "10m";
      case FarmTimeInterval.TwentyMinutes:
        return "20m";
      case FarmTimeInterval.FortyMinutes:
        return "40m";
      case FarmTimeInterval.OneHourAndHalf:
        return "1h 30m";
      case FarmTimeInterval.ThreeHours:
        return "3h";
      case FarmTimeInterval.FourHours:
        return "4h";
      case FarmTimeInterval.EightHours:
        return "8h";
      default:
        return "Unknown interval";
    }
  }

  public getManagersFlags = () => {
    return {
      farm: this.farm,
      builder: this.builder,
      guard: this.guard,
    }
  }

  private addStyle() {
    const style = document.createElement('style');
    style.textContent = configPopupCss;
    document.head.appendChild(style);
  }

  public render() {
    this.addStyle();

    // utwórz contener, ustaw atrybuty i body
    const configWindowElement = this.createInitialElement();
    document.body.appendChild(configWindowElement);

    this.initEventListeners();
  }
}
