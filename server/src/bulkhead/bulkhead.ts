export class Bulkhead {
  private maxConcurrent: number;
  private maxWaitMs: number;
  private activeCount = 0;
  private waitingQueue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(maxConcurrent = 5, maxWaitMs = 200) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.maxWaitMs = Math.max(0, maxWaitMs);
  }

  public setConfig(maxConcurrent: number, maxWaitMs: number): void {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.maxWaitMs = Math.max(0, maxWaitMs);
  }

  public async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return this.createReleaseCallback();
    }

    if (this.maxWaitMs === 0 || this.waitingQueue.length >= this.maxConcurrent * 3) {
      throw new Error('BULKHEAD_REJECTED: Concurrency limit reached and queue is saturated');
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitingQueue.findIndex((item) => item.timer === timer);
        if (idx !== -1) {
          this.waitingQueue.splice(idx, 1);
          reject(new Error('BULKHEAD_REJECTED: Request timed out waiting for available concurrency slot'));
        }
      }, this.maxWaitMs);

      this.waitingQueue.push({ resolve, reject, timer });
    });
  }

  private createReleaseCallback(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;

      if (this.waitingQueue.length > 0) {
        const next = this.waitingQueue.shift()!;
        clearTimeout(next.timer);
        this.activeCount++;
        next.resolve(this.createReleaseCallback());
      }
    };
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getQueueDepth(): number {
    return this.waitingQueue.length;
  }

  public getMaxConcurrent(): number {
    return this.maxConcurrent;
  }
}