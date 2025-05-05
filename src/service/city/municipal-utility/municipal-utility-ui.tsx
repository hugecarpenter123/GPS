// import { createElement } from 'preact';
// import { render } from 'preact/compat'
// import { useEffect, useState } from 'preact/hooks';
// import municipalUtilityStyle from './municipal-utility-style.css';
// import CitySwitchManager, { CityInfo } from '../city-switch-manager';
// import { QueuePriority } from '../../master-queue/master-queue';
// import { MunicipalEvent } from './municipal-utility';

// interface MunicipalUtilityProps {
//   availableCities: CityInfo[];
//   onSubmit: (data: {
//     selectedEvent: MunicipalEvent,
//     repetitiveness: number,
//     continuous: boolean,
//     priority: QueuePriority,
//     selectedCities: CityInfo[]
//   }) => void;
// }

// export const MunicipalUtility = ({
//   availableCities,
//   onSubmit
// }: MunicipalUtilityProps) => {
//   const [open, setOpen] = useState(false);
//   // NOTE: possibly remove this state
//   const [currentCity, setCurrentCity] = useState<CityInfo | undefined>(undefined);
//   const [selectedEvent, setSelectedEvent] = useState<MunicipalEvent | null>(null);
//   const [repetitiveness, setRepetitiveness] = useState(1);
//   const [continuous, setContinuous] = useState(false);
//   const [priority, setPriority] = useState<QueuePriority>(QueuePriority.High);
//   const [selectedCities, setSelectedCities] = useState<string[]>([]);
//   const [showInfo, setShowInfo] = useState<boolean>(false);
//   const [showError, setShowError] = useState<boolean>(false);

//   /**
//    * tracks city changes, and updates current city based on that
//    */
//   useEffect(() => {
//     let isMounted = true;
//     let citySwitchManager: CitySwitchManager | undefined;
//     let callback = (switchedCity: CityInfo) => { setCurrentCity(switchedCity) }
//     if (open) {
//       CitySwitchManager.getInstance().then((instance) => {
//         if (isMounted) {
//           citySwitchManager = instance;
//           const currentCity = instance.getCurrentCity()!;
//           setCurrentCity(currentCity);
//           setSelectedCities([currentCity.name])
//           citySwitchManager.on('cityChange', callback)
//         }
//       });
//     }
//     return () => {
//       isMounted = false;
//       if (citySwitchManager) citySwitchManager.off('cityChange', callback)
//     };
//   }, [open])

//   const handleEventSelect = (item: MunicipalEvent) => {
//     setSelectedEvent(item);
//   };

//   const handleSubmit = () => {
//     if (!selectedEvent || !selectedCities || (!repetitiveness && !continuous)) {
//       setShowError(true);
//       setTimeout(() => {
//         setShowError(false);
//       }, 1333);
//       return
//     }
//     const cities: CityInfo[] = selectedCities
//       .map(cityName => availableCities.find(c => c.name === cityName))
//       .filter(el => el !== undefined);

//     onSubmit({
//       selectedEvent,
//       repetitiveness,
//       continuous,
//       priority,
//       selectedCities: cities
//     })
//     setShowInfo(true);
//     setTimeout(() => {
//       setShowInfo(false);
//     }, 1333);
//   }

//   const handleReset = () => {

//   }

