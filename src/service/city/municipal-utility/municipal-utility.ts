/*
Klasa która umozliwia wykonywanie:
-festynu miejskiego wraz z pobraniem surowców
-wystepu teatralnego wraz z pobraniem surowców
-pochodu triumfalnego

Sposób działania:
Dedykowane okno z konfuguracją triggerowane ikonką,
w którym można dodać do kolejki głównej daną operację zarówno dla obecnego miasta lub dla wybranych miast, lub wszystkich
które mają możliwość wykonania danej operacji. Dodatkowo będzie wybór priorytetu tzn: w momencie gdy operacja nie ma już cooldownu
albo przesunąć na początek kolejki albo zlecić na koniec obecnej.
Przewidywane pola/opcje w oknie: 
-festyn:
  *select z miastami w których wykonać / fajka dla wszystkich które mogą
  *priorytet
  *powtarzalność: domyślnie - jeden raz, n-razy, fajka - w pętli

// TODO: później
-pochód:
 *ile pochodów wykonać
-występy teatralne:
  *select z miastami w których wykonać / fajka dla wszystkich które mogą
  *priorytet
  *powtarzalność: domyślnie - jeden raz, n-razy, fajka - w pętli
*/

// import Service from '../../../utility/Service';
// import MasterQueueService from '../../../utility/master-queue-service';
// import { textToMs, waitWhile } from '../../../utility/plain-utility';
// import Lock from '../../../utility/ui-lock';
// import { waitForElementInterval } from '../../../utility/ui-utility';
// import ResourceManager, { ResourcesInfo } from '../../resources/resource-manager';
// import TradeManager from '../../trade/trade-manager';
// import CitySwitchManager, { CityInfo } from '../city-switch-manager';
// import { BaseQueueItemDetails, QueuePriority, ScheduleOperationDetails } from '../../master-queue/master-queue';
// import GeneralInfo from '../../master/ui/general-info';
// import municipalUtilityStyle from './index.css';
// import municipalUtilityHTML from './index.prod.html';
// import { useMunicipalUtilityUI } from './municipal-utility-ui';

// export enum MunicipalEvent {
//   CityFestival = 'City Festival',
//   TriumphalProcession = 'Triumphal Procession',
//   TheatrePerformances = 'Theatre Performances',
// }

// interface MunicipalUtilitySubmitData {
//   selectedEvent: MunicipalEvent;
//   repetitiveness: number;
//   continuous: boolean;
//   priority: QueuePriority;
//   selectedCities: CityInfo[];
// }

// interface MunicipalUtilityQueueItem extends BaseQueueItemDetails {
//   operationType: MunicipalEvent;
//   repetitiveness: number;

//   priority: QueuePriority;
//   maxShipmentTime: number;
//   supplierCities: CityInfo[];
// }

// const CityFestivalResources: ResourcesInfo = {
//   wood: 15000,
//   stone: 18000,
//   iron: 15000,
// } as const;

// const TheatrePerformancesResources: ResourcesInfo = {
//   wood: 10000,
//   stone: 12000,
//   iron: 10000,
// } as const;

// export default class MunicipalUtility implements Service, MasterQueueService<MunicipalUtilityQueueItem> {
//   private RUN: boolean = false;
//   private lock!: Lock;
//   private tradeManager!: TradeManager;
//   private resourceManager!: ResourceManager;
//   private generalInfo!: GeneralInfo;
//   private UI = useMunicipalUtilityUI();

//   private static instance: MunicipalUtility;
//   private constructor() {}

//   public static async getInstance(): Promise<MunicipalUtility> {
//     if (!MunicipalUtility.instance) {
//       MunicipalUtility.instance = new MunicipalUtility();
//       MunicipalUtility.instance.lock = Lock.getInstance();
//       MunicipalUtility.instance.generalInfo = GeneralInfo.getInstance();
//       MunicipalUtility.instance.tradeManager = await TradeManager.getInstance();
//       MunicipalUtility.instance.resourceManager = await ResourceManager.getInstance();
//     }
//     return MunicipalUtility.instance;
//   }
//   // service implementation ------
//   isRunning = () => this.RUN;
//   start = async () => {
//     this.RUN = true;
//     this.UI.mount({
//       availableCities: (await CitySwitchManager.getInstance()).getCityList(),
//       onSubmit: data => this.handleSubmit(data),
//     });
//   };
//   stop = () => {
//     this.RUN = false;
//     this.UI.unmount();
//   };

