/*
 * Stworzyć utility, które będzie śledziło i rejestrowało ruch
TODO: it's not a service so move it to different folder
 */

import { TConfig } from '../../../gps.config';
import ConfigManager from '../../utility/config-manager';
import {
  addDelay,
  doWhile,
  getDaysAhead,
  getTopmostAncestorByClass,
  HHMMSS_toMS,
  waitWhile,
} from '../../utility/plain-utility';
import {
  cancelHover,
  performComplexClick,
  triggerHover,
  waitForElement,
  waitForElementInterval,
} from '../../utility/ui-utility';
import { CharmDetails } from '../charms/charms-utility';
import { CityInfo } from '../city/city-switch-manager';
import { AttackStrategy, OperationType, ScheduleItem, SchedulerExecutor } from '../scheduler/Scheduler';
import { LandArmyUnit, landArmyUnits, SeaArmyUnit, seaArmyUnits } from './army-units';
import {
  calculateCleanBaseDistanceTime,
  detectCurrentPlayerBonuses,
  findMatchingUnits,
  PlayerSpeedBonuses,
  SpeedBonusConfig,
} from './speed-calculator';

// interface OperationDetails {
//   id: string;
//   operationType: OperationType;
//   movementId: string | null;
//   targetTime: number;
//   actionTime: number;
//   realActionTime: number;
//   sourceCity: CityInfo;
//   targetCitySelector: string;
//   targetCityCords: [string, string];
//   targetCityName: string;
//   precision:
//     | false
//     | {
//         maxDiscrepancy: number;
//         onFailure: 'cancel' | 'leave';
//       };
//   preparationTime: number;
//   undoMovementAction: (() => void) | null;
// }

// interface AttackOperationDetails extends OperationDetails {
//   attackType: AttackType;
//   includeHero: boolean;
//   power: CharmDetails;
//   data: { name: string; value: string }[];
//   attackIfAlly: boolean;
// }

// interface SupportOperationDetails extends OperationDetails {
//   data: { name: string; value: string }[];
// }

type ArmyMovementDetails = {
  movementId: string;
  cancellableUntil: number;
  arrivalTime: number;
  movementType: 'attack' | 'support';
  direction: 'outgoing' | 'returning' | 'incoming';
  title: string;
  href: string | undefined;
};

export default class ArmyMovement implements SchedulerExecutor {
  private error: string | null = null;
  private configManager!: ConfigManager;
  private config!: TConfig;

  private static instance: ArmyMovement;
  private constructor() {}

  public static getInstance(): ArmyMovement {
    if (!ArmyMovement.instance) {
      ArmyMovement.instance = new ArmyMovement();
      ArmyMovement.instance.configManager = ConfigManager.getInstance();
      ArmyMovement.instance.config = ArmyMovement.instance.configManager.getConfig();
      // ArmyMovement.instance.mountObserver();
    }
    return ArmyMovement.instance;
  }

  private async goToCityFromSavedCoords(id: string) {
    document.querySelector<HTMLButtonElement>('.js-coord-button')?.click();
    const dropdownList = await waitForElementInterval('#dd_coordinates_list .content.js-dropdown-item-list', {
      interval: 333,
      retries: 5,
    });
    let elements: NodeListOf<HTMLElement>;
    await waitWhile(
      () => {
        const condition = !(elements = dropdownList.querySelectorAll<HTMLElement>(`.item.bookmark.option`)).length;
        console.log('found elements:', elements);
        return condition;
      },
      {
        delay: 250,
        maxIterations: 5,
        onError() {
          throw new Error('Failed to find any saved elements');
        },
      },
    );
    const dropdownItem = Array.from(elements!).find(el => {
      console.log(`el.textContent.trim(): "${el.textContent?.trim()}", id: "${id}"`);
      return el.textContent?.trim() === id;
    });
    if (!dropdownItem) {
      this.error = 'Failed to find saved coordinates from the list';
      throw new Error('Failed to find saved coordinates from the list');
    }

    dropdownItem.click();
  }

