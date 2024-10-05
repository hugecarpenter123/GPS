import { textToMs } from "../../utility/plain-utility";
import { performComplexClick, waitForElement } from "../../utility/ui-utility";
import CitySwitchManager from "../city/city-switch-manager";

type scheduleItem = { collectRewardTimeout: NodeJS.Timeout | null, repeatTimeout: NodeJS.Timeout | null }

export default class BarbaricVillageManager {
  private static instance: BarbaricVillageManager;
  private scheduleArray: scheduleItem[] = [];
  private citySwitchManager!: CitySwitchManager;
  private RUN: boolean = false;
  private attackTimeout: NodeJS.Timeout | null = null;
  private constructor() { }

  public static async getInstance(): Promise<BarbaricVillageManager> {
    if (!BarbaricVillageManager.instance) {
      BarbaricVillageManager.instance = new BarbaricVillageManager();
      BarbaricVillageManager.instance.citySwitchManager = await CitySwitchManager.getInstance();
    }
    return BarbaricVillageManager.instance;
  }


  public start() {
    // TODO: logic about checking if attack is possible, possibly mounting observer on army and retrying when possible.
    this.RUN = true;
    console.log('Starting');
  }
  public stop() {
    this.RUN = false;
    if (this.attackTimeout) clearTimeout(this.attackTimeout);
    console.log('Stopping');
  }
  public isRunning() {
    return this.RUN;
  }

  public async doAttack() {
    document.querySelector<HTMLElement>('[name="island_view"]')?.click();
    const unitBox = await waitForElement('.unit_picker_container');
    // .textContent holds unit count
    // const slingers = unitBox.querySelector<HTMLElement>('[data-game_unit="slinger"].unit')?.click();
    // const hoplite = unitBox.querySelector<HTMLElement>('[data-game_unit="hoplite"].unit')?.click();
    // const cavalry = unitBox.querySelector<HTMLElement>('[data-game_unit="cavalry"].unit')?.click();
    // const chariot = unitBox.querySelector<HTMLElement>('[data-game_unit="chariot"].unit')?.click();
    // const godsent = unitBox.querySelector<HTMLElement>('[data-game_unit="godsent""].unit')?.click();
    const offArmy = [
      unitBox.querySelector<HTMLElement>('[data-game_unit="slinger"].unit'),
      unitBox.querySelector<HTMLElement>('[data-game_unit="hoplite"].unit'),
      unitBox.querySelector<HTMLElement>('[data-game_unit="cavalry"].unit'),
      unitBox.querySelector<HTMLElement>('[data-game_unit="chariot"].unit'),
      unitBox.querySelector<HTMLElement>('[data-game_unit="godsent""].unit'),
    ]

    const totalCount = offArmy.reduce((acc, element) => {
      const count = parseInt(element?.textContent ?? '0');
      element?.click();
      return acc + count;
    }, 0)

    const enemyUnitcount = Array.from(document.querySelectorAll('.enemy_units_box .value'))
      .reduce((acc, e) => acc + parseInt(e.textContent ?? '0'), 0)

    if (enemyUnitcount > 0 && totalCount > enemyUnitcount) {
      const scheduleItem = {
        collectRewardTimeout: null as NodeJS.Timeout | null,
        repeatTimeout: null as NodeJS.Timeout | null,
      }

      const wayDuration = textToMs(document.querySelector('.unit_picker_container .way_duration')!.textContent!);
      document.querySelector<HTMLElement>('[data-buttonid="btn_attack_attackspot"]')?.click();
      const currentCity = this.citySwitchManager.getCurrentCity()!;
      const collectRewardTimeout = setTimeout(async () => {
        await currentCity.switchAction();
        performComplexClick(await waitForElement('.attack_spot collect_reward'));
        (await waitForElement('.btn_collect.button_new.double_border .caption.js-caption', 3000))?.click();
      }, wayDuration);
      // TODO: perform timeout x2, and repeat the process
      const repeatTimeout = setTimeout(async () => {
        await currentCity.switchAction();
        this.doAttack();

      }, wayDuration * 2);

      scheduleItem.collectRewardTimeout = collectRewardTimeout;
      scheduleItem.repeatTimeout = repeatTimeout;

      this.scheduleArray.push(scheduleItem);

    } else {
      // TODO: mounting observer on army and retrying when possible. (possibly army instance which will handle all army related observations)
    }
  }
}
