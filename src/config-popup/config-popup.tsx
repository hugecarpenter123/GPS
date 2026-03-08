/*
FUTURE: for now it's bad that it uses API on it's own like ConfigManager, CitySwitch etc - should be more unaware of what it is doing - i think.
TODO: let toggle icon be visible always
*/

/** @jsx h */
/** @jsxFrag Fragment */
import EventEmitter from 'events';
import { h, render } from 'preact';
import React from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { FarmTimeInterval, TConfig } from '../../gps.config';
import CitySwitchManager, { CityInfo } from '../service/city/city-switch-manager';
import ConfigManager from '../utility/config-manager';
// @ts-ignore
import MasterQueue from '~/service/master-queue-rework/master-queue';
import MasterManager from '~/service/master/master-manager';
import Scheduler from '~/service/scheduler/Scheduler';
import { setCookie } from '~/utility/plain-utility';
import Lock from '~/utility/ui-lock';
import configPopupCss from './config-popup.css?raw';

export type TConfigChanges = {
  masterQueue: {};
  farmer: {
    farmInterval: boolean;
    humanize: boolean;
    farmingCities: boolean;
  };
  general: {
    farmer: boolean;
    builder: boolean;
    recruiter: boolean;
    masterQueue: boolean;
    scheduler: boolean;
    academy: boolean;
    signoutOnCaptchaFailure: boolean;
    autoRelogin: boolean;
  };
  builder: {};
  recruiter: {};
  scheduler: {};
  academy: {};
  autoRelogin: {
    after: boolean;
  };
};

export const componentName = 'config-popup' as const;

// Chevron SVG component
const ChevronIcon = ({ isRotated, onClick }: { isRotated: boolean; onClick: () => void }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={`arrow-down ${isRotated ? 'rotate' : ''}`}
    width="16"
    height="16"
    fill="currentColor"
    viewBox="0 0 16 16"
    onClick={onClick}
  >
    <path
      fill-rule="evenodd"
      d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"
    />
  </svg>
);

// Reusable InputWrapper component
interface InputWrapperProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hidden?: boolean;
  expandableContent?: React.ReactNode;
  expandableHeader?: String | React.ReactNode;
}

// move away from "hidden" propm to conditional rendering
const InputWrapper = ({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  hidden = false,
  expandableContent,
  expandableHeader,
}: InputWrapperProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasExpandableContent = !!expandableContent;

  return !hidden ? (
    // <div className="input-wrapper" hidden={hidden}>
    <div className="input-wrapper">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={e => onChange((e.target as HTMLInputElement).checked)}
        disabled={disabled}
      />
      {hasExpandableContent ? (
        <div className="label-chevron">
          <label htmlFor={id}> {label} </label>
          <ChevronIcon isRotated={isExpanded} onClick={() => setIsExpanded(!isExpanded)} />
        </div>
      ) : (
        <label htmlFor={id}> {label} </label>
      )}
      {hasExpandableContent && isExpanded && (
        // <div className={`expandable-section ${isExpanded ? '' : 'hidden'}`}>
        <div className="expandable-section">
          <div className="section-header">{expandableHeader}</div>
          <div className="section-content">{expandableContent}</div>
        </div>
      )}
    </div>
  ) : null;
};

interface ConfigPopupProps {
  eventEmitter: EventEmitter;
  initialConfig: TConfig;
  initialCityList: CityInfo[];
  initialOpen?: boolean;
}

interface ConflictingCitiesState {
  uniqueIsleGrids: string[];
  arrayOfArraysOfCitiesOnTheSameIsland: CityInfo[][];
  areAnyConflicts: boolean;
}

