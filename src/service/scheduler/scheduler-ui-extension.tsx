// import buttonPanelExtenstionHtml from './button-panel-extension.rework.html';
// import { textToMs } from '../../utility/plain-utility';
// import { SchedulerUIExtensionSubmitDetails } from './Scheduler';

// export interface SchedulerExtensionProps {
//   onSubmit: (details: SchedulerUIExtensionSubmitDetails) => Promise<{ type: 'error' | 'info'; message: string } | void>;
// }
// export const componentName = 'scheduler-ui-extension' as const;

// // NOTE: if preact then use this
// // const SchedulerExtension = ({ onSubmit }: SchedulerExtensionProps) => {
// //   return <></>;
// // };

// const SchedulerExtension = ({ onSubmit }: SchedulerExtensionProps, container: HTMLElement) => {
//   // NOTE: ??
//   container.innerHTML = buttonPanelExtenstionHtml;

//   const schedulerError = document.getElementById('scheduler-error')!;

//   const submitButton = container.querySelector<HTMLButtonElement>('#scheduler-submit')!;
//   const dateInput = container.querySelector<HTMLInputElement>('#scheduler-date')!;
//   const targetTimeInput = container.querySelector<HTMLInputElement>('#scheduler-time')!;
//   const syncSelect = container.querySelector<HTMLSelectElement>('#scheduler-sync')!;
//   const syncDeviation = container.querySelector<HTMLInputElement>('#scheduler-sync-deviation')!;
//   const toleranceInput = container.querySelector<HTMLInputElement>('#scheduler-tolerance')!;
//   const failureTolerance = container.querySelector<HTMLInputElement>('#scheduler-failure-tolerance')!;
//   const precisionInput = document.querySelector<HTMLInputElement>('[name="scheduler-precise"]')!;

//   const schedulerRawRadio = document.getElementById('scheduler-raw-radio')! as HTMLInputElement;
//   const schedulerSyncRadio = document.getElementById('scheduler-sync-radio')! as HTMLInputElement;

//   submitButton.addEventListener('click', async () => {
//     const dateValue = dateInput.valueAsDate;
//     const targetTimeValue = targetTimeInput.value;
//     const syncValue = syncSelect.value;
//     const syncDeviationValue = Number(syncDeviation.value);
//     const toleranceValue = Number(toleranceInput.value);
//     const failureToleranceValue = Number(failureTolerance.value);
//     const precisionValue = precisionInput.value === 'true';

//     if (
//       !validateFields({
//         dateValue,
//         targetTimeValue,
//         syncValue,
//         syncDeviationValue,
//         toleranceValue,
//         failureToleranceValue,
//         precisionValue,
//       })
//     ) {
//       schedulerError.textContent = 'Some fields are filled improperly, or schedule is in the past';
//       setTimeout(() => {
//         schedulerError.textContent = '';
//       }, 5000);
//       return;
//     }

//     const submitReturn = await onSubmit({
//       timeDetails: {
//         // if synchronization is preffered, then time is null - must be assessed based on the other item
//         targetTime: schedulerSyncRadio.checked ? null : (dateValue as Date).getTime() + textToMs(targetTimeValue),
//       },
//       precision: precisionValue
//         ? {
//             tolerance: toleranceValue as number,
//             allowedToleranceIfFailed: failureToleranceValue,
//           }
//         : undefined,
//       syncWith: {
//         scheduleId: syncValue,
//         deviation: syncDeviationValue,
//       },
//     });
//     if (submitReturn) {
//     }
//   });

//   const validateFields = (fields: {
//     dateValue: any;
//     targetTimeValue: any;
//     syncValue: any;
//     syncDeviationValue: any;
//     toleranceValue: any;
//     failureToleranceValue: any;
//     precisionValue: boolean;
//   }): boolean => {
//     const dataTimeFilled =
//       (schedulerRawRadio.checked && /\d{2}:\d{2}:\d{2}/.test(fields.targetTimeValue)) ||
//       (schedulerSyncRadio.checked && fields.syncValue);

//     const isNotInThePast =
//       fields.dateValue instanceof Date
//         ? fields.dateValue.getTime() + textToMs(fields.targetTimeValue) > Date.now()
//         : false;

//     return dataTimeFilled && isNotInThePast;
//   };
// };

// const addStyleIfNotAdded = () => {
//   // NOTE: no style
//   // if (!document.head.querySelector(`[data-for="${componentName}"]`)) {
//   //   console.log('should add style');
//   //   const style = document.createElement('style');
//   //   style.dataset.for = componentName;
//   //   //   TODO: add
//   //   style.textContent = '';
//   //   document.head.appendChild(style);
//   // }
// };

