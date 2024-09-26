export default class ArmyMovement {
  private static instance: ArmyMovement;
  private callback: ((id: string) => void) | null = null;
  private constructor() { }

  public static getInstance(): ArmyMovement {
    if (!ArmyMovement.instance) {
      ArmyMovement.instance = new ArmyMovement();
      ArmyMovement.instance.mountObserver();
    }
    return ArmyMovement.instance;
  }

  private mountObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement && node.getAttribute('data-commandtype') === 'unit_movements' && node.getAttribute('data-cancelable') != '-1') {
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
    const element = document.querySelector('#toolbar_activity_commands_list .content.js-dropdown-item-list') as HTMLElement;
    observer.observe(element, {
      childList: true,
      subtree: false,
    });
  }

  public setCallback(callback: (id: string) => void) {
    this.callback = callback;
  }
}