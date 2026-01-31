import { ScheduleExecutionDetails } from '~/service/master-queue-rework/inline-queue-navigation';
import { TConfigChanges } from '../../../config-popup/config-popup';
import { addDelay, HHMMSS_toMS, msToFutureHHMMSS, waitWhile } from '../../../utility/plain-utility';
import Service from '../../../utility/Service';
import Lock, { LockOperationCancelledError } from '../../../utility/ui-lock';
import {
  cancelHover,
  getBrowserExecutionContextInfo,
  performOnDocumentVisibilityReturn,
  triggerHover,
  waitForElement,
  waitForElementInterval,
  waitForElementsInterval,
} from '../../../utility/ui-utility';
import MasterQueue, {
  type QueueItemInput,
  QueuePriority,
  type ScheduleOperationDetails,
} from '../../master-queue-rework/master-queue';
import GeneralInfo from '../../master/ui/general-info';
import ResourceManager from '../../resources/resource-manager';
import TradeManager from '../../trade/trade-manager';
import CitySwitchManager, { CityInfo } from '../city-switch-manager';
import builderHtml from './builder-prod.html';
import { Building, buildings, buildingsSelectors } from './buildings';
import builderCss from './queue.css?raw';
import { info } from 'console';

export type BuilderItemDetails = {
  building: Building;
  toLvl: number;
};

type CitySchedule = {
  city: CityInfo;
  timeout: NodeJS.Timeout | null;
  executionTime: number | null;
};

export default class CityBuilder implements Service<'builder'> {
  private static readonly buildOptionsContainerId = 'build-options';
  private static readonly buildOptionItemClass = 'build-option';
  private static readonly buildOptionItemAddClass = 'build-options-add';
  private static readonly builderContainerId = 'build-container';
  private static readonly toggleBuilderButtonId = 'toggle-builder';

  private static instance: CityBuilder;
  private citySwitchManager!: CitySwitchManager;
  private generalInfo!: GeneralInfo;
  private allowCriticalBuilds: boolean = true;

  private lock!: Lock;
  private resourceManager!: ResourceManager;
  private masterQueue!: MasterQueue;
  private tradeManager!: TradeManager;
  private getScheduleBaseFormValues: (() => ScheduleExecutionDetails) | undefined;
  private tryCount: Record<string, number> = {};

  private RUN: boolean = false;

  private schedule: Array<CitySchedule> = [];

  private constructor() {}

  public static async getInstance(): Promise<CityBuilder> {
    if (!CityBuilder.instance) {
      CityBuilder.instance = new CityBuilder();
      CityBuilder.instance.lock = Lock.getInstance();
      CityBuilder.instance.resourceManager = await ResourceManager.getInstance();
      CityBuilder.instance.citySwitchManager = await CitySwitchManager.getInstance();
      CityBuilder.instance.generalInfo = GeneralInfo.getInstance();
      CityBuilder.instance.masterQueue = await MasterQueue.getInstance();
      CityBuilder.instance.tradeManager = await TradeManager.getInstance();
      CityBuilder.instance.register();
      CityBuilder.instance.addUI();
    }
    return CityBuilder.instance;
  }

  private register() {
    this.masterQueue.registerExecutor<BuilderItemDetails>('builder', {
      execute: async operationDetails => {
        await this.execute(operationDetails);
      },
      postDeleteAction: (queue, deletedItemDetails) => {
        queue.forEach(item => {
          if (item.details.building.name === deletedItemDetails.building.name) {
            item.details.toLvl--;
          }
        });
      },
      onPositionChange: async (queue, movedItemDetails) => {
        const itemsToRevalidate = queue.filter(item => item.details.building.name === movedItemDetails.building.name);
        if (itemsToRevalidate.length > 1) {
          await this.goToBuildMode();
          let baseLvl = await this.getBuildingQueuedOrCurrentLvl(movedItemDetails.building);
          this.exitBuildMode();
          itemsToRevalidate.forEach(item => {
            baseLvl++;
            item.details.toLvl = baseLvl;
            item.ui.lvlBar = baseLvl.toString();
          });
        }
      },
      hydrateItem: function (itemDetails: BuilderItemDetails) {
        return {
          toLvl: itemDetails.toLvl,
          building: buildings[itemDetails.building.name as keyof typeof buildings],
        };
      },
      persistItem: function (itemDetails: BuilderItemDetails) {
        return { toLvl: itemDetails.toLvl, building: { name: itemDetails.building.name } };
      },
    });
  }

