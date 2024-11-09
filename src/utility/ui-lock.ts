import { Managers } from "../service/master/master-manager";
import { formatDateToSimpleString, getCopyOf } from "./plain-utility";

type LockTakerInfo = {
  method?: string;
  requestedAt: Date;
  acquiredAt?: Date;
  forced: boolean;
  manager?: Managers;
  city?: string;
  releasedAt?: Date;
}

export default class Lock {
  public static readonly LOCK_TIMEOUT: number = 1000 * 60 * 5;

  private static instance: Lock | null = null;
  private lockQueueInfo: LockTakerInfo[] = [];
  private lockCheckInterval: NodeJS.Timeout | null = null;
  private isLocked: LockTakerInfo | false = false;
  private queue: (() => void)[] = [];

  private constructor() { }

  public static getInstance(): Lock {
    if (!this.instance) {
      this.instance = new Lock();
      this.instance.setLockCheckInterval();
    }
    return this.instance;
  }

  /**
   * Method sets the interval to check if the lock is taken for too long and if so then
   * releases the lock assuming that something went wrong.
   */
  private setLockCheckInterval() {
    this.lockCheckInterval = setInterval(() => {
      if (this.isLocked && (Date.now() - this.isLocked.requestedAt.getTime() > Lock.LOCK_TIMEOUT)) {
        console.warn(`Lock: lock is taken for too long by ${this.isLocked.manager} "${this.isLocked.method}", releasing...`);
        // TODO: or consider restarting all managers
        this.release();
      }
    }, Lock.LOCK_TIMEOUT);
  }

  /**
   * Method tries to acquire the lock. If lock is free, it takes it.
   * If lock is taken, it adds the lock taker to the queue.
   * @param lockTakerInfo - optional lock taker name
   */
  public async acquire(lockTakerInfo?: { method?: string, manager?: Managers }): Promise<void> {
    const lockTaker: LockTakerInfo = {
      method: lockTakerInfo?.method,
      requestedAt: new Date(),
      forced: false,
      manager: lockTakerInfo?.manager,
    }

    if (!this.isLocked) {
      lockTaker.acquiredAt = new Date();
      this.isLocked = lockTaker;
      console.log(`Lock: acquire`, this.mapToLogObj(this.isLocked));
    } else {
      console.log(`\t-lock is taken, add`, this.mapToLogObj(lockTaker), 'to queue:', getCopyOf(this.lockQueueInfo))
      this.lockQueueInfo.push(lockTaker);
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

  }

  /**
   * Method forcefully unshifts the lock taker to the queue and releases currently taken lock. 
   * Doesn't remove existing queue.
   * @param lockTakerInfo 
   */
  public async forceAcquire(lockTakerInfo: { method?: string, manager?: Managers }): Promise<void> {
    const lockTaker: LockTakerInfo = {
      method: lockTakerInfo.method,
      requestedAt: new Date(),
      forced: true,
      manager: lockTakerInfo.manager,
    };

    if (this.isLocked) {
      console.log(`Lock: forceAcquire by`, this.mapToLogObj(lockTaker), 'on current lock:', this.mapToLogObj(this.isLocked as LockTakerInfo));
      await new Promise<void>(resolve => {
        this.lockQueueInfo.unshift(lockTaker);
        this.queue.unshift(resolve);
        this.release();
      });
    } else {
      lockTaker.acquiredAt = new Date();
      this.isLocked = lockTaker;
      console.log(`Lock: forceAcquire: `, this.mapToLogObj(lockTaker));
      return;
    }
  }

  /**
   * Method releases the lock and calls the next waiting task in the queue
   */
  public release(): void {
    // Release the next waiting task in the queue
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        // update state before logging and releasing
        (this.isLocked as LockTakerInfo).releasedAt = new Date();
        console.log('Lock: release:', this.mapToLogObj(this.isLocked as LockTakerInfo));

        this.isLocked = this.lockQueueInfo.shift() ?? {} as LockTakerInfo;
        this.isLocked.acquiredAt = new Date();
        console.log('\t-next element in the queue takes the lock:', this.mapToLogObj(this.isLocked as LockTakerInfo));
        nextResolve();
      }
    } else {
      (this.isLocked as LockTakerInfo).releasedAt = new Date();
      console.log(`Lock: release: `, this.mapToLogObj(this.isLocked as LockTakerInfo));
      this.isLocked = false;
    }
  }

  private mapToLogObj(lockTakerInfo: LockTakerInfo): string {
    const firstStepCopy: any = { ...lockTakerInfo };
    firstStepCopy.requestedAt = firstStepCopy.requestedAt.toLocaleString();
    if (firstStepCopy.acquiredAt) firstStepCopy.acquiredAt = firstStepCopy.acquiredAt.toLocaleString();
    if (firstStepCopy.releasedAt) firstStepCopy.releasedAt = firstStepCopy.releasedAt.toLocaleString();
    return getCopyOf(firstStepCopy);
  }

  public isTaken(): boolean {
    return !!this.isLocked;
  }
}