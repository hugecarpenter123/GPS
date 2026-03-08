// TODO: manual lock handling has no security against deadlock

import { type Managers } from '../../gps.config';
import { getCopyOf } from './plain-utility';

type LockCancelReason = 'timeout' | 'called';
export class LockOperationCancelledError extends Error {
  constructor(
    public readonly lockInfo: { manager: Managers; id: string },
    public readonly reason: LockCancelReason,
  ) {
    super(`[Lock] operation cancelled for ${lockInfo.manager} (${lockInfo.id})`);
    this.name = 'LockOperationCancelledError';
  }
}

type LockTaker = {
  id: string;
  manager: Managers;
  method?: string;
  requestedAt: Date;
  acquiredAt?: Date;
  releasedAt?: Date;
  forced: boolean;
  city?: string;
  details?: any;
};

export interface LockHandle {
  id: string;
  release: () => void;
}

type QueuedLockRequest = {
  lockInfo: LockTaker;
  resolver: {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  };
  timeoutId?: NodeJS.Timeout;
  // For performWithLock - operation to execute
  operation?: () => any | Promise<any>;
  // For manual acquire - flag to indicate it's manual
  isManual?: boolean;
};
/**
 * Lock system with unified queue for both automatic (performWithLock) and manual (acquire/release) locking.
 *
 * Usage examples:
 *
 * 1. Automatic locking with performWithLock (recommended for most cases):
 * ```typescript
 * const lock = Lock.getInstance();
 * const result = await lock.performWithLock(
 *   async () => {
 *     // Your operation here
 *     return someValue;
 *   },
 *   { manager: 'CityBuilder', method: 'buildBuilding' }
 * );
 * ```
 *
 * 2. Manual locking with acquire/release (for more control):
 * ```typescript
 * const lock = Lock.getInstance();
 * const handle!: LockHandle;
 * try {
 *   handle = await lock.acquire({ manager: 'CityBuilder', method: 'buildBuilding' });
 *   // Your operation here
 * } finally {
 *   handle.release();
 * }
 * ```
 *
 * Both methods use the same queue and are fully compatible.
 */
export default class Lock {
  public static readonly LOCK_TIMEOUT: number = 1000 * 60 * 5;

  private static instance: Lock | null = null;
  private lock: LockTaker | null = null;

  private queue: QueuedLockRequest[] = [];

  private constructor() {}

  public static getInstance(): Lock {
    if (!this.instance) {
      this.instance = new Lock();
    }
    return this.instance;
  }

  private mapToLogObj(lockTakerInfo: LockTaker): string {
    return getCopyOf({
      ...lockTakerInfo,
      requestedAt: lockTakerInfo.requestedAt.toLocaleString(),
      acquiredAt: lockTakerInfo.acquiredAt?.toLocaleString(),
      releasedAt: lockTakerInfo.releasedAt?.toLocaleString(),
    });
  }

  public isTaken(): boolean {
    return !!this.lock;
  }

  // TODO: work better on force
  public async performWithLock(
    operation: () => any | Promise<any>,
    details: Omit<LockTaker, 'requestedAt' | 'acquiredAt' | 'releasedAt' | 'id' | 'forced'> & {
      id?: string;
      forced?: boolean;
    },
  ) {
    const lockInfo: LockTaker = {
      ...details,
      forced: details?.forced ?? false,
      id: details.id ?? crypto.randomUUID(),
      requestedAt: new Date(),
    };

    if (!this.lock || lockInfo.forced) {
      lockInfo.acquiredAt = new Date();
      if (lockInfo.forced && this.lock) {
        console.log(
          '[Lock]: acquired (forced):',
          this.mapToLogObj(lockInfo),
          '| overriding:',
          this.mapToLogObj(this.lock),
        );
      } else {
        console.log('[Lock]: acquired:', this.mapToLogObj(lockInfo));
      }
      this.lock = lockInfo;
      let timeoutId: NodeJS.Timeout | undefined = undefined;
      try {
        return await Promise.race([
          new Promise(
            (_, rej) =>
              (timeoutId = setTimeout(() => {
                console.warn('[Lock]: operation timed out:', this.mapToLogObj(lockInfo));
                rej(new LockOperationCancelledError({ manager: lockInfo.manager, id: lockInfo.id }, 'timeout'));
              }, Lock.LOCK_TIMEOUT)),
          ),
          operation(),
        ]);
      } finally {
        clearTimeout(timeoutId);
        this.internalRelease();
      }
    } else {
      console.log('[Lock]: added to queue:', this.mapToLogObj(lockInfo), 'queue length:', this.queue.length);
      return new Promise((resolve, reject) => {
        this.queue.push({
          operation,
          lockInfo: lockInfo,
          resolver: { resolve, reject },
          isManual: false,
        });
      });
    }
  }

