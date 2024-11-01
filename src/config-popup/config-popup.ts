import configPopupCss from './config-popup.css';
import configPopupHtml from './config-popup.html';

import EventEmitter from "events";
import ConfigManager from "../utility/config-manager";
import { FarmTimeInterval, TConfig } from "../../gps.config";
import CitySwitchManager, { CityInfo } from '../service/city/city-switch-manager';

export default class ConfigPopup extends EventEmitter {
  private configManager: ConfigManager;
  private config: TConfig;

  private farm: boolean;
  private builder: boolean;
  private guard: boolean;
  private recruiter: boolean;
  private farmInterval: FarmTimeInterval;
  private humanize: boolean;
  private uniquelySelectedFarmingCitiesPerIsle: Record<string, CityInfo> = {};

  constructor() {
    super();
    this.configManager = ConfigManager.getInstance();
    this.config = this.configManager.getConfig();

    this.farm = this.config.general.farm;
    this.builder = this.config.general.builder;
    this.guard = this.config.general.guard;
    this.recruiter = this.config.general.recruiter;
    this.farmInterval = this.config.farmConfig.farmInterval;
    this.humanize = this.config.farmConfig.humanize;
  }

  public isFarmChecked = () => {
    return this.farm;
  };

  public isBuilderChecked = () => {
    return this.builder;
  };

  public isGuardChecked = () => {
    return this.guard;
  };

  public isRecruiterChecked = () => {
    return this.recruiter;
  };

  public getPlunderConfig = () => {
  }