  private async addUI() {
    this.addStyle();
    this.addBuilderUI();
    this.injectMasterQueueUIGenerics();
    this.initToggleButton();
  }

  private injectMasterQueueUIGenerics() {
    // OPTIMIZATION: should it really render on EACH city change OR only if visible?
    const addMasterQueueNavigation = () => {
      const navigation = document.querySelector<HTMLElement>('#builder-navigation')!;
      const currentCity = this.citySwitchManager.getCurrentCity()!;

      // injects standard navigation + required schedule options and assigns getValues callback for access inside addToQueue method
      this.getScheduleBaseFormValues = this.masterQueue.injectQueueNavigation(currentCity, navigation).getValues;
    };
    this.citySwitchManager.addListener('cityChange', addMasterQueueNavigation);
    addMasterQueueNavigation();

    // NOTE: inline queue container must be registered (added dataset attr) for master-queue to handle queue lifecycle/refresh etc
    const queueViewContainer = document.querySelector<HTMLElement>('#builder-queue-view')!;
    this.masterQueue.registerInlineQueueContainer(queueViewContainer, this.citySwitchManager.getCurrentCity()!);
  }

  /**
   * Handles builder config changes, method serves as a listener for config changes.
   * @see VALID
   */
  public handleBuilderConfigChange(configChanges: TConfigChanges['builder']) {
    // nothing
  }

  /**
   * @see VALID
   */
  private initToggleButton() {
    const button = document.getElementById(CityBuilder.toggleBuilderButtonId)!;
    const builderContainer = document.getElementById(CityBuilder.builderContainerId)!;

    button.addEventListener('click', () => {
      builderContainer.classList.toggle('hidden');
      if (!builderContainer.classList.contains('hidden')) {
        this.goToBuildMode();
      } else {
        this.exitBuildMode();
      }
    });
  }

  /*
  <div id="build-container">
  <div id="build-options">
  <div class="build-option"
  style="background-image: url(https://gpen.innogamescdn.com/images/game/main/lumber.png)">
  <div class="build-options-add">+</div>
  </div>
  </div>
  <div id="builder-queue-view">

  </div>
  </div>
  <button id="show-builder">Toggle builder</button>
  */

