import { addDelay, getTimeInFuture, textToMs } from "../../../utility/plain-utility";
import Lock from "../../../utility/ui-lock";
import { cancelHover, triggerHover, waitForElement, waitForElementFromNode, waitForElements } from "../../../utility/ui-utility";
import builderCss from './queue.css';
import builderHtml from './builder-prod.html';
import { Building, buildings, buildingsSelectors } from "./buildings";
import ResourceManager from "../../resources/resource-manager";
import CitySwitchManager, { CityInfo } from "../city-switch-manager";

type QueueItem = {
  id: string,
  building: Building,
  toLvl: number
}

type CityQueue = {
  city: CityInfo,
  queue: Array<QueueItem>
  schedule: NodeJS.Timeout | null
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
  private allowUnsequentialBuilds: boolean = false;
  private allowCriticalBuilds: boolean = true;

  private lock!: Lock;
  private resourceManager!: ResourceManager;

  private RUN: boolean = false;

  private mainQueue: Array<CityQueue> = [];


  private constructor() { }

  public static async getInstance(): Promise<CityBuilder> {
    if (!CityBuilder.instance) {
      CityBuilder.instance = new CityBuilder();
      CityBuilder.instance.lock = Lock.getInstance();
      CityBuilder.instance.resourceManager = ResourceManager.getInstance();
      CityBuilder.instance.citySwitchManager = await CitySwitchManager.getInstance();
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
      if (currentCityQueue) {
        this.rerenderQueue(currentCityQueue);
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
        schedule: null
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
      // TODO !!!!!
      return;
    }
    if (timeToSpeedUp <= 0) {
      console.log('\t-will speed up first build immediately');
      const emptySlots = this.getEmptySlotsCount();
      await this.speedUpFirstBuild(cityQueue.city);
      await this.untilEmptyslotsAreEqual(emptySlots + 1);
      await this.performBuildSchedule(cityQueue);
    } else {
      console.log('\t-speed up will be scheduled at:', getTimeInFuture(timeToSpeedUp));
      cityQueue.schedule = setTimeout(async () => {
        try {
          await this.lock.acquire();
          const emptySlots = this.getEmptySlotsCount();
          await this.speedUpFirstBuild(cityQueue.city);
          await this.untilEmptyslotsAreEqual(emptySlots + 1);
          await this.performBuildSchedule(cityQueue);
        } catch (e) {
          console.warn('CityBuilder.performBuildSchedule().catch', e);
        } finally {
          this.lock.release();
        }
      }, timeToSpeedUp);
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
        cityQueue.schedule = setInterval(async () => {
          try {
            await this.lock.acquire();
            if ((await this.resourceManager.hasEnoughResources(resourcesInfo.requiredResources, cityQueue.city)) && (await this.canBuild(building, cityQueue.city))) {
              console.log('\t\t-canBuild is true, building...');
              const emptySlots = this.getEmptySlotsCount();
              await building.buildAction();
              await this.untilEmptyslotsAreEqual(emptySlots - 1);
              await this.shiftQueueCleanScheduleAndTryNext(item, cityQueue);
            }
          } catch (e) {
            console.warn('CityBuilder.checkIfItemCanBeBuiltAndAddDeleteOrSchedule().catch', e);
          } finally {
            this.lock.release();
          }
        }, 1000 * 120);
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
      await this.lock.acquire();
      await this.performBuildSchedule(cityQueue);
    } catch (e) {
      console.warn('CityBuilder.doQueueOperation().catch', e);
    } finally {
      this.lock.release();
    }
  }

  private async speedUpFirstBuild(city: CityInfo) {
    await this.tryGoToBuildMode(city);
    const freeButton = await waitForElement('[data-order_index="0"] .type_free', 2000).catch(() => null);
    if (freeButton) {
      freeButton.click();
    } else {
      throw new Error('No free button found');
    }
  }

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

  private async areResourcesStackable(building: Building, city: CityInfo): Promise<{ areStackable: boolean | 'storage' | 'population' | 'alreadyStacked', requiredResources: { wood: number, stone: number, iron: number } }> {
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
    console.log('popup_div found !!!');
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
      return { areStackable: 'population', requiredResources };
    }
    if ([requiredWood, requiredStone, requiredIron].reduce((acc, curr) => curr > acc ? curr : acc, 0) > resourcesInfo.storeMaxSize) {
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
    const queue = localStorage.getItem('cityBuilderQueue');
    if (queue) {
      this.mainQueue = JSON.parse(queue)
        .map((cityQueue: CityQueue) => {
          const city = this.citySwitchManager.getCityByName(cityQueue.city.name);
          if (!city) {
            return null;
          }
          // actual queue
          const queueItems = cityQueue.queue.map(item => {
            const building = Object.values(buildings).find(building => building.name === item.building.name)!;
            return { ...item, building };
          });
          return { city, queue: queueItems, schedule: null };
        })
        .filter((queue: CityQueue | null) => queue !== null);
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

  public start() {
    this.RUN = true;
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.remove('hidden');
    Object.values(this.mainQueue).forEach(async cityQueue => {
      await this.handleBuildSchedule(cityQueue);
    });
  }


  public stop() {
    console.log('Stopping');
    this.RUN = false;
    this.mainQueue.forEach(cityQueue => {
      if (cityQueue.schedule) {
        clearInterval(cityQueue.schedule);
        clearTimeout(cityQueue.schedule);
        cityQueue.schedule = null;
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


