import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { type CityInfo } from '../city/types';

export const componentName = 'master-queue-city-navigation' as const;

interface InlineQueueNavigationProps {
  onRun: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onValueChange?: (newValues: ScheduleExecutionDetails) => void;
  className?: string;
  availableCities?: CityInfo[];
}

export interface ScheduleExecutionDetails {
  blocking: boolean;
  autoSuppliers: boolean;
  supplierCityNames?: string[];
  maxShipmentTime: number;
}

const defaultValues: ScheduleExecutionDetails = {
  blocking: true,
  autoSuppliers: true,
  supplierCityNames: [],
  maxShipmentTime: 1500000, // 5 minutes default
};

const InlineQueueNavigation = ({
  onRun,
  onPause,
  onRestart,
  onDelete,
  onValueChange,
  className,
  availableCities = [],
}: InlineQueueNavigationProps) => {
  const [data, setData] = useState<ScheduleExecutionDetails>(defaultValues);

  const maxShipmentTimeOptions = Array.from({ length: 12 }, (_, i) => {
    const minutes = 5 + i * 5;
    return {
      value: minutes * 60 * 1000,
      label: `${minutes} min`,
    };
  });
  const setDataWrapper = (values: ScheduleExecutionDetails) => {
    setData(values);
    onValueChange?.(values);
  };

  return (
    <div className="font-roboto flex w-fit flex-col gap-1 text-sm">
      {/* Blocking checkbox */}
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={data.blocking}
            onChange={e => setDataWrapper({ ...data, blocking: (e.target as HTMLInputElement).checked })}
            className="cursor-pointer"
          />
          <span>Blocking</span>
        </label>
      </div>

      {/* Supplier cities */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={data.autoSuppliers}
              onChange={e => setDataWrapper({ ...data, autoSuppliers: (e.target as HTMLInputElement).checked })}
              className="cursor-pointer"
            />
            <span>Auto supplier cities</span>
          </label>
        </div>
        {!data.autoSuppliers && (
          <select
            multiple
            onChange={e => {
              const target = e.target as HTMLSelectElement;
              if (!target) return;
              const selected = Array.from(target.selectedOptions).map(opt => opt.value);
              setDataWrapper({ ...data, supplierCityNames: selected });
            }}
            className="w-[100px] rounded border"
            size={Math.min(availableCities.length, 5)}
          >
            {availableCities.map(city => (
              <option
                key={city.name}
                value={city.name}
                selected={data.supplierCityNames?.includes(city.name)}
                className="p-1"
              >
                {city.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Max shipment time select */}
      <div className="flex items-center gap-2">
        <label htmlFor="max-shipment-time-select">Max shipment time:</label>
        <select
          id="max-shipment-time-select"
          value={data.maxShipmentTime ?? 300000}
          onChange={e => {
            const target = e.target as HTMLSelectElement;
            if (target) setDataWrapper({ ...data, maxShipmentTime: Number(target.value) });
          }}
          className="rounded border text-sm"
        >
          {maxShipmentTimeOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Navigation buttons */}
      <div className={className ?? 'mt-2 flex w-fit gap-0 text-sm'}>
        <button onClick={onRun}>Run</button>
        <button onClick={onRestart}>Restart</button>
        <button onClick={onPause}>Pause</button>
        <button onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
};

// Hook for lifecycle management
export type InlineQueueNavigationUtility = ReturnType<typeof useInlineQueueNavigation>;
export const useInlineQueueNavigation = () => {
  let container: HTMLElement | null = null;
  let values: ScheduleExecutionDetails = defaultValues;

  const mount = (targetContainer: HTMLElement | null, props: InlineQueueNavigationProps) => {
    if (!targetContainer) {
      console.warn('Cannot mount: no container provided');
      return;
    }

    container = targetContainer;
    container.dataset.componentName = componentName;

    // Render component
    render(h(InlineQueueNavigation, { ...props, onValueChange: newValues => (values = newValues) }), container);
  };

  const update = (props: InlineQueueNavigationProps) => {
    mount(container, { ...props, onValueChange: newValues => (values = newValues) });
  };

  const unmount = () => {
    if (!container) return;

    render(null, container);

    container = null;
  };

  const getValues = () => values;

  return {
    mount,
    update,
    unmount,
    getValues,
    get container() {
      return container;
    },
  };
};

export default useInlineQueueNavigation;
