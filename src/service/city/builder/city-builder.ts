import { addDelay, msToFutureHHMMSS, HHMMSS_toMS } from '../../../utility/plain-utility';
import Lock from '../../../utility/ui-lock';
import {
  cancelHover,
  triggerHover,
  waitForElement,
  waitForElementFromNode,
  waitForElementInterval,
  waitForElements,
} from '../../../utility/ui-utility';
import builderCss from './queue.css';
import builderHtml from './builder-prod.html';
import { Building, buildings, buildingsSelectors } from './buildings';
import ResourceManager from '../../resources/resource-manager';
import CitySwitchManager, { CityInfo } from '../city-switch-manager';
import GeneralInfo from '../../master/ui/general-info';
import { TConfigChanges } from '../../../config-popup/config-popup';
import ConfigManager from '../../../utility/config-manager';
import ResourceLock from '../../../utility/resource-lock';
import MasterQueue, { ScheduleOperationDetails } from '../../master-queue/master-queue';
import TradeManager from '../../trade/trade-manager';
import { TConfig } from '../../../../gps.config';

export type BuilderQueueItem = {
  building: Building;
  toLvl: number;
  supplierCities: CityInfo[];
  maxShipmentTime: number;
};

type CitySchedule = {
  city: CityInfo;
  schedule: NodeJS.Timeout | null;
  scheduledDate: Date | null;
  description?: string;
  operation?: 'build' | 'speedUp' | 'buildCheck' | 'speedUpAndCheck';
};

export default class CityBuilder {
  private static readonly queueContainerId = 'additional-queue';
  private static readonly queueItemClass = 'queue-item';
  private static readonly cancelButtonClass = 'cancel';
  private static readonly upButtonClass = 'up';
  private static readonly buildOptionsContainerId = 'build-options';
  private static readonly buildOptionItemClass = 'build-option';
  private static readonly buildOptionItemAddClass = 'build-options-add';
  private static readonly buildContainerId = 'build-container';
  private static readonly toggleBuilderButtonId = 'toggle-builder';

  private static instance: CityBuilder;
  private citySwitchManager!: CitySwitchManager;
  private generalInfo!: GeneralInfo;
  private allowUnsequentialBuilds: boolean = false;
  private allowCriticalBuilds: boolean = true;
  private static readonly BUILD_RETRY_INTERVAL: number = 10 * 60 * 1000;

  private lock!: Lock;
  private resourceManager!: ResourceManager;
  private masterQueue!: MasterQueue;
  private tradeManager!: TradeManager;
  private config!: TConfig;

  private RUN: boolean = false;
  private resourceLock!: ResourceLock;

  private mainQueue: Array<CitySchedule> = [];

  private constructor() {}

  public static async getInstance(): Promise<CityBuilder> {
    if (!CityBuilder.instance) {
      CityBuilder.instance = new CityBuilder();
      CityBuilder.instance.lock = Lock.getInstance();
      CityBuilder.instance.resourceLock = ResourceLock.getInstance();
      CityBuilder.instance.resourceManager = await ResourceManager.getInstance();
      CityBuilder.instance.citySwitchManager = await CitySwitchManager.getInstance();
      CityBuilder.instance.generalInfo = GeneralInfo.getInstance();
      CityBuilder.instance.masterQueue = await MasterQueue.getInstance();
      CityBuilder.instance.tradeManager = await TradeManager.getInstance();
      CityBuilder.instance.config = ConfigManager.getInstance().getConfig();
      CityBuilder.instance.addStyle();
      CityBuilder.instance.renderUI();
    }
    return CityBuilder.instance;
  }
  private renderUI() {
    const container = document.createElement('div');
    container.innerHTML = builderHtml;
    document.body.appendChild(container);
    this.addBuildingButtons();
    this.initProviderCities();
    this.accustomHtmlToMasterQueue();
    this.initToggleButton();
  }

  /**
   * Should be called only once on init.
   */
  private accustomHtmlToMasterQueue() {
    // NOTE: hydrate builder navigation with master-queue navigation
    const buttonsSection = document.querySelector<HTMLElement>('#builder-navigation')!;
    const currentCity = this.citySwitchManager.getCurrentCity()!;
    this.masterQueue.getNavigation('city', currentCity, buttonsSection);

    // NOTE: "master-queue" class must be added for master-queue to handle queue display
    const additionalQueue = document.querySelector<HTMLElement>('#additional-queue')!;
    additionalQueue.classList.add('master-queue');
  }

  private initProviderCities() {
    if (ConfigManager.getInstance().getConfig().masterQueue.autoReevaluate) {
      document.getElementById('provider-cities')!.parentElement!.classList.add('hidden');
    } else {
      const providerCities = document.getElementById('provider-cities')!;
      providerCities.hidden = false;
      this.citySwitchManager.getCityList().forEach(city => {
        const option = document.createElement('option');
        option.value = city.name;
        option.textContent = city.name;
        providerCities.appendChild(option);
      });
    }
  }

