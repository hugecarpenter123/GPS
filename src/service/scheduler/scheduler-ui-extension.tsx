import buttonPanelExtenstionHtml from './button-panel-extension.rework.html';
import { textToMs } from '../../utility/plain-utility';
import { SchedulerUIExtensionSubmitDetails } from './Scheduler.rework';

export interface SchedulerExtensionProps {
  onSubmit: (details: SchedulerUIExtensionSubmitDetails) => Promise<{ type: 'error' | 'info'; message: string } | void>;
}
export const componentName = 'scheduler-ui-extension' as const;

// NOTE: if preact then use this
// const SchedulerExtension = ({ onSubmit }: SchedulerExtensionProps) => {
//   return <></>;
// };

const SchedulerExtension = ({ onSubmit }: SchedulerExtensionProps, container: HTMLElement) => {
  // NOTE: ??
  container.innerHTML = buttonPanelExtenstionHtml;

  const schedulerError = document.getElementById('scheduler-error')!;
  const schedulerInfo = document.getElementById('scheduler-info')!;

  const submitButton = container.querySelector<HTMLButtonElement>('#scheduler-button')!;
  const dateInput = container.querySelector<HTMLInputElement>('#scheduler-date')!;
  const targetTimeInput = container.querySelector<HTMLInputElement>('#scheduler-time')!;
  const syncSelect = container.querySelector<HTMLSelectElement>('#scheduler-sync')!;
  const syncDeviation = container.querySelector<HTMLInputElement>('#scheduler-sync-deviation')!;
  const toleranceInput = container.querySelector<HTMLInputElement>('#scheduler-tolerance')!;
  const failureTolerance = container.querySelector<HTMLInputElement>('#scheduler-failure-tolerance')!;
  const precisionInput = document.querySelector<HTMLInputElement>('[name="scheduler-precise"]')!;

  const schedulerRawRadio = document.getElementById('scheduler-raw-radio')! as HTMLInputElement;
  const schedulerSyncRadio = document.getElementById('scheduler-sync-radio')! as HTMLInputElement;

  submitButton.addEventListener('click', async () => {
    const dateValue = dateInput.valueAsDate;
    const targetTimeValue = targetTimeInput.value;
    const syncValue = syncSelect.value;
    const syncDeviationValue = Number(syncDeviation.value);
    const toleranceValue = Number(toleranceInput.value);
    const failureToleranceValue = Number(failureTolerance.value);
    const precisionValue = precisionInput.value === 'true';

    if (
      !validateFields({
        dateValue,
        targetTimeValue,
        syncValue,
        syncDeviationValue,
        toleranceValue,
        failureToleranceValue,
        precisionValue,
      })
    ) {
      schedulerError.textContent = 'Some fields are filled improperly, or schedule is in the past';
      setTimeout(() => {
        schedulerError.textContent = '';
      }, 5000);
      return;
    }

    const submitReturn = await onSubmit({
      timeDetails: {
        // if synchronization is preffered, then time is null - must be assessed based on the other item
        targetTime: schedulerSyncRadio.checked ? null : (dateValue as Date).getTime() + textToMs(targetTimeValue),
      },
      precision: precisionValue
        ? {
            tolerance: toleranceValue as number,
            allowedToleranceIfFailed: failureToleranceValue,
          }
        : undefined,
      syncWith: {
        scheduleId: syncValue,
        deviation: syncDeviationValue,
      },
    });
    if (submitReturn) {
    }
  });

  const validateFields = (fields: {
    dateValue: any;
    targetTimeValue: any;
    syncValue: any;
    syncDeviationValue: any;
    toleranceValue: any;
    failureToleranceValue: any;
    precisionValue: boolean;
  }): boolean => {
    const dataTimeFilled =
      (schedulerRawRadio.checked && /\d{2}:\d{2}:\d{2}/.test(fields.targetTimeValue)) ||
      (schedulerSyncRadio.checked && fields.syncValue);

    const isNotInThePast =
      fields.dateValue instanceof Date
        ? fields.dateValue.getTime() + textToMs(fields.targetTimeValue) > Date.now()
        : false;

    return dataTimeFilled && isNotInThePast;
  };
};

const addStyleIfNotAdded = () => {
  // NOTE: no style
  // if (!document.head.querySelector(`[data-for="${componentName}"]`)) {
  //   console.log('should add style');
  //   const style = document.createElement('style');
  //   style.dataset.for = componentName;
  //   //   TODO: add
  //   style.textContent = '';
  //   document.head.appendChild(style);
  // }
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
    // render(createElement(SchedulerExtension, newProps), container);

    SchedulerExtension(newProps, container);
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
