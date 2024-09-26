import { textToMs } from "../../utility/plain-utility";
import { waitForElement } from "../../utility/ui-utility";

export default class BarbaricVillageManager {
  private static instance: BarbaricVillageManager;
  private RUN: boolean = false;
  private attackTimeout: NodeJS.Timeout | null = null;
  private constructor() { }

  public static getInstance(): BarbaricVillageManager {
    if (!BarbaricVillageManager.instance) {
      BarbaricVillageManager.instance = new BarbaricVillageManager();
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
      element?.click();
      return acc + parseInt(element?.textContent ?? '0');
    }, 0)

    const enemyUnitcount = Array.from(document.querySelectorAll('.enemy_units_box .value'))
      .reduce((acc, e) => acc + parseInt(e.textContent ?? '-1'), 0)

    if (enemyUnitcount > 0 && totalCount > enemyUnitcount) {
      const wayDuration = textToMs(document.querySelector('.unit_picker_container .way_duration')!.textContent!);
      document.querySelector<HTMLElement>('[data-buttonid="btn_attack_attackspot"]')?.click();
      // TODO: perform timeout x2, and repeat the process
    } else {
      // TODO: mounting observer on army and retrying when possible. (possibly army instance which will handle all army related observations)
    }
  }
}
