import { TConfig } from 'gps.config';
import { h, render } from 'preact';
import configPopupCss from './master-queue.css';

export const componentName = 'master-queue-table' as const;

const MasterQueueTable = () => {
  return (
    <div>
      <div id="master-queue-table-outer-container">
        <div id="master-queue-table-container" hidden>
          <div id="master-queue-table">
            <div class="table-toolbar">
              <button id="master-queue-table-close-icon">✕</button>
            </div>

            <div class="thead">
              <div class="tr">
                <div class="th">City</div>
                <div class="th">Queue</div>
                <div class="th">State</div>
                <div class="th">Actions</div>
              </div>
            </div>

            <div class="tbody"></div>

            <div id="master-queue-table-footer" class="tfoot"></div>
          </div>
        </div>
      </div>
      <div id="master-queue-table-toggle-button" hidden>
        <span>Master Queue</span>
      </div>
    </div>
  );
};

// Style management
let styleAdded = false;
const addStyleIfNotAdded = () => {
  if (styleAdded) return;

  const existingStyle = document.head.querySelector(`[data-for="${componentName}"]`);
  if (existingStyle) {
    styleAdded = true;
    return;
  }

  const style = document.createElement('style');
  style.setAttribute('data-for', componentName);
  style.textContent = configPopupCss;
  document.head.appendChild(style);
  styleAdded = true;
};

// Hook for lifecycle management
export type ConfigPopupUtility = ReturnType<typeof useMasterQueueTable>;
export const useMasterQueueTable = () => {
  let container: HTMLDivElement | null = null;

  //   TODO
  const mount = async (initialConfig: any) => {
    console.log('should mount:', componentName);
    addStyleIfNotAdded();

    // Find existing container or create new one
    container = document.body.querySelector<HTMLDivElement>(`[data-for="${componentName}"]`);
    if (!container) {
      container = document.createElement('div');
      container.dataset.for = componentName;
      document.body.appendChild(container);
    }

    // Render component
    render(h(MasterQueueTable, {}), container);
  };

  const update = async (newConfig: TConfig) => {
    if (!container) {
      console.warn('Cannot update: component not mounted');
      return;
    }

    render(h(MasterQueueTable, {}), container);
  };

  const unmount = () => {
    if (!container) return;

    // null all
    render(null, container);
    container.remove();
    container = null;

    // Remove styles
    document.head.querySelector(`[data-for="${componentName}"]`)?.remove();
    styleAdded = false;
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
export default useMasterQueueTable;
