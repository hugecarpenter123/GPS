import { addDelay, getTimeInFuture, textToMs } from "../../../utility/plain-utility";
import Lock from "../../../utility/ui-lock";
import { cancelHover, triggerHover, waitForElement, waitForElementFromNode, waitForElements } from "../../../utility/ui-utility";
import builderCss from './queue.css';
import builderHtml from './builder-prod.html';
import { Building, buildings, buildingsSelectors } from "./buildings";
import ResourceManager from "../../resources/resource-manager";
import CitySwitchManager, { CityInfo } from "../city-switch-manager";
import GeneralInfo from "../../master/ui/general-info";

type QueueItem = {
  id: string,
  building: Building,
  toLvl: number
}

type CityQueue = {
  city: CityInfo,
  queue: Array<QueueItem>
  schedule: NodeJS.Timeout | null,
  scheduledDate: Date | null
  description?: string
  operation?: 'build' | 'speedUp' | 'buildCheck' | 'speedUpAndCheck'
}

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

  private RUN: boolean = false;

  private mainQueue: Array<CityQueue> = [];


  private constructor() { }

  public static async getInstance(): Promise<CityBuilder> {
    if (!CityBuilder.instance) {
      CityBuilder.instance = new CityBuilder();
      CityBuilder.instance.lock = Lock.getInstance();
      CityBuilder.instance.resourceManager = await ResourceManager.getInstance();
      CityBuilder.instance.citySwitchManager = await CitySwitchManager.getInstance();
      CityBuilder.instance.generalInfo = GeneralInfo.getInstance();
      CityBuilder.instance.addStyle();
      CityBuilder.instance.renderUI();
      CityBuilder.instance.loadQueueFromStorage();
      CityBuilder.instance.listenToCitySwitch();
    }
    return CityBuilder.instance;
  }
  private renderUI() {
    const container = document.createElement('div');
    container.innerHTML = builderHtml;
    document.body.appendChild(container);
    this.addBuildButtons();
    this.initToggleButtonEvents();
  }
  private initToggleButtonEvents() {
    const button = document.getElementById(CityBuilder.toggleBuilderButtonId)!;

    button.addEventListener('click', () => {
      const buildContainer = document.getElementById(CityBuilder.buildContainerId)!;
      buildContainer.classList.toggle('hidden');
      if (!buildContainer.classList.contains('hidden')) {
        this.tryGoToBuildMode('current');
      } else {
        this.tryExitBuildMode();
      }
    });
  }

  private listenToCitySwitch() {
    this.citySwitchManager.on('cityChange', (city: CityInfo) => {
      const currentCityQueue = this.mainQueue.find(queue => queue.city === city);
      this.rerenderQueue(currentCityQueue);
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

  private addBuildButtons() {
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
        this.onOptionBuildButtonClick(building);
      });
    });
  }

  /**
   * Switches to the given city (if provided else assumes that current city is already switched) and clicks on the build mode button.
   * @param city 
   */
  private async tryGoToBuildMode(city: CityInfo | 'current') {
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

  private onOptionBuildButtonClick(building: Building) {
    const currentCity = this.citySwitchManager.getCurrentCity()!;
    let currentCityQueue = this.mainQueue.find((queueObj) => queueObj.city.name === currentCity.name);
    if (!currentCityQueue) {
      currentCityQueue = {
        city: currentCity,
        queue: [],
        schedule: null,
        scheduledDate: null
      };
      this.mainQueue.push(currentCityQueue);
    }
    this.addToQueue(building, currentCityQueue);
  }

  /**
   * Tworzy element DOM przedstawiający element kolejki i zwraca go.
   * @param building 
   * @returns 
   */
  private addBuldingToUIQueue(queueItem: QueueItem, position: 'start' | 'end' = 'end', cityQueue: CityQueue) {
    const additionalQueue = document.getElementById('additional-queue')!;
    const queueItemEl = document.createElement('div');
    queueItemEl.className = CityBuilder.queueItemClass;
    queueItemEl.style.backgroundImage = queueItem.building.backgroundImageProp;
    queueItemEl.setAttribute('data-id', queueItem.id);
    position === 'start' ? this.appendChildAtIndex(additionalQueue, queueItemEl, 0) : additionalQueue.appendChild(queueItemEl);

    // <div class="up">+1</div>
    const upButton = document.createElement('div');
    upButton.className = CityBuilder.upButtonClass;
    upButton.textContent = `+${queueItem.toLvl}`;

    queueItemEl.appendChild(upButton);

    // <div class="cancel">&#x2715;</div>
    const cancelButton = document.createElement('div');
    cancelButton.className = CityBuilder.cancelButtonClass;
    cancelButton.innerHTML = '&#x2715;';
    queueItemEl.appendChild(cancelButton);
    cancelButton.addEventListener('click', () => {
      const index = cityQueue.queue.findIndex(item => item.id === queueItem.id);
      if (index !== -1) {
        if (index === 0) {
          cityQueue.queue.shift();
          if (cityQueue.schedule) {
            clearInterval(cityQueue.schedule);
            clearTimeout(cityQueue.schedule);
            cityQueue.schedule = null;
            cityQueue.scheduledDate = null;
          }
          this.revalidateQueueItemLevels(queueItem.building, index, cityQueue);
          this.handleBuildSchedule(cityQueue);
        }
        else {
          cityQueue.queue.splice(index, 1);
          this.revalidateQueueItemLevels(queueItem.building, index, cityQueue);
        }
        queueItemEl.remove();
        this.saveQueueToStorage();
      } else {
        console.log('Item not found in queue');
      }
    });
    console.log('queueItemEl', queueItemEl);
    return queueItemEl;
  }

  public revalidateQueueItemLevels(building: Building, fromIndex: number, cityQueue: CityQueue) {
    console.log('--------revalidateQueueItemLevels', building, fromIndex);
    const itemsToRevalidate = cityQueue.queue.filter((item, index) => index >= fromIndex && item.building.name === building.name);
    itemsToRevalidate.forEach((item) => {
      const newToLvl = item.toLvl - 1;
      const newId = `${item.building.name}-${newToLvl}`;
      const queueItemEl = document.querySelector(`[data-id="${item.id}"]`);
      if (queueItemEl) {
        queueItemEl.querySelector('.up')!.textContent = `+${newToLvl}`;
        queueItemEl.setAttribute('data-id', newId);
      }
      item.toLvl = newToLvl;
      item.id = newId;
    });
  }

  private async addToQueue(building: Building, cityQueue: CityQueue) {
    await this.tryGoToBuildMode('current');
    let currentLvl!: number;
    const buildingElement = await waitForElement(building.elementSelector, 1000).catch(() => null);
    if (buildingElement) {
      const buildingcurrentLvlText = await waitForElement(`${building.elementSelector} ${buildingsSelectors.currentLvl}`, 1000)
        .then(el => el.textContent)
        .catch(() => null);
      currentLvl = (buildingcurrentLvlText !== 'max' || buildingcurrentLvlText !== null) ? Number(buildingcurrentLvlText) : Infinity;
    } else {
      currentLvl = 0;
    }

    if (currentLvl === Infinity) {
      return;
    }

    const lvlCounter = cityQueue.queue.filter(item => item.building.name === building.name).length + 1;
    const id = `${building.name}-${currentLvl + lvlCounter}`;
    const queueItem = { id, building, toLvl: currentLvl + lvlCounter };
    console.log('queueItem', queueItem);

    this.addBuldingToUIQueue(queueItem, 'end', cityQueue);
    cityQueue.queue.push(queueItem);
    this.saveQueueToStorage();
    console.log('pushed to queue:', JSON.parse(JSON.stringify(cityQueue.queue)));
    this.buildOrSchedule(cityQueue);
  }

  private async buildOrSchedule(cityQueue: CityQueue) {
    if (cityQueue.queue.length === 1) {
      console.log('\t-queue has only one item, handling immediately');
      if (cityQueue.schedule) {
        clearInterval(cityQueue.schedule);
        clearTimeout(cityQueue.schedule);
        cityQueue.schedule = null;
        cityQueue.scheduledDate = null;
      }
      await this.handleBuildSchedule(cityQueue);
    } else {
      console.log('\t-queue has more than one item, waiting for its turn');
    }
  }

  private async performBuildSchedule(cityQueue: CityQueue) {
    if (!cityQueue || !cityQueue.queue.length) {
      if (!(await this.isQueueEmpty(cityQueue.city))) {
        await this.setTimeoutForNextSpeedUpAndSchedule(cityQueue);
      }
      return;
    }

    console.log('performBuildSchedule with queue:', JSON.parse(JSON.stringify(cityQueue.queue)));
    if (await this.isEmptySlot(cityQueue.city)) {
      const item = cityQueue.queue[0];
      await this.checkIfItemCanBeBuiltAndAddDeleteOrSchedule(cityQueue, item);
    } else {
      await this.setTimeoutForNextSpeedUpAndSchedule(cityQueue);
    }
  }

  private async setTimeoutForNextSpeedUpAndSchedule(cityQueue: CityQueue) {
    const timeToSpeedUp = await this.getTimeToCanSpeedUp(cityQueue.city).catch(() => null);
    if (timeToSpeedUp === null) {
      console.log('\t-timeToSpeedUp is null, performing build schedule');
      await this.performBuildSchedule(cityQueue);
      return;
    }
    if (timeToSpeedUp <= 0) {
      console.log('\t-will speed up first build immediately');
      await this.speedUpFirstBuild(cityQueue.city);
      await this.performBuildSchedule(cityQueue);
    } else {
      console.log('\t-speed up will be scheduled at:', getTimeInFuture(timeToSpeedUp));
      cityQueue.schedule = setTimeout(async () => {
        try {
          await this.lock.acquire({ method: cityQueue.city.name + ' - setTimeoutForNextSpeedUpAndSchedule (inside timeout)', manager: 'builder' });
          await this.speedUpFirstBuild(cityQueue.city);
          await this.performBuildSchedule(cityQueue);
        } catch (e) {
          console.warn('CityBuilder.setTimeoutForNextSpeedUpAndSchedule().catch', e);
          console.log('\t-retrying setTimeoutForNextSpeedUpAndSchedule');
          this.setTimeoutForNextSpeedUpAndSchedule(cityQueue);
        } finally {
          cityQueue.description = undefined;
          cityQueue.operation = undefined;
          console.log('mainQueue:', JSON.parse(JSON.stringify(this.mainQueue)));
          this.lock.release();
        }
      }, timeToSpeedUp);
      cityQueue.scheduledDate = new Date(Date.now() + timeToSpeedUp);
      cityQueue.description = 'Waiting for speed up';
      cityQueue.operation = 'speedUp';
      console.log('mainQueue:', JSON.parse(JSON.stringify(this.mainQueue)));
    }
  }

  private async checkIfItemCanBeBuiltAndAddDeleteOrSchedule(cityQueue: CityQueue, item: QueueItem, forced: boolean = false) {
    const building = item.building;

    console.log('check if can build item:', item);
    const canBuild = await this.canBuild(building, cityQueue.city);
    console.log('\t-canBuild:', canBuild);
    if (canBuild === true) {
      console.log('\t-canBuild is true, building...');
      const emptySlots = this.getEmptySlotsCount();
      await building.buildAction();
      await this.untilEmptyslotsAreEqual(emptySlots - 1);
      await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
    }
    else if (canBuild === 'maxed') {
      console.log('\t-canBuild is maxed or not possible at the moment, shifting queue');
      if (forced) {
        this.clearUIQueueItem(cityQueue.queue[1]);
        cityQueue.queue.splice(1, 1);
        await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
      } else {
        await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
      }
    }
    else if (canBuild === 'impossible') {
      if (!(await this.isQueueEmpty(cityQueue.city))) {
        console.log('\t-canBuild is impossible, but queue is not empty, scheduling build because maybe after that it will be possible');
        await this.setTimeoutForNextSpeedUpAndSchedule(cityQueue);
      } else {
        console.log('\t-canBuild is impossible, and queue is empty, element must be deleted');
        await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
      }
    }
    else {
      const resourcesInfo = await this.areResourcesStackable(building, cityQueue.city);
      if (resourcesInfo.areStackable === true) {
        console.log('\t-areResourcesStackable is true, scheduling build');
        // // safe, but not perfect solution
        // cityQueue.schedule = setInterval(async () => {
        //   try {
        //     cityQueue.scheduledDate = new Date(Date.now() + CityBuilder.BUILD_RETRY_INTERVAL);
        //     await this.lock.acquire({ method: cityQueue.city.name + ' - checkIfItemCanBeBuiltAndAddDeleteOrSchedule (inside interval)', manager: 'builder' });
        //     if ((await this.resourceManager.hasEnoughResources(resourcesInfo.requiredResources, cityQueue.city)) && (await this.canBuild(building, cityQueue.city))) {
        //       console.log('\t\t-canBuild is true, building...');
        //       const emptySlots = this.getEmptySlotsCount();
        //       await building.buildAction();
        //       await this.untilEmptyslotsAreEqual(emptySlots - 1);
        //       await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
        //     }
        //   } catch (e) {
        //     console.warn('CityBuilder.checkIfItemCanBeBuiltAndAddDeleteOrSchedule().catch', e);
        //   } finally {
        //     this.lock.release();
        //   }
        // }, CityBuilder.BUILD_RETRY_INTERVAL);
        // cityQueue.scheduledDate = new Date(Date.now() + CityBuilder.BUILD_RETRY_INTERVAL);
        await this.handleResourcesStackableFlow(building, cityQueue, resourcesInfo.requiredResources, item);
      }
      else if (resourcesInfo.areStackable === 'population' && this.allowCriticalBuilds) {
        console.log('\t\t-areResourcesStackable is population, adding farm to queue');
        const farm = buildings.farm;
        const buildingLvl = await this.getBuildingCurrentLvl(farm);
        const id = `${farm.name}-${buildingLvl}`;
        const queueItem = { id, building, toLvl: buildingLvl + 1 };
        cityQueue.queue.unshift(queueItem);
        this.addBuldingToUIQueue(queueItem, 'start', cityQueue);
        await this.performBuildSchedule(cityQueue);
      }
      else if (resourcesInfo.areStackable === 'storage' && this.allowCriticalBuilds) {
        console.log('\t\t-areResourcesStackable is storage, adding storage to queue');
        const storage = buildings.storage;
        const buildingLvl = await this.getBuildingCurrentLvl(storage);
        const id = `${storage.name}-${buildingLvl}`;
        const queueItem = { id, building, toLvl: buildingLvl + 1 };
        cityQueue.queue.unshift(queueItem);
        this.addBuldingToUIQueue(queueItem, 'start', cityQueue);
        await this.performBuildSchedule(cityQueue);
      } else if (resourcesInfo.areStackable === 'alreadyStacked' && !(await this.isQueueEmpty(cityQueue.city))) {
        console.log('\t\t-areResourcesStackable is alreadyStacked, scheduling build');
        await this.setTimeoutForNextSpeedUpAndSchedule(cityQueue);
      } else {
        console.log('Item cannot be scheduled, because it has not met requirements');
        await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
      }
    }
  }

  private async handleResourcesStackableFlow(
    building: Building,
    cityQueue: CityQueue,
    requiredResources: { wood: number, stone: number, iron: number },
    item: QueueItem
  ) {
    /**
     * Checks if there are enough resources to build the building.
     * @requires Lock
     * @returns boolean
     */
    const resourcesCheckContition = async () => {
      return (await this.resourceManager.hasEnoughResources(requiredResources, cityQueue.city))
    }
    /**
     * Builds the building if possible or else deletes item from queue
     * @requires Lock
     */
    const performBuildAction = async () => {
      if ((await this.canBuild(building, cityQueue.city)) === true) {
        const emptySlots = this.getEmptySlotsCount();
        await building.buildAction();
        await this.untilEmptyslotsAreEqual(emptySlots - 1);
        await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
      } else {
        // it shouldn't happen, but if at this point canBuild is false or maxed or impossible then delete item from queue because it will block the queue permamently
        await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
      }
    }

    // sprawdź czas do przyspieszenia budowy
    const timeToSpeedUp = !(await this.isQueueEmpty(cityQueue.city)) ?
      await this.getTimeToCanSpeedUp(cityQueue.city).catch(() => null) :
      null;

    // jeżeli nie ma czasu do przyspieszenia (brak budowy w kolejce), to sprawdzaj czy można zbudować w standardowym interwale
    if (!timeToSpeedUp) {
      cityQueue.schedule = setInterval(async () => {
        try {
          cityQueue.scheduledDate = new Date(Date.now() + CityBuilder.BUILD_RETRY_INTERVAL);
          await this.lock.acquire({ method: cityQueue.city.name + ' - checkIfItemCanBeBuiltAndAddDeleteOrSchedule (inside interval)', manager: 'builder' });
          if (await resourcesCheckContition()) {
            await performBuildAction();
          }
        } catch (e) {
          console.warn('CityBuilder.handleResourcesStackable().catch', e);
        } finally {
          this.lock.release();
        }
      }, CityBuilder.BUILD_RETRY_INTERVAL);
      cityQueue.scheduledDate = new Date(Date.now() + CityBuilder.BUILD_RETRY_INTERVAL);
      return
    }
    /* w przeciwnym razie sprawdź czy timeToSpeedUp jest krótszy od standardowego interwału
    jeżeli tak, to ustaw timeout na przyspieszenie i wywołaj metodę rekurencyjnie
    */
    if (timeToSpeedUp < CityBuilder.BUILD_RETRY_INTERVAL) {
      cityQueue.schedule = setTimeout(async () => {
        try {
          await this.lock.acquire({ method: cityQueue.city.name + ' - handleResourcesStackable (inside checking timeout)', manager: 'builder' });
          // this.generalInfo.showInfo('Builder:', `Przyspieszanie budowy w mieście: ${cityQueue.city.name}`);
          await this.speedUpFirstBuild(cityQueue.city);
          if (await resourcesCheckContition()) {
            await performBuildAction();
          } else {
            await this.handleResourcesStackableFlow(building, cityQueue, requiredResources, item);
          }
        } catch (e) {
          console.warn('CityBuilder.handleResourcesStackable().catch', e);
        } finally {
          cityQueue.description = undefined;
          cityQueue.operation = undefined;
          console.log('mainQueue:', JSON.parse(JSON.stringify(this.mainQueue)));
          this.lock.release();
        }
      }, timeToSpeedUp);
      cityQueue.scheduledDate = new Date(Date.now() + timeToSpeedUp);
      cityQueue.description = 'Speeding up first build, then checking if can build, else comparing times for next schedule';
      cityQueue.operation = 'speedUpAndCheck';
      console.log('mainQueue:', JSON.parse(JSON.stringify(this.mainQueue)));
    } else {
      /* at this point it's known that there are items in the queue, that needs to be constantly checked for speed up and also
      there is waiting element in the virtual queue, that needs to be checked if can be finally added to real queue.
      Also checking interval is shortter than time to speed up, so it will be checked first
      */
      cityQueue.schedule = setTimeout(async () => {
        try {
          await this.lock.acquire({ method: cityQueue.city.name + ' - handleResourcesStackable (inside checking timeout)', manager: 'builder' });
          if (await resourcesCheckContition()) {
            await performBuildAction();
          } else {
            await this.handleResourcesStackableFlow(building, cityQueue, requiredResources, item);
          }
        } catch (e) {
          console.warn('CityBuilder.handleResourcesStackable().catch', e);
        } finally {
          cityQueue.description = undefined;
          cityQueue.operation = undefined;
          console.log('mainQueue:', JSON.parse(JSON.stringify(this.mainQueue)));
          this.lock.release();
        }
      }, CityBuilder.BUILD_RETRY_INTERVAL);
      cityQueue.scheduledDate = new Date(Date.now() + CityBuilder.BUILD_RETRY_INTERVAL);
      cityQueue.description = 'Checking if can build, then checking if next speed up time is shorter than standard interval';
      cityQueue.operation = 'buildCheck';
      console.log('mainQueue:', JSON.parse(JSON.stringify(this.mainQueue)));
    }
  }

  private async getBuildingCurrentLvl(building: Building) {
    const buildingcurrentLvlText = (await waitForElement(`${building.elementSelector} ${buildingsSelectors.currentLvl}`)).textContent;
    const currentLvl = buildingcurrentLvlText !== 'max' ? Number(buildingcurrentLvlText) : Infinity;
    return currentLvl;
  }

  private clearUIQueueItem(item: QueueItem) {
    const queueItemEl = document.querySelector(`[data-id="${item.id}"]`);
    if (queueItemEl) {
      queueItemEl.remove();
    }
  }

  private getEmptySlotsCount() {
    return document.querySelectorAll('.construction_queue_order_container.instant_buy .js-queue-item.empty_slot').length;
  }


  private async untilEmptyslotsAreEqual(emptySlots: number) {
    return new Promise<void>((res) => {
      const interval = setInterval(() => {
        if (this.getEmptySlotsCount() === emptySlots) {
          console.log('\t-emptyslotsAreEqual:', emptySlots);
          clearInterval(interval);
          res();
        }
      }, 333);
    });
  }

  private async shiftQueueCleanScheduleAndTryNext(item: QueueItem, cityQueue: CityQueue) {
    cityQueue.queue.shift();
    this.saveQueueToStorage();
    if (cityQueue.schedule) {
      clearInterval(cityQueue.schedule);
      clearTimeout(cityQueue.schedule);
      cityQueue.schedule = null;
      cityQueue.scheduledDate = null;
    }
    this.clearUIQueueItem(item);
    await this.performBuildSchedule(cityQueue);
  }

  private goToCityView() {
    const cityViewBtn = document.querySelector<HTMLDivElement>('[name="city_overview"]');
    cityViewBtn?.click();
  }

  private async handleBuildSchedule(cityQueue: CityQueue) {
    try {
      await this.lock.acquire({ method: cityQueue.city.name + ' - handleBuildSchedule', manager: 'builder' });
      this.generalInfo.showInfo('Builder:', `Obsługa kolejki w mieście: ${cityQueue.city.name}`);
      await this.performBuildSchedule(cityQueue);
    } catch (e) {
      console.warn('CityBuilder.doQueueOperation().catch', e);
    } finally {
      console.log('handleBuildSchedule, release lock', cityQueue.city.name);
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
    await this.tryGoToBuildMode(city);
    const freeButton = await waitForElement('[data-order_index="0"] .type_free', 2000).catch(() => null);
    if (freeButton) {
      const emptySlotsSnapshot = this.getEmptySlotsCount();
      freeButton.click();
      await this.untilEmptyslotsAreEqual(emptySlotsSnapshot + 1);
    } else {
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
    await this.tryGoToBuildMode(city);
    const element = await waitForElement(building.elementSelector, 2000).catch(() => null);
    if (!element) {
      return 'impossible';
    }
    const buildButton = await waitForElement(`${building.elementSelector} ${buildingsSelectors.buildButton}`, 1000).catch(() => null);
    if (!buildButton) {
      return 'maxed';
    }
    const canBuild = !buildButton.classList.contains(buildingsSelectors.disabled);
    return canBuild;
  }

  private async areResourcesStackable(building: Building, city: CityInfo): Promise<{ areStackable: boolean | 'storage' | 'population' | 'alreadyStacked' | 'waiting', requiredResources: { wood: number, stone: number, iron: number } }> {
    console.log('areResourcesStackable');
    await this.tryGoToBuildMode(city);
    // const buildButton = await waitForElement(`${building.elementSelector} ${buildingsSelectors.buildButton}`);
    let counter = 0;
    do {
      triggerHover(document.querySelector(`${building.elementSelector} ${buildingsSelectors.buildButton}`)!);
      await addDelay(333);
      counter++;
    } while (!(await waitForElement('#popup_div img[src*="images/game/res/wood.png"]', 500).catch(() => false)) && counter < 4);
    if (counter === 4) {
      console.warn('No popup content found, had to try 4 times. Returning false');
      return { areStackable: false, requiredResources: { wood: 0, stone: 0, iron: 0 } };
    }

    const requiredWood = Number((await waitForElement('#popup_div img[src*="images/game/res/wood.png"]', 3000)).nextSibling!.textContent!);
    const requiredStone = Number((await waitForElement('#popup_div img[src*="images/game/res/stone.png"]', 0)).nextSibling!.textContent!);
    const requiredIron = Number((await waitForElement('#popup_div img[src*="images/game/res/iron.png"]', 0)).nextSibling!.textContent!);
    const requiredPopulation = Number((await waitForElement('#popup_div img[src*="images/game/res/pop.png"]', 0)).nextSibling!.textContent!);
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
    if (requiredPopulation > (resourcesInfo.population.amount)) {
      /* jeżeli farma już jest w kolejce, to być może po jej skończeniu budynek właściwy będzie mógł być zbudowany
      w przeciwnym razie builder będzie kolejkował farmę w nieskończoność */
      if (await this.isBuildingInRealQueue(building)) {
        return { areStackable: 'waiting', requiredResources };
      }
      return { areStackable: 'population', requiredResources };
    }
    if ([requiredWood, requiredStone, requiredIron].reduce((acc, curr) => curr > acc ? curr : acc, 0) > resourcesInfo.storeMaxSize) {
      /* jeżeli magazyn już jest w kolejce, to być może po jego skończeniu budynek właściwy będzie mógł być zbudowany
      w przeciwnym razie builder będzie kolejkował magazyn w nieskończoność */
      if (await this.isBuildingInRealQueue(building)) {
        return { areStackable: 'waiting', requiredResources };
      }
      return { areStackable: 'storage', requiredResources };
    }
    if (requiredWood <= (resourcesInfo).wood.amount &&
      requiredStone <= (resourcesInfo).stone.amount &&
      requiredIron <= (resourcesInfo).iron.amount &&
      requiredPopulation <= (resourcesInfo).population.amount
    ) {
      return { areStackable: 'alreadyStacked', requiredResources };
    }
    return { areStackable: true, requiredResources }
  };

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
    this.goToCityView()
    await city.switchAction();
    await addDelay(1000);
    return await waitForElement('.construction_queue_order_container.instant_buy .js-queue-item.empty_slot', 1000)
      .then(() => true)
      .catch(() => false);
  }

  private async getTimeToCanSpeedUp(city: CityInfo): Promise<number> {
    this.goToCityView();
    await city.switchAction();
    await addDelay(1000);
    const firstOrder = await waitForElement('[data-order_index="0"] .countdown.js-item-countdown', 3000).catch(() => null);
    if (firstOrder) {
      return textToMs(firstOrder.textContent!) - 5 * 60 * 1000;
    }
    throw new Error('No item in the queue.')
  }

  private loadQueueFromStorage() {
    this.mainQueue = this.citySwitchManager.getCityList().map((cityInfo) => ({
      city: cityInfo,
      queue: [],
      schedule: null,
      scheduledDate: null
    }));

    const storageQueue = localStorage.getItem('cityBuilderQueue');
    if (storageQueue) {
      JSON.parse(storageQueue)
        .forEach((cityQueue: CityQueue) => {
          const city = this.citySwitchManager.getCityByName(cityQueue.city.name);
          if (!city) {
            return;
          }
          // actual queue
          const queueItems = cityQueue.queue.map(item => {
            const building = Object.values(buildings).find(building => building.name === item.building.name)!;
            return { ...item, building };
          });
          this.mainQueue.find(queue => queue.city === city)!.queue = queueItems;
        })
    }

    const currentCity = this.citySwitchManager.getCurrentCity();
    const currentCityQueue = this.mainQueue.find(queue => queue.city === currentCity);
    if (currentCityQueue) {
      currentCityQueue.queue.forEach(item => {
        this.addBuldingToUIQueue(item, 'end', currentCityQueue);
      });
    }
  }

  private saveQueueToStorage() {
    localStorage.setItem('cityBuilderQueue', JSON.stringify(this.mainQueue));
  }

  private async isQueueEmpty(city: CityInfo) {
    await city.switchAction();
    this.goToCityView();
    return new Promise((res) => setTimeout(() => res(document.querySelector('.empty_queue')) != null, 0));
  }

  public async start() {
    this.RUN = true;
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.remove('hidden');
    for (const cityQueue of this.mainQueue) {
      await this.handleBuildSchedule(cityQueue);
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

  private appendChildAtIndex(additionalQueue: HTMLElement, queueItemEl: HTMLDivElement, index: number) {
    additionalQueue.insertBefore(queueItemEl, additionalQueue.children[index]);
  }

  private rerenderQueue(cityQueue?: CityQueue) {
    document.getElementById('additional-queue')!.innerHTML = '';
    if (cityQueue) {
      cityQueue.queue.forEach(item => {
        this.addBuldingToUIQueue(item, 'end', cityQueue);
      });
    }
  }
}


