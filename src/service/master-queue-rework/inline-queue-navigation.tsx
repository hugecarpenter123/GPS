import EventEmitter from 'events';
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import QueueItemComp from './components/queue-item';
import type { CitySchedule, QueueItem } from './master-queue.rework';

export const componentName = 'master-queue-inline' as const;

interface InlineQueueNavigationProps {
  onRun: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  className?: string;
}

const InlineQueueNavigation = ({ onRun, onPause, onRestart, onDelete, className }: InlineQueueNavigationProps) => {
  return (
    <div className={className ?? 'flex w-fit gap-0'}>
      <button onClick={onRun}>Run</button>
      <button onClick={onPause}>Restart</button>
      <button onClick={onRestart}>Pause</button>
      <button onClick={onDelete}>Delete</button>
    </div>
  );
};

// Hook for lifecycle management
export type InlineQueueNavigationUtility = ReturnType<typeof useInlineQueueNavigation>;
export const useInlineQueueNavigation = () => {
  let container: HTMLElement | null = null;

  const mount = (targetContainer: HTMLElement | null, props: InlineQueueNavigationProps) => {
    if (!targetContainer) {
      console.warn('Cannot mount: no container provided');
      return;
    }

    container = targetContainer;
    container.setAttribute('data-component-container', componentName);

    // Render component
    render(h(InlineQueueNavigation, props), container);
  };

  const update = (props: InlineQueueNavigationProps) => {
    mount(container, props);
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

export default useInlineQueueNavigation;