// export type SchedulerUIExtensionUIUtility = ReturnType<typeof useSchedulerUIExtensionUI>;
// export const useSchedulerUIExtensionUI = () => {
//   let container: HTMLElement;
//   const mount = (mountContainer: HTMLElement, props: SchedulerExtensionProps) => {
//     console.log('should mount:', componentName);
//     container = mountContainer;
//     addStyleIfNotAdded();
//     mountContainer.dataset.for = componentName;
//     update(props);
//   };

//   // Przechowaj referencje do listenerów, które można później usunąć
//   const listeners: { target: Element; type: string; callback: Function }[] = [];

//   // Pomocnicza funkcja do dodawania event listenerów z śledzeniem
//   const addTrackedListener = (target: Element, type: string, callback: Function) => {
//     target.addEventListener(type, callback as EventListener);
//     listeners.push({ target, type, callback });
//   };

//   const update = (newProps: SchedulerExtensionProps) => {
//     if (!container) return;
//     // NOTE: if preact then use this
//     // render(createElement(SchedulerExtension, newProps), container);

//     SchedulerExtension(newProps, container);
//   };

//   const unmount = () => {
//     listeners.forEach(({ target, type, callback }) => {
//       target.removeEventListener(type, callback as EventListener);
//     });

//     document.body.querySelector(`[data-for="${componentName}"]`)?.remove();
//     document.head.querySelector(`[data-for="${componentName}"]`)?.remove();
//   };

//   return {
//     mount,
//     update,
//     unmount,
//   };
// };
import { createElement, render } from 'preact';
import { useState } from 'preact/hooks';
import { OperationType, rework_ScheduleItem, SchedulerUIExtensionSubmitDetails } from './Scheduler';
import { HHMMSS_toMS } from '../../utility/plain-utility';

export interface SchedulerExtensionProps {
  schedueList: rework_ScheduleItem[];
  onSubmit: (details: SchedulerUIExtensionSubmitDetails) => Promise<{ type: 'error' | 'info'; message: string } | void>;
}
export const componentName = 'scheduler-ui-extension' as const;

