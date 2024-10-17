import { formatDateToSimpleString } from "./plain-utility";

export default class Lock {
  private static instance: Lock | null = null;
  private isLocked: boolean = false;
  private lockedBy: string | null = null;
  private lockedAt: number | null = null;
  private lockCheckInterval: NodeJS.Timeout | null = null;
  private queue: (() => void)[] = [];

  private constructor() {}

  public static getInstance(): Lock {
    if (!this.instance) {
      this.instance = new Lock();
      this.instance.setLockCheckInterval();
    }
    return this.instance;
  }

  private setLockCheckInterval() {
    this.lockCheckInterval = setInterval(() => {
      if (this.lockedAt && (Date.now() - this.lockedAt > 1000 * 60 * 5)) {
        console.warn(`Lock: lock is taken for too long by "${this.lockedBy}", releasing...`);
        // TODO: or consider restarting all managers
        this.release();
      }
    }, 1000 * 60 * 5);
  }

  public async acquire(lockTaker?: string): Promise<void> {
    console.log(`Lock: try acquiring${lockTaker ? '\n\t-by: ' + lockTaker : ''}\n\t-at ${formatDateToSimpleString(new Date())}`)    
    if (!this.isLocked) {
      console.log('\t-lock is free, acquire Lock')
      this.isLocked = true;
      this.lockedBy = lockTaker ?? null;
      this.lockedAt = Date.now();
      return;
    }
    // console.log(`\t-lock is locked, add${lockTaker ? ' "' +lockTaker + '"' : ''} to queue`, this.queue.length)
    console.log(`\t-lock is taken, add to queue, length before adding: ${this.queue.length}`)


    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  public release(): void {
    console.log(`Lock: release lock${this.lockedBy ? `\n\t-by: "${this.lockedBy}"` : ''}\n\t-at ${formatDateToSimpleString(new Date())}`)
    // Release the next waiting task in the queue
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        console.log('\t-next element in the queue takes the lock')
        nextResolve();
      }
    } else {
      this.lockedBy = null;
      this.lockedAt = null;
      this.isLocked = false;
      console.log(`Lock: lock released at ${formatDateToSimpleString(new Date())}`)
    }
  }

  public isTaken(): boolean {
    return this.isLocked;
  }
}