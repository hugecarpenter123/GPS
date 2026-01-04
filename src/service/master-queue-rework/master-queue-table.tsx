import EventEmitter from 'events';
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionButton } from './components/action-button';
import QueueItemComp from './components/queue-item';
import type { CitySchedule, QueueItem } from './master-queue';
import Select from './components/select';

export const componentName = 'master-queue' as const;

// Local helper components (not exported)
const Td = ({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: Record<string, string>;
}) => (
  <div className={`border-gps-border bg-gps-card border p-2 ${className}`} style={style}>
    {children}
  </div>
);

const Th = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`border-gps-border bg-gps-card border p-2 font-bold ${className}`}>{children}</div>
);

const CityScheduleRow = ({
  citySchedule,
  queueDisplay,
  onRunCity,
  onRestartCity,
  onPauseCity,
  onDeleteCity,
  onDeleteItem,
}: {
  citySchedule: CitySchedule;
  queueDisplay: QueueDisplay;
  onRunCity: () => void;
  onRestartCity: () => void;
  onPauseCity: () => void;
  onDeleteCity: () => void;
  onDeleteItem: (item: QueueItem) => void;
}) => {
  const selectedScheduleType =
    queueDisplay === 'main' ? citySchedule : citySchedule.nonBlockingQueueComplex[queueDisplay];
  return (
    // Tr
    <div className="contents" data-city={citySchedule.city.name}>
      {/* City Cell */}
      <Td className="flex items-center justify-center font-bold">{citySchedule.city.name}</Td>

      {/* Exection time */}
      <Td className="flex items-center justify-center">
        {selectedScheduleType?.timeoutData.executionTime
          ? new Date(selectedScheduleType.timeoutData.executionTime).toLocaleTimeString()
          : '-'}
      </Td>

      <Td className="relative flex items-center justify-center">
        <div
          className="absolute h-7 w-8 self-center"
          style={
            selectedScheduleType?.timeoutData.purpose === 'resources'
              ? {
                  backgroundImage: 'url(https://gppl.innogamescdn.com/images/game/layout/resources_2.32.png)',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: '0 -92px',
                }
              : selectedScheduleType?.timeoutData.purpose === 'charms'
                ? {
                    backgroundImage: 'url(https://gppl.innogamescdn.com/images/game/layout/resources_2.32.png)',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: '0 -150px',
                  }
                : {}
          }
        />
        {['slot', 'error'].includes(selectedScheduleType?.timeoutData.purpose ?? '')
          ? selectedScheduleType?.timeoutData.purpose
          : '-'}
      </Td>

      {/* Queue Cell */}
      <Td className="overflow-x-auto">
        <div className="flex flex-nowrap items-start gap-2">
          {(
            (queueDisplay === 'main'
              ? citySchedule.queue
              : queueDisplay === 'builder'
                ? citySchedule.nonBlockingQueueComplex.builder?.queue
                : citySchedule.nonBlockingQueueComplex.recruiter?.queue) ?? []
          ).map((item, index) => (
            <QueueItemComp key={item.id} item={item} index={index} onDelete={() => onDeleteItem(item)} />
          ))}
        </div>
      </Td>

      {/* State Cell */}
      <Td
        className={`flex items-center justify-center px-2 font-bold ${citySchedule.currentAction ? 'text-green-600' : 'text-orange-500'}`}
      >
        {citySchedule.currentAction ? 'Running' : 'Idle'}
      </Td>

      {/* Actions Cell */}
      <Td className="flex grow-0 flex-col justify-center">
        <ActionButton variant="run" onClick={onRunCity}>
          Run
        </ActionButton>
        <ActionButton variant="restart" onClick={onRestartCity}>
          Restart
        </ActionButton>
        <ActionButton variant="pause" onClick={onPauseCity}>
          Pause
        </ActionButton>
        <ActionButton variant="delete" onClick={onDeleteCity}>
          Delete
        </ActionButton>
      </Td>
    </div>
  );
};