  // TODO: change because of master queue
  /**
   * Handles builder config changes, method serves as a listener for config changes.
   * @param configChanges
   */
  public handleBuilderConfigChange(configChanges: TConfigChanges['builder']) {
    const minimumTrackingChanged = configChanges.minimumTracking;

    // minimum tracking change handling
    if (minimumTrackingChanged) {
      const minimumTracking = ConfigManager.getInstance().getConfig().builder.minimumTracking;
      if (minimumTracking === true) {
        this.mainQueue.forEach(citySchedule => {
          if (citySchedule.schedule) {
            clearInterval(citySchedule.schedule);
            clearTimeout(citySchedule.schedule);
            citySchedule.schedule = null;
            citySchedule.scheduledDate = null;
          }
        });
      } else {
        if (this.RUN) {
          this.mainQueue.forEach(cityQueue => {
            if (!cityQueue.schedule) this.setInternalSpeedUpFlow(cityQueue.city);
          });
        }
      }
    }
  }

  private initToggleButton() {
    const button = document.getElementById(CityBuilder.toggleBuilderButtonId)!;

    button.addEventListener('click', () => {
      const buildContainer = document.getElementById(CityBuilder.buildContainerId)!;
      buildContainer.classList.toggle('hidden');
      if (!buildContainer.classList.contains('hidden')) {
        this.goToBuildMode('current');
      } else {
        this.tryExitBuildMode();
      }
    });
  }

  public getBuilderScheduleTimes() {
    return this.mainQueue.map(queue => queue.scheduledDate);
  }

  /*
  <div id="build-container">
    <div id="build-options">
      <div class="build-option"
        style="background-image: url(https://gpen.innogamescdn.com/images/game/main/lumber.png)">
        <div class="build-options-add">+</div>
      </div>
    </div>
    <div id="additional-queue">

    </div>
  </div>
  <button id="show-builder">Toggle builder</button>
  */

  // TODO: change because of master queue (should call masterQueue.addToQueue(details))
  private addBuildingButtons() {
    // <div id="build-container">
    const buildOptions = document.getElementById(CityBuilder.buildOptionsContainerId)!;

    // <div class="build-option"
    Object.values(buildings).forEach(building => {
      const button = document.createElement('div');
      button.className = CityBuilder.buildOptionItemClass;
      button.style.backgroundImage = building.backgroundImageProp;
      buildOptions.appendChild(button);

      // <div class="build-options-add">+</div>
      const addIcon = document.createElement('div');
      addIcon.className = CityBuilder.buildOptionItemAddClass;
      addIcon.innerHTML = '+';
      button.appendChild(addIcon);

      button.addEventListener('click', () => {
        this.addToQueue(building);
      });
    });
  }

  /**
   * Switches to the given city (if provided else assumes that current city is already switched) and clicks on the build mode button.
   * @param city
   */
  private async goToBuildMode(city: CityInfo | 'current') {
    if (city !== 'current') {
      await city.switchAction();
    }
    document.querySelector<HTMLDivElement>('[name="city_overview"]')?.click();
    const buildModeButton = await waitForElement('[class="construction_queue_build_button"] div', 2000);
    if (!buildModeButton.classList.contains('active')) {
      buildModeButton.click();
    }
  }

  private tryExitBuildMode() {
    const buildModeButton = document.querySelector<HTMLElement>('[class="construction_queue_build_button"] div');
    if (buildModeButton?.classList.contains('active')) {
      buildModeButton.click();
    }
  }

  // TODO: change because of master queue
  /**
   * API method to revalidate queue item levels for given building and from index. Assumes item is already deleted from queue.
   * @param building
   * @param fromIndex
   * @param citySchedule
   */
  public revalidateQueueItemLevels(building: Building, fromIndex: number, itemsToRevalidate: BuilderQueueItem[]) {
    console.log('--------revalidateQueueItemLevels', building, fromIndex);
    itemsToRevalidate.forEach(item => {
      const newToLvl = item.toLvl - 1;
      item.toLvl = newToLvl;
    });
  }

