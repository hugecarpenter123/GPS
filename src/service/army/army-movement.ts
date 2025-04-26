/*
 * Stworzyć utility, które będzie śledziło i rejestrowało ruch
 */

import { InfoError } from '../../utility/info-error';
import { addDelay, getBrowserStateSnapshot } from '../../utility/plain-utility';
import { performComplexClick, setInputValue, waitForElement, waitForElementInterval } from '../../utility/ui-utility';
import { CharmDetails } from '../charms/charms-utility';
import { CityInfo } from '../city/city-switch-manager';
import { rework_ScheduleItem, SchedulerExecute, SchedulerExecutor } from '../scheduler/Scheduler.rework';

enum OperationType {
  ATTACK,
  SUPPORT,
  WITHDRAW,
}

enum AttackType {
  NORMAL,
  MUTINY,
}

interface OperationDetails {
  id: string;
  operationType: OperationType;
  movementId: string | null;
  targetTime: number;
  actionTime: number;
  realActionTime: number;
  sourceCity: CityInfo;
  targetCitySelector: string;
  targetCityCords: [string, string];
  targetCityName: string;
  precision:
    | false
    | {
        maxDiscrepancy: number;
        onFailure: 'cancel' | 'leave';
      };
  preparationTime: number;
  undoMovementAction: (() => void) | null;
}

interface AttackOperationDetails extends OperationDetails {
  attackType: AttackType;
  includeHero: boolean;
  power: CharmDetails;
  data: { name: string; value: string }[];
  attackIfAlly: boolean;
}

interface SupportOperationDetails extends OperationDetails {
  data: { name: string; value: string }[];
}

export default class ArmyMovement implements SchedulerExecutor {
  private error: string | null = null;

  private static instance: ArmyMovement;
  private callback: ((id: string) => void) | null = null;
  private constructor() {}

  public static getInstance(): ArmyMovement {
    if (!ArmyMovement.instance) {
      ArmyMovement.instance = new ArmyMovement();
      // ArmyMovement.instance.mountObserver();
    }
    return ArmyMovement.instance;
  }

  private mountObserver() {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (
              node instanceof HTMLElement &&
              node.getAttribute('data-commandtype') === 'unit_movements' &&
              node.getAttribute('data-cancelable') != '-1'
            ) {
              if (this.callback) {
                this.callback(node.id);
                this.callback = null;
                return;
              }
            }
          }
        }
      });
    });
    const element = document.querySelector(
      '#toolbar_activity_commands_list .content.js-dropdown-item-list',
    ) as HTMLElement;
    observer.observe(element, {
      childList: true,
      subtree: false,
    });
  }

  public setCallback(callback: (id: string) => void) {
    this.callback = callback;
  }

  /**
   * -Otwiera dialog z formularzem
   * -wypełnia w nim dane operacji (jednostki, zaklęcia, rodzaj ataku, bohatera)
   * -wykonuje akcję w określonym czasie t
   * -dostaje callbacki do:
   *  --?przekazania callbacka do anulowania wszystkich timeoutów związanych z tym działaniem
   *  --?do zaprzestania wykonywania operacji
   * @param operationDetails
   */
  public async performAttack(operationDetails: AttackOperationDetails) {
    // TODO: make sure ID is what it should be
    await this.openCityOperationDialog(
      operationDetails.id,
      operationDetails.targetCitySelector,
      operationDetails.operationType,
    );
  }

  private async openCityOperationDialog(
    locationId: string,
    targetCitySelector: string,
    operationType: Omit<OperationType, OperationType.WITHDRAW>,
  ) {
    document.querySelector<HTMLButtonElement>('.js-coord-button')?.click();
    const dropdownList = await waitForElementInterval('.content.js-dropdown-item-list', { interval: 333, retries: 5 });
    const dropdownItem = Array.from(dropdownList.querySelectorAll<HTMLElement>(`.item.bookmark.option`)).find(
      el => el.textContent?.trim() === locationId,
    );
    if (!dropdownItem) {
      this.error = 'Failed to find saved coordinates from the list';
      throw new Error('Failed to find saved coordinates from the list');
    }

    dropdownItem.click();

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
        throw new InfoError('target city not found', null);
      },
    );

    // TODO: reghink if this is needed
    let counter = 0;
    do {
      await performComplexClick(targetCityElement);
      counter++;
      await addDelay(333);
    } while (!document.querySelector<HTMLElement>('#context_menu') && counter < 4);

    if (counter === 4) {
      throw new InfoError('target city not found', null);
    }

    if (operationType === OperationType.ATTACK) {
      (await waitForElementInterval('#attack', { interval: 500, timeout: 2000 })).click();
    } else {
      (await waitForElementInterval('#support', { interval: 500, timeout: 2000 })).click();
    }
  }

  private async fillInputData(
    inputData: { value: string; name: string }[],
    attachHero?: boolean,
    charm?: CharmDetails,
  ) {
    console.log('fill inputData');
    for (const data of inputData) {
      if (data.value) {
        const input = (await waitForElementInterval(`input[name="${data.name}"]`, {
          interval: 500,
          timeout: 2000,
        })) as HTMLInputElement;
        setInputValue(input, data.value);
      }
    }

    if (attachHero) {
      (await waitForElementInterval('.cbx_include_hero')).click();
    }

    if (charm) {
      await waitForElementInterval('#spells_1', { interval: 500, timeout: 2000 }).then(el =>
        (el as HTMLElement).click(),
      );
      await waitForElementInterval(`[data-power_id="${charm.dataPowerId}"`, { interval: 500, timeout: 2000 }).then(el =>
        (el as HTMLElement).click(),
      );
    }
  }

  public performSupport(operationDetails: SupportOperationDetails) {}

  public async execute(
    item: rework_ScheduleItem,
    utils: {
      successCallback: (landedTime: number, movementId: string) => void;
      failureCallback: () => void;
      assignTimeout: (timeoutId: NodeJS.Timeout) => void;
    },
  ) {}
}