  private async performQueued(data: QueuedLockRequest) {
    let timeoutId: NodeJS.Timeout | undefined = undefined;

    data.lockInfo.acquiredAt = new Date();
    this.lock = data.lockInfo;

    try {
      const result = await Promise.race([
        new Promise<never>((_, rej) => {
          timeoutId = setTimeout(() => {
            console.warn('[Lock]: operation timed out:', this.mapToLogObj(data.lockInfo));
            rej(new LockOperationCancelledError({ manager: data.lockInfo.manager, id: data.lockInfo.id }, 'timeout'));
          }, Lock.LOCK_TIMEOUT);
        }),
        data.operation!(),
      ]);
      data.resolver.resolve(result);
    } catch (error) {
      console.warn('[Lock]: operation failed:', this.mapToLogObj(data.lockInfo), error);
      data.resolver.reject(error);
    } finally {
      clearTimeout(timeoutId);
      this.internalRelease();
    }
  }

  private internalRelease() {
    const queueLength = this.queue.length;

    // Mark release time
    this.lock!.releasedAt = new Date();

    // Release the next waiting task in the queue
    if (queueLength > 0) {
      const nextLock = this.queue.shift()!;

      console.log(
        `[Lock]: released:`,
        this.mapToLogObj(this.lock!),
        `→ next in queue (${queueLength - 1} remaining):`,
        this.mapToLogObj(nextLock.lockInfo),
      );

      // Check if it's a manual acquire or performWithLock
      if (nextLock.isManual) {
        // Manual acquire - just set the lock and resolve with handle
        nextLock.lockInfo.acquiredAt = new Date();
        this.lock = nextLock.lockInfo;

        // Resolve with handle
        const handle: LockHandle = {
          id: nextLock.lockInfo.id,
          release: () => {
            clearTimeout(nextLock.timeoutId);
            this.release(nextLock.lockInfo.id);
          },
        };

        // watch it not to exceed allowed ammount of time
        nextLock.timeoutId = setTimeout(() => {
          console.warn('[Lock]: manual lock timed out, force release:', this.mapToLogObj(nextLock.lockInfo));
          handle.release();
        }, Lock.LOCK_TIMEOUT);

        nextLock.resolver.resolve(handle);
      } else {
        // performWithLock - execute the operation
        this.performQueued(nextLock);
      }
    } else {
      // No items in queue - fully release the lock
      if (this.lock) {
        console.log('[Lock]: released (queue empty):', this.mapToLogObj(this.lock));
      }
      this.lock = null;
    }
  }

  public cancelQueuedLock = (arg: { manager: Managers; id: string }) => {
    const indexToDelete = this.queue.findIndex(i => i.lockInfo.id === arg.id && i.lockInfo.manager === arg.manager);

    if (indexToDelete >= 0) {
      const [cancelledOperation] = this.queue.splice(indexToDelete, 1);

      // Clear timeout if exists - should never exist at this point, but let it be
      clearTimeout(cancelledOperation.timeoutId);

      console.log('[Lock]: cancelQueuedLock - cancelled:', this.mapToLogObj(cancelledOperation.lockInfo));
      cancelledOperation.resolver.reject(new LockOperationCancelledError(arg, 'called'));
    } else {
      console.warn('[Lock]: cancelQueuedLock - not found in queue:', arg);
    }
  };