  /**
   * @see VALID
   */
  private addBuilderUI() {
    const container = document.createElement('div');
    container.innerHTML = builderHtml;
    document.body.appendChild(container);
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
  private async goToBuildMode(city?: CityInfo) {
    if (city) {
      await city.switchAction();
    }
    document.querySelector<HTMLDivElement>('[name="city_overview"]')?.click();
    const buildModeButton = await waitForElementInterval('[class="construction_queue_build_button"] div', {
      interval: 150,
      retries: 12,
    });
    if (!buildModeButton.classList.contains('active')) {
      buildModeButton.click();
      await waitWhile(() => !buildModeButton.classList.contains('active'), { maxIterations: 4, delay: 100 });
    }
  }

  private exitBuildMode() {
    const buildModeButton = document.querySelector<HTMLElement>('[class="construction_queue_build_button"] div');
    if (buildModeButton?.classList.contains('active')) {
      buildModeButton.click();
    }
  }

  /**
   * @see VALID
   */
  private async addToQueue(building: Building) {
    const currentCity = this.citySwitchManager.getCurrentCity()!;
    const itemDetailsArr = this.masterQueue.getTypeSpecificItemDetailsForCity(currentCity, 'builder') as {
      id: string;
      itemDetails: {
        building: Building;
        toLvl: number;
      };
    }[];
    await this.goToBuildMode();

    // assess lvl
    let currentLvl!: number;
    const buildingElement = document.querySelector(building.elementSelector);
    if (buildingElement) {
      const buildingcurrentLvlText = document.querySelector(
        `${building.elementSelector} ${buildingsSelectors.currentLvl}`,
      )?.textContent;
      currentLvl =
        buildingcurrentLvlText !== 'max' || buildingcurrentLvlText !== null ? Number(buildingcurrentLvlText) : Infinity;
    } else {
      currentLvl = 0;
    }

    if (currentLvl === Infinity) {
      return;
    }
    // end of assess lvl

    const { blocking, priority, supplierCityNames, autoSuppliers, maxShipmentTime } = this.getScheduleBaseFormValues!();

    // assess lvl
    const lvlCounter = itemDetailsArr.filter(item => item.itemDetails.building.name === building.name).length + 1;
    // end of assess lvl

    const toLvl = currentLvl + lvlCounter;

    const queueItem: QueueItemInput = {
      itemType: 'builder',
      ui: {
        title: building.name,
        style: { backgroundImage: building.backgroundImageProp },
        lvlBar: toLvl.toString(),
      },
      blocking,
      priority,
      maxShipmentTime,
      supplyEvaluation: autoSuppliers ? 'auto' : 'manual',
      supplierCities: supplierCityNames?.map(name => this.citySwitchManager.getCityByName(name)!),
      itemDetails: {
        building,
        toLvl,
      },
    };

    console.log('[Builder]: Adding to queue:', queueItem);

    // add to master queue
    this.masterQueue.addToQueue(currentCity, queueItem);
  }

  public async execute(operationDetails: ScheduleOperationDetails<BuilderItemDetails>) {
    await this.handleBuildSchedule(operationDetails);
  }

  /**
   * Performs build schedule for given operation details or schedules speed up.
   * @param operationDetails
   * @requires Lock
   */
  private async performBuildSchedule(operationDetails: ScheduleOperationDetails<BuilderItemDetails>) {
    if (await this.isEmptySlot(operationDetails.city)) {
      console.log('[Builder]: Empty slot available, checking if can build');
      await this.buildOrScheduleOrRemove(operationDetails);
    } else {
      console.log('[Builder]: No empty slot, scheduling speed up');
      await this.setTimeoutForSpeedUpAndPerformBuildSchedule(operationDetails);
    }
  }

  /**
   * Calls API method to shift queue and go for next item, and sets internal speed up flow for given city.
   * @param operationDetails
   */
  private async onScheduleItemFinished(operationDetails: ScheduleOperationDetails<BuilderItemDetails>) {
    await this.setInternalSpeedUpFlow(operationDetails.city);
    operationDetails.onFinishCallback();
  }

  /**
   * Clears internal schedule for given city.
   * @param city
   */
  private clearInternalCitySchedule(city: CityInfo) {
    const citySchedule = this.schedule.find(schedule => schedule.city.name === city.name);
    console.log('[Builder]: Clearing internal schedule for city:', city.name, 'timeoutId:', citySchedule?.timeout);
    if (citySchedule && citySchedule.timeout) {
      console.log('[Builder]: Clearing internal schedule timeout');
      clearTimeout(citySchedule.timeout);
      clearInterval(citySchedule.timeout);
      citySchedule.timeout = null;
      citySchedule.executionTime = null;
    } else {
      console.log('[Builder]: No schedule found, no timeout to clear');
    }
  }

  /**
   * Speeds up first build or schedules it and then performs build schedule. (valid for master queue)
   * @param operationDetails
   */
  private async setTimeoutForSpeedUpAndPerformBuildSchedule(
    operationDetails: ScheduleOperationDetails<BuilderItemDetails>,
  ) {
    console.log('[Builder]: setTimeoutForSpeedUpAndPerformBuildSchedule execution');
    const timeToSpeedUp = await this.getTimeToCanSpeedUp(operationDetails.city).catch(() => null);
    console.log('[Builder]: Time to speed up:', timeToSpeedUp);
    if (timeToSpeedUp === null) {
      console.log('[Builder]: Time to speed up is null, performing build schedule to reevaluate conditions');
      await this.performBuildSchedule(operationDetails);
    } else if (timeToSpeedUp <= 0) {
      console.log('[Builder]: Will speed up first build immediately');
      await this.speedUpFirstBuild(operationDetails.city);
      console.log('[Builder]: Calling performBuildSchedule for the waiting item');
      await this.performBuildSchedule(operationDetails);
    } else {
      console.log(
        '[Builder]: Time to speed up:',
        timeToSpeedUp,
        'will be scheduled at:',
        msToFutureHHMMSS(timeToSpeedUp),
      );
      const timeToAction = timeToSpeedUp + 2000;

      const executionCallback = async () => {
        try {
          await this.lock.performWithLock(
            async () => {
              console.log('[Builder]: setTimeoutForNextSpeedUpAndSchedule inside timeout');
              console.log('[Builder]: Speeding up first build');
              await this.speedUpFirstBuild(operationDetails.city);
              console.log('[Builder]: Performing build schedule');
              await this.performBuildSchedule(operationDetails);
            },
            {
              manager: 'builder',
              id: operationDetails.id,
              details: 'method: setTimeoutForSpeedUpAndPerformBuildSchedule',
              forced: false,
            },
          );
        } catch (e) {
          // if it's not deliberate Lock cancelation, retry the whole flow
          if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
            const browserContext = getBrowserExecutionContextInfo();
            console.warn('[Builder]: handleResourcesStackable catch:', e, browserContext, 'retrying the whole flow');
            if (browserContext.visibilityState === 'hidden') {
              performOnDocumentVisibilityReturn(() => this.handleBuildSchedule(operationDetails));
            } else {
              this.handleBuildSchedule(operationDetails);
            }
          }
        }
      };
      console.log('[Builder]: Setting timeout for speed up and schedule at:', new Date(Date.now() + timeToAction));
      operationDetails.setScheduleTimeout(executionCallback, Date.now() + timeToAction, 'waiting', 'slot');
    }
  }

