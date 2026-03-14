import EventEmitter from 'events';
import { h, render } from 'preact';
import QueueItemComp from './components/queue-item';
import type { CitySchedule, QueueItem, QueueItemType } from './master-queue';
import { useRef, useState } from 'preact/hooks';
import { QueueDisplay } from './master-queue-table';

export const componentName = 'master-queue-inline' as const;

interface MasterQueueInlineProps {
  schedule?: CitySchedule | null;
  onDeleteItem: (item: QueueItem) => void;
  onQueuePositionChange?: (item: QueueItem, newPosition: number, queueType: 'main' | QueueItemType) => void;
}

const MasterQueueInline = ({ schedule, onDeleteItem, onQueuePositionChange }: MasterQueueInlineProps) => {
  const [open, setOpen] = useState(false);
  const [queueType, setQueueType] = useState<'main' | QueueItemType>('main');
  const draggedItemIdRef = useRef<string | null>(null);
  // If no schedule or empty queue, render nothing
  if (
    !schedule ||
    (Object.values(schedule.nonBlockingQueueComplex).every(c => !c.queue.length) && !schedule.queue.length)
  ) {
    return null;
  }

  const selectedQueue =
    queueType === 'main' ? schedule.queue : (schedule.nonBlockingQueueComplex[queueType]?.queue ?? []);

  return (
    // queue wrapper
    <div>
      <button onClick={() => setOpen(prev => !prev)}>{open ? 'hide' : 'open'} queue</button>
      {open && (
        <div className="font-roboto mt-1 max-h-[192px] w-fit overflow-auto rounded-md p-1 shadow-xl">
          <div className="flex gap-2">
            {selectedQueue.length ? (
              <div className="flex flex-wrap items-start gap-2" data-queue-container>
                {selectedQueue.map((item, index) => (
                  <QueueItemComp
                    key={item.id}
                    item={item}
                    index={index}
                    onDelete={() => {
                      onDeleteItem(item);
                    }}
                    onDragStart={() => {
                      draggedItemIdRef.current = item.id;
                    }}
                    onDragEnd={() => {
                      draggedItemIdRef.current = null;
                    }}
                    onPositionChange={
                      onQueuePositionChange
                        ? (targetItem, newPosition) => {
                            // Find the dragged item by ID stored in ref
                            const draggedItemId = draggedItemIdRef.current;
                            if (draggedItemId) {
                              const draggedItem = selectedQueue.find(i => i.id === draggedItemId);
                              if (draggedItem && draggedItem.id !== targetItem.id) {
                                onQueuePositionChange(draggedItem, newPosition, queueType);
                              }
                            }
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            ) : null}
            <div className="flex flex-col gap-[2px]">
              <button
                onClick={() => setQueueType('main')}
                className={queueType === 'main' ? 'rounded-sm border border-amber-700 bg-amber-500/50' : ''}
              >
                Main
              </button>
              <button
                onClick={() => setQueueType('builder')}
                className={queueType === 'builder' ? 'rounded-sm border border-amber-700 bg-amber-500/50' : ''}
              >
                Builder
              </button>
              <button
                onClick={() => setQueueType('recruiter')}
                className={queueType === 'recruiter' ? 'rounded-sm border border-amber-700 bg-amber-500/50' : ''}
              >
                Recruiter
              </button>
              <button
                onClick={() => setQueueType('academy')}
                className={queueType === 'academy' ? 'rounded-sm border border-amber-700 bg-amber-500/50' : ''}
              >
                Academy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Hook for lifecycle management
export type MasterQueueInlineUtility = ReturnType<typeof useMasterQueueInline>;
export const useMasterQueueInline = () => {
  let container: HTMLElement | null = null;
  let prevProps: MasterQueueInlineProps | null = null;

  /**
   * Mounts the queue component into provided container
   * @param targetContainer - DOM element where queue should be rendered
   * @param initialSchedule - initial city schedule to display
   * @param onDeleteItem - callback when user deletes an item
   */
  const mount = (targetContainer: HTMLElement, props: MasterQueueInlineProps) => {
    if (!targetContainer) {
      console.warn('Cannot mount: no container provided');
      return;
    }

    container = targetContainer;
    container.dataset.componentName = componentName;
    prevProps = props;

    // Render component
    render(h(MasterQueueInline, props), container);
  };

  /**
   * Updates the queue with new schedule data
   * @param schedule - updated city schedule (or null to clear)
   */
  const update = (schedule: CitySchedule | null) => {
    if (!container || !container.isConnected || !prevProps) {
      console.warn('Cannot update: component not mounted');
      return;
    }

    prevProps = { ...prevProps, schedule };

    // Render component
    render(h(MasterQueueInline, prevProps), container);
  };

  const unmount = () => {
    if (!container) return;

    render(null, container);

    container = null;
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

export default useMasterQueueInline;
