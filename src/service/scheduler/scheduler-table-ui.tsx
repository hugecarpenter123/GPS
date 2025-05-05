import { createElement } from 'preact';
import React, { render } from 'preact/compat';
import { useState } from 'preact/hooks';
import ConfigManager from '../../utility/config-manager';
import SchedulerTableCSS from './scheduler-table.css';
import { OperationType, rework_ScheduleItem } from './Scheduler';

export interface SchedulerTableProps {
  scheduleList: rework_ScheduleItem[];
  onCancel: (item: rework_ScheduleItem) => void;
}
export const componentName = 'scheduler-table' as const;

const SchedulerTable: React.FC<SchedulerTableProps> = ({ scheduleList, onCancel }) => {
  const [open, setOpen] = useState(false);
  const AT = ConfigManager.getInstance().getConfig().general.antyTimingMs;
  return (
    <>
      <div id="scheduler-table-container" class={open ? '' : 'hidden'}>
        <table id="scheduler-table">
          <thead>
            <tr>
              <th id="scheduler-table-th-id">ID</th>
              <th id="operation-type">Operation Type</th>
              <th>Sync with</th>
              <th class="source-city">Source City</th>
              <th class="destination-city">Destination City</th>
              <th class="departure-time">Departure Time</th>
              <th class="arrival-time">Arrival Time</th>
              <th class="scheduler-table-th-tolerance">Tolerance {'[s]'}</th>
              <th class="actions">
                <div class="close-icon" onClick={() => setOpen(false)}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    style="display: block;"
                  >
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <line x1="23" y1="1" x2="1" y2="23"></line>
                  </svg>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {!scheduleList.length ? (
              <tr>
                <td colspan={9} id="no-schedules">
                  No schedules
                </td>
              </tr>
            ) : (
              scheduleList.map(schedule => {
                const isPrecise = !!schedule.precision;
                const isSync = !!schedule.synchronizedWith && schedule.timeDetails.targetTime === null;
                const departureTime = isSync
                  ? `${new Date(
                      schedule.timeDetails.targetTimeStart - schedule.timeDetails.movementDuration,
                    ).toLocaleString(navigator.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                      // day: 'numeric',
                      // month: 'long',
                    })} - ${new Date(
                      schedule.timeDetails.targetTimeStart +
                        schedule.timeDetails.targetTimeDuration -
                        schedule.timeDetails.movementDuration,
                    ).toLocaleString(navigator.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                      // day: 'numeric',
                      // month: 'long',
                    })}`
                  : `${new Date(
                      schedule.timeDetails.targetTime! - schedule.timeDetails.movementDuration,
                    ).toLocaleString(navigator.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                      // day: 'numeric',
                      // month: 'long',
                    })}`;

                const arrivalTime = isSync
                  ? `${new Date(schedule.timeDetails.targetTimeStart).toLocaleString(navigator.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                      // day: 'numeric',
                      // month: 'long',
                    })} - ${new Date(
                      schedule.timeDetails.targetTimeStart + schedule.timeDetails.targetTimeDuration,
                    ).toLocaleString(navigator.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                      // day: 'numeric',
                      // month: 'long',
                    })}`
                  : `${new Date(schedule.timeDetails.targetTime!).toLocaleString(navigator.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                      // day: 'numeric',
                      // month: 'long',
                    })}`;

                return (
                  <tr class="scheduler-item">
                    <td class={`scheduler-table-td-id`}>{schedule.id}</td>
                    <td
                      class={`operation-type ${schedule.operationType === OperationType.Support ? 'support' : 'attack'}`}
                    >
                      {schedule.operationType === OperationType.Support ? 'Support' : 'Attack'}
                    </td>
                    <td>{schedule.synchronizedWith ? schedule.synchronizedWith.scheduleId : '-'}</td>
                    <td class="source-city">{schedule.sourceCity.name}</td>
                    <td class="destination-city">{schedule.targetCityDetails.name}</td>
                    <td class="departure-time">{departureTime}</td>
                    <td class="arrival-time">{arrivalTime}</td>
                    <td class="scheduler-table-td-tolerance">
                      {isPrecise
                        ? `${schedule.precision!.tolerance > 0 ? '+' : ''}${schedule.precision!.tolerance / 1000}`
                        : `+/-${AT / 1000}`}
                    </td>
                    <td class="actions">
                      <button
                        onClick={() => {
                          console.log('should cancel');
                          onCancel(schedule);
                        }}
                        class="cancel-button"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <button id="scheduler-toggle-button" onClick={() => setOpen(prev => !prev)}>
        scheduler
      </button>
    </>
  );
};

const addStyleIfNotAdded = () => {
  if (!document.head.querySelector(`[data-for="${componentName}"]`)) {
    console.log('should add style');
    const style = document.createElement('style');
    style.dataset.for = componentName;
    style.textContent = SchedulerTableCSS;
    document.head.appendChild(style);
  }
};

export type SchedulerTableUtility = ReturnType<typeof useSchedulerTable>;
export const useSchedulerTable = () => {
  let container = document.body.querySelector<HTMLDivElement>(`[data-for="${componentName}"]`);
  const mount = (props: SchedulerTableProps) => {
    console.log('should mount:', componentName);

    addStyleIfNotAdded();
    if (!container) {
      container = document.createElement('div');
      container.dataset.for = componentName;
      document.body.appendChild(container);
    }
    update(props);
  };

  // Przechowaj referencje do listenerów, które można później usunąć
  const listeners: { target: Element; type: string; callback: Function }[] = [];

  // Pomocnicza funkcja do dodawania event listenerów z śledzeniem
  const addTrackedListener = (target: Element, type: string, callback: Function) => {
    target.addEventListener(type, callback as EventListener);
    listeners.push({ target, type, callback });
  };

  const update = (newProps: SchedulerTableProps) => {
    if (!container) return;
    render(createElement(SchedulerTable, newProps), container);
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
    container,
  };
};