  /**
   * Builds building and ensures it's added to the real queue.
   * @param building
   * @param city
   * @requires Lock
   */
  private async buildBuilding(building: Building, city?: CityInfo) {
    await this.goToBuildMode(city);
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
    operationDetails: ScheduleOperationDetails<BuilderItemDetails>,
    forced: boolean = false,
  ) {
    const building = operationDetails.itemDetails.building;
    // const item = operationDetails.queueItem;

    // console.log('check if can build item:', item);
    const canBuild = await this.canBuild(building, operationDetails.city);
    console.log('[Builder]: Can build:', canBuild);
    // NOTE: only point in the code where building gets built
    if (canBuild === true) {
      console.log('[Builder]: Can build is true, building...');
      await this.buildBuilding(building, operationDetails.city);
      await this.onScheduleItemFinished(operationDetails);
    } else if (canBuild === 'maxed') {
      console.log('[Builder]: Can build is maxed, shifting queue');
      if (forced) {
        await this.setInternalSpeedUpFlow(operationDetails.city);
        operationDetails.shiftQueueAndNext();
      } else {
        await this.setInternalSpeedUpFlow(operationDetails.city);
        operationDetails.shiftQueueAndNext();
      }
    }
    // problematic, because it can block whole queue until queue is empty - user must be cautious
    else if (canBuild === 'impossible') {
      if (!(await this.isQueueEmpty(operationDetails.city))) {
        console.log(
          '[Builder]: Can build is impossible, but queue is not empty, scheduling build because maybe after that it will be possible',
        );
        // BUG: can be buggy - check it (especially error throwing if speedup is not possible)
        await this.setTimeoutForSpeedUpAndPerformBuildSchedule(operationDetails);
      } else {
        console.log('[Builder]: Can build is impossible, and queue is empty, element must be deleted');
        await this.setInternalSpeedUpFlow(operationDetails.city);
        operationDetails.shiftQueueAndNext();
      }
    } else {
      const resourcesInfo = await this.areResourcesStackable(building, operationDetails.city);
      if (resourcesInfo.areStackable === true) {
        console.log('[Builder]: Resources are stackable, stacking/waiting for resources and scheduling build');
        await this.handleResourcesStackableFlow(operationDetails, resourcesInfo.requiredResources);
      } else if (resourcesInfo.areStackable === 'population' && this.allowCriticalBuilds) {
        console.log('[Builder]: Resources are stackable (population), adding farm to queue');

        const toLvl = (await this.getBuildingQueuedOrCurrentLvl(buildings.Farm)) + 1;
        this.masterQueue.unshiftAndRun(operationDetails.city, {
          itemType: 'builder',
          ui: {
            title: buildings.Farm.name,
            style: { backgroundImage: buildings.Warehouse.backgroundImageProp },
            lvlBar: toLvl.toString(),
          },
          // NOTE: some fields are hardcoded -but this feature is FOR SURE not going to be used much and hardocded values seem reasonable
          blocking: true,
          priority: QueuePriority.High,
          maxShipmentTime: operationDetails.maxShipmentTime,
          supplyEvaluation: 'auto',
          supplierCities: [],
          itemDetails: {
            building: buildings.Farm,
            toLvl,
          },
        });
      } else if (resourcesInfo.areStackable === 'storage' && this.allowCriticalBuilds) {
        console.log('[Builder]: Resources are stackable (storage), adding warehouse to queue');
        const toLvl = (await this.getBuildingQueuedOrCurrentLvl(buildings.Warehouse)) + 1;
        this.masterQueue.unshiftAndRun(operationDetails.city, {
          itemType: 'builder',
          ui: {
            title: buildings.Warehouse.name,
            style: { backgroundImage: buildings.Warehouse.backgroundImageProp },
            lvlBar: toLvl.toString(),
          },
          // NOTE: some fields are hardcoded -but this feature is FOR SURE not going to be used much and hardocded values seem reasonable
          blocking: true,
          priority: QueuePriority.High,
          maxShipmentTime: operationDetails.maxShipmentTime,
          supplyEvaluation: 'auto',
          supplierCities: [],
          itemDetails: {
            building: buildings.Warehouse,
            toLvl,
          },
        });
      }
      // surowce zestackowane, nie można zbudować, ale są inne elementy w kolejce, które po zbudowaniu mogą zmienić warunek więc czekaj
      else if (resourcesInfo.areStackable === 'alreadyStacked' && !(await this.isQueueEmpty(operationDetails.city))) {
        console.log('[Builder]: Resources are already stacked, waiting for other items to be built');
        await this.setTimeoutForSpeedUpAndPerformBuildSchedule(operationDetails);
      } else {
        console.log('[Builder]: Item cannot be scheduled, because it has not met requirements');
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
    console.log('[Builder]: setInternalSpeedUpFlow for city:', city.name);
    if (!(await this.isQueueEmpty(city))) {
      const timeToSpeedUp = await this.getTimeToCanSpeedUp(city).catch(() => null);
      if (timeToSpeedUp === null) {
        return;
      }
      if (timeToSpeedUp <= 0) {
        console.log('[Builder]: Time to speed up <= 0, speeding up first build');
        await this.speedUpFirstBuild(city);
        // call itself recursively to check if there are any other items in the queue
        await this.setInternalSpeedUpFlow(city);
      } else {
        // set timeout to speed up first build when ready and call itself recursively to check if there are any other items in the queue
        const timeout = setTimeout(async () => {
          console.log('[Builder]: SpeedUpFirstBuild inside timeout, speeding up first build');
          await this.speedUpFirstBuild(city);
          await this.setInternalSpeedUpFlow(city);
        }, timeToSpeedUp + 1000);
        const scheduleTime = Date.now() + timeToSpeedUp + 1000;
        console.log('[Builder]: Setting timeout to speed up first build at:', new Date(scheduleTime));
        this.setInternalScheduleTimeout(city, timeout, scheduleTime);
      }
    }
  }

  /**
   * Assigns timeout details for given city, handles all scenarios, even where city is not in main queue.
   * Assigns it to internal builder queue (not to master queue).
   * @param city
   * @param timeout
   * @param scheduleTime
   */
  private setInternalScheduleTimeout(city: CityInfo, timeout: NodeJS.Timeout, scheduleTime: number) {
    const cityScheduleExists = this.schedule.find(queue => queue.city.name === city.name);
    const citySchedule = cityScheduleExists ?? {
      city,
      timeout: null,
      executionTime: null,
    };

    citySchedule.timeout = timeout;
    citySchedule.executionTime = scheduleTime;

    if (!cityScheduleExists) {
      this.schedule.push(citySchedule);
    }

    console.log(
      '[Builder]: setInternalScheduleTimeout for city:',
      city.name,
      'schedule:',
      this.schedule.find(queue => queue.city.name === city.name),
    );
  }

  /**
   * Stacks resources via trade manager and schedules build action. (valid for master queue)
   * @param operationDetails - operation details
   * @param requiredResources - required resources to build the building
   * @requires Lock
   */
  private async handleResourcesStackableFlow(
    operationDetails: ScheduleOperationDetails<BuilderItemDetails>,
    requiredResources: { wood: number; stone: number; iron: number },
    resourcesArrivalTime?: number,
  ) {
    console.log('[Builder]: handleResourcesStackableFlow, details:', JSON.parse(JSON.stringify(operationDetails)));
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
      if ((await this.canBuild(operationDetails.itemDetails.building, operationDetails.city)) === true) {
        await this.buildBuilding(operationDetails.itemDetails.building, operationDetails.city);
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
      console.log('[Builder]: Recursive call, resourcesArrivalTime:', resourcesArrivalTime);
      timeToRetry = resourcesArrivalTime - Date.now();
      retrialTime = resourcesArrivalTime;
    } else {
      // if there are supplier cities, then stack resources
      if (operationDetails.supplierCities.length) {
        console.log('[Builder]: Stacking resources, supplierCities.length:', operationDetails.supplierCities.length);
        const stackResourcesResult = await this.tradeManager.stackResources(
          requiredResources,
          operationDetails.city,
          operationDetails.supplierCities,
          operationDetails.maxShipmentTime,
        );
        // if stackResourcesResult.timeMs is -1, then resources are not fully stacked and it needs to be retried in 10 minutes
        if (stackResourcesResult.arrivalTime === -1 || stackResourcesResult.fullyStacked === false) {
          timeToRetry = 600000;
          retrialTime = Date.now() + 600000;
        } else {
          // time to arrival of all necessary resources (+3s)
          timeToRetry = stackResourcesResult.arrivalTime - Date.now();
          retrialTime = stackResourcesResult.arrivalTime;
        }
      } else {
        timeToRetry = 600000;
        retrialTime = Date.now() + 600000;
        console.log('[Builder]: Retrial time:', retrialTime, new Date(retrialTime));
      }
    }

    // sprawdź czas do przyspieszenia budowy
    const timeToSpeedUp = !(await this.isQueueEmpty(operationDetails.city))
      ? await this.getTimeToCanSpeedUp(operationDetails.city)
          .then(time => time + 3000)
          .catch(() => null)
      : null;

    // jeżeli nie ma czasu do przyspieszenia (brak budynku w kolejce), to sprawdź w czasie określonym przez czas dostawy lub fallback 10 minut
    if (!timeToSpeedUp) {
      operationDetails.setScheduleTimeout(
        async () => await this.handleBuildSchedule(operationDetails),
        retrialTime,
        'execution',
        'resources' /* NOTE: na pewno taki? */,
      );
    } else if (timeToSpeedUp < timeToRetry) {
      /* w przeciwnym razie sprawdź czy timeToSpeedUp jest krótszy od czasu dostawy surowców
    jeżeli tak, to ustaw timeout na przyspieszenie i wywołaj metodę rekurencyjnie
    */
      console.log(
        '[Builder]: TimeToSpeedUp < timeToRetry, setting timeout to speed up first build on:',
        new Date(Date.now() + timeToSpeedUp),
      );
      operationDetails.setScheduleTimeout(
        async () => {
          try {
            await this.lock.performWithLock(
              async () => {
                // this.generalInfo.showInfo('Builder:', `Przyspieszanie budowy w mieście: ${cityQueue.city.name}`);
                await this.speedUpFirstBuild(operationDetails.city);
                if (await resourcesCheckContition()) {
                  await performBuildActionAndCallback();
                } else {
                  await this.handleResourcesStackableFlow(operationDetails, requiredResources, retrialTime);
                }
              },
              {
                manager: 'builder',
                id: operationDetails.id,
                details: 'method: handleResourcesStackableFlow',
                forced: false,
              },
            );
          } catch (e) {
            // if it's not deliberate Lock cancel error, retry whole flow
            if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
              const browserContext = getBrowserExecutionContextInfo();
              console.warn('[Builder]: handleResourcesStackable catch:', e, browserContext, 'retrying the whole flow');
              if (browserContext.visibilityState === 'hidden') {
                performOnDocumentVisibilityReturn(() => this.handleBuildSchedule(operationDetails));
              } else {
                this.handleBuildSchedule(operationDetails);
              }
            }
          }
        },
        Date.now() + timeToSpeedUp,
        'execution',
        'resources',
      );
    } else {
      /* at this point it's known that there are items in the queue, that needs to be constantly checked for speed up and also
      there is waiting element in the virtual queue, that needs to be checked if can be finally added to real queue.
      Also checking time is shorter than time to speed up, so it will be checked first
      */
      console.log(
        '[Builder]: TimeToSpeedUp >= timeToRetry, setting timeout to check resources on:',
        new Date(Date.now() + timeToSpeedUp),
      );
      operationDetails.setScheduleTimeout(
        async () => {
          try {
            await this.lock.performWithLock(
              async () => {
                if (await resourcesCheckContition()) {
                  await performBuildActionAndCallback();
                } else {
                  await this.handleResourcesStackableFlow(operationDetails, requiredResources);
                }
              },
              {
                manager: 'builder',
                id: operationDetails.id,
                details: 'method: handleResourcesStackableFlow',
                forced: false,
              },
            );
          } catch (e) {
            // if it's not deliberate Lock cancel error, retry whole flow
            if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
              const browserContext = getBrowserExecutionContextInfo();
              console.warn('[Builder]: handleResourcesStackable catch:', e, browserContext, 'retrying the whole flow');
              if (browserContext.visibilityState === 'hidden') {
                performOnDocumentVisibilityReturn(() => this.handleBuildSchedule(operationDetails));
              } else {
                this.handleBuildSchedule(operationDetails);
              }
            }
          }
        },
        retrialTime,
        'execution',
        'resources',
      );
    }
  }