  private async addToQueue(building: Building) {
    console.log('cityBuilder.addToQueue() building', building);
    const currentCity = this.citySwitchManager.getCurrentCity()!;
    const citySchedule = this.masterQueue.getBuilderScheduleForCity(currentCity);
    await this.goToBuildMode('current');

    // assess lvl
    let currentLvl!: number;
    const buildingElement = await waitForElement(building.elementSelector, 1000).catch(() => null);
    if (buildingElement) {
      const buildingcurrentLvlText = await waitForElement(
        `${building.elementSelector} ${buildingsSelectors.currentLvl}`,
        1000,
      )
        .then(el => el.textContent)
        .catch(() => null);
      currentLvl =
        buildingcurrentLvlText !== 'max' || buildingcurrentLvlText !== null ? Number(buildingcurrentLvlText) : Infinity;
    } else {
      currentLvl = 0;
    }

    if (currentLvl === Infinity) {
      return;
    }
    // end of assess lvl

    // assess supplier cities
    const citiesSelect = document.getElementById('provider-cities') as HTMLSelectElement;
    const selectedSupplierCities = Array.from(citiesSelect.selectedOptions).map(
      (option: HTMLOptionElement) => this.citySwitchManager.getCityByName(option.value)!,
    );
    console.log('selectedSupplierCities', selectedSupplierCities);
    // end of assess supplier cities

    // assess max shipment time
    const maxShipmentTime = document.getElementById('max-shipment-time') as HTMLSelectElement;
    const maxShipmentTimeValue = Number(maxShipmentTime.value);
    console.log('maxShipmentTimeValue', maxShipmentTimeValue);
    // end of assess max shipment time

    // assess lvl
    console.log('lvl conter start, citySchedule', citySchedule);
    const lvlCounter = citySchedule.filter(item => item.building.name === building.name).length + 1;
    console.log('lvlCounter', lvlCounter);
    // end of assess lvl

    const queueItem = {
      building,
      toLvl: currentLvl + lvlCounter,
      supplierCities: selectedSupplierCities,
      maxShipmentTime: Number(maxShipmentTimeValue),
    };

    console.log('cityBuilder.addToQueue() queueItem', queueItem);

    // add to master queue
    this.masterQueue.addToQueue(currentCity, 'builder', queueItem);
  }

  public async execute(operationDetails: ScheduleOperationDetails<BuilderQueueItem>) {
    console.log('cityBuilder.execute() operationDetails', JSON.parse(JSON.stringify(operationDetails)));
    await this.handleBuildSchedule(operationDetails);
  }

  /**
   * Performs build schedule for given operation details or schedules speed up.
   * @param operationDetails
   * @requires Lock
   */
  private async performBuildSchedule(operationDetails: ScheduleOperationDetails<BuilderQueueItem>) {
    if (await this.isEmptySlot(operationDetails.city)) {
      console.log('\t-isEmptySlot is true, checking if can build');
      await this.buildOrScheduleOrRemove(operationDetails);
    } else {
      console.log('\t-isEmptySlot is false, scheduling speed up');
      await this.setTimeoutForSpeedUpAndPerformBuildSchedule(operationDetails, 'slot');
    }
  }

  /**
   * Calls API method to shift queue and go for next item, and sets internal speed up flow for given city.
   * @param operationDetails
   */
  private async onScheduleItemFinished(operationDetails: ScheduleOperationDetails<BuilderQueueItem>) {
    await this.setInternalSpeedUpFlow(operationDetails.city);
    // NOTE: could be optimized because calculating time to speed up is called twice
    const isRealQueueFull = await this.isRealQueueFull(operationDetails.city);
    // TODO: prepare master-queue for argument reception
    operationDetails.shiftQueueAndNext();
  }

  /**
   * Clears internal schedule for given city.
   * @param city
   */
  private clearInternalCitySchedule(city: CityInfo) {
    const citySchedule = this.mainQueue.find(schedule => schedule.city.name === city.name);
    console.warn('clearInternalCitySchedule for city:', city.name, 'timeoutId:', citySchedule?.schedule);
    if (citySchedule && citySchedule.schedule) {
      console.warn('\t-clearing internal schedule');
      clearTimeout(citySchedule.schedule);
      clearInterval(citySchedule.schedule);
      citySchedule.schedule = null;
      citySchedule.scheduledDate = null;
    } else {
      console.warn('\t-no schedule found, no timeout cleared');
    }
  }

  /**
   * Speeds up first build or schedules it and then performs build schedule. (valid for master queue)
   * @param operationDetails
   */
  private async setTimeoutForSpeedUpAndPerformBuildSchedule(
    operationDetails: ScheduleOperationDetails<BuilderQueueItem>,
    purpose: 'slot' | 'resources' | 'charms' | 'other',
  ) {
    console.log('setTimeoutForSpeedUpAndPerformBuildSchedule execution()');
    const timeToSpeedUp = await this.getTimeToCanSpeedUp(operationDetails.city).catch(() => null);
    console.log('\t-timeToSpeedUp:', timeToSpeedUp);
    if (timeToSpeedUp === null) {
      console.log('\t-timeToSpeedUp is null, performing build schedule to reevaluate conditions');
      await this.performBuildSchedule(operationDetails);
    } else if (timeToSpeedUp <= 0) {
      console.log('\t-will speed up first build immediately');
      await this.speedUpFirstBuild(operationDetails.city);
      console.log('\t-call performBuildSchedule for the waiting item');
      await this.performBuildSchedule(operationDetails);
    } else {
      console.log('\t-time to speed up is:', timeToSpeedUp, 'will be scheduled at:', msToFutureHHMMSS(timeToSpeedUp));
      const timeToAction = timeToSpeedUp + 2 * 1000;

      const executionCallback = async () => {
        try {
          await this.lock.acquire({
            method: operationDetails.city.name + ' - setTimeoutForNextSpeedUpAndSchedule (inside timeout)',
            manager: 'builder',
          });
          console.log('setTimeoutForNextSpeedUpAndSchedule() inside timeout');
          console.log('\t-speed up first build');
          await this.speedUpFirstBuild(operationDetails.city);
          console.log('\t-performBuildSchedule');
          await this.performBuildSchedule(operationDetails);
        } catch (e) {
          console.warn('CityBuilder.setTimeoutForNextSpeedUpAndSchedule().catch', e);
          console.log('\t-retrying by calling handleBuildSchedule()');
          this.handleBuildSchedule(operationDetails);
        } finally {
          this.lock.release();
        }
      };
      console.warn(
        'setting timeout for speed up and schedule (setTimeoutForSpeedUpAndPerformBuildSchedule)',
        new Date(Date.now() + timeToAction),
      );
      operationDetails.setScheduleTimeout(executionCallback, timeToAction, purpose);
    }
  }

