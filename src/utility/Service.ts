import { TConfigChanges } from '../config-popup/config-popup';

export default interface Service<K extends keyof TConfigChanges> {
  isRunning: () => boolean;
  start: (autorun?: boolean) => void | Promise<void>;
  stop: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  resume: () => void | Promise<void>;
  getScheduledActionTimes: () => [number, number | undefined][];
  onConfigChange: (configChanges: Partial<TConfigChanges[K]>) => void;
}