  /**
   * Closes all windows, navigates to city from saved coords (based on id) and opens Attack/Support tab.
   * @param coordsId
   * @param targetCitySelector
   * @param operationType
   */
  private async openCityOperationDialog(
    coordsId: string,
    targetCitySelector: string,
    operationType: Omit<OperationType, OperationType.Withdraw>,
  ) {
    await this.goToCityFromSavedCoords(coordsId);

    // pozamykaj okna ----------------
    for (const el of document.querySelectorAll<HTMLElement>('.minimized_windows_area .btn_wnd.close')) {
      el.click();
      await waitForElementInterval('.dialog_buttons [href="#cancel"]', { interval: 333, retries: 1 })
        .then(() => el.click())
        .catch(() => {});
    }

    for (const el of document.querySelectorAll<HTMLElement>('.ui-dialog-titlebar-close')) {
      el.click();
      await waitForElementInterval('.dialog_buttons [href="#cancel"]', { interval: 333, retries: 1 })
        .then(() => el.click())
        .catch(() => {});
    }
    // --------------------------------
    await addDelay(100);

    const targetCityElement = await waitForElementInterval(targetCitySelector, { interval: 500, retries: 5 }).catch(
      () => {
        this.error = 'Nie udało się znaleźć wioski na mapie, operacja anulowana, współrzędne zostaną usunięte.';
        throw new Error('Target city not found');
      },
    );

    // TODO: reghink if this is needed
    await doWhile(
      () => !document.querySelector<HTMLElement>('#context_menu'),
      async () => {
        await performComplexClick(targetCityElement);
      },
      {
        maxIterations: 5,
        delay: 333,
        onError() {
          throw new Error("Target city couldn't be accessed");
        },
      },
    );

    if (operationType === OperationType.Attack) {
      (await waitForElementInterval('#attack', { interval: 400, timeout: 2000 })).click();
    } else {
      (await waitForElementInterval('#support', { interval: 400, timeout: 2000 })).click();
    }
  }

  // TODO: add logic for when there is different units count, for now its STRICT
  /**
   * Based on specified policy (strict | max-available) fills input fields and selects other operation relevant fields.
   */
  private async fillInputData(
    inputData: { value: string; name: string }[],
    attachHero?: boolean | null,
    charm?: CharmDetails | null,
    attackStrategy?: AttackStrategy,
    policy: 'strict' | 'max-available' = 'strict',
  ) {
    let areUnitsPresentFromStart = true;

    console.log('fill inputData');
    for (const data of inputData) {
      if (data.value) {
        const input = (await waitForElementInterval(`input[name="${data.name}"]`, {
          interval: 333,
          timeout: 2000,
        })) as HTMLInputElement;
        // setInputValue(input, data.value);

        const availableUnitsEl = document.getElementById(data.name);
        console.log('availableUnitsEl:', availableUnitsEl);
        if (policy === 'strict') {
          // czekaj aż będą wszystkie zdefiniowane jednostki dostępne
          await doWhile(
            () => Number(availableUnitsEl?.innerText ?? null) < Number(data.value),
            // optimization - just report if had to wait for units
            () => {
              areUnitsPresentFromStart = false;
            },
            {
              delay: 150,
              maxIterations: 20,
              onError() {
                console.log("Available units count doesn't match the requirements");
              },
            },
          );
          input.value = data.value;
        } else {
          input.value = Math.min(Number(data.value), Number(availableUnitsEl?.innerText)).toString();
        }
      }
    }

    if (attackStrategy === 'breach') {
      document.querySelector<HTMLElement>('[data-attack="breach"]')?.click();
    }

    if (attachHero) {
      (await waitForElementInterval('.cbx_include_hero')).click();
    }

    if (charm) {
      console.log('scheduled charm:', charm);
      await waitForElementInterval('#spells_1', { timeout: 2000 }).then(el => (el as HTMLElement).click());
      await waitForElementInterval(`[data-power_id="${charm.dataPowerId}"`, { interval: 100, timeout: 2000 }).then(el =>
        (el as HTMLElement).click(),
      );
      // await waitWhile(() => !document.querySelector('#spells_1')?.classList.contains(charm.dataPowerId), {
      //   delay: 100,
      //   maxIterations: 15,
      //   onError: () => {
      //     throw new Error(`Charm "${charm.dataPowerId}" has been selected but not activated.`);
      //   },
      // });
    }

    return areUnitsPresentFromStart;
  }

