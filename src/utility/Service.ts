import { TConfigChanges } from "../config-popup/config-popup";

export default interface Service {
  isRunning: () => boolean;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  // TODO: should be required
  getScheduledActionTimes?: () => number[]
  onConfigChange?: (configChanges: Partial<TConfigChanges>) => void
}