  /**
   * Builds building and ensures it's added to the real queue.
   * @param building
   * @param city
   * @requires Lock
   */
  private async buildBuilding(building: Building, city?: CityInfo) {
    await this.goToBuildMode(city ?? 'current');
    const emptySlots = this.getEmptySlotsCount();
    await waitForElement(building.elementSelector + ' ' + buildingsSelectors.buildButton).then(element =>
      element.click(),
    );
    await this.untilEmptyslotsAreEqual(emptySlots - 1);
  }

  /**
   * -Checks if building can be built and builds
   *
   * -Or schedules speed up and then builds
   *
   * -Or removes item from queue if bulding is maxed or impossible to build
   *
   * @param operationDetails
   * @param forced - if true, item will be removed from queue
   * @requires Lock
   */
  private async buildOrScheduleOrRemove(
    operationDetails: ScheduleOperationDetails<BuilderQueueItem>,
    forced: boolean = false,
  ) {
    const building = operationDetails.queueItem.building;
    const item = operationDetails.queueItem;

    console.log('check if can build item:', item);
    const canBuild = await this.canBuild(building, operationDetails.city);
    console.log('\t-canBuild:', canBuild);
    // NOTE: only point in the code where building gets built
    if (canBuild === true) {
      console.log('\t-canBuild is true, building...');
      await this.buildBuilding(building, operationDetails.city);
      await this.onScheduleItemFinished(operationDetails);
    } else if (canBuild === 'maxed') {
      console.log('\t-canBuild is maxed, shifting queue');
      if (forced) {
        this.masterQueue.removeItemById(operationDetails.city, operationDetails.id);
        await this.onScheduleItemFinished(operationDetails);
      } else {
        await this.onScheduleItemFinished(operationDetails);
      }
    }
    // problematic, because it can block whole queue until queue is empty - user must be cautious
    else if (canBuild === 'impossible') {
      if (!(await this.isQueueEmpty(operationDetails.city))) {
        console.log(
          '\t-canBuild is impossible, but queue is not empty, scheduling build because maybe after that it will be possible',
        );
        /* NOTE: it can be set as "waiting for the slot" as it waits for building to be done 
        in order to know if that was the condition why building was not possible */
        await this.setTimeoutForSpeedUpAndPerformBuildSchedule(operationDetails, 'slot');
      } else {
        console.log('\t-canBuild is impossible, and queue is empty, element must be deleted');
        await this.onScheduleItemFinished(operationDetails);
      }
    } else {
      const resourcesInfo = await this.areResourcesStackable(building, operationDetails.city);
      if (resourcesInfo.areStackable === true) {
        console.log('\t-areResourcesStackable is true, stacking/waiting for resources and scheduling build');
        await this.handleResourcesStackableFlow(operationDetails, resourcesInfo.requiredResources);
      } else if (resourcesInfo.areStackable === 'population' && this.allowCriticalBuilds) {
        console.log('\t\t-areResourcesStackable is population, adding farm to queue');
        this.masterQueue.unshiftAndRun(operationDetails.city, 'builder', {
          building: buildings.farm,
          toLvl: (await this.getBuildingCurrentLvl(buildings.farm)) + 1,
          supplierCities: [],
          maxShipmentTime: 0,
        });
      } else if (resourcesInfo.areStackable === 'storage' && this.allowCriticalBuilds) {
        console.log('\t\t-areResourcesStackable is storage, adding storage to queue');
        this.masterQueue.unshiftAndRun(operationDetails.city, 'builder', {
          building: buildings.storage,
          toLvl: (await this.getBuildingCurrentLvl(buildings.storage)) + 1,
          supplierCities: [],
          maxShipmentTime: 0,
        });
      }
      // surowce zestackowane, nie można zbudować, ale są inne elementy w kolejce, które po zbudowaniu mogą zmienić warunek więc czekaj
      else if (resourcesInfo.areStackable === 'alreadyStacked' && !(await this.isQueueEmpty(operationDetails.city))) {
        console.log('\t\t-areResourcesStackable is alreadyStacked, waiting for other items to be built');
        /* NOTE: it can be set as "waiting for the slot" as it waits for building to be done in order to know if that was the condition that is to be met */
        await this.setTimeoutForSpeedUpAndPerformBuildSchedule(operationDetails, 'slot');
      } else {
        console.log('Item cannot be scheduled, because it has not met requirements');
        await this.onScheduleItemFinished(operationDetails);
      }
    }
  }

