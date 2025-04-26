import { createElement } from 'preact';
import { render } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';

export interface SchedulerTableProps {}
export const componentName = 'scheduler-table' as const;

const SchedulerTable = () => {
  return <></>;
};

const addStyleIfNotAdded = () => {
  if (!document.head.querySelector(`[data-for="${componentName}"]`)) {
    console.log('should add style');
    const style = document.createElement('style');
    style.dataset.for = componentName;
    //   TODO: add
    style.textContent = '';
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