  /**
   * Based in item details performs the operation.
   * @throws Error - if anything is not the way it should
   * @param item
   * @param utils
   */
  public async execute(
    item: ScheduleItem,
    utils: {
      successCallback: (landedTime: number, movementId: string) => void;
      failureCallback: (reason?: string) => void;
      assignTimeout: (timeoutId: ReturnType<typeof setTimeout>) => void;
    },
  ) {
    // preparation
    await item.sourceCity.switchAction();
    await this.openCityOperationDialog(item.id, item.targetCityDetails.selector, item.operationType);
    // await this.fillInputData(item.armyDetails, item.includeHero, item.power);

    await this.fillInputData(
      item.armyDetails,
      item.includeHero,
      !item.precision ? item.power : null,
      item.attackStrategy,
    );
    // afterwards it waits for like 4s to hit proper action

    if (item.precision) {
      let totalTtrials = 0;
      const timeToRealExecution =
        item.timeDetails.executionStartTime + this.configManager.getTimeDifference() - Date.now();
      utils.assignTimeout(
        setTimeout(async () => {
          try {
            // first execution --------------------
            // just id's of every movement within the city
            let operationsSnapshot = (await this.getArmyMovementSnapshot()).map(el => el.movementId);

            const { isAttackingAlly } = await this.submitOperationWithFeedback(item.operationType);
            totalTtrials++;

            let operationDetails = await this.getNewestOperationDetailsOfCity({
              sourceCity: item.sourceCity,
              wayDuration: item.timeDetails.movementDuration,
              snapshot: operationsSnapshot,
              withCaptain: false,
            });
            // END first execution ----------------

            while (
              operationDetails.landedTime < item.timeDetails.targetTimeStart ||
              operationDetails.landedTime > item.timeDetails.targetTimeStart + item.timeDetails.targetTimeDuration
            ) {
              console.log(
                `canceling movement because landed at: "${new Date(operationDetails.landedTime).toLocaleString()}" instead of ${new Date(item.timeDetails.targetTimeStart).toLocaleString()} ~+${item.timeDetails.targetTimeDuration}`,
              );
              await addDelay(Math.random() * 200 + 200);
              // await this.cancelCommand(operationDetails.movementId);
              await this.cancelMovement(operationDetails.movementId);
              // trial possibilities are done at this point
              if (Date.now() > item.timeDetails.exclusionTime + item.timeDetails.exclusionDuration) {
                console.warn(`precision failure after ${totalTtrials} times`);
                utils.failureCallback();
                return;
              }
              // otherwise repeat
              operationsSnapshot = (await this.getArmyMovementSnapshot()).map(el => el.movementId);

              // TODO: here add input policy (but must be specified by user in UI extension)
              // send without hero because of retries
              const wasImmadiate = await this.fillInputData(
                item.armyDetails,
                item.includeHero,
                null,
                item.attackStrategy,
              );
              if (wasImmadiate) await addDelay(Math.random() * 300 + 300);
              await this.submitOperation(item.operationType, isAttackingAlly);
              totalTtrials++;
              operationDetails = await this.getNewestOperationDetailsOfCity({
                sourceCity: item.sourceCity,
                wayDuration: item.timeDetails.movementDuration,
                snapshot: operationsSnapshot,
                withCaptain: false,
              });
            }
            console.log('success, landed time:', operationDetails.landedTime, `after ${totalTtrials} trials`);
            await this.addPowerToMovement(operationDetails.movementId, item.power, 'normal');
            utils.successCallback(operationDetails.landedTime, operationDetails.movementId);
          } catch (e) {
            if (e instanceof Error) utils.failureCallback(e.message);
            else utils.failureCallback(String(e));
          }
        }, timeToRealExecution),
      );
    }
    // no precision operation
    else {
      const timeToRealExecution =
        item.timeDetails.executionStartTime + this.configManager.getTimeDifference() - Date.now();

      utils.assignTimeout(
        setTimeout(async () => {
          try {
            // remember what elements are there before adding new
            const operationsSnapshot = (await this.getArmyMovementSnapshot()).map(el => el.movementId);

            if (item.operationType === OperationType.Attack) {
              (await waitForElement('#btn_attack_town')).click();
              // TODO: instead of anticipating confirmation for ally attack, assess if that's the case - it will eliminate the need waiting
              await waitForElementInterval('.js-window-main-container.classic_window.dialog .btn_confirm.button_new', {
                interval: 150,
                retries: 4,
              })
                .then(el => el.click())
                .catch(() => {});
            } else {
              (await waitForElement('.attack_support_window a .middle')).click();
            }

            const operationDetails = await this.getNewestOperationDetailsOfCity({
              sourceCity: item.sourceCity,
              wayDuration: item.timeDetails.movementDuration,
              snapshot: operationsSnapshot,
              withCaptain: false,
            });

            utils.successCallback(operationDetails.landedTime, operationDetails.movementId);
          } catch (e) {
            if (e instanceof Error) utils.failureCallback(e.message);
            else utils.failureCallback(String(e));
          }
        }, timeToRealExecution),
      );
    }
  }