  /**
   * Sets internal speed up flow for given city for all items in the queue.
   * @param city
   * @requires Lock
   */
  private async setInternalSpeedUpFlow(city: CityInfo) {
    console.warn('----------setInternalSpeedUpFlow for city:', city.name);
    if (!(await this.isQueueEmpty(city))) {
      const timeToSpeedUp = await this.getTimeToCanSpeedUp(city).catch(() => null);
      if (timeToSpeedUp === null) {
        return;
      }
      if (timeToSpeedUp <= 0) {
        console.warn('\t-timeToSpeedUp <= 0, speedUpFirstBuild');
        await this.speedUpFirstBuild(city);
        // call itself recursively to check if there are any other items in the queue
        await this.setInternalSpeedUpFlow(city);
      } else {
        // set timeout to speed up first build when ready and call itself recursively to check if there are any other items in the queue
        const timeout = setTimeout(async () => {
          console.warn('\t-speedUpFirstBuild inside timeout, speeding up first build');
          await this.speedUpFirstBuild(city);
          await this.setInternalSpeedUpFlow(city);
        }, timeToSpeedUp + 1000);
        const scheduleDate = new Date(Date.now() + timeToSpeedUp + 1000);
        console.warn('\t-(setInternalSpeedUpFlow) setting timeout to speed up first build', timeout, scheduleDate);
        this.setInternalScheduleTimeout(city, timeout, scheduleDate);
      }
    }
  }

  /**
   * Assigns timeout details for given city, handles all scenarios, even where city is not in main queue.
   * Assigns it to internal builder queue (not to master queue).
   * @param city
   * @param timeout
   * @param scheduleDate
   */
  private setInternalScheduleTimeout(city: CityInfo, timeout: NodeJS.Timeout, scheduleDate: Date) {
    const cityScheduleExists = this.mainQueue.find(queue => queue.city.name === city.name);
    const citySchedule = cityScheduleExists ?? {
      city,
      schedule: null,
      scheduledDate: null,
    };

    citySchedule.schedule = timeout;
    citySchedule.scheduledDate = scheduleDate;

    if (!cityScheduleExists) {
      this.mainQueue.push(citySchedule);
    }

    console.warn(
      'setInternalScheduleTimeout for city:',
      city.name,
      '(schedule):',
      this.mainQueue.find(queue => queue.city.name === city.name),
    );
  }

