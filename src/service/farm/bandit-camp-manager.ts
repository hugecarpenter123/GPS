import Service from '~/utility/Service';
import Lock, { LockOperationCancelledError } from '~/utility/ui-lock';
import { HHMMSS_toMS, waitWhile } from '../../utility/plain-utility';
import {
  getBrowserExecutionContextInfo,
  performComplexClick,
  performOnDocumentVisibilityReturn,
  waitForElementInterval,
} from '../../utility/ui-utility';
import ArmyMovement from '../army/army-movement';
import {
  type LandArmyUnitName,
  getLandCounterUnits,
  LandArmyUnit,
  landArmyUnits,
  offLandArmyUnitNames,
} from '../army/army-units';
import CitySwitchManager from '../city/city-switch-manager';
import GeneralInfo from '../master/ui/general-info';

export default class BanditCampManager implements Service<'bandit'> {
  private static instance: BanditCampManager;
  private lock!: Lock;
  private armyMovement!: ArmyMovement;
  private citySwitchManager!: CitySwitchManager;
  private generalInfo!: GeneralInfo;
  private RUN: boolean = false;
  private timeoutData: { timeoutId: ReturnType<typeof setTimeout> | null; scheduledTime: number | null } = {
    timeoutId: null,
    scheduledTime: null,
  };
  private constructor() {}
  private tryCount: number = 0;
  private readonly STANDARD_RETRY_TIME_MS = 10 * 60_000;
  private readonly LOG_PREFIX = '[Bandit]:';

  public pause() {
    this.stop();
  }
  public resume() {
    this.stop();
  }

  public getScheduledActionTimes(): [number, number | undefined][] {
    return this.timeoutData.scheduledTime ? [[this.timeoutData.scheduledTime, 10000]] : [];
  }
  public onConfigChange: (configChanges: Partial<unknown>) => void = () => {
    /* nothing */
  };

  public static async getInstance(): Promise<BanditCampManager> {
    if (!BanditCampManager.instance) {
      BanditCampManager.instance = new BanditCampManager();
      BanditCampManager.instance.citySwitchManager = await CitySwitchManager.getInstance();
      BanditCampManager.instance.lock = Lock.getInstance();
      BanditCampManager.instance.armyMovement = ArmyMovement.getInstance();
      BanditCampManager.instance.generalInfo = GeneralInfo.getInstance();
    }
    return BanditCampManager.instance;
  }

  public start() {
    if (!this.RUN) {
      console.log(this.LOG_PREFIX, 'BanditCampManager started');
      this.RUN = true;
      this.perform();
    }
  }

  public stop() {
    this.RUN = false;
    if (this.timeoutData.timeoutId) clearTimeout(this.timeoutData.timeoutId);
    this.timeoutData = { timeoutId: null, scheduledTime: null };
    console.log(this.LOG_PREFIX, 'BanditCampManager stopped');
  }

  public isRunning() {
    return this.RUN;
  }

  private async handleRewardCollectionFlow() {
    console.log(this.LOG_PREFIX, 'Collecting reward from bandit camp');
    await Promise.all([
      waitForElementInterval('.attack_spots .victory_bg .btn_collect', { retries: 5 }).then(el => el.click()),
      waitForElementInterval('.attack_spots .victory_bg .btn_collect a', { retries: 5 })
        .then(el => el.click())
        .catch(() => null),
    ]);

    // if stashing to the equipment is possible
    const stashOption = await waitForElementInterval('#item_reward_stash', { retries: 5 }).catch(() => null);
    if (stashOption) {
      // potential further confirmation if equipment is full
      if (document.querySelector('.toolbar_button.inventory.full')) {
        // stop the manager
        // TODO: change the config, and reflect the changes in the UI
        this.stop();
        return;
      } else {
        stashOption.click();
      }
    }
    // collection without the option to store inside the equipment
    else {
      // potential confirmation to receive resources to already full magazine
      (
        await waitForElementInterval('.window_content .confirmation .btn_confirm', { retries: 5 }).catch(
          () => undefined,
        )
      )?.click();
    }

    await waitWhile(() => !!document.querySelector('.attack_spots .victory_bg .btn_collect'), {
      maxIterations: 10,
      delay: 333,
    });
    console.log(this.LOG_PREFIX, 'Reward collected successfully');
    this.perform();
  }