  /**
   *
   * @param movementId either id derived from command panel (premium) or non-premium dropdown
   * @param power
   * @param idType
   * @returns
   */
  private async addPowerToMovement(movementId: string, power: CharmDetails | null, idType: 'premium' | 'normal') {
    console.log('power to be added:', power);
    if (!power) return;

    if (idType === 'premium') {
      await this.openActivityCommandsPanel();

      const movement = document.getElementById(movementId);
      if (!movement) throw new Error('Movement to add power to not found');

      // cmd_info_box
      movement.querySelector<HTMLElement>('.cmd_info_box a')?.click();
    } else {
      triggerHover(document.getElementById('toolbar_activity_commands')!);
      document.querySelector<HTMLElement>(`$${movementId} .icon`)?.click();
      cancelHover(document.getElementById('toolbar_activity_commands')!);
    }

    await waitForElementInterval('#command_info-god', { interval: 250, timeout: 2000 }).then(e => e.click());
    await waitForElementInterval(`[data-power_id="${power.dataPowerId}"`, { interval: 100, timeout: 2000 }).then(el =>
      (el as HTMLElement).click(),
    );

    await waitForElementInterval('.cast_spell.confirmation .btn_confirm.button_new').then(e => e.click());
  }

  /**
   * Premium only army movement cancellers
   */
  private async cancelCommand(commandId: string) {
    await this.openActivityCommandsPanel();
    // .game_arrow_delete
    const movement = document.getElementById(commandId);
    if (!movement) throw new Error('Movement to cancel not found');
    movement.querySelector<HTMLAnchorElement>('.game_arrow_delete')?.click();
    await waitWhile(() => !!document.getElementById(commandId)?.querySelector('.game_arrow_delete'), {
      delay: 100,
      maxIterations: 10,
    });
  }

  /**
   * Performs a safe submit operation that ensures it occurred. Throws error if anything was not possible.
   */
  private async submitOperation(operationType: OperationType, isAttackingAlly: boolean = false) {
    // simple snapshot
    let el = document.querySelector<HTMLInputElement>('.unit_input.with_value');

    if (operationType === OperationType.Attack) {
      (await waitForElement('#btn_attack_town')).click();

      if (isAttackingAlly) {
        await waitForElementInterval('.js-window-main-container.classic_window.dialog .btn_confirm.button_new', {
          interval: 150,
          retries: 10,
        })
          .then(el => el.click())
          .catch(() => {
            throw new Error("Expected to confirm attack on an ally, but couldn't do so.");
          });
      }
    } else {
      (await waitForElement('.attack_support_window a .middle')).click();
    }

    // waits until input is empty again - means operation is submitted
    await waitWhile(() => !!el?.value, {
      delay: 100,
      maxIterations: 15,
      onError() {
        throw new Error("Units couldn't be sent");
      },
    });
  }

