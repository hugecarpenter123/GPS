export interface IService {
  isRunning: () => boolean;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
}