  /**
   * Stacks resources via trade manager and schedules build action. (valid for master queue)
   * @param operationDetails - operation details
   * @param requiredResources - required resources to build the building
   * @requires Lock
   */
  private async handleResourcesStackableFlow(
    operationDetails: ScheduleOperationDetails<BuilderQueueItem>,
    requiredResources: { wood: number; stone: number; iron: number },
    resourcesArrivalTime?: number,
  ) {
    console.log('handleResourcesStackableFlow, details:', JSON.parse(JSON.stringify(operationDetails)));
    /**
     * Checks if there are enough resources to build the building.
     * @requires Lock
     * @returns boolean
     */
    const resourcesCheckContition = async () => {
      return await this.resourceManager.hasEnoughResources(requiredResources, operationDetails.city);
    };

    /**
     * Builds the building if possible or else deletes item from queue
     * @requires Lock
     */
    const performBuildActionAndCallback = async () => {
      if ((await this.canBuild(operationDetails.queueItem.building, operationDetails.city)) === true) {
        await this.buildBuilding(operationDetails.queueItem.building, operationDetails.city);
        await this.onScheduleItemFinished(operationDetails);
      } else {
        // it shouldn't happen, but if at this point canBuild is false or maxed or impossible then delete item from queue because it will block the queue permamently
        await this.onScheduleItemFinished(operationDetails);
      }
    };

    let timeToRetry: number;
    let retrialTime: number;

    /* 
    Assess time to retry (either arrival of resources or 10 minutes) - if method receives resourcesArrivalTime, it means that it's a retry
    and no need to stack resources again, because they already are on the way (unless time is in the past)
    */
    if (resourcesArrivalTime && resourcesArrivalTime > Date.now()) {
      console.log('recursive call, resourcesArrivalTime:', resourcesArrivalTime);
      timeToRetry = resourcesArrivalTime - Date.now();
      retrialTime = resourcesArrivalTime;
    } else {
      // if there are supplier cities, then stack resources
      if (operationDetails.queueItem.supplierCities.length) {
        console.log('stacking resources, supplierCities.length:', operationDetails.queueItem.supplierCities.length);
        const stackResourcesResult = await this.tradeManager.stackResources(
          requiredResources,
          operationDetails.city,
          operationDetails.queueItem.supplierCities,
          operationDetails.queueItem.maxShipmentTime,
        );
        // if stackResourcesResult.timeMs is -1, then resources are not fully stacked and it needs to be retried in 10 minutes
        if (stackResourcesResult.timeMs === -1 || stackResourcesResult.fullyStacked === false) {
          timeToRetry = 1000 * 60 * 10;
          retrialTime = Date.now() + 1000 * 60 * 10;
        } else {
          // time to arrival of all necessary resources (+3s)
          timeToRetry = stackResourcesResult.timeMs;
          retrialTime = Date.now() + stackResourcesResult.timeMs;
        }
      } else {
        timeToRetry = 600000;
        retrialTime = Date.now() + 600000;
      }
    }

    // sprawdź czas do przyspieszenia budowy
    const timeToSpeedUp = !(await this.isQueueEmpty(operationDetails.city))
      ? await this.getTimeToCanSpeedUp(operationDetails.city)
          .then(time => time + 3000)
          .catch(() => null)
      : null;

    // jeżeli nie ma czasu do przyspieszenia (brak budynku w kolejce), to sprawdź w czasie określonym przez czas dostawy
    if (!timeToSpeedUp) {
      operationDetails.setScheduleTimeout(
        async () => await this.handleBuildSchedule(operationDetails),
        timeToRetry,
        'slot' /* NOTE: na pewno slot? */,
      );
    } else if (timeToSpeedUp < timeToRetry) {
      /* w przeciwnym razie sprawdź czy timeToSpeedUp jest krótszy od czasu dostawy surowców
    jeżeli tak, to ustaw timeout na przyspieszenie i wywołaj metodę rekurencyjnie
    */
      console.warn(
        '\t-timeToSpeedUp < timeToRetry, setting timeout to speed up first build on',
        new Date(Date.now() + timeToSpeedUp),
      );
      operationDetails.setScheduleTimeout(
        async () => {
          try {
            await this.lock.acquire({
              method: operationDetails.city.name + ' - handleResourcesStackable (inside checking timeout)',
              manager: 'builder',
            });
            // this.generalInfo.showInfo('Builder:', `Przyspieszanie budowy w mieście: ${cityQueue.city.name}`);
            await this.speedUpFirstBuild(operationDetails.city);
            if (await resourcesCheckContition()) {
              await performBuildActionAndCallback();
            } else {
              await this.handleResourcesStackableFlow(operationDetails, requiredResources, retrialTime);
            }
          } catch (e) {
            console.warn('CityBuilder.handleResourcesStackable().catch', e);
          } finally {
            this.lock.release();
          }
        },
        timeToSpeedUp,
        'resources',
      );
    } else {
      /* at this point it's known that there are items in the queue, that needs to be constantly checked for speed up and also
      there is waiting element in the virtual queue, that needs to be checked if can be finally added to real queue.
      Also checking time is shorter than time to speed up, so it will be checked first
      */
      console.warn(
        '\t-timeToSpeedUp >= timeToRetry, setting timeout to speed up first build on',
        new Date(Date.now() + timeToSpeedUp),
      );
      operationDetails.setScheduleTimeout(
        async () => {
          try {
            await this.lock.acquire({
              method: operationDetails.city.name + ' - handleResourcesStackable (inside checking timeout)',
              manager: 'builder',
            });
            if (await resourcesCheckContition()) {
              await performBuildActionAndCallback();
            } else {
              await this.handleResourcesStackableFlow(operationDetails, requiredResources);
            }
          } catch (e) {
            console.warn('CityBuilder.handleResourcesStackable().catch', e);
          } finally {
            this.lock.release();
          }
        },
        timeToRetry,
        'resources',
      );
    }
  }

  private async getBuildingCurrentLvl(building: Building) {
    const buildingcurrentLvlText = (
      await waitForElement(`${building.elementSelector} ${buildingsSelectors.currentLvl}`)
    ).textContent;
    const currentLvl = buildingcurrentLvlText !== 'max' ? Number(buildingcurrentLvlText) : Infinity;
    return currentLvl;
  }

  private getEmptySlotsCount() {
    return document.querySelectorAll('.construction_queue_order_container.instant_buy .js-queue-item.empty_slot')
      .length;
  }

  private async untilEmptyslotsAreEqual(emptySlots: number) {
    return new Promise<void>(res => {
      const interval = setInterval(() => {
        if (this.getEmptySlotsCount() === emptySlots) {
          console.log('\t-emptyslotsAreEqual:', emptySlots);
          clearInterval(interval);
          res();
        }
      }, 333);
    });
  }

