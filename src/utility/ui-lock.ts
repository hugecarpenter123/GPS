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
        console.warn(`lock is locked for too long by ${this.lockedBy}, releasing...`);
        // TODO: or consider restarting all managers
        this.release();
      }
    }, 1000 * 60 * 5);
  }

  public async acquire(lockedBy?: string): Promise<void> {
    console.log('try acquiring')
    if (!this.isLocked) {
      console.log('\tlock is free, acquire Lock')
      this.isLocked = true;
      this.lockedBy = lockedBy ?? null;
      this.lockedAt = Date.now();
      return;
    }
    console.log('\tlock is locked, add to queue')

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  public release(): void {
    console.log('release lock()')
    // Release the next waiting task in the queue
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        console.log('\t-but next element in the queue takes it turn')
        nextResolve();
      }
    } else {
      this.isLocked = false;
      console.log('lock released()')
    }
  }

  public isTaken(): boolean {
    return this.isLocked;
  }
}