//   return (
//     <div>
//       <div id="municipal-utility-trigger" onClick={() => setOpen(prev => !prev)}>
//         MU
//       </div>
//       {open && (<div id="municipal-utility-window">
//         <nav><button onClick={() => setOpen(false)} id="municipal-utility-close-button">✕</button></nav>
//         <h1>Municipal Utility</h1>
//         <div className="img-panel top-separated">
//           <img
//             data-cultural-event="CityFestival"
//             height="65px"
//             src="https://gppl.innogamescdn.com/images/game/place/party.jpg"
//             className={selectedEvent === MunicipalEvent.CityFestival ? 'selected' : ''}
//             onClick={() => handleEventSelect(MunicipalEvent.CityFestival)}
//           />
//           <img
//             data-cultural-event="TriumphalProcession"
//             height="65px"
//             src="https://gppl.innogamescdn.com/images/game/place/triumph.jpg"
//             className={selectedEvent === MunicipalEvent.TriumphalProcession ? 'selected' : ''}
//             onClick={() => handleEventSelect(MunicipalEvent.TriumphalProcession)}
//           />
//           <img
//             data-cultural-event="TheatrePerformances"
//             height="65px"
//             src="https://gppl.innogamescdn.com/images/game/place/theater.jpg"
//             className={selectedEvent === MunicipalEvent.TheatrePerformances ? 'selected' : ''}
//             onClick={() => handleEventSelect(MunicipalEvent.TheatrePerformances)}
//           />
//         </div>
//         <div className="select-wrapper top-separated">
//           <label htmlFor="municipal-utility-city-select">City</label>
//           <select name="city-select" id="municipal-utility-city-select" multiple>
//             {availableCities.map((city) => (
//               <option value={city.name} selected={selectedCities.includes(city.name)}>{city.name}</option>
//             ))}
//           </select>
//         </div>
//         <div className="input-wrapper top-separated">
//           <label htmlFor="municipal-utility-repetitiveness">Repetitiveness:</label>
//           <input
//             id="municipal-utility-repetitiveness"
//             type="number"
//             min="0"
//             style={{ width: '5ch' }}
//             value={repetitiveness}
//             disabled={continuous}
//             onChange={(e) => setRepetitiveness(parseInt((e.target as HTMLInputElement).value, 10))}
//           />
//           <input
//             type="checkbox"
//             id="municipal-utility-infinity"
//             checked={continuous}
//             onChange={() => setContinuous((prev) => !prev)}
//           />
//           <label htmlFor="municipal-utility-infinity">Continuous</label>
//         </div>
//         <div className="select-wrapper top-separated">
//           <label htmlFor="municipal-utility-priority">Priority:</label>
//           <select
//             name="municipal-utility-priority"
//             id="municipal-utility-priority"
//             value={priority}
//             onChange={(e) => setPriority((e.target as HTMLSelectElement)!.value as QueuePriority)}
//           >
//             <option value={QueuePriority.High}>high</option>
//             <option value={QueuePriority.Normal}>normal</option>
//             <option value={QueuePriority.Low}>low</option>
//           </select>
//         </div>
//         <div className="top-separated" style={"display: flex; gap:4px;"}>
//           <button onClick={handleSubmit} type="submit">Submit</button>
//           <button class='reset' type='reset' onClick={handleReset}>Clear</button>
//           {showInfo && (<p style={'color: green; margin: 0; line-height: 1;'}>Scheduled</p>)}
//           {showError && (<p style={'color: red; margin: 0; line-height: 1;'}>Data incomplete</p>)}
//         </div>
//       </div>)}
//     </div>
//   );
// };

// const addStyleIfNotAdded = () => {
//   if (!document.head.querySelector('[data-for="municipal-utility"]')) {
//     console.log('should add style');
//     const style = document.createElement('style');
//     style.dataset.for = 'municipal-utility';
//     style.textContent = municipalUtilityStyle;
//     document.head.appendChild(style);
//   }
// }

// export const useMunicipalUtilityUI = () => {
//   let container = document.body.querySelector<HTMLDivElement>('[data-for="municipal-utility"]');
//   const mount = (props: MunicipalUtilityProps) => {
//     console.log('should mount')

//     addStyleIfNotAdded();
//     if (!container) {
//       container = document.createElement('div');
//       container.dataset.for = 'municipal-utility';
//       document.body.appendChild(container);
//     }
//     update(props);
//   }

//   // Przechowaj referencje do listenerów, które można później usunąć
//   const listeners: { target: Element, type: string, callback: Function }[] = [];

//   // Pomocnicza funkcja do dodawania event listenerów z śledzeniem
//   const addTrackedListener = (target: Element, type: string, callback: Function) => {
//     target.addEventListener(type, callback as EventListener);
//     listeners.push({ target, type, callback });
//   };

//   const update = (newProps: MunicipalUtilityProps) => {
//     if (!container) return;
//     render(createElement(MunicipalUtility, newProps), container);
//   };

//   const unmount = () => {
//     listeners.forEach(({ target, type, callback }) => {
//       target.removeEventListener(type, callback as EventListener);
//     });

//     document.body.querySelector('[data-for="municipal-utility"]')?.remove();
//     document.head.querySelector('[data-for="municipal-utility"]')?.remove();
//   };

//   return {
//     mount,
//     update,
//     unmount,
//     container
//   };
// };
