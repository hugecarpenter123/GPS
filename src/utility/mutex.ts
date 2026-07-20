// class Mutex {
//   private locked = false;
//   private queue: (() => void)[] = [];

//   async lock() {
//     if (this.locked) {
//       await new Promise(resolve => this.queue.push(resolve));
//     }
//     this.locked = true;
//   }

//   unlock() {
//     this.locked = false;
//     const next = this.queue.shift();
//     if (next) next();
//   }
// }
export default class Mutex {
  private locked = false;
  private queue: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private currentOwner?: string;
  private readonly defaultTimeout = 30000;

  public async lock(timeoutMs: number = this.defaultTimeout): Promise<void> {
    if (this.locked) {
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            this.queue.push({ resolve, reject });
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Mutex lock timeout')), timeoutMs)),
        ]);
      } catch (error) {
        const index = this.queue.findIndex(item => item.reject === error);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        throw error;
      }
    }

    this.locked = true;
    // this.currentOwner = new Error().stack;
  }

  public unlock(): void {
    if (!this.locked) {
      throw new Error('Cannot unlock: mutex is not locked');
    }

    // if (this.currentOwner !== new Error().stack) {
    //   throw new Error('Cannot unlock: mutex is locked by different owner');
    // }

    this.locked = false;
    // this.currentOwner = undefined;

    const next = this.queue.shift();
    if (next) {
      next.resolve();
    }
  }

  public async withLock<T>(operation: () => Promise<T>, timeoutMs?: number): Promise<T> {
    await this.lock(timeoutMs);
    try {
      return await operation();
    } finally {
      this.unlock();
    }
  }
}
