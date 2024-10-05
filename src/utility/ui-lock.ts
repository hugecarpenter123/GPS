export default class Lock {
  private static instance: Lock | null = null;
  private isLocked: boolean = false;
  private queue: (() => void)[] = [];

  private constructor() {}

  public static getInstance(): Lock {
    if (!this.instance) {
      this.instance = new Lock();
    }
    return this.instance;
  }

  public async acquire(): Promise<void> {
    console.log('try acquiring')
    if (!this.isLocked) {
      console.log('\tlock is free, acquire Lock')
      this.isLocked = true;
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
        console.log('- but next element in the queue takes it turn')
        nextResolve();
      }
    } else {
      this.isLocked = false;
      console.log('lock released ()')
    }
  }

  public isTaken(): boolean {
    return this.isLocked;
  }
}