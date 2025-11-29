import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import ConfigManager from '../../utility/config-manager';
import SchedulerTableAction from './components/scheduler-table-action';
import { OperationType, ScheduleItem, ScheduleItemEditData } from './Scheduler';
import SchedulerTableCSS from './scheduler-table.css';

export interface SchedulerTableProps {
  scheduleList: ScheduleItem[];
  onCancel: (item: ScheduleItem) => void;
  onEdit: (item: ScheduleItem, editData: ScheduleItemEditData) => { success: boolean; message?: string };
}
export const componentName = 'scheduler-table' as const;

const COLORS = [
  '#9B9ECE', // periwinkle
  '#F7A072', // peach
  '#99B898', // forest green
  '#6C5B7B', // dusty purple
  '#FF6B6B', // coral red
  '#4ECDC4', // turquoise
  '#96CEB4', // sage green
  '#45B7D1', // sky blue
  '#FFEEAD', // cream yellow
  '#D4A5A5', // dusty rose
  '#A8E6CE', // mint
  '#FFD93D', // golden yellow
] as const;

const SchedulerTable: React.FC<SchedulerTableProps> = ({ scheduleList, onCancel, onEdit }) => {
  const [open, setOpen] = useState(false);
  const highlightedIds = Array.from(
    new Set(scheduleList.map(s => s.synchronizedWith?.scheduleId).filter(id => id !== undefined)),
  );
  const colorDic: Record<string, (typeof COLORS)[number]> = highlightedIds.reduce(
    (acc, id, index) => ({ ...acc, [id]: COLORS[index % COLORS.length] }),
    {},
  );
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
              <th>Army</th>
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
                <td colspan={10} id="no-schedules">
                  No schedules
                </td>
              </tr>
            ) : (
              scheduleList
                .sort((a, b) => a.timeDetails.targetTimeStart - b.timeDetails.targetTimeStart)
                .map(schedule => {
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
                      <td
                        class={`scheduler-table-td-id`}
                        style={
                          highlightedIds.includes(schedule.id)
                            ? { color: colorDic[schedule.id], fontWeight: '600' }
                            : undefined
                        }
                      >
                        {schedule.id}
                      </td>
                      <td
                        class={`operation-type ${schedule.operationType === OperationType.Support ? 'support' : 'attack'}`}
                      >
                        {schedule.operationType === OperationType.Support ? 'Support' : 'Attack'}
                      </td>
                      <td
                        style={
                          schedule.synchronizedWith && highlightedIds.includes(schedule.synchronizedWith.scheduleId)
                            ? { color: colorDic[schedule.synchronizedWith.scheduleId], fontWeight: '600' }
                            : undefined
                        }
                      >
                        {schedule.synchronizedWith ? schedule.synchronizedWith.scheduleId : '-'}
                      </td>
                      <td class="source-city">{schedule.sourceCity.name}</td>
                      <td class="destination-city">{schedule.targetCityDetails.name}</td>
                      <td class="departure-time">{departureTime}</td>
                      <td class="arrival-time">{arrivalTime}</td>
                      <td class="scheduler-table-td-tolerance">
                        {isPrecise
                          ? `${schedule.precision!.tolerance > 0 ? '+' : ''}${schedule.precision!.tolerance / 1000}`
                          : `+/-${AT / 1000}`}
                      </td>
                      <td>
                        <div class="scheduler-army-details-container">
                          {schedule.armyDetails.map(({ value, name }) => (
                            <div class={`scheduler-army-details-item`}>
                              <div class={`unit_icon50x50 ${name} scheduler-army-details-item-bg`} />
                              <span class="scheduler-army-details-item-caption">{value}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <SchedulerTableAction
                          onCancelClick={() => onCancel(schedule)}
                          onEditClick={(editData: ScheduleItemEditData) => onEdit(schedule, editData)}
                          scheduleItem={schedule}
                          scheduleList={scheduleList}
                        />
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
  let container: HTMLDivElement | null = null;
  let root: any = null; // Preact root for future compatibility

  const mount = (props: SchedulerTableProps) => {
    console.log('should mount:', componentName);

    addStyleIfNotAdded();

    // Find existing container or create new one
    container = document.body.querySelector<HTMLDivElement>(`[data-for="${componentName}"]`);
    if (!container) {
      container = document.createElement('div');
      container.dataset.for = componentName;
      document.body.appendChild(container);
    }

    // For future Preact 11+ compatibility
    // root = createRoot(container);
    // root.render(h(SchedulerTable, props));

    // Current Preact 10 approach
    render(h(SchedulerTable, props), container);
  };

  const update = (newProps: SchedulerTableProps) => {
    if (!container) {
      console.warn('Cannot update: component not mounted');
      return;
    }

    // For future Preact 11+ compatibility
    // if (root) {
    //   root.render(h(SchedulerTable, newProps));
    // } else {
    //   render(h(SchedulerTable, newProps), container);
    // }

    // Current approach
    render(h(SchedulerTable, newProps), container);
  };

  const unmount = () => {
    if (!container) return;

    // For future Preact 11+ compatibility
    // if (root) {
    //   root.unmount();
    //   root = null;
    // } else {
    //   render(null, container);
    // }

    // Current approach - render null to unmount
    render(null, container);

    // Cleanup DOM
    container.remove();
    container = null;

    // Remove styles
    document.head.querySelector(`[data-for="${componentName}"]`)?.remove();
  };

  return {
    mount,
    update,
    unmount,
    get container() {
      return container;
    },
  };
};