  private async handleAttackFlow() {
    console.log(this.LOG_PREFIX, 'Starting attack flow');
    const defendingUnitsContainer = await waitForElementInterval('.defending_units .cb_content');

    const defendingUnits: (LandArmyUnit & { count: number })[] = Array.from(
      defendingUnitsContainer.querySelectorAll('.enemy_units_box'),
    ).map(box => ({
      ...landArmyUnits[box.getAttribute('data-type') as LandArmyUnitName],
      count: Number((box.children[0] as HTMLElement).innerText),
    }));

    const unitBox = await waitForElementInterval('.units_box');

    const ownedOffUnits = Array.from(unitBox.querySelectorAll('.unit_container'))
      .map(box => ({
        ...landArmyUnits[(box.children[0] as HTMLElement).getAttribute('data-unit_id') as LandArmyUnitName],
        count: Number((box.children[0] as HTMLElement).innerText),
      }))
      .filter(unit => unit.count > 0 && (offLandArmyUnitNames as readonly LandArmyUnitName[]).includes(unit.name));

    const ownedOffUnitsNames = ownedOffUnits.map(u => u.name);
    const ownedOffUnitsTotalCount = ownedOffUnits.reduce((acc, u) => (acc += u.count), 0);
    const defendingUnitstotalCount = defendingUnits.reduce((acc, u) => (acc += u.count), 0);

    console.log(
      this.LOG_PREFIX,
      `Owned off units: ${ownedOffUnitsTotalCount}, Defending units: ${defendingUnitstotalCount}`,
    );

    if (ownedOffUnitsTotalCount < 0.5 * defendingUnitstotalCount) {
      console.log(this.LOG_PREFIX, 'Insufficient army, scheduling retry');
      const armyMovement = (await this.armyMovement.getArmyMovementDetails('Obóz bandytów'))[0];
      const timetoRetry =
        armyMovement && armyMovement.direction === 'returning'
          ? armyMovement.arrivalTime - Date.now() + 3000
          : this.STANDARD_RETRY_TIME_MS;
      this.scheduleOperation(timetoRetry, 'waiting for army return');
      return;
    }

    let allHaveCounters = true;
    for (const defendingUnit of defendingUnits) {
      const availableCounterUnits = getLandCounterUnits(defendingUnit, 'defender', [
        'catapult',
        'centaur',
        'cerberus',
        'cyclop',
      ]).filter(unitName => ownedOffUnitsNames.includes(unitName));

      if (
        availableCounterUnits.reduce((acc, unit) => acc + (ownedOffUnits.find(u => u.name === unit)?.count ?? 0), 0) >=
        defendingUnit.count * 0.6
      ) {
        for (const unitName of availableCounterUnits) {
          const unitTrigger = unitBox.querySelector<HTMLElement>(`[data-game_unit="${unitName}"].unit`)!;
          const unitInput = unitTrigger.nextElementSibling!.querySelector('input')!;
          if (!unitInput.value) {
            unitTrigger.click();
            await waitWhile(() => !unitInput.value, { delay: 100 });
            // unitBox.querySelector<HTMLElement>(`[data-game_unit="${unit}"].unit`)?.click();
          }
        }
      } else {
        allHaveCounters = false;
      }
    }

    if (!allHaveCounters) {
      console.log(this.LOG_PREFIX, 'Not all defending units have counters, selecting all off units');
      for (const unit of ownedOffUnitsNames) {
        const unitTrigger = unitBox.querySelector<HTMLElement>(`[data-game_unit="${unit}"].unit`)!;
        const unitInput = unitTrigger.nextElementSibling!.querySelector('input') as HTMLInputElement;
        if (!unitBox.querySelector('input')?.value) {
          unitTrigger.click();
          await waitWhile(() => !unitInput.value, { delay: 100 });
        }
      }
      if (ownedOffUnitsTotalCount < defendingUnitstotalCount * 1.5) {
        console.log(this.LOG_PREFIX, 'Army ratio too low, scheduling retry');
        const timeToRetry = (await this.armyMovement.getArmyMovementSnapshot())
          .filter(movement => movement.direction === 'returning')
          .reduce((acc, curr) => {
            const time = curr.arrivalTime - Date.now();
            return time < acc ? time : acc;
          }, this.STANDARD_RETRY_TIME_MS);

        this.scheduleOperation(timeToRetry, 'waiting for better army ratio');
        return;
      }
    }

    console.log(this.LOG_PREFIX, 'Sending attack');
    (await waitForElementInterval('[data-buttonid="btn_attack_attackspot"]:not(.disabled)')).click();
    await waitWhile(() => !!document.querySelector('.classic_window.attack_spot'), { delay: 200 });
    this.scheduleOperation(2000, 'schedule reward collection');
  }

  private async closeDialog() {
    document
      .querySelector<HTMLElement>('.classic_window:is(.attack_spot, .attack_spot_victory) .btn_wnd.close')
      ?.click();
    await waitWhile(() => !!document.querySelector('.classic_window:is(.attack_spot, .attack_spot_victory)'));
  }