  /**
   * Performs a safe submit operation that ensures it occurred and returns whether the operation was an attack on an Ally
   */
  private async submitOperationWithFeedback(operationType: OperationType): Promise<{ isAttackingAlly: boolean }> {
    let el = document.querySelector<HTMLInputElement>('.unit_input.with_value');
    let isAttackingAlly: boolean = false;
    if (operationType === OperationType.Attack) {
      (await waitForElement('#btn_attack_town')).click();

      await waitForElementInterval('.js-window-main-container.classic_window.dialog .btn_confirm.button_new', {
        interval: 150,
        retries: 4,
      })
        .then(el => {
          isAttackingAlly = true;
          el.click();
        })
        .catch(() => {
          /* nothing */
        });
    } else {
      (await waitForElement('.attack_support_window a .middle')).click();
    }
    await waitWhile(() => !!el?.value, { delay: 100, maxIterations: 15 });
    console.warn('is attacking an Ally:', isAttackingAlly);
    return { isAttackingAlly };
  }

  private hasCaptain() {
    return !!document.querySelector('.advisor_frame.captain .captain_active');
  }

  private async openActivityCommandsPanel() {
    if (this.hasCaptain()) {
      const openCommandsPanel = document.querySelector('#command_overview');
      if (!!openCommandsPanel) {
        document.getElementById('town_overviews-command_overview')?.click();
        await waitWhile(
          () => openCommandsPanel.isConnected && !document.getElementById('town_overviews-command_overview'),
          { delay: 100, maxIterations: 15 },
        );
      }

      document.querySelector<HTMLElement>('#toolbar_activity_commands')?.click();
      await waitWhile(() => !document.querySelector('#command_overview'), { delay: 200, maxIterations: 5 });
    } else {
      throw new Error('Cannot open "Activity Commands" because account is not premium');
    }
  }

  private closeActivityCommandsPanel() {
    const commandTabEl = document.getElementById('command_overview_tabs');
    if (!commandTabEl) return;
    getTopmostAncestorByClass(commandTabEl, 'ui-dialog')
      ?.querySelector<HTMLElement>('button.ui-dialog-titlebar-close')
      ?.click();
  }

  /**
   * Opens (if closed) command panel and makes snapshot of current command alements and returns their ID in a array.
   * @returns
   */
  private async doOperationsSnapshot(closeAfterwards: boolean = false) {
    console.log('doOperationSnapchot');
    await this.openActivityCommandsPanel();
    const ids = Array.from(document.querySelectorAll('#command_overview li')).map(el => el.id);
    if (closeAfterwards) this.closeActivityCommandsPanel();
    console.log('returning snapshot:', ids);
    return ids;
  }

