/** @jsx h */
import EventEmitter from 'events';
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import QueueItemComp from './components/queue-item';
import type { CitySchedule, QueueItem } from './master-queue.rework';

export const componentName = 'master-queue-inline' as const;

interface MasterQueueInlineProps {
  schedule?: CitySchedule | null;
  onDeleteItem: (item: QueueItem) => void;
}

const MasterQueueInline = ({ schedule, onDeleteItem }: MasterQueueInlineProps) => {
  // If no schedule or empty queue, render nothing
  if (!schedule || schedule.queue.length === 0) {
    return null;
  }

  return (
    // queue wrapper
    <div className="flex flex-wrap items-start gap-2">
      {schedule.queue.map((item, index) => (
        <QueueItemComp key={item.id} item={item} index={index} onDelete={() => onDeleteItem(item)} />
      ))}
    </div>
  );
};

// Hook for lifecycle management
export type MasterQueueInlineUtility = ReturnType<typeof useMasterQueueInline>;
export const useMasterQueueInline = () => {
  let container: HTMLElement | null = null;
  let prevProps: MasterQueueInlineProps | null = null;
  const eventEmitter = new EventEmitter();

  /**
   * Mounts the queue component into provided container
   * @param targetContainer - DOM element where queue should be rendered
   * @param initialSchedule - initial city schedule to display
   * @param onDeleteItem - callback when user deletes an item
   */
  const mount = (
    targetContainer: HTMLElement,
    props: {
      schedule: CitySchedule | null | undefined;
      onDeleteItem: (item: QueueItem) => void;
    },
  ) => {
    if (!targetContainer) {
      console.warn('Cannot mount: no container provided');
      return;
    }

    container = targetContainer;
    container.setAttribute('data-component-container', componentName);
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

    eventEmitter.removeAllListeners();
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