// NOTE: if preact then use this
const SchedulerExtension = ({ onSubmit, schedueList }: SchedulerExtensionProps) => {
  const [timeType, setTimeType] = useState<'raw' | 'sync'>('raw');
  const [date, setDate] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [time, setTime] = useState<string | null>(null);
  const [sync, setSync] = useState<string | null>(null);
  const [syncDeviation, setSyncDeviation] = useState<number>(0);
  const [precise, setPrecise] = useState<boolean>(true);
  const [tolerance, setTolerance] = useState<number>(3);
  const [failureTolerance, setFailureTolerance] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);

  const validateFields = () => {
    console.log(
      `validateFields:\ntimeType:${timeType}\ntime:${time}\nsync:${sync}\nsyncDeviation:${syncDeviation}\nprecise:${precise}\ntolerance:${tolerance}\n`,
    );
    return (
      (timeType === 'raw' &&
        /\d{2}:\d{2}:\d{2}/.test(time ?? '') &&
        date instanceof Date &&
        date.getTime() + HHMMSS_toMS(time!) > Date.now()) ||
      (timeType === 'sync' && sync)
    );
  };

  const handleSubmit = async () => {
    if (!validateFields()) {
      setError('Some fields are filled improperly, or schedule is in the past');
      return;
    }
    const inputDetails = {
      timeDetails: {
        targetTime: timeType === 'raw' ? date.getTime() + HHMMSS_toMS(time!) : null,
      },
      precision: precise
        ? {
            tolerance: tolerance * 1000, // convert to MS
            allowedToleranceIfFailed: failureTolerance * 1000, // convert to MS
          }
        : undefined,
      syncWith: sync
        ? {
            scheduleId: sync,
            deviation: syncDeviation * 1000, // convert to MS
          }
        : undefined,
    };
    console.log('input values to be submitted:', inputDetails);
    const submitReturn = await onSubmit(inputDetails);
    if (submitReturn) {
      console.log(submitReturn);
    }
  };
  return (
    <div id="scheduler-inner-container" style="margin-top: 8px; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; gap: 8px">
        <div style="display: flex; flex-direction: column">
          <div style="display: flex">
            <div>
              <input
                type="radio"
                checked={timeType === 'raw'}
                name="scheduler-datetime-type"
                value="raw"
                id="scheduler-raw-radio"
                onClick={() => setTimeType('raw')}
              />
              <label for="scheduler-raw-radio">Raw</label>
            </div>
            <div>
              <input
                type="radio"
                name="scheduler-datetime-type"
                value="sync"
                id="scheduler-sync-radio"
                checked={timeType === 'sync'}
                onClick={() => setTimeType('sync')}
              />
              <label for="scheduler-sync-radio">Sync</label>
            </div>
          </div>
          {timeType === 'raw' && (
            <div id="scheduler-raw-container">
              <input
                id="scheduler-date"
                type="date"
                value={date.toLocaleDateString('en-CA')}
                onChange={e => {
                  const newDate = new Date((e.target as HTMLInputElement).value);
                  newDate.setHours(0, 0, 0, 0);
                  setDate(newDate);
                }}
              />
              <input
                id="scheduler-time"
                type="text"
                style="width: 10ch"
                placeholder="hh:mm:ss"
                onChange={e => setTime((e.target as HTMLInputElement).value)}
              />
            </div>
          )}
          {timeType === 'sync' && (
            <div id="scheduler-sync-container">
              <select
                id="scheduler-sync"
                style="width: 90px"
                value={sync ?? undefined}
                onChange={e => setSync((e.target as HTMLSelectElement).value)}
              >
                <option disabled selected>
                  sync with:
                </option>
                {schedueList.map((item: rework_ScheduleItem) => (
                  <option value={item.id}>
                    {item.sourceCity.name} {item.operationType === OperationType.Attack ? '⚔️' : '🛡️'}{' '}
                    {item.targetCityDetails.name} (ID="{item.id}")
                  </option>
                ))}
              </select>
              <label for="scheduler-sync-deviation">+</label>
              <input
                id="scheduler-sync-deviation"
                type="number"
                style="width: 5ch"
                value={syncDeviation}
                onChange={e => setSyncDeviation((e.target as HTMLInputElement).valueAsNumber)}
              />
              <label for="scheduler-sync-deviation">s</label>
            </div>
          )}
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-start">
          <div>
            <input
              type="radio"
              checked={precise}
              name="scheduler-precise"
              value="true"
              id="scheduler-precise-true-radio"
              onClick={() => setPrecise(true)}
            />
            <label for="scheduler-precise-true-radio">Precise</label>
          </div>
          <div>
            <input
              type="radio"
              checked={!precise}
              name="scheduler-precise"
              value="false"
              id="scheduler-precise-false-radio"
              onClick={() => setPrecise(false)}
            />
            <label for="scheduler-precise-false-radio">Normal</label>
          </div>
        </div>
        {precise && (
          <>
            <div
              id="scheduler-tolerance-wrapper"
              style="display: flex; flex-direction: column; align-items: center; width: fit-content"
            >
              <label for="scheduler-tolerance">tolerance [s]</label>
              <input
                id="scheduler-tolerance"
                type="number"
                style="width: 6ch"
                min="-10"
                max="10"
                defaultValue="3"
                onChange={e => setTolerance((e.target as HTMLInputElement).valueAsNumber)}
              />
            </div>
            {/* <div
              id="scheduler-failure-tolerance-wrapper"
              style="display: flex; flex-direction: column; align-items: center; width: fit-content"
            >
              <label for="scheduler-failure-tolerance">failure tolerance [s]</label>
              <input
                id="scheduler-failure-tolerance"
                type="number"
                style="width: 6ch"
                min="-10"
                max="10"
                value="10"
                onChange={e => setFailureTolerance(Number((e.target as HTMLInputElement).value))}
              />
            </div> */}
          </>
        )}
        <button type="button" id="scheduler-submit" style="cursor: pointer" onClick={handleSubmit}>
          Schedule
        </button>
      </div>
      {error && <p style="color: red; font-size: 0.8em; margin: 4px; padding: 0px; font-weight: bold">{error}</p>}
    </div>
  );
};

// const SchedulerExtension = ({ onSubmit }: SchedulerExtensionProps, container: HTMLElement) => {
//   // NOTE: ??
//   container.innerHTML = buttonPanelExtenstionHtml;

//   const schedulerError = document.getElementById('scheduler-error')!;