  private goToCityView() {
    const cityViewBtn = document.querySelector<HTMLDivElement>('[name="city_overview"]');
    cityViewBtn?.click();
  }

  private async handleBuildSchedule(operationDetails: ScheduleOperationDetails<BuilderQueueItem>) {
    try {
      await this.lock.acquire({ method: operationDetails.city.name + ' - handleBuildSchedule', manager: 'builder' });
      this.generalInfo.showInfo('Builder:', `Obsługa kolejki w mieście: ${operationDetails.city.name}`);
      this.clearInternalCitySchedule(operationDetails.city);
      await this.performBuildSchedule(operationDetails);
    } catch (e) {
      console.warn('CityBuilder.handleBuildSchedule().catch', e);
    } finally {
      console.log('handleBuildSchedule, release lock', operationDetails.city.name);
      this.generalInfo.hideInfo();
      this.lock.release();
    }
  }

  /**
   * Calls method that navigates to the given city and clicks on the free button.
   * @param city city in which operation is to be performed
   * @throws Error if no free button is found
   */
  private async speedUpFirstBuild(city: CityInfo) {
    await city.switchAction();
    const freeButton = await waitForElementInterval('[data-order_index="0"] .type_free', {
      retries: 6,
      interval: 400,
    }).catch(() => null);
    if (freeButton) {
      const emptySlotsSnapshot = this.getEmptySlotsCount();
      freeButton.click();
      await this.untilEmptyslotsAreEqual(emptySlotsSnapshot + 1);
    } else {
      const el = document.querySelector('[data-order_index="0"]');
      console.warn('element in the queue', el?.querySelector('.item_icon')?.classList[2]);
      console.warn('element in the queue time', el?.querySelector('.countdown.js-item-countdown')?.textContent);
      throw new Error('No free button found');
    }
  }

  /**
   * Calls method that navigates to the given city and checks if the given building can be built.
   * @param building building to be checked
   * @param city city in which operation is to be performed
   * @returns boolean | 'maxed' | 'impossible'
   */
  private async canBuild(building: Building, city: CityInfo): Promise<boolean | 'maxed' | 'impossible'> {
    await this.goToBuildMode(city);
    const element = await waitForElement(building.elementSelector, 2000).catch(() => null);
    if (!element) {
      return 'impossible';
    }
    const buildButton = await waitForElement(
      `${building.elementSelector} ${buildingsSelectors.buildButton}`,
      1000,
    ).catch(() => null);
    if (!buildButton) {
      return 'maxed';
    }
    const canBuild = !buildButton.classList.contains(buildingsSelectors.disabled);
    return canBuild;
  }
  /**
   * Checks if resources are stackable and returns required resources:
   *
   * True -> if resources are stackable,
   *
   * 'storage' -> if higher lvl storage is required,
   *
   * 'population' -> if higher lvl farm is required,
   *
   * 'alreadyStacked' -> if resources are already stacked,
   *
   * 'waiting' -> if 'storage' or 'population' is needed but are already in the queue
   *
   *  False -> is never returned, because it's never possible.
   *
   * @param building building requirements to be checked
   * @param city city in which operation is to be performed
   */
  private async areResourcesStackable(
    building: Building,
    city: CityInfo,
  ): Promise<{
    areStackable: boolean | 'storage' | 'population' | 'alreadyStacked' | 'waiting';
    requiredResources: { wood: number; stone: number; iron: number };
  }> {
    console.log('areResourcesStackable');
    await this.goToBuildMode(city);
    // const buildButton = await waitForElement(`${building.elementSelector} ${buildingsSelectors.buildButton}`);
    let counter = 0;
    do {
      triggerHover(document.querySelector(`${building.elementSelector} ${buildingsSelectors.buildButton}`)!);
      await addDelay(333);
      counter++;
    } while (
      !(await waitForElement('#popup_div img[src*="images/game/res/wood.png"]', 500).catch(() => false)) &&
      counter < 4
    );
    if (counter === 4) {
      console.warn('No popup content found, had to try 4 times. Returning false');
      return { areStackable: false, requiredResources: { wood: 0, stone: 0, iron: 0 } };
    }

    const requiredWood = Number(
      (await waitForElement('#popup_div img[src*="images/game/res/wood.png"]', 3000)).nextSibling!.textContent!,
    );
    const requiredStone = Number(
      (await waitForElement('#popup_div img[src*="images/game/res/stone.png"]', 0)).nextSibling!.textContent!,
    );
    const requiredIron = Number(
      (await waitForElement('#popup_div img[src*="images/game/res/iron.png"]', 0)).nextSibling!.textContent!,
    );
    const requiredPopulation = Number(
      (await waitForElement('#popup_div img[src*="images/game/res/pop.png"]', 0)).nextSibling!.textContent!,
    );
    cancelHover(document.querySelector(`${building.elementSelector} ${buildingsSelectors.buildButton}`)!);

    const resourcesInfo = await this.resourceManager.getResourcesInfo();

    console.log(`Resource requirements:
      \t- Required population: ${requiredPopulation}
      \t- Current population: ${this.resourceManager.getPopulation()}
      \t- Store capacity: ${await this.resourceManager.getStoreCapacity()}
      \t- Required wood: ${requiredWood}
      \t- Required stone: ${requiredStone}
      \t- Required iron: ${requiredIron}`);

    console.log('Current resources:', resourcesInfo);
    const requiredResources = {
      wood: requiredWood,
      stone: requiredStone,
      iron: requiredIron,
    };
    if (requiredPopulation > resourcesInfo.population.amount) {
      /* jeżeli farma już jest w kolejce, to być może po jej skończeniu budynek właściwy będzie mógł być zbudowany
      w przeciwnym razie builder będzie kolejkował farmę w nieskończoność */
      if (await this.isBuildingInRealQueue(building)) {
        return { areStackable: 'waiting', requiredResources };
      }
      return { areStackable: 'population', requiredResources };
    }
    if (
      [requiredWood, requiredStone, requiredIron].reduce((acc, curr) => (curr > acc ? curr : acc), 0) >
      resourcesInfo.storeMaxSize
    ) {
      /* jeżeli magazyn już jest w kolejce, to być może po jego skończeniu budynek właściwy będzie mógł być zbudowany
      w przeciwnym razie builder będzie kolejkował magazyn w nieskończoność */
      if (await this.isBuildingInRealQueue(building)) {
        return { areStackable: 'waiting', requiredResources };
      }
      return { areStackable: 'storage', requiredResources };
    }
    if (
      requiredWood <= resourcesInfo.wood.amount &&
      requiredStone <= resourcesInfo.stone.amount &&
      requiredIron <= resourcesInfo.iron.amount &&
      requiredPopulation <= resourcesInfo.population.amount
    ) {
      return { areStackable: 'alreadyStacked', requiredResources };
    }
    return { areStackable: true, requiredResources };
  }

