import type { TConfigChanges } from '~/config-popup/config-popup';
import { HHMMSS_toMS, waitWhile } from '~/utility/plain-utility';
import type Service from '~/utility/Service';
import Lock, { LockOperationCancelledError } from '~/utility/ui-lock';
import {
  cancelHover,
  getBrowserExecutionContextInfo,
  performOnDocumentVisibilityReturn,
  triggerHover,
  waitForElementInterval,
  waitForElementsInterval,
} from '~/utility/ui-utility';
import { Building, buildings } from '../city/builder/buildings';
import CityBuilder, { BuilderItemDetails } from '../city/builder/city-builder';
import CitySwitchManager from '../city/city-switch-manager';
import { CityInfo } from '../city/types';
import type { ScheduleExecutionDetails } from '../master-queue-rework/inline-queue-navigation';
import MasterQueue, { type ScheduleOperationDetails } from '../master-queue-rework/master-queue';
import GeneralInfo from '../master/ui/general-info';
import ResourceManager from '../resources/resource-manager';
import TradeManager from '../trade/trade-manager';
import { academyItemBgUrl, academyItems, type AcademyItem } from './academy-items';

interface ItemDetails {
  researchName: string;
  actionType: 'research' | 'reset';
}

export class Academy implements Service<'academy'> {
  private static instance: Academy;
  private citySwitch!: CitySwitchManager;
  private masterQueue!: MasterQueue;
  private lock!: Lock;
  private generalInfo!: GeneralInfo;
  private resourceManager!: ResourceManager;
  private tradeManager!: TradeManager;

  private RUN: boolean = false;
  private observer: MutationObserver | null = null;
  private getScheduleBaseFormValues?: (() => ScheduleExecutionDetails) | undefined;
  private tryCount: Record<string, number> = {};

  private constructor() {}

  public isRunning() {
    return this.RUN;
  }
  public start() {
    this.RUN = true;
    this.addUI();
  }
  public stop() {
    this.RUN = false;
    this.observer?.disconnect();
  }
  public pause() {
    this.RUN = false;
  }
  public resume() {
    this.RUN = true;
  }

  public getScheduledActionTimes() {
    throw new Error('to implement');
    return [];
  }
  public onConfigChange(configChanges: Partial<TConfigChanges['academy']>) {
    // nothing
  }

  public static async getInstance() {
    if (!this.instance) {
      Academy.instance = new Academy();
      Academy.instance.lock = Lock.getInstance();
      Academy.instance.generalInfo = GeneralInfo.getInstance();
      Academy.instance.resourceManager = await ResourceManager.getInstance();
      Academy.instance.tradeManager = await TradeManager.getInstance();
      Academy.instance.citySwitch = await CitySwitchManager.getInstance();
      Academy.instance.masterQueue = await MasterQueue.getInstance();
      Academy.instance.register();
    }
    return this.instance;
  }

  private register() {
    this.masterQueue.registerExecutor<ItemDetails>('academy', {
      execute: async operationDetails => {
        await this.execute(operationDetails);
      },
      cancelExecution: id => {
        this.lock.cancelQueuedLock({ manager: 'academy', id: id });
      },
      hydrateItem: function (itemDetails: ItemDetails) {
        return itemDetails;
      },
      persistItem: function (itemDetails: ItemDetails) {
        return itemDetails;
      },
    });
  }

