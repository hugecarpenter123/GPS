import Lock from "../../utility/ui-lock";
import { waitForElementInterval } from "../../utility/ui-utility";
import CitySwitchManager from "../city/city-switch-manager";
import ResourceManager from "../resources/resource-manager";

export default class Recruiter {
  private static instance: Recruiter;
  private resourceManager!: ResourceManager;
  private lock!: Lock;
  private citySwitchManager!: CitySwitchManager;

  private RUN: boolean = false;
  private observer: MutationObserver | null = null;

  private constructor() {};

  public static async getInstance() {
    if (!Recruiter.instance) {
      Recruiter.instance = new Recruiter();
      Recruiter.instance.resourceManager = await ResourceManager.getInstance();
      Recruiter.instance.lock = Lock.getInstance();
      Recruiter.instance.citySwitchManager = await CitySwitchManager.getInstance();
    }
    return Recruiter.instance;
  }

  public async start() {
    this.RUN = true;
    if (!this.observer) {
      this.observer = this.mountObserver();
    }
  }
  
  public async stop() {
    this.RUN = false;
    this.observer?.disconnect();
    this.observer = null;
  }

  public isRunning() {
    return this.RUN;
  }
  
  private mountObserver(): MutationObserver {
    const checkAsyncCondition = async (node: Node) => {
      if (node instanceof HTMLElement 
        && node.getAttribute('role') === 'dialog' 
        && await waitForElementInterval('.barracks_building', {fromNode: node, interval: 333, retries: 4})) {
        this.extendUI(node);
      }
    }

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            checkAsyncCondition(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
    return observer;
  }

  /**
   * 1. Metoda dodaje przycisk recruiter w prawym górnym rogu
   * 2. Po przyciśnięciu pojawia sie okno dialogowe
   * 3. W oknie są do wypełnienia następujące inputy:
   *    -ile slotów jednostki produkować (liczba | 'max')
   *    -lista miast z jakich można pobierać surowce
   *    -przycisk `submit`
   * 4. Po wciśnięciu submit inna metoda zajmuje się implementacją działania
   * 5. Okno dialogowe pokazuje obecną kolejkę przypisaną do miasta wraz z czasami rekrutacji
   * 6. Przycisk anuluj, który kasuje (na tą chwilę) całość zaplanowanych operacji i elementy w kolejce
   * 
   * @param node 
   */
  private extendUI(node: HTMLElement) {
    console.log('extend rectuiter ui inside this node:', node);
  }

}