  public async getBuildingQueuedOrCurrentLvl(building: Building, city?: CityInfo) {
    await this.goToBuildMode(city);

    const buildingcurrentLvlText = (
      await waitForElementInterval(`${building.elementSelector} ${buildingsSelectors.currentLvl}`, {
        interval: 250,
        retries: 6,
      })
    ).textContent;
    const currentLvl = buildingcurrentLvlText !== 'max' ? Number(buildingcurrentLvlText) : Infinity;
    return currentLvl;
  }

  public async getBuildingCurrentLvl(building: Building, city?: CityInfo) {
    return (
      (await this.getBuildingQueuedOrCurrentLvl(building, city)) -
      document.querySelectorAll(
        `.construction_queue_order_container .item_icon.${building.elementSelector.split('.')[2]}`,
      ).length
    );
  }

  private getEmptySlotsCount() {
    return document.querySelectorAll('.construction_queue_order_container.instant_buy .js-queue-item.empty_slot')
      .length;
  }

  private async untilEmptyslotsAreEqual(emptySlots: number) {
    return new Promise<void>(res => {
      const interval = setInterval(() => {
        if (this.getEmptySlotsCount() === emptySlots) {
          console.log('[Builder]: Empty slots are equal:', emptySlots);
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

  private async handleBuildSchedule(operationDetails: ScheduleOperationDetails<BuilderItemDetails>) {
    console.log('[Builder]: handleBuildSchedule');
    let infoId!: number;
    try {
      await this.lock.performWithLock(
        async () => {
          console.log('[Builder]: Inside operation callback');
          infoId = this.generalInfo.showInfo(
            'Builder:',
            `Obsługa kolejki w mieście: ${operationDetails.city.name}`,
            'info',
          );
          this.clearInternalCitySchedule(operationDetails.city);
          await this.performBuildSchedule(operationDetails);
          delete this.tryCount[operationDetails.city.name];
        },
        {
          manager: 'builder',
          id: operationDetails.id,
          details: 'method: handleBuildSchedule',
          forced: false,
        },
      );
    } catch (e) {
      // if it's not deliberate Lock cancelation, retry the whole flow
      if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
        const browserContext = getBrowserExecutionContextInfo();
        console.warn(`[Builder]: handleBuildSchedule catch:`, e, operationDetails.itemDetails, browserContext);
        const cityName = operationDetails.city.name;
        this.tryCount[cityName] = (this.tryCount[cityName] ?? 0) + 1;
        if (this.tryCount[cityName] < 3) {
          console.warn(`[Builder]: retry count ${this.tryCount[cityName]}`);
          if (browserContext.visibilityState === 'hidden') {
            performOnDocumentVisibilityReturn(() => this.handleBuildSchedule(operationDetails));
          } else {
            this.handleBuildSchedule(operationDetails);
          }
        } else {
          delete this.tryCount[cityName];
          console.warn(`[Builder]: retry limit exceeded, removing item:`, operationDetails.itemDetails);
          operationDetails.shiftQueueAndNext();
        }
      }
    } finally {
      console.log('[Builder]: handleBuildSchedule finally block for city:', operationDetails.city.name);
      this.generalInfo.hideInfo(infoId);
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
      console.warn('[Builder]: Element in the queue:', el?.querySelector('.item_icon')?.classList[2]);
      console.warn(
        '[Builder]: Element in the queue time:',
        el?.querySelector('.countdown.js-item-countdown')?.textContent,
      );
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
    const element = await waitForElementInterval(building.elementSelector, { interval: 150, retries: 13 }).catch(
      () => null,
    );
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
    console.log('[Builder]: areResourcesStackable');
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
      console.warn('[Builder]: No popup content found, had to try 4 times. Returning false');
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

    console.log(`[Builder]: Resource requirements:
      - Required population: ${requiredPopulation}
      - Current population: ${this.resourceManager.getPopulation()}
      - Store capacity: ${await this.resourceManager.getStoreCapacity()}
      - Required wood: ${requiredWood}
      - Required stone: ${requiredStone}
      - Required iron: ${requiredIron}`);

    console.log('[Builder]: Current resources:', resourcesInfo);
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
      console.log('[Builder]: Calculated time to speed up first order:', timeToFirstOrder);
      return timeToFirstOrder;
    }
    console.warn('[Builder]: No item in the queue, throwing error');
    throw new Error('No item in the queue.');
  }

  private async isQueueEmpty(city: CityInfo) {
    await city.switchAction();
    this.goToCityView();
    return new Promise(res => setTimeout(() => res(document.querySelector('.empty_queue')) != null, 0));
  }

  public async getBuildingFinishTime(city: CityInfo, building: Building, lvl: number) {
    await city.switchAction();
    this.goToCityView();
    const queueContainer = await waitForElementInterval('.construction_queue_order_container');
    const queuedElement = Array.from(
      queueContainer.querySelectorAll<HTMLElement>(`.js-queue-item.${building.elementSelector.split('.')[2]}`),
    ).find(el => Number(el.querySelector<HTMLDivElement>('.building_level')!.innerText) === lvl);
    if (queuedElement) {
      triggerHover(queuedElement);
      // format hh:mm:ss
      const timeString = await waitForElementsInterval('.building_queue_item_instant_buy_tooltip .table .row').then(
        arr => arr[1].innerText.match(/\d{2}:\d{2}:\d{2}/)![0],
      );

      // Parse time string and calculate execution time
      const [hours, minutes, seconds] = timeString.split(':').map(Number);
      const now = new Date();
      const targetTime = new Date(now);

      targetTime.setHours(hours, minutes, seconds, 0);

      // If the target time is earlier than or equal to the current time, assume it's for the next day
      if (targetTime <= now) {
        targetTime.setDate(targetTime.getDate() + 1);
      }

      return targetTime.getTime();
    }
  }

  public async start() {
    this.RUN = true;
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.remove('hidden');
  }

  public stop() {
    console.log('[Builder]: Stopping');
    this.RUN = false;
    this.schedule.forEach(cityQueue => {
      if (cityQueue.timeout) {
        clearInterval(cityQueue.timeout);
        clearTimeout(cityQueue.timeout);
        cityQueue.timeout = null;
        cityQueue.executionTime = null;
      }
    });
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.add('hidden');
  }

  public pause() {
    this.RUN = false;
  }
  public resume() {
    this.RUN = true;
  }

  public isRunning() {
    return this.RUN;
  }

  public getScheduledActionTimes() {
    return this.schedule.map(s => [s.executionTime, undefined]).filter(([t1]) => Boolean(t1)) as [number, undefined][];
  }
  public onConfigChange(configChanges: Partial<TConfigChanges['builder']>) {
    // nothing
  }
}