interface MasterQueueTableProps {
  eventEmitter: EventEmitter;
  initialQueue: CitySchedule[];
  onRunAll: () => void;
  onResetAll: () => void;
  onDeleteAll: () => void;
  onPauseAll: () => void;
  onRunCity: (citySchedule: CitySchedule) => void;
  onRestartCity: (citySchedule: CitySchedule) => void;
  onPauseCity: (citySchedule: CitySchedule) => void;
  onDeleteCity: (citySchedule: CitySchedule) => void;
  onDeleteItem: (citySchedule: CitySchedule, item: QueueItem) => void;
}

export type QueueDisplay = 'main' | 'builder' | 'recruiter';

const MasterQueueTable = ({
  eventEmitter,
  initialQueue,
  onRunAll,
  onResetAll,
  onDeleteAll,
  onPauseAll,
  onRunCity,
  onRestartCity,
  onPauseCity,
  onDeleteCity,
  onDeleteItem,
}: MasterQueueTableProps) => {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<CitySchedule[]>(initialQueue);
  const [queueDisplay, setQueueDisplay] = useState<QueueDisplay>('main');

  // Listen for queue updates from MasterQueue
  useEffect(() => {
    const handleQueueUpdate = (newQueue: CitySchedule[]) => {
      setQueue([...newQueue]); // spread to create new reference and trigger re-render
    };

    const handleToggle = () => {
      setOpen(prev => !prev);
    };

    const handleShow = () => {
      setOpen(true);
    };

    const handleHide = () => {
      setOpen(false);
    };

    eventEmitter.on('queue-update', handleQueueUpdate);
    eventEmitter.on('toggle', handleToggle);
    eventEmitter.on('show', handleShow);
    eventEmitter.on('hide', handleHide);

    return () => {
      eventEmitter.off('queue-update', handleQueueUpdate);
      eventEmitter.off('toggle', handleToggle);
      eventEmitter.off('show', handleShow);
      eventEmitter.off('hide', handleHide);
    };
  }, [eventEmitter]);

  const activeSchedules = queue.filter(
    citySchedule =>
      citySchedule.queue.length > 0 || Object.values(citySchedule.nonBlockingQueueComplex).some(c => c.queue.length),
  );
  const isEmpty = !activeSchedules.length;

  return (
    <>
      {/* Outer Container - Global positioning */}
      <div
        className="pointer-events-none fixed top-1/2 left-1/2 z-2000 w-full -translate-x-1/2 -translate-y-1/2"
        style={{ fontFamily: "'Roboto', sans-serif", fontSize: '13px' }}
      >
        {/* Table Container */}
        <div className="mx-auto max-h-[70vh] w-fit max-w-[90%] overflow-x-auto" hidden={!open}>
          {/* Table Grid */}
          <div className="bg-gps-card pointer-events-auto grid grid-cols-[min-content_min-content_min-content_minmax(200px,1fr)_min-content_min-content] rounded-b">
            {/* Toolbar */}
            <div className="bg-gps-toolbar sticky top-0 col-span-6 flex justify-end rounded-t">
              <button
                className="cursor-pointer rounded border-none bg-red-600 text-white"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Table Header */}
            <div className="contents">
              {/* Tr */}
              <div className="contents">
                <Th>City</Th>
                <Th className="whitespace-nowrap">Next at</Th>
                <Th className="whitespace-nowrap">Reason</Th>
                <Th className="flex items-center gap-2">
                  <span>Queue</span>
                  {!isEmpty && (
                    <div className={'flex'}>
                      {'('}
                      <Select
                        options={[
                          { value: 'main', label: 'Main' },
                          { value: 'builder', label: 'Builder' },
                          { value: 'recruiter', label: 'Recruiter' },
                        ]}
                        onSelect={value => setQueueDisplay(value as QueueDisplay)}
                        triggerType="text"
                      />
                      {')'}
                    </div>
                  )}
                </Th>
                <Th>State</Th>
                <Th>Actions</Th>
              </div>
            </div>

            {/* Table Body */}
            <div className="contents">
              {isEmpty ? (
                // Tr
                <div className="contents">
                  <Td className="col-span-6 border-t-0 p-3 text-center">No schedules</Td>
                </div>
              ) : (
                activeSchedules.map(citySchedule => (
                  <CityScheduleRow
                    key={citySchedule.city.name}
                    queueDisplay={queueDisplay}
                    citySchedule={citySchedule}
                    onRunCity={() => onRunCity(citySchedule)}
                    onRestartCity={() => onRestartCity(citySchedule)}
                    onPauseCity={() => onPauseCity(citySchedule)}
                    onDeleteCity={() => onDeleteCity(citySchedule)}
                    onDeleteItem={item => onDeleteItem(citySchedule, item)}
                  />
                ))
              )}
            </div>

            {/* Table Footer */}
            {!isEmpty && (
              <div className="border-gps-border bg-gps-card sticky bottom-0 col-span-5 border p-2 text-center">
                <ActionButton variant="run" onClick={onRunAll}>
                  Run all
                </ActionButton>
                <ActionButton variant="restart" onClick={onResetAll}>
                  Reset all
                </ActionButton>
                <ActionButton variant="delete" onClick={onDeleteAll}>
                  Delete all
                </ActionButton>
                <ActionButton variant="pause" onClick={onPauseAll}>
                  Pause all
                </ActionButton>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        className="absolute bottom-[135px] left-[10px] z-1000 m-0 cursor-pointer rounded border border-red-500 bg-transparent px-2 py-1 text-xs text-red-500 shadow-[0_0_2px_tomato] transition-all duration-150 hover:bg-red-500 hover:text-white"
        style={{ fontVariant: 'small-caps' }}
        onClick={() => setOpen(!open)}
      >
        <span>Master Queue</span>
      </button>
    </>
  );
};

// Hook for lifecycle management
export type MasterQueueTableUtility = ReturnType<typeof useMasterQueueTable>;
export const useMasterQueueTable = () => {
  let container: HTMLElement | null = null;
  const eventEmitter = new EventEmitter();

  const mount = (
    targetContainer: HTMLElement | null,
    props: {
      initialQueue: CitySchedule[];
      onRunAll: () => void;
      onResetAll: () => void;
      onDeleteAll: () => void;
      onPauseAll: () => void;
      onRunCity: (citySchedule: CitySchedule) => void;
      onRestartCity: (citySchedule: CitySchedule) => void;
      onPauseCity: (citySchedule: CitySchedule) => void;
      onDeleteCity: (citySchedule: CitySchedule) => void;
      onDeleteItem: (citySchedule: CitySchedule, item: QueueItem) => void;
    },
  ) => {
    // NOTE: component is done with tailwind, and talwind.css is injected on script load, so it's no necessery anymore
    // use it however when for example lazy loading is preferred
    // addStyleIfNotAdded();

    // Find existing container or create new one
    container =
      targetContainer ?? document.body.querySelector<HTMLDivElement>(`[data-component-name="${componentName}"]`);
    if (!container) {
      container = document.createElement('div');
      container.dataset.componentName = componentName;
      document.body.appendChild(container);
    }

    // Render component
    render(
      h(MasterQueueTable, {
        eventEmitter,
        ...props,
      }),
      container,
    );
  };

  // NOTE: potentially just rerender, and eliminate event emitter
  const update = (newQueue: CitySchedule[]) => {
    if (!container) {
      console.warn('Cannot update: component not mounted');
      return;
    }

    // Emit event to update queue in component
    eventEmitter.emit('queue-update', newQueue);
  };

  const toggle = () => {
    eventEmitter.emit('toggle');
  };

  const show = () => {
    eventEmitter.emit('show');
  };

  const hide = () => {
    eventEmitter.emit('hide');
  };

  const unmount = () => {
    if (!container) return;

    // Render null to unmount
    render(null, container);

    // Cleanup DOM
    container.remove();
    container = null;

    // Remove styles (only queue styles)
    // document.head.querySelector(`[data-for="${componentName}-queue"]`)?.remove();
    // styleAdded = false;

    // Remove all event listeners
    eventEmitter.removeAllListeners();
  };

  return {
    mount,
    update,
    toggle,
    show,
    hide,
    unmount,
    get container() {
      return container;
    },
  };
};

export default useMasterQueueTable;