  // TODO potentially should specify what newest operation type should it be - incomning/outgoing attack/support etc
  /**
   * Tries to find newest operation initiated by a given city whose id is not in the spiecified list of ids.
   * If cannot find such an element within 1600ms then throws an Error.
   * @returns Object with operation id and landed time.
   */
  private async getNewestOperationDetailsOfCity({
    sourceCity,
    wayDuration,
    snapshot,
    shouldCloseAfterwards,
    withCaptain,
    direction,
    movementType,
  }: {
    sourceCity: CityInfo;
    wayDuration: number;
    snapshot: string[];
    shouldCloseAfterwards?: boolean;
    withCaptain?: boolean;
    direction?: ArmyMovementDetails['direction'];
    movementType?: ArmyMovementDetails['movementType'];
  }) {
    if ((withCaptain ?? true) && this.hasCaptain()) {
      await this.openActivityCommandsPanel();

      let newestOperationLi: HTMLElement | undefined;
      await waitWhile(
        () =>
          !(newestOperationLi = Array.from(document.querySelectorAll<HTMLElement>('#command_overview li')).find(el => {
            return (
              !snapshot.includes(el.id) &&
              el.querySelector<HTMLElement>('.cmd_info_box .gp_town_link')?.textContent === sourceCity.name
            );
          })),
        {
          delay: 200,
          maxIterations: 8,
          onError() {
            throw new Error('Latest operation not found');
          },
        },
      );

      // \.match(/\d+/g)
      const arrivalTimeArray = newestOperationLi!
        .querySelector('.troops_arrive_at')
        ?.textContent?.match(/\d+/g)
        ?.slice(-3);

      if (arrivalTimeArray?.length !== 3) throw new Error("Couldn't parse arrival time from command");
      const now = new Date();
      const daysAhead = getDaysAhead(new Date(now.getTime() + wayDuration));
      const arrivalDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + daysAhead,
        Number(arrivalTimeArray[0]),
        Number(arrivalTimeArray[1]),
        Number(arrivalTimeArray[2]),
        0, // milisekundy
      );
      const arrivalTime = arrivalDate.getTime();

      if (shouldCloseAfterwards) this.closeActivityCommandsPanel();

      return { movementId: newestOperationLi!.id, landedTime: arrivalTime };
    }
    // non-premium
    else {
      await sourceCity.switchAction();
      let newestMovement: ArmyMovementDetails | undefined;

      await waitWhile(
        async () => {
          const newestSnapshot = await this.getArmyMovementSnapshot();
          console.log('snapsho:', newestSnapshot);
          newestMovement = newestSnapshot.find(
            el =>
              !snapshot.includes(el.movementId) &&
              (direction ? direction === el.direction : true) &&
              (movementType ? movementType === el.movementType : true),
          );
          return !newestMovement;
        },
        {
          delay: 200,
          maxIterations: 8,
          onError() {
            throw new Error('Latest operation not found');
          },
        },
      );

      const now = new Date();
      const daysAhead = getDaysAhead(new Date(now.getTime() + wayDuration));
      // newestMovement!.arrivalTime doesn't account for days difference, only raw clock time
      const flatArrivalTime = new Date(newestMovement!.arrivalTime);
      const arrivalDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + daysAhead,
        Number(flatArrivalTime.getHours()),
        Number(flatArrivalTime.getMinutes()),
        Number(flatArrivalTime.getSeconds()),
        0, // milisekundy
      );