//   public async execute(operationDetails: ScheduleOperationDetails<MunicipalUtilityQueueItem>): Promise<void> {
//     await this.tryPerformOrScheduleOperation(operationDetails);
//   }
//   // end of service implementation

//   private async tryPerformOrScheduleOperation(operationDetails: ScheduleOperationDetails<MunicipalUtilityQueueItem>) {
//     const {
//       city,
//       queueItem: { operationType },
//     } = operationDetails;
//     // let timeoutId: NodeJS.Timeout;
//     try {
//       await this.lock.acquire();
//       this.generalInfo.showInfo('MunicipalUtility:', `performing "${operationDetails.queueItem.operationType}"`);
//       await city.switchAction();
//       const operationPerformDetials = await this.getCanPerformDetails(operationType);
//       if (!operationPerformDetials.canPerform) {
//         operationDetails.shiftQueueAndNext();
//       }
//       // not blocked by counter
//       else if (operationPerformDetials.timeToPerform === 0) {
//         // resources needed (and no time to wait)
//         if (
//           operationPerformDetials.requiredResources &&
//           Object.values(operationPerformDetials.requiredResources).some(Boolean)
//         ) {
//           // TODO: get supplier cities to pass as an argument
//           const stackResult = await this.tradeManager.stackResources(
//             operationPerformDetials.requiredResources,
//             city,
//             [] as CityInfo[],
//             20000,
//           );
//           // stacked fully, so perform and shift
//           if (stackResult.fullyStacked) {
//             operationDetails.setScheduleTimeout(
//               async () => {
//                 await this.tryPerformOrScheduleOperation(operationDetails);
//               },
//               stackResult.timeMs,
//               'resources',
//             );
//           }
//           // not fully stacked, reschedule in 10 min
//           else if (stackResult) {
//             const callback = async () => await this.tryPerformOrScheduleOperation(operationDetails);
//             operationDetails.setScheduleTimeout(callback, 600000, 'slot');
//           }
//         }
//         // perform straight away (resources present, no time to wait)
//         else {
//           const result = await this.performOperation(operationType);
//           if (result) operationDetails.onFinishCallback();
//           else {
//             const callback = async () => await this.tryPerformOrScheduleOperation(operationDetails);
//             operationDetails.setScheduleTimeout(callback, 600000, 'other');
//           }
//         }
//       }
//       // there is time to wait until can be done
//       else {
//         // TODO: make mechanism that will read priority and based on this (potentially move it to the front when the time comes)
//         const callback = async () => await this.tryPerformOrScheduleOperation(operationDetails);
//         operationDetails.setScheduleTimeout(callback, operationPerformDetials.timeToPerform!, 'slot');
//       }
//     } catch (e) {
//       console.error('tryPerformOrScheduleOperation catch block:', e);
//       this.generalInfo.showError(
//         'MunicipalUtility:',
//         `Something went wrong when performing "${operationDetails.queueItem.operationType}"`,
//       );
//     } finally {
//       this.closeAgoraDialog();
//       this.generalInfo.hideInfo();
//       this.lock.release();
//     }
//   }

//   /**
//    * Tells whether operation can be performed, and gives details if needed about remaining time to operation and required resources.
//    * @requires Lock
//    * @requires CityInfo to be current
//    */
//   private async getCanPerformDetails(
//     operation: MunicipalEvent,
//   ): Promise<{ canPerform: boolean; timeToPerform?: number; requiredResources?: ResourcesInfo }> {
//     await this.goToCultureView();