//   const submitButton = container.querySelector<HTMLButtonElement>('#scheduler-submit')!;
//   const dateInput = container.querySelector<HTMLInputElement>('#scheduler-date')!;
//   const targetTimeInput = container.querySelector<HTMLInputElement>('#scheduler-time')!;
//   const syncSelect = container.querySelector<HTMLSelectElement>('#scheduler-sync')!;
//   const syncDeviation = container.querySelector<HTMLInputElement>('#scheduler-sync-deviation')!;
//   const toleranceInput = container.querySelector<HTMLInputElement>('#scheduler-tolerance')!;
//   const failureTolerance = container.querySelector<HTMLInputElement>('#scheduler-failure-tolerance')!;
//   const precisionInput = document.querySelector<HTMLInputElement>('[name="scheduler-precise"]')!;

//   const schedulerRawRadio = document.getElementById('scheduler-raw-radio')! as HTMLInputElement;
//   const schedulerSyncRadio = document.getElementById('scheduler-sync-radio')! as HTMLInputElement;

//   submitButton.addEventListener('click', async () => {
//     const dateValue = dateInput.valueAsDate;
//     const targetTimeValue = targetTimeInput.value;
//     const syncValue = syncSelect.value;
//     const syncDeviationValue = Number(syncDeviation.value);
//     const toleranceValue = Number(toleranceInput.value);
//     const failureToleranceValue = Number(failureTolerance.value);
//     const precisionValue = precisionInput.value === 'true';

//     if (
//       !validateFields({
//         dateValue,
//         targetTimeValue,
//         syncValue,
//         syncDeviationValue,
//         toleranceValue,
//         failureToleranceValue,
//         precisionValue,
//       })
//     ) {
//       schedulerError.textContent = 'Some fields are filled improperly, or schedule is in the past';
//       setTimeout(() => {
//         schedulerError.textContent = '';
//       }, 5000);
//       return;
//     }

//     const submitReturn = await onSubmit({
//       timeDetails: {
//         // if synchronization is preffered, then time is null - must be assessed based on the other item
//         targetTime: schedulerSyncRadio.checked ? null : (dateValue as Date).getTime() + textToMs(targetTimeValue),
//       },
//       precision: precisionValue
//         ? {
//             tolerance: toleranceValue as number,
//             allowedToleranceIfFailed: failureToleranceValue,
//           }
//         : undefined,
//       syncWith: {
//         scheduleId: syncValue,
//         deviation: syncDeviationValue,
//       },
//     });
//     if (submitReturn) {
//     }
//   });

//   const validateFields = (fields: {
//     dateValue: any;
//     targetTimeValue: any;
//     syncValue: any;
//     syncDeviationValue: any;
//     toleranceValue: any;
//     failureToleranceValue: any;
//     precisionValue: boolean;
//   }): boolean => {
//     const dataTimeFilled =
//       (schedulerRawRadio.checked && /\d{2}:\d{2}:\d{2}/.test(fields.targetTimeValue)) ||
//       (schedulerSyncRadio.checked && fields.syncValue);

//     const isNotInThePast =
//       fields.dateValue instanceof Date
//         ? fields.dateValue.getTime() + textToMs(fields.targetTimeValue) > Date.now()
//         : false;

//     return dataTimeFilled && isNotInThePast;
//   };
// };

const addStyleIfNotAdded = () => {
  /* no style at the moment */
};

export type SchedulerUIExtensionUIUtility = ReturnType<typeof useSchedulerUIExtensionUI>;
export const useSchedulerUIExtensionUI = () => {
  let container: HTMLElement;
  const mount = (mountContainer: HTMLElement, props: SchedulerExtensionProps) => {
    console.log('should mount:', componentName);
    container = mountContainer;
    addStyleIfNotAdded();
    mountContainer.dataset.for = componentName;
    update(props);
  };

  // Przechowaj referencje do listenerów, które można później usunąć
  const listeners: { target: Element; type: string; callback: Function }[] = [];

  // Pomocnicza funkcja do dodawania event listenerów z śledzeniem
  const addTrackedListener = (target: Element, type: string, callback: Function) => {
    target.addEventListener(type, callback as EventListener);
    listeners.push({ target, type, callback });
  };

  const update = (newProps: SchedulerExtensionProps) => {
    if (!container) return;
    // NOTE: if preact then use this
    render(createElement(SchedulerExtension, newProps), container);

    // SchedulerExtension(newProps, container);
  };

  const unmount = () => {
    listeners.forEach(({ target, type, callback }) => {
      target.removeEventListener(type, callback as EventListener);
    });

    document.body.querySelector(`[data-for="${componentName}"]`)?.remove();
    document.head.querySelector(`[data-for="${componentName}"]`)?.remove();
  };

  return {
    mount,
    update,
    unmount,
  };
};