  private addStyle() {
    const style = document.createElement('style');
    style.textContent = builderCss;
    document.head.appendChild(style);
  }

  private async isBuildingInRealQueue(building: Building, city?: CityInfo) {
    if (city) await city.switchAction();

    const buildingClassSelector = building.elementSelector.split('.')[2];
    for (const el of document.querySelectorAll<HTMLElement>('.type_building_queue .queued_building_order')) {
      if (el.classList.contains(buildingClassSelector)) {
        return true;
      }
    }
    return false;
  }

  private async isEmptySlot(city: CityInfo) {
    this.goToCityView();
    await city.switchAction();
    await addDelay(1000);
    return await waitForElement('.construction_queue_order_container.instant_buy .js-queue-item.empty_slot', 1000)
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Returns time to first item in the queue or
   * @param city
   * @returns time in ms
   */
  private async getTimeToCanSpeedUp(city?: CityInfo): Promise<number> {
    this.goToCityView();
    if (city) await city.switchAction();
    await addDelay(1000);
    const firstOrder = await waitForElementInterval('[data-order_index="0"] .countdown.js-item-countdown', {
      retries: 5,
      interval: 400,
    }).catch(() => null);
    if (firstOrder) {
      const timeToFirstOrder = HHMMSS_toMS(firstOrder.textContent!) - 5 * 60 * 1000;
      console.log('getTimeToCanSpeedUp(): calculated time to speed up first order:', timeToFirstOrder);
      return timeToFirstOrder;
    }
    console.warn('getTimeToCanSpeedUp(): no item in the queue, throwing error');
    throw new Error('No item in the queue.');
  }

  private async isQueueEmpty(city: CityInfo) {
    await city.switchAction();
    this.goToCityView();
    return new Promise(res => setTimeout(() => res(document.querySelector('.empty_queue')) != null, 0));
  }

  public async start() {
    this.RUN = true;
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.remove('hidden');
    if (!this.config.builder.minimumTracking) {
      this.citySwitchManager.getCityList().forEach(city => {
        this.setInternalSpeedUpFlow(city);
      });
    }
  }

  public stop() {
    console.log('Stopping');
    this.RUN = false;
    this.mainQueue.forEach(cityQueue => {
      if (cityQueue.schedule) {
        clearInterval(cityQueue.schedule);
        clearTimeout(cityQueue.schedule);
        cityQueue.schedule = null;
        cityQueue.scheduledDate = null;
      }
    });
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.add('hidden');
  }
  public isRunning() {
    return this.RUN;
  }

  public async isRealQueueFull(city?: CityInfo): Promise<{ isRealQueueFull: boolean; timeToFreeSlot: number }> {
    if (city) await city.switchAction(false);
    const emptySlots = this.getEmptySlotsCount();
    const returnValue = { isRealQueueFull: !emptySlots, timeToFreeSlot: 0 };
    if (!emptySlots) {
      returnValue.timeToFreeSlot = await this.getTimeToCanSpeedUp(city);
    }
    return returnValue;
  }
}