//     // check
//     if (operation === MunicipalEvent.CityFestival) {
//       const button = await waitForElementInterval('.btn_city_festival');
//       const container = button.parentElement;
//       const isError = !!button.querySelector('error_msg');
//       const countdownEl = container?.querySelector('#countdown_party')?.textContent;
//       const timeToPerform = countdownEl ? textToMs(countdownEl) : 0;
//       let canPerform = !button.classList.contains('disabled') || (!isError && timeToPerform !== undefined);
//       let requiredResources: ResourcesInfo | undefined;
//       if (canPerform) {
//         requiredResources = await this.resourceManager.getLackingResources(CityFestivalResources);
//         if (requiredResources.storageCapacity) canPerform = false;
//       }

//       return {
//         canPerform,
//         timeToPerform,
//         requiredResources,
//       };
//     } else if (operation === MunicipalEvent.TriumphalProcession) {
//       const button = await waitForElementInterval('.btn_victory_procession');
//       const container = button.parentElement;
//       const isError = !!button.querySelector('error_msg');
//       const countdownEl = container?.querySelector('#countdown_triumph')?.textContent;
//       const timeToPerform = countdownEl ? textToMs(countdownEl) : 0;
//       const canPerform = !button.classList.contains('disabled') || (!isError && timeToPerform != undefined);

//       return {
//         canPerform,
//         timeToPerform,
//       };
//     } else if (operation === MunicipalEvent.TheatrePerformances) {
//       const button = await waitForElementInterval('.btn_theater_plays');
//       const container = button.parentElement;
//       const isError = !!button.querySelector('error_msg');
//       const countdownEl = container?.querySelector('#countdown_theater')?.textContent;
//       const timeToPerform = countdownEl ? textToMs(countdownEl) : 0;
//       let canPerform = !button.classList.contains('disabled') || (!isError && timeToPerform !== undefined);
//       let requiredResources: ResourcesInfo | undefined;
//       if (canPerform) {
//         requiredResources = await this.resourceManager.getLackingResources(CityFestivalResources);
//         if (requiredResources.storageCapacity) canPerform = false;
//       }
//       return {
//         canPerform,
//         timeToPerform,
//         requiredResources,
//       };
//     } else {
//       return { canPerform: false };
//     }
//   }

//   private handleSubmit(data: MunicipalUtilitySubmitData) {}

//   private async goToCultureView() {
//     // city view
//     document.querySelector<HTMLDivElement>('[name="city_overview"]')?.click();
//     // open agora
//     (await waitForElementInterval('[data-building="place"]')).click();

//     // switch to culture tab
//     (await waitForElementInterval('#building_place-culture')).click();
//     await waitWhile(() => !document.querySelector('#place_container'));
//   }

//   /**
//    * @requires Lock
//    * @requires city being the current one
//    */
//   private async performOperation(operation: MunicipalEvent): Promise<boolean> {
//     await this.goToCultureView();
//     if (operation === MunicipalEvent.CityFestival) {
//       document.querySelector<HTMLElement>('.btn_city_festival')?.click();
//       await waitWhile(
//         () => !document.querySelector<HTMLElement>('.btn_city_festival')?.classList.contains('disabled'),
//         { onError: () => false },
//       );
//       return true;
//     } else if (operation === MunicipalEvent.TheatrePerformances) {
//       document.querySelector<HTMLElement>('.btn_theater_plays')?.click();
//       await waitWhile(
//         () => !document.querySelector<HTMLElement>('.btn_theater_plays')?.classList.contains('disabled'),
//         { onError: () => false },
//       );
//       return true;
//     } else {
//       document.querySelector<HTMLElement>('.btn_victory_procession')?.click();
//       await waitWhile(
//         () => !document.querySelector<HTMLElement>('.btn_victory_procession')?.classList.contains('disabled'),
//         { onError: () => false },
//       );
//       return true;
//     }
//   }

//   private closeAgoraDialog() {
//     document
//       .querySelector<HTMLElement>('#place_container')
//       ?.parentElement?.parentElement?.parentElement?.querySelector<HTMLButtonElement>('button.ui-dialog-titlebar-close')
//       ?.click();
//   }
// }