  /**
   * Manual acquire/release API - alternative to performWithLock
   * Allows for more granular control over lock lifecycle
   */

  /**
   * Acquires the lock. If lock is free, returns immediately with a handle.
   * If lock is taken, queues the request and waits.
   * @param details - lock acquisition details (same as performWithLock)
   * @returns Promise<LockHandle> - handle with release() method
   * @throws LockOperationCancelledError if timeout occurs
   */
  public async acquire(
    details: Omit<LockTaker, 'requestedAt' | 'acquiredAt' | 'releasedAt' | 'id' | 'forced'> & {
      id?: string;
      forced?: boolean;
      timeout?: number;
    },
  ): Promise<LockHandle> {
    const lockInfo: LockTaker = {
      ...details,
      forced: details?.forced ?? false,
      id: details.id ?? crypto.randomUUID(),
      requestedAt: new Date(),
    };

    const createHandle = (): LockHandle => ({
      id: lockInfo.id,
      release: () => this.release(lockInfo.id),
    });

    // If lock is free or forced, acquire immediately
    if (!this.lock || lockInfo.forced) {
      lockInfo.acquiredAt = new Date();
      if (lockInfo.forced) {
        if (this.lock) {
          console.log(
            `[Lock]: acquire (force) by`,
            this.mapToLogObj(lockInfo),
            'on current lock:',
            this.mapToLogObj(this.lock as LockTaker),
          );
        } else {
          console.log(`[Lock]: acquire (force) by`, this.mapToLogObj(lockInfo));
        }
      }
      this.lock = lockInfo;
      console.log(`[Lock]: acquire (manual)`, this.mapToLogObj(lockInfo));
      return createHandle();
    }

    // Lock is taken, queue the request
    return new Promise<LockHandle>((resolve, reject) => {
      this.queue.push({
        lockInfo,
        resolver: { resolve, reject },
        isManual: true,
      });

      console.log(`[Lock]: acquire (manual) - queued`, this.mapToLogObj(lockInfo));
    });
  }

  /**
   * Releases the lock by ID. Should be called on the handle returned by acquire().
   * @param lockId - ID of the lock to release
   */
  public release(lockId: string): void {
    if (!this.lock) {
      console.warn(`[Lock]: release (manual) - no lock to release, requested id: ${lockId}`);
      return;
    }

    if (this.lock.id !== lockId) {
      console.warn(`[Lock]: release (manual) - id mismatch, requested: ${lockId}, current: ${this.lock.id}`);
      return;
    }

    console.log('[Lock]: release (manual) - releasing:', this.mapToLogObj(this.lock));
    this.internalRelease();
  }

  public getLogInfo() {
    return {
      isTaken: this.isTaken(),
      queue: this.queue,
    };
  }

  public forceReleaseAll = () => {
    console.warn(
      '[Lock]: forceReleaseAll - clearing queue length:',
      this.queue.length,
      'current lock:',
      this.lock ? this.mapToLogObj(this.lock) : 'none',
    );

    this.queue.forEach(lockRequest => {
      console.log('[Lock]: forceReleaseAll - rejecting queued:', this.mapToLogObj(lockRequest.lockInfo));
      lockRequest.resolver.reject(
        new LockOperationCancelledError(
          { manager: lockRequest.lockInfo.manager, id: lockRequest.lockInfo.id },
          'called',
        ),
      );
    });
    this.queue = [];

    if (this.lock) {
      console.log('[Lock]: forceReleaseAll - releasing current lock');
      this.lock = null;
    }
  };
}
