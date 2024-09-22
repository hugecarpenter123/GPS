import { notEqual } from "assert";
import CitySwitchManager, { CityInfo } from "../city/city-switch-manager";
import MasterManager from "../master/master-manager";
import buttonPanelExtension from './button-panel-extension.html';
import { addDelay, textToMs } from "../../utility/plain-utility";
import { performComplexClick, waitForElement } from "../../utility/ui-utility";
import { TConfig } from "../../../gps.config";
import ConfigManager from "../../utility/config-manager";

enum ScheduleType {
  ARMY_ATTACK,
  ARMY_SUPPORT,
  ARMY_WITHDRAW,
  RESOURCE_SHIPMENT,
}
type ScheduleItem = {
  type: ScheduleType;
  time: number;
  sourceCity: CityInfo;
  destinationCity: [number, number] | string;
  data: any;
}

export default class Scheduler {
  private static instance: Scheduler;
  private masterManager!: MasterManager;
  private config!: TConfig;
  private citySwitchManager!: CitySwitchManager;
  private schedule: ScheduleItem[] = [];

  privateconstructor() { }

  public static async getInstance(): Promise<Scheduler> {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
      Scheduler.instance.masterManager = await MasterManager.getInstance();
      Scheduler.instance.citySwitchManager = await CitySwitchManager.getInstance();
      Scheduler.instance.config = ConfigManager.getInstance().getConfig();
      Scheduler.instance.addUIExtenstion();
    }
    return Scheduler.instance;
  }

  private async addUIExtenstion() {
    await this.mountCityDialogObserver();
  }

  /**
   * Ma rozpoznawać, czy znajduje się na karcie ATAK/OBRONA
   * Ma dodać schdule button i inputy do podania czasu wykonania operacji.
   * Na schedule click:
   * -zczytać i zapamiętać wartości imputów
   * -zczytać czas podróży jednostek i obliczyć na podstawie tych danych timeout
   * -zczytać wioskę źródłową oraz gridy wioski na której operacja ma być wykonana
   * -dodać obiekt ScheduleItem do listy oraz do LocaleStorage oraz ustawic timeout
   * -timeout powinien usunąć wszstko co z nim związane powykonaniu operacji
   */
  private async extendAttackSupportUI(node: HTMLElement): Promise<void> {
    // observer mounted, argument is the grand parent of the button panel
    const buttonWrapper = node.querySelector('.button_wrapper')!;
    const div = document.createElement('div');
    div.innerHTML = buttonPanelExtension;
    buttonWrapper.appendChild(div);

    // Element ready, logic below:
    const inputDateElement = document.querySelector<HTMLInputElement>('#schedule-date')!;
    // prefill date input with current date
    inputDateElement.value = this.getFormattedInputValueFromDate(new Date());

    const scheduleButton = div.querySelector('#schedule-button')!;
    scheduleButton.addEventListener('click', async () => {
      // get way duration time
      const wayDurationText = node.querySelector('.way_duration')!.textContent!.slice(1);
      const wayDuration = textToMs(wayDurationText);
      // get input data (all unit inputs)
      const inputData = Array.from(node.querySelectorAll<HTMLInputElement>('.unit_input')).map(inputEl => {
        return {
          name: inputEl.getAttribute('name')!,
          value: inputEl.value
        }
      })

      const operationType = node.firstElementChild!.getAttribute('data-type') === 'attack' ? ScheduleType.ARMY_ATTACK : ScheduleType.ARMY_SUPPORT;
      const inputDateValue = inputDateElement.value
      // Wartość z inputu type="date" będzie w formacie "YYYY-MM-DD"
      // Na przykład: "2023-05-25" dla 25 maja 2023

      // #schedule-time      
      const inputTimeValue = document.querySelector<HTMLInputElement>('#schedule-time')!.value
      const targetDate = this.getDateFromDateTimeInputValues(inputDateValue, inputTimeValue);
      const sourceCity = this.citySwitchManager.getCurrentCity()
      if (!sourceCity) {
        throw new Error('Source city not found');
      }
      const infoSubcard = document.querySelector('#town_info-info');
      (infoSubcard as HTMLElement)?.click();
      const coordsElement = await waitForElement('.sea_coords', 2000).then(el => el.parentElement);
      const destinationCityGrid: [number, number] = coordsElement?.textContent!.match(/\(\d{3},\d{3}\)/)![0].slice(1, -1).split(',').map(Number) as [number, number];

      // - minutę przed czasem operacji właściwej wyłącz wszytskie managery (może oprócz guarda)
      // - 10 sekund przed czasem operacji właściwej, wykonaj operację na UI by ustawić inputy i być w gotowości do wciśnięcia submita
      // - submit w momencie planu
      const oneMinuteBeforeAction = targetDate.getTime() - new Date().getTime() - 60 * 1000;

      console.log('parsed info:')
      console.log('inputData:', inputData)
      console.log('wayDuration', wayDuration)
      console.log('operationType', operationType === ScheduleType.ARMY_ATTACK ? 'attack' : 'support')
      console.log('destinationCityGrid', destinationCityGrid)
      console.log('sourceCity', sourceCity);
      console.log('targetDate', targetDate)

      // setTimeout(() => {
      //   const tenSecondsBeforeAction = targetDate.getTime() - new Date().getTime() - 10 * 1000;
      //   this.masterManager.stopAll();

      //   setTimeout(() => {
      //     console.log('should perform action');
      //   }, tenSecondsBeforeAction)
      // }, oneMinuteBeforeAction);
    });
  }


  private getDateFromDateTimeInputValues(inputDateValue: string, inputTimeValue: string) {
    const timeRegex = /(\d{2})\D*(\d{2})\D*(\d{2})/;
    const match = inputTimeValue.match(timeRegex);
    if (!match || !inputDateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
      throw new Error('Invalid time format');
    }
    const [, hours, minutes, seconds] = match;
    const parsedTime = `${hours}:${minutes}:${seconds}`;
    return new Date(`${inputDateValue}T${parsedTime}`);
  }

  private getFormattedInputValueFromDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Miesiące są indeksowane od 0
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private mountAttackSupportSubpageObserver(parentNode: HTMLElement): () => void {
    console.log('Scheduler.mountAttackSupportSubpageObserver')
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains('attack_support_window')) {
              console.log('Scheduler.mountAttackSupportSubpageObserver: found attack/support subpage')
              this.extendAttackSupportUI(node as HTMLElement);
              return
            }
          }
        }
      }
    })
    observer.observe(parentNode, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  private async mountCityDialogObserver(): Promise<void> {
    console.log('Scheduler.mountCityDialogObserver')
    let unobserveAttackSupportSubpages: (() => void) | null = null;
    '[class="ui-dialog ui-corner-all ui-widget ui-widget-content ui-front ui-draggable ui-resizable js-window-main-container"]'
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE &&
              (node as HTMLElement).getAttribute('class') === 'ui-dialog ui-corner-all ui-widget ui-widget-content ui-front ui-draggable ui-resizable js-window-main-container') {
              console.log('Scheduler.mountCityDialogObserver: found dialog node')
              unobserveAttackSupportSubpages = this.mountAttackSupportSubpageObserver(node as HTMLElement);
              return;
            }
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE &&
              (node as HTMLElement).getAttribute('role') === 'dialog' &&
              (node as HTMLElement).classList.contains('ui-dialog') &&
              (node as HTMLElement).classList.contains('js-window-main-container')
            ) {
              if (unobserveAttackSupportSubpages) {
                unobserveAttackSupportSubpages();
                unobserveAttackSupportSubpages = null;
                return;
              }
            }
          }
        }
      }
    })

    observer.observe(document.body, {
      childList: true,
    });

  }
}