const ConfigPopup = ({ eventEmitter, initialConfig, initialCityList, initialOpen = true }: ConfigPopupProps) => {
  const [open, setOpen] = useState(initialOpen);
  const [showDebugWindow, setShowDebugWindow] = useState(false);

  // Listen for external minimize requests
  useEffect(() => {
    const handleMinimize = () => {
      setOpen(false);
    };

    eventEmitter.on('minimize', handleMinimize);
    return () => {
      eventEmitter.off('minimize', handleMinimize);
    };
  }, [eventEmitter]);

  // General toggles
  const [farmer, setFarmer] = useState(initialConfig.general.farmer);
  const [recruiter, setRecruiter] = useState(initialConfig.general.recruiter);
  const [builder, setBuilder] = useState(initialConfig.general.builder);
  const [masterQueue, setMasterQueue] = useState(initialConfig.general.masterQueue);
  const [scheduler, setScheduler] = useState(initialConfig.general.scheduler);
  const [academy, setAcademy] = useState(initialConfig.general.academy);
  const [captcha, setCaptcha] = useState(initialConfig.general.signoutOnCaptchaFailure);
  const [autoRelogin, setAutoRelogin] = useState({
    checked: initialConfig.general.autoRelogin,
    after: initialConfig.autoRelogin.after,
  });

  // Farm specific
  const [farmInterval, setFarmInterval] = useState(initialConfig.farmer.farmInterval);
  const [humanize, setHumanize] = useState(initialConfig.farmer.humanize);

  // Conflicting cities
  const [uniquelySelectedFarmingCitiesPerIsle, setUniquelySelectedFarmingCitiesPerIsle] = useState<
    Record<string, CityInfo>
  >({});

  // Conflicting cities data
  const [conflictingCitiesState, setConflictingCitiesState] = useState<ConflictingCitiesState>({
    uniqueIsleGrids: [],
    arrayOfArraysOfCitiesOnTheSameIsland: [],
    areAnyConflicts: false,
  });

  // State for nested conflicting cities expansion
  const [conflictingCitiesExpanded, setConflictingCitiesExpanded] = useState(false);

  // Initialize conflicting cities
  useEffect(() => {
    const uniqueIsleGrids: string[] = Array.from(new Set(initialCityList.map(city => city.isleId)));
    const arrayOfArraysOfCitiesOnTheSameIsland = uniqueIsleGrids.map(isleId =>
      initialCityList.filter(city => city.isleId === isleId),
    );
    const areAnyConflicts = arrayOfArraysOfCitiesOnTheSameIsland.some(array => array.length > 1);

    setConflictingCitiesState({
      uniqueIsleGrids,
      arrayOfArraysOfCitiesOnTheSameIsland,
      areAnyConflicts,
    });

    // Initialize uniquely selected cities
    const initialSelection: Record<string, CityInfo> = {};

    if (!areAnyConflicts) {
      // No conflicts, all cities are uniquely selected
      initialCityList.forEach(city => {
        initialSelection[city.isleId] = city;
      });
    } else {
      // Handle conflicts
      arrayOfArraysOfCitiesOnTheSameIsland.forEach(arrayOfCities => {
        if (arrayOfCities.length === 1) {
          initialSelection[arrayOfCities[0].isleId] = arrayOfCities[0];
        } else {
          const initialCity =
            arrayOfCities.find(
              city =>
                city.name === initialConfig.farmer.farmingCities.find(c => c.isleId === arrayOfCities[0].isleId)?.name,
            ) ?? arrayOfCities[0];
          initialSelection[arrayOfCities[0].isleId] = initialCity;
        }
      });
    }

    setUniquelySelectedFarmingCitiesPerIsle(initialSelection);
  }, [initialCityList, initialConfig]);

  const mapTimeIntervalKeyToText = (value: FarmTimeInterval): string => {
    switch (value) {
      case FarmTimeInterval.FirstOption:
        return '5m/10m';
      case FarmTimeInterval.SecondOption:
        return '20m/40m';
      case FarmTimeInterval.ThirdOption:
        return '1h 30m/3h';
      case FarmTimeInterval.FourthOption:
        return '4h/8h';
      default:
        return 'Unknown interval';
    }
  };

  const farmTimeConfirmation = (): boolean => {
    if (farmInterval === FarmTimeInterval.FourthOption && farmer) {
      return confirm('Farmienie ustawione na 4h/8h. Kliknij OK aby kontynuować lub Anuluj aby cofnąć (na 5min/10min).');
    }
    return true;
  };

  const configChanged = (configChanges: { [key: string]: any }): boolean => {
    for (const [key, value] of Object.entries(configChanges)) {
      if (typeof value === 'object') {
        if (configChanged(value)) return true;
      } else if (value) {
        return true;
      }
    }
    return false;
  };

  const handleSubmit = () => {
    if (!farmTimeConfirmation()) {
      setFarmInterval(FarmTimeInterval.FirstOption);
      return;
    }

    const conflictingCitiesChanged = Object.keys(uniquelySelectedFarmingCitiesPerIsle).some(
      isleId =>
        uniquelySelectedFarmingCitiesPerIsle[isleId].name !==
        initialConfig.farmer.farmingCities.find(city => city.isleId === isleId)?.name,
    );

    const managersConfigChanges: TConfigChanges = {
      masterQueue: {},
      farmer: {
        farmInterval: initialConfig.farmer.farmInterval !== farmInterval,
        humanize: initialConfig.farmer.humanize !== humanize,
        farmingCities: conflictingCitiesChanged,
      },
      general: {
        farmer: initialConfig.general.farmer !== farmer,
        masterQueue: initialConfig.general.masterQueue !== masterQueue,
        builder: initialConfig.general.builder !== builder,
        recruiter: initialConfig.general.recruiter !== recruiter,
        scheduler: initialConfig.general.scheduler !== scheduler,
        academy: initialConfig.general.academy !== academy,
        signoutOnCaptchaFailure: initialConfig.general.signoutOnCaptchaFailure !== captcha,
        autoRelogin: initialConfig.general.autoRelogin !== autoRelogin.checked,
      },
      builder: {},
      scheduler: {},
      recruiter: {},
      academy: {},
      autoRelogin: {
        after: initialConfig.autoRelogin.after !== autoRelogin.after,
      },
    };

    // Update config if changed
    if (configChanged(managersConfigChanges)) {
      const configManager = ConfigManager.getInstance();
      const config = configManager.getConfig();

      config.farmer.farmInterval = farmInterval;
      config.farmer.humanize = humanize;
      config.farmer.farmingCities = Object.values(uniquelySelectedFarmingCitiesPerIsle);

      config.general.farmer = farmer;
      config.general.builder = builder;
      config.general.recruiter = recruiter;
      config.general.masterQueue = masterQueue;
      config.general.scheduler = scheduler;
      config.general.academy = academy;

      config.general.signoutOnCaptchaFailure = captcha;
      if (config.general.autoRelogin !== autoRelogin.checked || config.autoRelogin.after !== autoRelogin.after) {
        setCookie('autoRelogin', autoRelogin.checked ? { value: autoRelogin.checked, after: autoRelogin.after } : '', {
          maxAge: autoRelogin.checked ? 60 * 60 * 24 * 365 : -1,
        });
      }
      config.general.autoRelogin = autoRelogin.checked;
      config.autoRelogin.after = autoRelogin.after;

      configManager.persist();
    }

    setOpen(false);
    eventEmitter.emit('managersChange', managersConfigChanges);
  };

  const handleCancelAll = () => {
    setFarmer(false);
    setBuilder(false);
    setRecruiter(false);
    setMasterQueue(false);
    setScheduler(false);
    setAcademy(false);
  };

  //   useEffect(() => {
  //     const config = ConfigManager.getInstance().getConfig();
  //     setFarm(config.general.farm);
  //     setBuilder(config.general.builder);
  //     setGuard(config.general.guard);
  //     setRecruiter(config.general.recruiter);
  //     setMasterQueue(config.general.masterQueue);
  //     setScheduler(config.general.scheduler);
  //   }, [isMinimized]);

  const handleConflictingCityChange = (isleId: string, cityName: string) => {
    const cityArray = conflictingCitiesState.arrayOfArraysOfCitiesOnTheSameIsland.find(arr => arr[0].isleId === isleId);
    const selectedCity = cityArray?.find(city => city.name === cityName);
    if (selectedCity) {
      setUniquelySelectedFarmingCitiesPerIsle(prev => ({
        ...prev,
        [isleId]: selectedCity,
      }));
    }
  };

  const farmIntervalValuesUnparsed = Object.values(FarmTimeInterval);
  const farmIntervalValues = farmIntervalValuesUnparsed.slice(farmIntervalValuesUnparsed.length / 2);

  return (
    <div>
      <div id="config-popup-container" className={!open ? 'hidden' : ''}>
        <div id="config-popup-header" className={'relative'}>
          <div
            onClick={() => setShowDebugWindow(prev => !prev)}
            className="absolute top-1/2 left-0 -translate-y-1/2 cursor-pointer p-1 hover:opacity-70"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <h1>GPS config</h1>
          <div
            id="close-popup"
            onClick={() => {
              setOpen(false);
              setShowDebugWindow(false);
            }}
          >
            &#10006;
          </div>
        </div>
        <div id="config-popup-content">
          {/* Farm Manager */}
          <InputWrapper
            id="farm"
            label="Farm manager"
            checked={farmer}
            onChange={setFarmer}
            expandableContent={
              <>
                <div className="input-wapper">
                  <label> Time interval </label>
                  <select
                    id="time-interval-select"
                    value={farmInterval}
                    onChange={e => setFarmInterval(Number((e.target as HTMLSelectElement).value))}
                  >
                    {farmIntervalValues.map(value => (
                      <option key={value} value={value}>
                        {mapTimeIntervalKeyToText(value as FarmTimeInterval)}
                      </option>
                    ))}
                  </select>
                </div>
                <InputWrapper id="humanize-checkbox" label="Humanize" checked={humanize} onChange={setHumanize} />
                {conflictingCitiesState.areAnyConflicts && (
                  <div id="conflicting-cities-container">
                    <div className="section-header">
                      <span className="section-name">Conflicting cities</span>
                      <ChevronIcon
                        isRotated={conflictingCitiesExpanded}
                        onClick={() => setConflictingCitiesExpanded(!conflictingCitiesExpanded)}
                      />
                    </div>
                    <div className={`section-content ${conflictingCitiesExpanded ? '' : 'hidden'}`}>
                      {conflictingCitiesState.arrayOfArraysOfCitiesOnTheSameIsland.map(arrayOfCities => {
                        if (arrayOfCities.length === 1) return null;
                        return (
                          <div key={arrayOfCities[0].isleId} className="isle-container">
                            <div className="isle-header">Isle {arrayOfCities[0].isleId}</div>
                            <select
                              name={`isle-${arrayOfCities[0].isleId}-cities`}
                              id={`isle-${arrayOfCities[0].isleId}-cities`}
                              value={uniquelySelectedFarmingCitiesPerIsle[arrayOfCities[0].isleId]?.name || ''}
                              onChange={e =>
                                handleConflictingCityChange(
                                  arrayOfCities[0].isleId,
                                  (e.target as HTMLSelectElement).value,
                                )
                              }
                            >
                              {arrayOfCities.map(city => (
                                <option key={city.name} value={city.name}>
                                  {city.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            }
          />

          {/* Builder */}
          <InputWrapper id="builder" label="Builder" checked={builder} onChange={setBuilder} />

          {/* Recruiter */}
          <InputWrapper id="recruiter" label="Recruiter" checked={recruiter} onChange={setRecruiter} />

          {/* Master Queue */}
          <InputWrapper id="master-queue" label="Master queue" checked={masterQueue} onChange={setMasterQueue} />

          {/* Scheduler */}
          <InputWrapper id="scheduler" label="Scheduler" checked={scheduler} onChange={setScheduler} />

          {/* Academy */}
          <InputWrapper id="academy" label="Academy" checked={academy} onChange={setAcademy} />

          {/* Captcha failure */}
          <InputWrapper id="captcha" label="Log out on captcha failure" checked={captcha} onChange={setCaptcha} />

          {/* Signin back */}
          <InputWrapper
            id="auto-relogin"
            label="Auto signin back"
            checked={autoRelogin.checked}
            onChange={v =>
              setAutoRelogin(prev => {
                if (!prev.checked) {
                  setCookie('cr3', '', { maxAge: -1 });
                  setCookie('worldname', '', { maxAge: -1 });
                }
                return { ...prev, checked: !prev.checked };
              })
            }
            expandableContent={
              <div>
                <div className="input-wrapper">
                  <label htmlFor={'auto-relogin-after'}>After [s]:</label>
                  <input
                    type="number"
                    id="auto-relogin-after"
                    value={autoRelogin.after}
                    onChange={e =>
                      setAutoRelogin(prev => ({ ...prev, after: Number((e.target as HTMLInputElement).value) }))
                    }
                  />
                </div>
                <button
                  onClick={() => {
                    const login = window.prompt('login:');
                    if (!login) {
                      setAutoRelogin(prev => ({ ...prev, checked: false }));
                      return;
                    }
                    const pwd = window.prompt('Password:');
                    if (!pwd) {
                      setAutoRelogin(prev => ({ ...prev, checked: false }));
                      return;
                    }
                    const worldname = window.prompt('World name:');
                    if (!worldname) {
                      setAutoRelogin(prev => ({ ...prev, checked: false }));
                      return;
                    }

                    // Set cookie for 1 year using max-age (1 rok = 365 days)
                    const maxAge = 60 * 60 * 24 * 365;
                    setCookie('cr3', btoa(`${login}:${pwd}`), { maxAge });
                    setCookie('worldname', worldname.toUpperCase(), { maxAge });
                  }}
                >
                  Add credentials
                </button>
              </div>
            }
          />

          {/* Button Panel */}
          <div id="button-panel">
            <button id="submit" onClick={handleSubmit}>
              Submit
            </button>
            <button type="reset" id="cancel-all" onClick={handleCancelAll}>
              Cancel all
            </button>
          </div>
        </div>
        {showDebugWindow && (
          <div
            className="absolute top-1/2 left-1/2 z-[2000] flex size-fit -translate-x-1/2 -translate-y-1/2 flex-col gap-1 bg-white"
            style={{ padding: '8px' }}
          >
            <div className="absolute top-2 right-2 cursor-pointer" onClick={() => setShowDebugWindow(false)}>
              &#10006;
            </div>
            <h1>Debug</h1>
            <button
              onClick={() => {
                console.log('[DEBUG]: Lock:', Lock.getInstance().getLogInfo());
              }}
            >
              Log Lock
            </button>
            <button onClick={() => Lock.getInstance().forceReleaseAll()}>Force release lock</button>
            <button
              onClick={() => {
                localStorage.removeItem(MasterQueue.LOCAL_STORAGE_KEY);
                localStorage.removeItem(Scheduler.LOCAL_STORAGE_KEY);
                localStorage.removeItem(ConfigManager.LOCAL_STORAGE_KEY);
                Lock.getInstance().forceReleaseAll();
                MasterManager.getInstance().then(i => {
                  i.stopAll();
                });
              }}
            >
              Reset GPS
            </button>
          </div>
        )}
      </div>
      <div id="config-popup-trigger" onClick={() => setOpen(prev => !prev)}>
        GPS
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
export type ConfigPopupUtility = ReturnType<typeof useConfigPopup>;
export const useConfigPopup = () => {
  let container: HTMLDivElement | null = null;
  const eventEmitter = new EventEmitter();

  const mount = async ({ initialConfig, open }: { initialConfig: TConfig; open?: boolean }) => {
    console.log('should mount:', componentName);

    addStyleIfNotAdded();

    const citySwitchManager = await CitySwitchManager.getInstance();
    const cityList = citySwitchManager.getCityList();

    // Find existing container or create new one
    container = document.body.querySelector<HTMLDivElement>(`[data-for="${componentName}"]`);
    if (!container) {
      container = document.createElement('div');
      container.dataset.for = componentName;
      document.body.appendChild(container);
    }

    // Render component
    render(
      h(ConfigPopup, {
        eventEmitter,
        initialConfig,
        initialCityList: cityList,
        initialOpen: open,
      }),
      container,
    );
  };

  const update = async ({ newConfig, open }: { newConfig: TConfig; open?: boolean }) => {
    if (!container) {
      console.warn('Cannot update: component not mounted');
      return;
    }

    const citySwitchManager = await CitySwitchManager.getInstance();
    const cityList = citySwitchManager.getCityList();

    render(
      h(ConfigPopup, {
        eventEmitter,
        initialConfig: newConfig,
        initialCityList: cityList,
        initialOpen: open,
      }),
      container,
    );
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

    // Remove all event listeners
    eventEmitter.removeAllListeners();
  };

  const minimize = () => {
    eventEmitter.emit('minimize');
  };

  const addListener = (event: string, listener: (...args: any[]) => void) => {
    eventEmitter.addListener(event, listener);
  };

  const removeListener = (event: string, listener: (...args: any[]) => void) => {
    eventEmitter.removeListener(event, listener);
  };

  return {
    mount,
    update,
    unmount,
    minimize,
    addListener,
    removeListener,
    get container() {
      return container;
    },
  };
};
export default useConfigPopup;