  private scheduleOperation(timeMs: number, reason: string) {
    if (this.timeoutData.timeoutId) {
      console.assert(
        this.timeoutData.scheduledTime! < Date.now(),
        this.LOG_PREFIX,
        'Previous scheduled time should have passed',
        { previousScheduledTime: new Date(this.timeoutData.scheduledTime!), now: new Date() },
      );
      clearTimeout(this.timeoutData.timeoutId);
    }
    const scheduledTime = Date.now() + timeMs;
    console.log(
      this.LOG_PREFIX,
      `Scheduling operation in ${Math.round(timeMs / 1000)}s (${reason}), at:`,
      new Date(scheduledTime),
    );
    this.generalInfo.showInfo(this.LOG_PREFIX, 'scheduling timeout, reason: ' + reason, 'info', 5000);
    this.timeoutData = {
      timeoutId: setTimeout(() => {
        this.perform();
      }, timeMs),
      scheduledTime,
    };
  }

  private handleCooldownCase = () => {
    const cooldown = document.querySelector('#map_attack_spots .curr[data-type="attack_spot"]')?.textContent;
    if (!cooldown) {
      console.warn(this.LOG_PREFIX, 'Cooldown element not found');
      throw new Error('Cooldown not found');
    }
    const cooldownMs = HHMMSS_toMS(cooldown);
    console.log(this.LOG_PREFIX, `Cooldown active: ${cooldown}`);
    this.scheduleOperation(cooldownMs, 'cooldown');
  };

  public async perform() {
    if (!this.RUN) return;

    let infoId!: number;
    try {
      console.log(this.LOG_PREFIX, 'Starting perform cycle at', new Date());
      await this.lock.performWithLock(
        async () => {
          infoId = this.generalInfo.showInfo(this.LOG_PREFIX, 'Szukanie obozu bandytów...', 'info', 15000);
          document.querySelector<HTMLElement>('[name="island_view"]')?.click();

          for (const city of this.citySwitchManager.getCityList()) {
            console.log(this.LOG_PREFIX, `Checking city: ${city.name}`);
            await city.switchAction();
            this.citySwitchManager.jumpToCurrentCity();

            const banditCampMovement = (await this.armyMovement.getArmyMovementDetails('Obóz bandytów'))[0];
            if (banditCampMovement) {
              if (banditCampMovement.direction === 'outgoing') {
                const timeToArrival = banditCampMovement.arrivalTime - Date.now() + 3000;
                console.log(this.LOG_PREFIX, 'Army already attacking, waiting for arrival');
                this.scheduleOperation(timeToArrival, 'attack in progress');
                return;
              }
              // else if coming back then check if can perform
            }

            const attackOrRewardTrigger = await waitForElementInterval('#map_attack_spots .attack_spot').catch(
              () => null,
            );

            if (attackOrRewardTrigger) {
              console.log(this.LOG_PREFIX, 'Found bandit camp trigger');
              await performComplexClick(attackOrRewardTrigger);

              if (attackOrRewardTrigger.classList.contains('collect_reward')) {
                await this.handleRewardCollectionFlow();
              } else if (attackOrRewardTrigger.classList.contains('cooldown_running')) {
                this.handleCooldownCase();
              } else {
                await this.handleAttackFlow();
              }
              break;
            } else {
              console.log(this.LOG_PREFIX, `No bandit camp found in city: ${city.name}`);
            }
          }

          await this.closeDialog();
          this.tryCount = 0;
          console.log(this.LOG_PREFIX, 'Perform cycle completed successfully');
        },
        {
          manager: 'bandit',
          method: 'perform',
        },
      );
    } catch (e) {
      const browserContext = getBrowserExecutionContextInfo();
      console.warn(this.LOG_PREFIX, 'perform catch:', e, browserContext);
      if (!(e instanceof LockOperationCancelledError && e.reason === 'called')) {
        if (browserContext.visibilityState === 'hidden') {
          console.warn(this.LOG_PREFIX, 'visibility hidden, scheduling after visibility return');
          performOnDocumentVisibilityReturn(() => this.perform());
        } else {
          this.tryCount += 1;
          console.warn(this.LOG_PREFIX, 'retry count:', this.tryCount);
          if (this.tryCount < 3) {
            this.perform();
          } else {
            this.tryCount = 0;
            console.error(this.LOG_PREFIX, 'Critical error, retry count exceeded, abandoning execution');
          }
        }
      }
    } finally {
      this.generalInfo.hideInfo(infoId);
    }
  }
}
