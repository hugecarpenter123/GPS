// TODO: finish later, because it has lower priority now

import GeneralInfo from "../master/ui/general-info";

import Lock from "../../utility/ui-lock";

export default class PlayerInfo {
  private static instance: PlayerInfo;
  private generalInfo!: GeneralInfo;
  private lock!: Lock;
  private constructor() {

  }
  public static async getInstance(): Promise<PlayerInfo> {
    if (!PlayerInfo.instance) {
      PlayerInfo.instance = new PlayerInfo();
      PlayerInfo.instance.lock = Lock.getInstance();
      PlayerInfo.instance.generalInfo = GeneralInfo.getInstance();
      await PlayerInfo.instance.init();
    }
    return PlayerInfo.instance;
  }

  private async init() {
    const mutationCallback = (mutationsList: MutationRecord[]) => {
      for (const mutation of mutationsList) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.getAttribute('role') === 'dialog') {
            if (node.querySelector('#player_towns')) {
              this.extendUI(node);
            }
          }
        }
      };

      // new MutationObserver(mutationCallback)
      //   .observe(document.body, { childList: true });
    }


  }

  private extendUI(node: HTMLElement) {
    throw new Error("Method not implemented.");
  }

  private async onFindTimeClicked(node: HTMLElement) {
    try {
      await this.lock.acquire();
      this.generalInfo.showInfo('PlayerInfo:', 'Szukanie najszybszego czasu kolona do miasta...');

      const playerTowns = node.querySelectorAll('.gp_town_link');
      for (const playerTown of playerTowns) {
        const townId = playerTown.getAttribute('data-town-id');
        console.log('townId:', townId);
      }
    } catch (error) {
      console.error('Error onFindTimeClicked:', error);
    } finally {
      this.generalInfo.hideInfo();
      this.lock.release();
    }
  }
}