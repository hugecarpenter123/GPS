import { createPortal } from 'preact/compat';
import { useState } from 'preact/hooks';
import { getMsFromStartOfDay, HHMMSS_toMS, msToHHMMSS } from '../../../utility/plain-utility';
import CharmsUtility from '../../charms/charms-utility';
import { AttackStrategy, OperationType, ScheduleItem, ScheduleItemEditData } from '../Scheduler';

interface SchedulerEditDialogProps {
  open: boolean;
  setOpen: (value: boolean) => void;
  onEdit: (editData: ScheduleItemEditData) => { success: boolean; message?: string };
  scheduleItem: ScheduleItem;
  scheduleList: ScheduleItem[];
}

export default function SchedulerEditDialog({
  onEdit,
  scheduleItem,
  scheduleList,
  open,
  setOpen,
}: SchedulerEditDialogProps) {
  const [operationType, setOperationType] = useState<OperationType>(scheduleItem.operationType);
  const [attackStrategy, setAttackStrategy] = useState<AttackStrategy | undefined>(scheduleItem.attackStrategy);
  const [power, setPower] = useState<string | undefined>(scheduleItem.power?.dataPowerId);
  const [includeHero, setIncludeHero] = useState(scheduleItem.includeHero);
  const [timingType, setTimingType] = useState<'raw' | 'sync'>(!!scheduleItem.synchronizedWith ? 'sync' : 'raw');
  const [date, setDate] = useState(() => {
    const targetDate = new Date(scheduleItem.timeDetails.targetTime || Date.now());
    targetDate.setHours(0, 0, 0, 0);
    return targetDate;
  });
  const [targetTime, setTargetTime] = useState<string>(
    scheduleItem.timeDetails.targetTime ? msToHHMMSS(getMsFromStartOfDay(scheduleItem.timeDetails.targetTime)) : '',
  );
  const [syncID, setSyncID] = useState<string | undefined>(scheduleItem.synchronizedWith?.scheduleId);
  const [syncDeviation, setSyncDeviation] = useState<number>(
    scheduleItem.synchronizedWith?.deviation ? scheduleItem.synchronizedWith.deviation / 1000 : 0,
  );
  const [isPrecise, setIsPrecise] = useState<boolean>(!!scheduleItem.precision);
  const [tolerance, setTolerance] = useState<number>(
    scheduleItem.precision?.tolerance ? scheduleItem.precision.tolerance / 1000 : 3,
  );

  const [error, setError] = useState('');

  const handleCancel = () => {
    handleClose();
  };

  const handleSubmit = () => {
    // TODO: validation with error

    const editData: ScheduleItemEditData = {
      operationType,
      // no need to pass default values if it's totally different operation Type
      attackStrategy: operationType === OperationType.Attack ? attackStrategy : undefined,
      power: power ? (CharmsUtility.getCharmByPowerId(power) ?? null) : null,
      includeHero,
      // TODO: enable edit, for now pass previous details
      armyDetails: scheduleItem.armyDetails,
      targetTime: timingType === 'raw' && targetTime ? date.getTime() + HHMMSS_toMS(targetTime) : null,
      precision: isPrecise ? { tolerance: tolerance * 1000 } : undefined,
      synchronizedWith:
        timingType === 'sync' && syncID ? { scheduleId: syncID, deviation: syncDeviation * 1000 } : undefined,
    };
    const { success, message } = onEdit(editData);
    if (success) {
      handleClose();
    } else {
      setError(message ?? '');
    }
  };

  const handleClose = () => {
    setError('');
    setOpen(false);
  };

  return (
    <>
      {open &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2137,
            }}
          >
            <div
              style={{
                position: 'relative',
                backgroundColor: 'white',
                padding: '20px',
                borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
                minWidth: '300px',
                maxWidth: '90%',
                maxHeight: '90vh',
                height: 'fit-content',
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                alignItems: 'flex-start',
              }}
            >
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
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  cursor: 'pointer',
                }}
                onClick={handleClose}
              >
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <line x1="23" y1="1" x2="1" y2="23"></line>
              </svg>
              {/* Tutaj zawartość dialogu */}
              <div style={{ width: 'fit-content' }}>
                <label htmlFor="s-ot">Operation type</label>
                <select
                  id="s-ot"
                  value={operationType}
                  onChange={e => setOperationType((e.target as HTMLSelectElement).value as OperationType)}
                >
                  <option value={OperationType.Attack}>⚔️ Attack</option>
                  <option value={OperationType.Support}>🛡️ Support</option>
                </select>
              </div>
              {operationType === OperationType.Attack && (
                <>
                  <div style={{ width: 'fit-content' }}>
                    <label htmlFor="s-as">Attack strategy</label>
                    <div
                      style={{
                        width: '45px',
                        height: '45px',
                        backgroundImage:
                          'url(https://gppl.innogamescdn.com/images/game/towninfo/attack_type/breach.png)',
                        ...(attackStrategy === 'breach' ? { backgroundPositionY: '-47px' } : {}),
                      }}
                      onClick={() => setAttackStrategy(prev => (prev === 'breach' ? 'regular' : 'breach'))}
                    />
                  </div>

                  {/* powers */}
                  <div>
                    <div style={{ textAlign: 'start' }}>Power</div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
                      {CharmsUtility.attackCharms.map(c => (
                        <div
                          class={c.classes}
                          onClick={() => setPower(prev => (prev === c.dataPowerId ? undefined : c.dataPowerId))}
                          style={{
                            width: '45px',
                            height: '45px',
                            ...(power === c.dataPowerId ? { border: '2px solid green', borderRadius: '50%' } : {}),
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div style={{ width: 'fit-content', display: 'flex', alignItems: 'center' }}>
                    <label htmlFor="s-ih" style={{ userSelect: 'none' }}>
                      Include hero
                    </label>
                    <input
                      type="checkbox"
                      id="s-ih"
                      checked={includeHero}
                      onChange={e => setIncludeHero((e.target as HTMLInputElement).checked)}
                    />
                  </div>
                </>
              )}
              {/* TODO: army inputs */}
              <div></div>

              <div style="display: flex; gap: 8px">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="radio"
                    id="s-tt-raw"
                    name="timing-type"
                    value="raw"
                    checked={timingType === 'raw'}
                    onChange={() => setTimingType('raw')}
                  />
                  <label htmlFor="s-tt-raw">Raw timing</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="radio"
                    id="s-tt-sync"
                    name="timing-type"
                    value="sync"
                    checked={timingType === 'sync'}
                    onChange={() => setTimingType('sync')}
                  />
                  <label htmlFor="s-tt-sync">Sync</label>
                </div>
              </div>

              {timingType === 'raw' ? (
                <>
                  <div>
                    <label htmlFor="s-tt" style={{ textAlign: 'start' }}>
                      Target time
                    </label>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input
                        id="scheduler-date"
                        type="date"
                        value={date.toLocaleDateString('en-CA')}
                        onChange={e => {
                          const newDate = new Date((e.target as HTMLInputElement).value);
                          newDate.setHours(0, 0, 0, 0);
                          setDate(newDate);
                        }}
                      />
                      <input
                        id="s-tt"
                        type="text"
                        style={{ width: '52px' }}
                        value={targetTime}
                        onChange={e => setTargetTime((e.target as HTMLInputElement).value)}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <select
                      style="width: 90px"
                      value={syncID ?? undefined}
                      onChange={e => setSyncID((e.target as HTMLSelectElement).value)}
                    >
                      <option disabled selected={!syncID}>
                        sync with:
                      </option>
                      {scheduleList.map((item: ScheduleItem) => (
                        <option value={item.id}>
                          {item.sourceCity.name} {item.operationType === OperationType.Attack ? '⚔️' : '🛡️'}{' '}
                          {item.targetCityDetails.name} (ID="{item.id}")
                        </option>
                      ))}
                    </select>

                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <label for="s-sd">+</label>
                      <input
                        id="s-sd"
                        type="number"
                        style="width: 5ch"
                        value={syncDeviation}
                        onChange={e => setSyncDeviation((e.target as HTMLInputElement).valueAsNumber)}
                      />
                      <label for="s-sd">s</label>
                    </div>
                  </div>
                </>
              )}

              {/* precision radio */}
              <div style="display: flex; gap: 8px">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="radio"
                    //   precision true
                    id="s-p-t"
                    name="s-p-t"
                    value="precise"
                    checked={isPrecise}
                    onChange={() => setIsPrecise(true)}
                  />
                  <label htmlFor="s-p-t">Precise</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="radio"
                    //   precision false
                    id="s-p-f"
                    name="s-p-f"
                    value="normal"
                    checked={!isPrecise}
                    onChange={() => setIsPrecise(false)}
                  />
                  <label htmlFor="s-p-f">Normal</label>
                </div>
              </div>

              {isPrecise && (
                <div style="display: flex; align-items: center; width: fit-content">
                  <label for="s-t">tolerance</label>
                  <input
                    id="s-t"
                    type="number"
                    style="width: 5ch; margin-left: 4px;"
                    min="-10"
                    max="10"
                    value={tolerance}
                    onChange={e => setTolerance((e.target as HTMLInputElement).valueAsNumber)}
                  />
                  s
                </div>
              )}
              {error && <div style={{ color: 'red', textAlign: 'start' }}>{error}</div>}
              {/* button panel */}
              <div
                style={{ display: 'flex', gap: '8px', marginTop: '24px', justifyContent: 'flex-end', width: '100%' }}
              >
                <button onClick={handleCancel}>Cancel</button>
                <button onClick={handleSubmit}>Save</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