  public async execute(operationDetails: ScheduleOperationDetails<ItemDetails>) {
    let infoId!: number;
    try {
      await this.lock.performWithLock(
        async () => {
          infoId = this.generalInfo.showInfo(
            'Academy: ',
            `Performing ${operationDetails.itemDetails.researchName} ${operationDetails.itemDetails.researchName}`,
            'info',
          );
          await this.performResearchOperation(operationDetails);
          delete this.tryCount[operationDetails.city.name];
        },
        {
          id: operationDetails.id,
          method: '[Academy] execute',
          manager: 'academy',
        },
      );
    } catch (e) {
      if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
        const browserContext = getBrowserExecutionContextInfo();
        console.warn('[Academy] execute catch:', e, browserContext);
        const cityName = operationDetails.city.name;
        this.tryCount[cityName] = (this.tryCount[cityName] ?? 0) + 1;
        if (this.tryCount[cityName] < 2) {
          console.warn(`[Academy]: retry count ${this.tryCount[cityName]}`);
          if (browserContext.visibilityState === 'hidden') {
            performOnDocumentVisibilityReturn(() => this.execute(operationDetails));
          } else {
            this.execute(operationDetails);
          }
        } else {
          delete this.tryCount[cityName];
          operationDetails.shiftQueueAndNext();
          this.closeAcademyDialog();
        }
      }
    } finally {
      this.generalInfo.hideInfo(infoId);
    }
  }

  private async performResearchOperation(operationDetails: ScheduleOperationDetails<ItemDetails>) {
    console.log(
      '[Academy] Opening academy for city:',
      operationDetails.city.name,
      'action type:',
      operationDetails.itemDetails.actionType,
      'research:',
      operationDetails.itemDetails.researchName,
    );
    await this.openAcademy(operationDetails.city, operationDetails.itemDetails.actionType);

    console.log('[Academy] Looking for action button for research:', operationDetails.itemDetails.researchName);
    const actionButton = await waitForElementInterval(`.research_icon.${operationDetails.itemDetails.researchName}`, {
      retries: 3,
    })
      .then(el => el.nextElementSibling as HTMLDivElement)
      .catch(() => null);
    // done
    if (actionButton) {
      console.log('[Academy] Action button found, clicking');
      actionButton.click();
      if (operationDetails.itemDetails.actionType === 'reset') {
        console.log('[Academy] Reset action - waiting for confirm button');
        await waitForElementInterval('.btn_confirm').then(btn => btn.click());
        console.log('[Academy] Reset action - waiting for item to disappear from queue');
        await waitWhile(
          () =>
            !!document.querySelector(`.research_icon .${operationDetails.itemDetails.researchName}`)
              ?.nextElementSibling,
        )
          .then(operationDetails.onFinishCallback)
          .catch(() => {
            console.warn(
              'Item not executed (probably not enough culture points), remove',
              JSON.parse(JSON.stringify(operationDetails)),
            );
            operationDetails.shiftQueueAndNext();
          });
      } else {
        console.log('[Academy] Research action - waiting for item to be added to queue');
        await waitWhile(
          () =>
            !!document.querySelector(`.research_icon .${operationDetails.itemDetails.researchName}`)
              ?.nextElementSibling,
        );
        console.log('[Academy] Item added to queue, attempting speed up if possible');
        await this.speedUpNewlyAddedItemIfPossible();
        operationDetails.onFinishCallback();
      }
    }
    // cannot be done now - figure out why
    else {
      console.log('[Academy] Action button not found, checking why operation cannot be executed');

      // is not active - so either academy is queued in the real/virtual queue or item cannot be executed
      const researchItem = document.querySelector(
        `.tech_tree_box .research_icon.${operationDetails.itemDetails.researchName}`,
      )!;

      if (researchItem.parentElement!.parentElement!.classList.contains('inactive')) {
        const requiredAcademyLvl = Number(
          researchItem.parentElement!.parentElement!.querySelector('.level.number')!.textContent,
        );
        await this.handleNoRequiredBuildingFlow(operationDetails, buildings.Academy, requiredAcademyLvl);
      } else if (!document.querySelectorAll('.js-researches-queue .empty_slot').length) {
        console.log('[Academy] Queue is full, checking time to speed up');
        const timeToSpeedUp = this.getTimeToSpeedUp();
        console.log('[Academy] Time to speed up:', timeToSpeedUp, 'ms');
        // speed up is viable
        if (timeToSpeedUp <= 0) {
          console.log('[Academy] Speed up is viable now, clicking speed up button');
          document
            .querySelector<HTMLButtonElement>('.js-researches-queue [data-order_index="0"] .btn_time_reduction')
            ?.click();
          await waitWhile(() => document.querySelectorAll('.js-researches-queue .empty_slot').length === 0);
          console.log('[Academy] Slot freed, retrying operation');
          await this.performResearchOperation(operationDetails);
          return;
        }
        // speed up in the future
        else {
          const scheduledTime = Date.now() + timeToSpeedUp + 2000;
          console.log(
            '[Academy] Speed up scheduled for:',
            new Date(scheduledTime).toISOString(),
            'retrying operation then',
          );
          operationDetails.setScheduleTimeout(
            async () => {
              this.execute(operationDetails);
            },
            scheduledTime,
            'waiting',
            'slot',
          );
        }
      }
      // check if resources are needed
      else {
        console.log('[Academy] Queue has empty slots, checking if resources are needed');
        // if item is reset then it doesn't need resources for reset - item is misqueued for some reason
        if (operationDetails.itemDetails.actionType === 'reset') {
          console.warn('item', operationDetails, 'cannot be executed, removing from the queue');
          operationDetails.shiftQueueAndNext();
        }
        // check resoures
        else {
          console.log('[Academy] Checking resources for item:', operationDetails.itemDetails.researchName);
          // academy_popup
          document.querySelector('.academy_popup')?.remove();
          triggerHover(
            document.querySelector(`div.research_icon.research.${operationDetails.itemDetails.researchName}`)!,
          );
          const infoPopup = await waitForElementInterval('.academy_popup');
          console.log('[Academy] Info popup found, extracting resource info');
          const requiredResourceInfo = this.extractResourceInfo(infoPopup);
          console.log('[Academy] Extracted resource info:', requiredResourceInfo);
          const researchPoints = Number(
            document.querySelector('.research_points.js-research-points')?.textContent?.split('/')[0] ??
              (() => {
                throw new Error('current research points not parsed');
              })(),
          );
          console.log('[Academy] Current research points:', researchPoints);
          cancelHover(document.querySelector('div.research_icon.research')!);
          // no info parsed (item already done)
          if (!requiredResourceInfo) {
            console.warn(
              'item',
              operationDetails,
              "cannot be executed because it's probably already researched, removing from the queue",
            );
            operationDetails.shiftQueueAndNext();
          } else if (researchPoints < requiredResourceInfo.researchPoints) {
            console.log(
              `[Academy]: Not enough research points (${researchPoints} < ${requiredResourceInfo.researchPoints})`,
            );
            await this.handleNoRequiredBuildingFlow(operationDetails, buildings.Academy);
          } else {
            console.log('[Academy] Research points sufficient, checking lacking resources');
            const lackingResources = await this.resourceManager.getLackingResources(requiredResourceInfo);
            console.log('[Academy] Lacking resources:', lackingResources);
            if (lackingResources.storageCapacity) {
              console.log(`[Academy]: Not enough storage capacity (${lackingResources.storageCapacity})`);
              await this.handleNoRequiredBuildingFlow(operationDetails, buildings.Warehouse);
            } else if (Object.values(lackingResources).some(Boolean)) {
              console.log('[Academy] Resources are lacking, attempting to stack resources');
              console.log(
                '[Academy] Stacking resources for city:',
                operationDetails.city.name,
                'supplier cities:',
                operationDetails.supplierCities.map(c => c.name),
              );
              const result = await this.tradeManager.stackResources(
                requiredResourceInfo,
                operationDetails.city,
                operationDetails.supplierCities,
                operationDetails.maxShipmentTime,
              );
              console.log('[Academy] Stack resources result:', result);
              if (result.fullyStacked) {
                console.log(
                  '[Academy] Resources fully stacked, scheduling execution at:',
                  new Date(result.arrivalTime).toISOString(),
                );
                operationDetails.setScheduleTimeout(
                  async () => this.execute(operationDetails),
                  result.arrivalTime,
                  'execution',
                  'resources',
                );
              } else {
                console.log('[Academy] Resources not fully stacked, scheduling retry in 10 minutes');
                operationDetails.setScheduleTimeout(
                  async () => this.execute(operationDetails),
                  Date.now() + 600000,
                  'execution',
                  'resources',
                );
              }
            } else {
              console.log('[Academy] All resources available, but unknown condition occurred');
              this.closeAcademyDialog();
              throw new Error('Unknown condition occured when executing');
            }
          }
        }
      }
    }
    this.closeAcademyDialog();
  }

  /**
   * Handles scenario in which reserach cannot be done due to unbuilt Building by searching virtual and real queue
   * and subscribing to it's execution finish. If no building is found whatsoever, element is removed from the master queue.
   * - If lvl is not specified, it searches for the queued building with 1 lvl higher than the current one
   * - else searches exactly for the specified lvl building
   */
  private async handleNoRequiredBuildingFlow(
    operationDetails: ScheduleOperationDetails<ItemDetails>,
    building: Building,
    lvl?: number,
  ) {
    const builderInstance = await CityBuilder.getInstance();
    const targetLvl = lvl ?? (await builderInstance.getBuildingCurrentLvl(building, operationDetails.city)) + 1;
    console.log(
      `[Academy] Research blocked - checking for required building: ${building.name} lvl ${targetLvl} in real queue`,
    );
    const realQueueBuildingFinishTime = await builderInstance.getBuildingFinishTime(
      operationDetails.city,
      building,
      targetLvl,
    );
    if (realQueueBuildingFinishTime) {
      console.log(
        `[Academy] Required building found in real queue, scheduling research execution at: ${new Date(realQueueBuildingFinishTime).toLocaleString()}`,
      );
      operationDetails.setScheduleTimeout(
        async () => this.execute(operationDetails),
        realQueueBuildingFinishTime + 3000,
        'waiting',
        'other item',
      );
    } else {
      console.log(
        `[Academy] Building not found in real queue, checking virtual queue for: ${building.name} lvl ${targetLvl}`,
      );
      const requiredScheduledItem = this.masterQueue
        .getTypeSpecificItemDetailsForCity(operationDetails.city, 'builder')
        .find(
          (qItem: { id: string; itemDetails: BuilderItemDetails }) =>
            qItem.itemDetails?.building?.name === building.name && (lvl ? qItem.itemDetails?.toLvl === lvl : true),
        );
      if (requiredScheduledItem) {
        console.log(
          `[Academy] Required building found in virtual queue (id: ${requiredScheduledItem.id}), subscribing to execution finish`,
        );
        const subscribed = this.masterQueue.subscribeToItemOnExecutionFinish(
          operationDetails.city,
          requiredScheduledItem.id,
          operationDetails.id,
        );
        if (!subscribed) {
          throw new Error(
            `Subscription of item ${JSON.stringify(operationDetails.itemDetails)} to item ${JSON.stringify(requiredScheduledItem)} failed.`,
          );
        }
      } else {
        console.log(
          `[Academy] Required building (${building.name} lvl ${targetLvl}) not found in real nor virtual queue, removing research item from queue`,
        );
        operationDetails.shiftQueueAndNext();
      }
    }
  }

  private closeAcademyDialog() {
    document.querySelector<HTMLDivElement>('.classic_window.academy .btn_wnd.close')?.click();
  }

  private async speedUpNewlyAddedItemIfPossible() {
    const itemsList = await waitForElementsInterval('.js-researches-queue [data-order_index]');
    // should be present, so throw if it's not
    const newlyAdded = itemsList[itemsList.length - 1];
    // index 0 needs to be handled differently than index > 0 - 0 has visible btn and the others need trigger popup
    if (Number(newlyAdded.dataset.order_index) === 0) {
      const speedUpBtn = newlyAdded.querySelector<HTMLButtonElement>('.btn_time_reduction.type_free');
      if (speedUpBtn) {
        console.log('found speed up btn on item with index 0, speeding up');
        speedUpBtn.click();
        await waitWhile(
          () => document.querySelectorAll('.js-researches-queue [data-order_index]').length === itemsList.length,
          { onError() {} },
        );
      }
    }
    // hover to trigger popup and then try
    else {
      triggerHover(newlyAdded);
      await waitForElementInterval('.building_queue_item_instant_buy_tooltip', {
        timeout: 2000,
      })
        .then(async popup => {
          const btn = popup.querySelector<HTMLButtonElement>('.btn_time_reduction.type_free');
          if (btn) {
            console.log('found speed up btn on item with above 0, speeding up');
            btn.click();
            await waitWhile(
              () => document.querySelectorAll('.js-researches-queue [data-order_index]').length === itemsList.length,
              { onError() {} },
            );
          }
        })
        .catch(() => {});
      cancelHover(document.querySelector('.building_queue_item_instant_buy_tooltip')!);
    }
  }

  /**
   * Requires lock, given city and opened dialog.
   */
  private getTimeToSpeedUp = (): number => {
    // takes first element from the queue
    // NOTE: for extra efficiency subsequent items can be checked for speedup
    const text = document.querySelector('.js-researches-queue [data-order_index] .countdown')?.textContent;
    if (!text) throw new Error('No time to speed up research item found.');
    return 300000 - HHMMSS_toMS(text);
  };

  private extractResourceInfo(popup: HTMLElement): {
    wood: number;
    stone: number;
    iron: number;
    researchPoints: number;
  } | null {
    const result = {} as {
      wood: number;
      stone: number;
      iron: number;
      researchPoints: number;
    };

    const images = popup.querySelectorAll('img');
    if (!images) return null;

    images.forEach(img => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';

      // Find the next sibling span with the value
      let nextSibling = img.nextElementSibling;
      while (nextSibling && nextSibling.tagName !== 'SPAN') {
        nextSibling = nextSibling.nextElementSibling;
      }

      if (!nextSibling) return;

      const valueText = nextSibling.textContent?.trim() || '0';
      // Handle time format (00:04:49) - skip it
      if (valueText.includes(':')) return;

      const value = parseInt(valueText, 10);
      if (isNaN(value)) throw new Error('Research item resources misparsed');

      // Determine resource type based on src
      if (src.includes('wood.png')) {
        result.wood = value;
      } else if (src.includes('stone.png')) {
        result.stone = value;
      } else if (src.includes('iron.png')) {
        result.iron = value;
      } else if (src.includes('research_points.png')) {
        result.researchPoints = value;
      }
    });

    return result;
  }

  private async openAcademy(city: CityInfo, mode: ItemDetails['actionType']) {
    await city.switchAction();
    document.querySelector<HTMLDivElement>('[name="city_overview"]')?.click();
    await waitForElementInterval('[data-building="academy"]').then(el => el.click());
    let conainter: HTMLElement | null = null;
    await waitWhile(() => !(conainter = document.querySelector('.js-window-main-container.classic_window.academy')));
    if (mode === 'reset') {
      conainter!.querySelector<HTMLDivElement>('div.tab.reset')?.click();
      await waitForElementInterval('div.tab.reset.selected', { fromNode: conainter! });
    }
  }

  private showAddDialog(researchName: string, actionType: 'research' | 'reset') {
    // Remove existing dialog if any
    const existingDialog = document.getElementById('academy-add-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const academyItem = academyItems[researchName];
    if (!academyItem) {
      console.warn(`Academy item not found: ${researchName}`);
      return;
    }

    const city = this.citySwitch.getCurrentCity();
    if (!city) {
      console.warn('No current city available');
      return;
    }

    // Create dialog container
    const dialog = document.createElement('div');
    dialog.id = 'academy-add-dialog';
    dialog.className = 'fixed z-[2000] bg-white border-2 border-gray-400 rounded shadow-lg';
    dialog.style.minWidth = '400px';
    // Center dialog on screen
    const centerX = window.innerWidth / 2 - 200; // 200 is approximate half of minWidth
    const centerY = window.innerHeight / 2 - 150; // approximate center
    dialog.style.left = `${centerX}px`;
    dialog.style.top = `${centerY}px`;

    // Create header (draggable)
    const header = document.createElement('div');
    header.className = 'bg-gray-200 p-2 cursor-move border-b border-gray-300 flex justify-between items-center';
    header.textContent = `Add ${academyItem.name} to queue`;
    dialog.appendChild(header);

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ml-auto text-red-600 hover:text-red-800 font-bold text-lg';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => dialog.remove());
    header.appendChild(closeBtn);

    // Create content container
    const content = document.createElement('div');
    content.className = 'p-4 flex flex-col gap-4';
    dialog.appendChild(content);

    // Create item preview
    const preview = document.createElement('div');
    preview.className = 'flex items-center gap-2 p-2 border border-gray-300 rounded';
    const previewIcon = document.createElement('div');
    previewIcon.className = 'size-[50px]';
    previewIcon.style.backgroundImage = `url(${academyItemBgUrl})`;
    previewIcon.style.backgroundPosition = academyItem.bgPos;
    previewIcon.style.backgroundRepeat = 'no-repeat';
    preview.appendChild(previewIcon);
    const previewText = document.createElement('div');
    previewText.textContent = `${academyItem.name} (${actionType})`;
    preview.appendChild(previewText);
    content.appendChild(preview);

    // Create navigation section
    const navSection = document.createElement('div');
    navSection.id = 'academy-navigation-section';
    content.appendChild(navSection);

    // Inject master queue navigation
    this.getScheduleBaseFormValues = this.masterQueue.injectQueueNavigation(city, navSection).getValues;

    // Create Add button
    const addButton = document.createElement('button');
    addButton.className = 'bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mt-2';
    addButton.textContent = 'Add';
    addButton.addEventListener('click', () => {
      this.addToQueue(researchName, actionType, academyItem);
      dialog.remove();
    });
    content.appendChild(addButton);

    // Make dialog draggable
    let isDragging = false;
    let offsetX: number | null = null;
    let offsetY: number | null = null;

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      // Calculate offset from mouse position relative to dialog
      const rect = dialog.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      isDragging = true;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging && offsetX !== null && offsetY !== null) {
        dialog.style.left = `${e.clientX - offsetX}px`;
        dialog.style.top = `${e.clientY - offsetY}px`;
      }
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    header.addEventListener('mousedown', onMouseDown);

    document.body.appendChild(dialog);
  }

  private addToQueue(researchName: string, actionType: 'research' | 'reset', academyItem: AcademyItem) {
    const currentCity = this.citySwitch.getCurrentCity();
    if (
      !currentCity ||
      !this.getScheduleBaseFormValues ||
      this.masterQueue
        .getTypeSpecificItemDetailsForCity(currentCity, 'academy')
        .some(({ itemDetails }: { itemDetails: ItemDetails }) => itemDetails.researchName === researchName)
    ) {
      console.warn('Cannot add to queue: no city or form values or item already queued');
      return;
    }

    const { blocking, supplierCityNames, autoSuppliers, maxShipmentTime } = this.getScheduleBaseFormValues();

    const queueItem = {
      itemType: 'academy' as const,
      ui: {
        title: academyItem.name,
        style: {
          backgroundImage: `url(${academyItemBgUrl})`,
          backgroundPosition: academyItem.bgPos,
          backgroundRepeat: 'no-repeat',
        },
        description: actionType,
      },
      blocking,
      maxShipmentTime,
      supplyEvaluation: autoSuppliers ? ('auto' as const) : ('manual' as const),
      supplierCities:
        supplierCityNames?.map((name: string) => this.citySwitch.getCityByName(name)!).filter(Boolean) ?? [],
      itemDetails: {
        researchName,
        actionType,
      } as ItemDetails,
    };

    this.masterQueue.addToQueue(currentCity, queueItem);
  }

  private addUI() {
    if (this.observer) return;

    // mount observer
    const onShowAddDialogClick = (cls: string | null, actionType: 'research' | 'reset') => {
      if (!cls) return;
      this.showAddDialog(cls, actionType);
    };

    const extendUICallback = async (container: HTMLDivElement) => {
      (await waitForElementsInterval('.tech_tree_box .research_icon', { retries: 3 })).forEach(academyItem => {
        academyItem.appendChild(
          (() => {
            const addBtn = document.createElement('button');
            addBtn.textContent = '+';
            addBtn.className = 'w-4 h-4 font-bold text-sm leading-none flex items-center justify-center cursor-pointer';
            addBtn.addEventListener('click', () =>
              onShowAddDialogClick(
                academyItem.classList.item(2),
                container.querySelector('div.tab.research.selected') ? 'research' : 'reset',
              ),
            );
            return addBtn;
          })(),
        );
      });

      [
        container.querySelector('div.tab.reset:not(.selected)'),
        container.querySelector('div.tab.research:not(.selected)'),
      ].forEach(btn =>
        btn?.addEventListener('click', async () => {
          await waitWhile(() => !!container.querySelector('.tech_tree_box .research_icon button'));
          extendUICallback(container);
        }),
      );
    };

    this.observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (
              (node as HTMLElement)?.getAttribute('class') === 'window_curtain ui-front' &&
              (node as HTMLElement).querySelector('div.academy')
            ) {
              const dialogContainer: HTMLDivElement = (node as HTMLElement).querySelector('div.academy')!;
              extendUICallback(dialogContainer);
            }
          }
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: false });
  }
}