  private initEventListeners(): void {
    const container = document.querySelector('#config-popup-container') as HTMLElement;
    const plunderCheckbox = container.querySelector('#farm');
    const builderCheckbox = container.querySelector('#builder');
    const recruiterCheckbox = container.querySelector('#recruiter');
    const guardCheckbox = container.querySelector('#guard');
    const timeIntervalSelect = container.querySelector('#time-interval-select');
    const showTrigger = container.querySelector('.show-trigger');
    const closeTrigger = container.querySelector('#close-popup');
    const humanizeCheckbox = container.querySelector('#humanize-checkbox');

    if (!container) throw new Error('"#config-popup-container" couldn\'t be found.')

    closeTrigger!.addEventListener('click', () => {
      if (!container.classList.contains('minimized')) container.classList.add('minimized');
    })

    container.querySelectorAll('#button-panel button').forEach((btn) => btn.addEventListener('click', () => {
      if ((btn as HTMLButtonElement).type === 'reset') {
        (plunderCheckbox as HTMLInputElement)!.checked = false;
        this.farm = false;
        (builderCheckbox as HTMLInputElement)!.checked = false;
        this.builder = false;
        (guardCheckbox as HTMLInputElement)!.checked = false;
        this.guard = false;
        (recruiterCheckbox as HTMLInputElement)!.checked = false;
        this.recruiter = false;
      }

      const conflictingCitiesChanged = Object.keys(this.uniquelySelectedFarmingCitiesPerIsle).some(isleId => this.uniquelySelectedFarmingCitiesPerIsle[isleId].name !== this.config.farmConfig.farmingCities.find(city => city.isleId === isleId)?.name);
      console.log('conflictingCitiesChanged', conflictingCitiesChanged);

      // update config related fields and persist them to local storage if changed
      if (this.config.farmConfig.farmInterval !== this.farmInterval ||
        this.config.farmConfig.humanize !== this.humanize ||
        this.config.general.farm !== this.farm ||
        this.config.general.builder !== this.builder ||
        this.config.general.guard !== this.guard ||
        this.config.general.recruiter !== this.recruiter ||
        conflictingCitiesChanged) {
        // readability comment --------------------------------------------------------------
        this.config.farmConfig.farmInterval = this.farmInterval;
        this.config.farmConfig.humanize = this.humanize;
        this.config.general.farm = this.farm;
        this.config.general.builder = this.builder;
        this.config.general.guard = this.guard;
        this.config.general.recruiter = this.recruiter;
        this.config.farmConfig.farmingCities = Object.values(this.uniquelySelectedFarmingCitiesPerIsle);
        this.configManager.persistConfig();
      }

      if (this.farmInterval === FarmTimeInterval.FourthOption) {
        alert('Farmienie ustawione na 4h/8h, odśwież stronę jeżeli to błąd!')
      }
      container.classList.add('minimized');
      this.emit('managersChange');
    }));

    showTrigger!.addEventListener('click', () => {
      container.classList.contains('minimized') && container.classList.remove('minimized')
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
    recruiterCheckbox!.addEventListener('change', () => {
      this.recruiter = (recruiterCheckbox as HTMLInputElement).checked;
    });
    timeIntervalSelect!.addEventListener('change', () => {
      this.farmInterval = Number((timeIntervalSelect as HTMLSelectElement).value)
      console.log('this.farmInterval changed to: ', this.farmInterval);
    })


    // farm section

    const farmSection = container.querySelector('#farm')?.parentElement;
    const farmSectionContainer = farmSection!.querySelector('.expandable-section');
    const farmSectionArrow = farmSection!.querySelector('.arrow-down');

    farmSectionArrow!.addEventListener('click', () => {
      farmSectionContainer!.classList.toggle('hidden');
      farmSectionArrow!.classList.toggle('rotate');
    });

    humanizeCheckbox!.addEventListener('change', () => {
      this.humanize = (humanizeCheckbox as HTMLInputElement).checked;
    });


    // END farm section
  }

  private async createInitialElements() {
    const container = document.createElement('div');
    container.innerHTML = configPopupHtml;

    // get initial data from config and change
    (container.querySelector('#farm') as HTMLInputElement)!.checked = this.farm;
    (container.querySelector('#builder') as HTMLInputElement)!.checked = this.builder;
    (container.querySelector('#guard') as HTMLInputElement)!.checked = this.guard;
    (container.querySelector('#recruiter') as HTMLInputElement)!.checked = this.recruiter;
    // farm section
    const intervalSelectElement = (container.querySelector('#time-interval-select') as HTMLSelectElement)
    const farmIntervalValuesUnparsed = Object.values(FarmTimeInterval);
    const farmIntervalValues = farmIntervalValuesUnparsed.slice((farmIntervalValuesUnparsed.length / 2));
    farmIntervalValues.forEach((value) => {
      const option = document.createElement('option')
      option.value = value.toString()
      option.textContent = this.mapTimeIntervalKeyToText(value as FarmTimeInterval);
      intervalSelectElement.appendChild(option);
    });

    (container.querySelector('#time-interval-select') as HTMLSelectElement)!.value = this.config.farmConfig.farmInterval.toString() ?? FarmTimeInterval.FirstOption.toString();

    const humanizeCheckbox = container.querySelector('#humanize-checkbox') as HTMLInputElement;
    humanizeCheckbox.checked = this.config.farmConfig.humanize;
    await this.createConfictingCitiesSelects(container);
    // END farm section
    return container;
  }

  private async createConfictingCitiesSelects(container: HTMLElement) {
    const citySwitchManager = await CitySwitchManager.getInstance();
    const listOfCities = citySwitchManager.getCityList();
  
    const uniqueIsleGrids = Array.from(new Set(listOfCities.map(city => city.isleId)));
    const arrayOfArraysOfCitiesOnTheSameIsland = uniqueIsleGrids.map(isleId => listOfCities.filter(city => city.isleId === isleId));
    const areAnyConflicts = arrayOfArraysOfCitiesOnTheSameIsland.some(array => array.length > 1);

    const conflictingCitiesContainer = container.querySelector('#conflicting-cities-container') as HTMLElement;
    const conflictingCitiesArrow = conflictingCitiesContainer.querySelector('.arrow-down');
    const conflictingCitiesContent = conflictingCitiesContainer.querySelector('.section-content') as HTMLElement;

    if (!areAnyConflicts) {
      conflictingCitiesContainer.classList.add('hidden');
      /* NOTE:  if there are no conflicts, then all cities are uniquely selected, 
      but it must be explicitly assigned to the class field because based on this, after submitting it will
      be added to the config and farm manager will use it to know which villages to farm.
      */
      this.uniquelySelectedFarmingCitiesPerIsle = listOfCities.reduce((acc: Record<string, CityInfo>, city) => {
        acc[city.isleId] = city;
        return acc;
      }, {});
    } else {
      conflictingCitiesContainer.classList.remove('hidden');
      /*
       *     <!-- <div class="isle-container">
       *         <div class="isle-header">Isle 1</div>
       *         <select name="isle1-cities" id="isle1-cities">
       *         <option value="city1">City 1</option>
       *         <option value="city2">City 2</option>
       *       </select>
       *     </div> --> 
       */
      for (const arrayOfCities of arrayOfArraysOfCitiesOnTheSameIsland) {
        if (arrayOfCities.length === 1) {
          this.uniquelySelectedFarmingCitiesPerIsle[arrayOfCities[0].isleId] = arrayOfCities[0];
          continue;
        }

        const initialCity = arrayOfCities.find(city => city.name === this.config.farmConfig.farmingCities.find(city => city.isleId === arrayOfCities[0].isleId)?.name)
          ?? arrayOfCities[0];
        this.uniquelySelectedFarmingCitiesPerIsle[arrayOfCities[0].isleId] = initialCity;


        const isleContainer = document.createElement('div');
        isleContainer.className = 'isle-container';

        const isleHeader = document.createElement('div');
        isleHeader.className = 'isle-header';
        isleHeader.textContent = `Isle ${arrayOfCities[0].isleId}`;
        isleContainer.appendChild(isleHeader);

        const isleCitiesSelect = document.createElement('select');
        isleCitiesSelect.name = `isle-${arrayOfCities[0].isleId}-cities`;
        isleCitiesSelect.id = `isle-${arrayOfCities[0].isleId}-cities`;
        isleContainer.appendChild(isleCitiesSelect);

        arrayOfCities.forEach((city) => {
          const option = document.createElement('option');
          option.value = city.name;
          option.textContent = city.name;
          isleCitiesSelect.appendChild(option);
        });

        isleCitiesSelect.value = initialCity.name;

        isleCitiesSelect.addEventListener('change', () => {
          const selectedCity = arrayOfCities.find(city => city.name === isleCitiesSelect.value);
          if (selectedCity) {
            this.uniquelySelectedFarmingCitiesPerIsle[arrayOfCities[0].isleId] = selectedCity;
            console.log('this.conflictingCities', this.uniquelySelectedFarmingCitiesPerIsle);
          }
        });

        conflictingCitiesContent.appendChild(isleContainer);
      };
    }

    conflictingCitiesArrow!.addEventListener('click', () => {
      conflictingCitiesContent!.classList.toggle('hidden');
      conflictingCitiesArrow!.classList.toggle('rotate');
    });


  }

  private mapTimeIntervalKeyToText(value: FarmTimeInterval): string {
    switch (value) {
      case FarmTimeInterval.FirstOption:
        return "5m/10m";
      case FarmTimeInterval.SecondOption:
        return "20m/40m";
      case FarmTimeInterval.ThirdOption:
        return "1h 30m/3h";
      case FarmTimeInterval.FourthOption:
        return "4h/8h";
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

  public async render() {
    this.addStyle();

    // utwórz contener, ustaw atrybuty i body
    const configWindowElement = await this.createInitialElements();
    document.body.appendChild(configWindowElement);

    this.initEventListeners();
  }

  public minimize() {
    const container = document.querySelector<HTMLElement>('#config-popup-container');
    container?.classList.add('minimized');
  }
}