      return { movementId: newestMovement!.movementId, landedTime: arrivalDate.getTime() };
    }
  }

  /**
   * Non-premium army movement parser
   * @param townLink
   * @returns
   */
  public getArmyMovementDetails = async (
    townLink: string,
  ): Promise<
    {
      movementId: string;
      title: string;
      movementType: 'attack' | 'support';
      direction: 'incoming' | 'returning' | 'outgoing';
      arrivalTime: number;
      cancellableUntil: number;
      href?: string;
    }[]
  > => {
    if (!this.hasCaptain() || true) {
      triggerHover(document.querySelector<HTMLElement>('#toolbar_activity_commands')!);
      const movementList = await waitForElementInterval(
        '#toolbar_activity_commands_list .content.js-dropdown-item-list',
      );
      const array = Array.from(movementList.children)
        .filter(
          (el): el is HTMLDivElement =>
            townLink === (el as HTMLElement).querySelector('.details_wrapper .town_link')?.textContent?.trim(),
        )
        .map(el => {
          const iconClassList = el.querySelector('.icon')!.classList;
          const directionClass = iconClassList.item(3) as 'outgoing' | 'returning';
          return {
            movementId: el.id,
            cancellableUntil: Number(el.dataset.cancelable) * 1000,
            arrivalTime: Number(el.dataset.timestamp) * 1000,
            movementType: iconClassList.item(2)!.split('_')[0] as 'attack' | 'support',

            direction:
              directionClass === 'returning' && el.dataset.cancelable === 'null'
                ? 'incoming'
                : (directionClass as 'incoming' | 'returning' | 'outgoing'),
            title: el.querySelector('.town_link')!.textContent!.trim(),
            href: el.querySelector('a')?.href,
          };
        });
      cancelHover(document.querySelector<HTMLElement>('#toolbar_activity_commands')!);
      return array;
    }
    return [];
  };

  /**
   * Non-premium movement canceller
   * @param movementId
   */
  private async cancelMovement(movementId: string) {
    const activityIcon = document.querySelector<HTMLElement>('#toolbar_activity_commands')!;
    triggerHover(activityIcon);
    const movement = Array.from(
      document.querySelector('#toolbar_activity_commands_list .content.js-dropdown-item-list')!.children,
    ).find(el => el.id === movementId);
    cancelHover(activityIcon);
    if (!movement) throw new Error('Movement to cancel not found');
    const cancel = movement.querySelector<HTMLDivElement>('.remove.cancelable');
    if (!cancel) throw new Error('cannot cancel');
    cancel.click();
    await waitWhile(
      () => !!document.querySelector(`#toolbar_activity_commands_list #${movementId} .remove.cancelable`),
      {
        delay: 100,
        maxIterations: 10,
      },
    );
  }

  /**
   * Non-premium army movement parser.
   * @param city
   * @returns
   */
  public async getArmyMovementSnapshot(city?: CityInfo): Promise<ArmyMovementDetails[]> {
    if (city) await city.switchAction();
    triggerHover(document.querySelector<HTMLElement>('#toolbar_activity_commands')!);
    const movementList = await waitForElementInterval('#toolbar_activity_commands_list .content.js-dropdown-item-list');
    cancelHover(document.querySelector<HTMLElement>('#toolbar_activity_commands')!);

    console.log('Array.from(movementList.children):', Array.from(movementList.children));
    return Array.from(movementList.children).map(el => {
      const iconClassList = el.querySelector('.icon')!.classList;
      const directionClass = iconClassList.item(3) as 'outgoing' | 'returning';
      return {
        movementId: el.id,
        cancellableUntil: Number((el as HTMLDivElement).dataset.cancelable) * 1000,
        arrivalTime: Number((el as HTMLDivElement).dataset.timestamp) * 1000,
        movementType: iconClassList.item(2)!.split('_')[0] as 'attack' | 'support',
        direction:
          directionClass === 'returning' && (el as HTMLElement).dataset.cancelable === 'null'
            ? ('incoming' as const)
            : directionClass,
        title: el.querySelector('.town_link')!.textContent!.trim(),
        href: el.querySelector('a')?.href,
      };
    });
  }

  /**
   * Assesses which unit could be the slowest in an incoming movement by:
   * 1. Using UI to get reference travel time for a known unit
   * 2. Calculating base distance from reference
   * 3. Finding all units that could match observed travel time with various speed bonuses
   */
  public async assessSlowestUnitInTheMovement(
    movementId: string,
    againstCity: CityInfo,
  ): Promise<{ unit: LandArmyUnit | SeaArmyUnit; possibleBonuses: Partial<SpeedBonusConfig>[] }[]> {
    await againstCity.switchAction();
    triggerHover(document.querySelector<HTMLElement>('#toolbar_activity_commands')!);
    cancelHover(document.querySelector<HTMLElement>('#toolbar_activity_commands')!);

    const movement = await waitForElementInterval(
      `#toolbar_activity_commands_list .content.js-dropdown-item-list #${movementId}`,
      { retries: 10, interval: 100 },
    );

    const iconClassList = movement.querySelector('.icon')!.classList;
    const direction = iconClassList.item(3) as 'outgoing' | 'returning';
    const href = movement.querySelector('a')?.href;
    if (!(direction === 'returning' && href)) throw new Error('No attacking movement detected');

    const arrivalTime = Number((movement as HTMLDivElement).dataset.timestamp) * 1000;
    const observedTravelTimeMs = arrivalTime - Date.now();

    const link = movement.querySelector('a')!;
    link.click();

    (await waitForElementInterval('#context_menu #info', { retries: 20, interval: 100 })).click();
    const isleId = (await waitForElementInterval('#towninfo_towninfo .sea_coords'))
      .parentElement!.innerText!.match(/(\d{3},\d{3})/g)![0]
      .replace(',', '_');

    const isTheSameIsle = againstCity.isleId === isleId;

    const playerBonuses = await detectCurrentPlayerBonuses();
    console.log('[ArmyMovement]: Detected player bonuses:', playerBonuses);

    const cleanBaseDistanceTime = await this.getCleanBaseDistanceTimeFromUI(againstCity, playerBonuses);
    if (!cleanBaseDistanceTime) throw new Error('Could not determine base distance time');

    const potentialUnits: (LandArmyUnit | SeaArmyUnit)[] = [
      ...(isTheSameIsle ? Object.values(landArmyUnits) : Object.values(landArmyUnits).filter(u => u.canFly)),
      ...Object.values(seaArmyUnits),
    ];

    const matches = findMatchingUnits(potentialUnits, observedTravelTimeMs, cleanBaseDistanceTime, 10000);

    console.log(
      '[ArmyMovement]: Assessed movement matches:',
      matches.map(m => ({
        unit: m.unit.name,
        possibleBonusesCount: m.possibleBonuses.length,
      })),
    );

    return matches;
  }

  /**
   * Uses UI to get a reference travel time and calculate clean base distance time.
   * Opens support form and checks travel time for a reference unit (bireme).
   * Then removes player's bonuses to get the actual distance-based time.
   *
   * @param targetCity - City to check travel time to
   * @param playerBonuses - Player's active speed bonuses (to remove from calculation)
   */
  private async getCleanBaseDistanceTimeFromUI(
    targetCity: CityInfo,
    playerBonuses: PlayerSpeedBonuses,
  ): Promise<number | null> {
    await targetCity.switchAction();
    document.querySelector<HTMLDivElement>('#town_info-support')?.click();
    await waitForElementInterval('.attack_support_window', { retries: 20, interval: 100 });

    const form = document.querySelector('form[data-type="support"]');
    if (!form) return null;

    const referenceUnit = 'bireme';
    const referenceUnitSpeed = seaArmyUnits.bireme.speed;
    const referenceUnitType = 'sea' as const;

    const wayDurationTextSnapshot = form.querySelector<HTMLElement>('.duration_container .way_duration')!.innerText!;

    const inputElement = form.querySelector<HTMLInputElement>(`input[name=${referenceUnit}]`)!;

    inputElement.value = '1';

    const refreshElement = form.querySelector<HTMLInputElement>('input[name=trireme]')!;
    refreshElement.click();
    refreshElement.click();

    let wayDurationText = '';
    await waitWhile(
      () =>
        wayDurationTextSnapshot ===
          (wayDurationText = form.querySelector<HTMLDivElement>('.duration_container .way_duration')!.innerText) &&
        !!wayDurationText,
      { delay: 100, maxIterations: 30 },
    );

    document.querySelector<HTMLDivElement>('.ui-dialog-titlebar-close')?.click();

    const referenceTimeWithBonusesMs = HHMMSS_toMS(wayDurationText);

    const cleanBaseDistanceTime = calculateCleanBaseDistanceTime(
      referenceTimeWithBonusesMs,
      referenceUnitSpeed,
      playerBonuses,
      referenceUnitType,
    );

    console.log('[ArmyMovement]: Clean base distance time calculated:', {
      referenceUnit,
      referenceTimeWithBonusesMs,
      referenceUnitSpeed,
      playerBonuses,
      cleanBaseDistanceTime,
    });

    return cleanBaseDistanceTime;
  }
}
