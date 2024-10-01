import { addDelay, getTimeInFuture, textToMs } from "../../../utility/plain-utility";
import Lock from "../../../utility/ui-lock";
import { cancelHover, triggerHover, waitForElement, waitForElementFromNode, waitForElements } from "../../../utility/ui-utility";
import builderCss from './queue.css';
import builderHtml from './builder-prod.html';
import { Building, buildings, buildingsSelectors } from "./buildings";
import ResourceManager from "../../resources/resource-manager";


type BuildingId = '#building_main_main' | '#building_main_hide'
  | '#building_main_lumber' | '#building_main_stoner' | '#building_main_ironer'
  | '#building_main_market' | '#building_main_docks' | '#building_main_barracks'
  | '#building_main_wall' | '#building_main_storage' | '#building_main_farm'
  | '#building_main_academy' | '#building_main_temple'

type QueueItem = {
  id: string,
  building: Building,
  toLvl: number
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
  private allowUnsequentialBuilds: boolean = false;
  private allowCriticalBuilds: boolean = true;

  private observer: MutationObserver | null = null;
  private lock!: Lock;
  private resourceManager!: ResourceManager;
  private buildSchedule: NodeJS.Timeout | null = null;
  
  private speedUpSchedule: { timeout: NodeJS.Timeout, promise: Promise<void> } | null = null;
  private RUN: boolean = false;
  private queue: Array<QueueItem> = [];
  private constructor() { }

  public static getInstance(): CityBuilder {
    if (!CityBuilder.instance) {
      CityBuilder.instance = new CityBuilder();
      CityBuilder.instance.lock = Lock.getInstance();
      CityBuilder.instance.resourceManager = ResourceManager.getInstance();
      CityBuilder.instance.loadQueueFromStorage();
      CityBuilder.instance.addStyle();
      CityBuilder.instance.renderUI();
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
        this.tryGoToBuildMode();
      } else {
        this.tryExitBuildMode();
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

  private writeToStorage() {
    localStorage.setItem('cityBuilderQueue', JSON.stringify(this.queue));
  }

  private readFromStorage() {
    const queue = localStorage.getItem('cityBuilderQueue');
    if (queue) {
      this.queue = JSON.parse(queue);
    }
  }

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

  private async tryGoToBuildMode() {
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
    this.addToQueue(building);
  }

  /**
   * Tworzy element DOM przedstawiający element kolejki i zwraca go.
   * @param building 
   * @returns 
   */
  private addBuldingToUIQueue(queueItem: QueueItem, position: 'start' | 'end' = 'end') {
    const additionalQueue = document.getElementById('additional-queue')!;
    const queueItemEl = document.createElement('div');
    queueItemEl.className = CityBuilder.queueItemClass;
    queueItemEl.style.backgroundImage = queueItem.building.backgroundImageProp;
    queueItemEl.setAttribute('data-id', queueItem.id);
    position === 'start' ? appendChildAtIndex(additionalQueue, queueItemEl, 0) : additionalQueue.appendChild(queueItemEl);

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
      const index = this.queue.findIndex(item => item.id === queueItem.id);
      if (index !== -1) {
        if (index === 0) {
          this.queue.shift();
          if (this.buildSchedule) {
            clearInterval(this.buildSchedule);
            clearTimeout(this.buildSchedule);
            this.buildSchedule = null;
          }
          this.revalidateQueueItemLevels(queueItem.building, index);
          this.tryScheduleNextBuild();
        }
        else {
          this.queue.splice(index, 1);
          this.revalidateQueueItemLevels(queueItem.building, index);
        }
        queueItemEl.remove();
      } else {
        console.log('Item not found in queue');
      }
    });
    console.log('queueItemEl', queueItemEl);
    return queueItemEl;
  }

  public revalidateQueueItemLevels(building: Building, fromIndex: number) {
    console.log('--------revalidateQueueItemLevels', building, fromIndex);
    const itemsToRevalidate = this.queue.filter((item, index) => index >= fromIndex && item.building.name === building.name);
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

  private async addToQueue(building: Building) {
    console.log('addToQueue', building);
    await this.tryGoToBuildMode();

    const buildingcurrentLvlText = (await waitForElement(`${building.elementSelector} ${buildingsSelectors.currentLvl}`)).textContent;
    const currentLvl = buildingcurrentLvlText !== 'max' ? Number(buildingcurrentLvlText) : Infinity;
    if (currentLvl === Infinity) {
      return;
    }

    const lvlCounter = this.queue.filter(item => item.building.name === building.name).length + 1;
    const id = `${building.name}-${currentLvl + lvlCounter}`;
    const queueItem = { id, building, toLvl: currentLvl + lvlCounter };
    console.log('queueItem', queueItem);

    this.addBuldingToUIQueue(queueItem);
    this.queue.push(queueItem);
    console.log('pushed to queue:', this.queue);
    this.tryAddToRealQueueOrSchedule();
  }

  private tryAddToRealQueueOrSchedule() {
    console.log('tryAddToRealQueueOrSchedule', this.queue);
    if (this.queue.length === 1) {
      console.log('queue length is 1, performing build schedule');
      this.performBuildSchedule();
    }
    else {
      if (this.allowUnsequentialBuilds) {
        const newestItem = this.queue[this.queue.length - 1];
        this.tryAddToRealQueue(newestItem);
      } else {
        console.log('queue length is not 1, but unsequential builds are not allowed, another element waits for its turn');
      }
    }
  }

  private async tryAddToRealQueue(item: QueueItem) {
    console.log('tryAddToRealQueue', item);
    if (await this.isEmptySlot() && await this.canBuild(item.building)) {
      console.log('can build, adding to real queue');
      await item.building.buildAction();
      this.clearUIQueueItem(item);
    } else {
      // wait for the scheduler to take up this item and handle it
      console.log('cannot build, waiting for the scheduler to take up this item and handle it');
    }
  }

  private async performBuildSchedule() {
    // get first item from queue
    const item = this.queue[0];
    const building = item.building;
    console.log('performBuildSchedule, with item:', item);

    // if there is an empty slot, try to build
    if (await this.isEmptySlot()) {
      console.log('\t-there is an empty slot, trying to build');
      this.checkIfItemCanBeBuiltAndAddDeleteOrSchedule(building, item);
    } else {
      this.setTimeoutForNextSpeedUpAndSchedule();
    }
  }

  private async setTimeoutForNextSpeedUpAndSchedule() {
    const timeToSpeedUp = await this.getTimeToCanSpeedUp();
    if (timeToSpeedUp <= 0) {
      console.log('\t-will speed up first build immediately');
      await this.speedUpFirstBuild();
      this.performBuildSchedule();
    } else {
      console.log('\t-speed up will be scheduled at:', getTimeInFuture(timeToSpeedUp));
      this.buildSchedule = setTimeout(async () => {
        await this.speedUpFirstBuild();
        this.performBuildSchedule();
      }, timeToSpeedUp);
    }
  }

  private async trySpeedUpFirstBuildOrSchedule() {
    console.log('trySpeedUpFirstBuildOrSchedule')
    if (!this.speedUpSchedule) {
      console.log('\t-speedUpSchedule does not exist, creating new one');
      await addDelay(1000);
      const timeToSpeedUp = await this.getTimeToCanSpeedUp();
      console.log('\t-timeToSpeedUp:', timeToSpeedUp);
      if (timeToSpeedUp <= 0) {
        console.log('\t-will speed up first build immediately');
        await this.speedUpFirstBuild();
        await addDelay(1000);
      } else {
        console.log('\t-speed up will be scheduled');
        let timeout!: NodeJS.Timeout;
        const promise = new Promise<void>(async (res) => {
          timeout = setTimeout(async () => {
            await this.speedUpFirstBuild();
            await addDelay(1000);
            res();
            console.log('\t\t-speedUpFirstBuild finished, clearing speedUpSchedule');
            this.speedUpSchedule = null;
          }, timeToSpeedUp);
        });
        this.speedUpSchedule = { timeout, promise };
      }
    } else {
      console.log('\t-but speedup is already scheduled, do nothing...');
    }
  }

  private async checkIfItemCanBeBuiltAndAddDeleteOrSchedule(building: Building, item: QueueItem, forced: boolean = false) {
    console.log('check if can build item:', item);
    let canBuild = await this.canBuild(building);
    console.log('\t-canBuild:', canBuild);
    if (canBuild === true) {
      console.log('\t-canBuild is true, building...');
      await building.buildAction();
      this.shiftQueueCleanScheduleAndTryNext(item);
    }
    else if (canBuild === 'maxed') {
      console.log('\t-canBuild is maxed, shifting queue');
      if (forced) {
        // TODO: here should remove two first items from queue
      } else {
        this.shiftQueueCleanScheduleAndTryNext(item);
      }
    }
    else {
      const areResourcesStackable = await this.areResourcesStackable(building);
      if (areResourcesStackable === true) {
        console.log('\t-areResourcesStackable is true, scheduling build');
        this.buildSchedule = setInterval(async () => {
          let canBuild = await this.canBuild(building);
          if (canBuild === true) {
            console.log('\t\t-canBuild is true, building...');
            await building.buildAction();
            this.shiftQueueCleanScheduleAndTryNext(item);
          }
        }, 1000 * 30);
      }
      // TODO: !!! IMPORTANT: if farm or magazine needs to be built first, BUT they are already maxed, then infinite loop happens, create 
      // additional flag passed to this function to prevent infinite loops (for example: forced=true) think of something
      else if (areResourcesStackable === 'population' && this.allowCriticalBuilds) {
        console.log('\t\t-areResourcesStackable is population, adding farm to queue');
        const farm = buildings.farm;
        const buildingLvl = await this.getBuildingCurrentLvl(farm);
        const id = `${farm.name}-${buildingLvl}`;
        const queueItem = { id, building, toLvl: buildingLvl + 1 };
        this.queue.unshift(queueItem);
        this.addBuldingToUIQueue(queueItem, 'start');
        this.performBuildSchedule();
      }
      else if (areResourcesStackable === 'storage' && this.allowCriticalBuilds) {
        console.log('\t\t-areResourcesStackable is storage, adding storage to queue');
        const storage = buildings.storage;
        const buildingLvl = await this.getBuildingCurrentLvl(storage);
        const id = `${storage.name}-${buildingLvl}`;
        const queueItem = { id, building, toLvl: buildingLvl + 1 };
        this.queue.unshift(queueItem);
        this.addBuldingToUIQueue(queueItem, 'start');
        this.performBuildSchedule();
      } else if (areResourcesStackable === 'alreadyStacked' && !(await this.isQueueEmpty())) {
        console.log('\t\t-areResourcesStackable is alreadyStacked, scheduling build');
        /*
        Ten warunek upewnia się, że jeżeli w prawdziwej kolejce znajduje się tartak 15, to żeby 
        port mógł być schedulowany. Ten warunek nie upewnia się czy w kolejce na pewno znajduje się tartak 15,
        ale gdy przyjdzie jego kolej zapełnić kolejkę, to scheduler odpowiednio to rozwiąże.
         */
        this.setTimeoutForNextSpeedUpAndSchedule();
      } else {
        console.log('Item cannot be scheduled, because it has not met requirements');
        this.shiftQueueCleanScheduleAndTryNext(item);
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

  private shiftQueueCleanScheduleAndTryNext(item: QueueItem) {
    this.queue.shift();
    if (this.buildSchedule) {
      clearInterval(this.buildSchedule);
      clearTimeout(this.buildSchedule);
      this.buildSchedule = null;
    }
    this.clearUIQueueItem(item);
    this.tryScheduleNextBuild();
  }

  private async tryScheduleNextBuild() {
    console.log('tryScheduleNextBuild, queue:', this.queue);
    if (this.queue.length > 0) {
      console.log('\t-queue is not empty, performing build schedule');
      this.performBuildSchedule();
    }
  }

  private goToCityView() {
    const cityViewBtn = document.querySelector<HTMLDivElement>('[name="city_overview"]');
    if (!cityViewBtn?.classList.contains('checked')) {
      cityViewBtn?.click();
    }
  }

  private async speedUpFirstBuild() {
    this.goToCityView();
    const freeButton = await waitForElement('[data-order_index="0"] .type_free', 2000).catch(() => null);
    if (freeButton) {
      freeButton.click();
    } else {
      throw new Error('No free button found');
    }
  }

  private async getFirstElementInTheRealQueue() {
    const firstElementInTheQueue = await waitForElement('[data-order_index="0"]');
    return firstElementInTheQueue;
  }

  private async canBuild(building: Building): Promise<boolean | 'maxed'> {
    await this.tryGoToBuildMode();
    const buildButton = await waitForElement(`${building.elementSelector} ${buildingsSelectors.buildButton}`, 2000).catch(() => null);
    if (!buildButton) {
      return 'maxed';
    }
    const canBuild = !buildButton.classList.contains(buildingsSelectors.disabled);
    return canBuild;
  }

  private async areResourcesStackable(building: Building): Promise<true | 'population' | 'storage' | 'alreadyStacked'> {
    console.log('areResourcesStackable');
    await this.tryGoToBuildMode();
    // const buildButton = await waitForElement(`${building.elementSelector} ${buildingsSelectors.buildButton}`);
    do {
      triggerHover(document.querySelector(`${building.elementSelector} ${buildingsSelectors.buildButton}`)!);
      await addDelay(333);
    } while (!document.querySelector('#popup_content img[alt="Wood"]'));
    const requiredWood = Number((await waitForElement('#popup_content img[alt="Wood"]', 3000)).nextSibling!.textContent!);
    const requiredStone = Number((await waitForElement('#popup_content img[alt="Stone"]', 0)).nextSibling!.textContent!);
    const requiredIron = Number((await waitForElement('#popup_content img[alt="Silver coins"]', 0)).nextSibling!.textContent!);
    const requiredPopulation = Number((await waitForElement('img[alt="Food"]', 0)).nextSibling!.textContent!);
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

    if (requiredPopulation > (resourcesInfo.population.amount)) {
      return 'population';
    }
    if ([requiredWood, requiredStone, requiredIron].reduce((acc, curr) => curr > acc ? curr : acc, 0) > resourcesInfo.storeMaxSize) {
      return 'storage';
    }
    if (requiredWood <= (resourcesInfo).wood.amount &&
      requiredStone <= (resourcesInfo).stone.amount &&
      requiredIron <= (resourcesInfo).iron.amount &&
      requiredPopulation <= (resourcesInfo).population.amount
    ) {
      return 'alreadyStacked';
    }
    return true;
  }

  private addStyle() {
    const style = document.createElement('style');
    style.textContent = builderCss;
    document.head.appendChild(style);
  }


  private async isEmptySlot() {
    this.goToCityView()
    await addDelay(3000);
    return await waitForElement('.construction_queue_order_container.instant_buy .js-queue-item.empty_slot', 2000)
      .then(() => true)
      .catch(() => false);
  }

  private async getTimeToCanSpeedUp(): Promise<number> {
    this.goToCityView();
    await addDelay(1000);
    const firstOrder = await waitForElement('[data-order_index="0"] .countdown.js-item-countdown', 3000).catch(() => null);
    if (firstOrder) {
      return textToMs(firstOrder.textContent!) - 5 * 60 * 1000;
    }
    throw new Error('No item in the queue.')
  }

  private loadQueueFromStorage() {
    // do it later
  }

  private async isQueueEmpty() {
    this.goToCityView();
    return new Promise((res) => setTimeout(() => res(document.querySelector('.empty_queue')) != null, 0));
  }

  public start() {
    this.RUN = true;
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.remove('hidden');
  }
  public stop() {
    console.log('Stopping');
    this.RUN = false;
    this.buildSchedule = null;
    document.getElementById(CityBuilder.toggleBuilderButtonId)!.classList.add('hidden');
  }
  public isRunning() {
    return this.RUN;
  }

}

function appendChildAtIndex(additionalQueue: HTMLElement, queueItemEl: HTMLDivElement, arg2: number) {
  throw new Error("Function not implemented.");
}
