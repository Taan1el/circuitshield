import { Bulkhead } from '../bulkhead/bulkhead.js';
import type {
  CircuitConfig,
  CircuitMetrics,
  CircuitState,
  CallOutcome,
  CallRecord,
  CircuitBreakerInfo,
  ExecutionResult,
} from '../../../shared/types.js';

export class CircuitBreaker {
  private id: string;
  private name: string;
  private serviceTarget: string;
  private state: CircuitState = 'CLOSED';
  private config: CircuitConfig;
  private bulkhead: Bulkhead;
  private fallbackPayload: Record<string, unknown>;

  // Sliding window ring buffer
  private window: CallRecord[] = [];

  // State transitions & timer
  private openedAt: number | null = null;
  private halfOpenSuccesses = 0;
  private halfOpenAttempts = 0;

  // Lifetime counters
  private totalCalls = 0;
  private successCalls = 0;
  private failedCalls = 0;
  private slowCalls = 0;
  private shortCircuitedCalls = 0;
  private bulkheadRejections = 0;

  constructor(
    id: string,
    name: string,
    serviceTarget: string,
    config: Partial<CircuitConfig> = {},
    fallbackPayload: Record<string, unknown> = {}
  ) {
    this.id = id;
    this.name = name;
    this.serviceTarget = serviceTarget;
    this.config = {
      failureRateThresholdPercent: 50,
      slowCallRateThresholdPercent: 50,
      slowCallDurationThresholdMs: 500,
      minCallsThreshold: 5,
      slidingWindowSize: 20,
      resetTimeoutMs: 5000,
      halfOpenTrialCalls: 3,
      bulkheadMaxConcurrent: 5,
      bulkheadMaxWaitMs: 200,
      ...config,
    };
    this.bulkhead = new Bulkhead(this.config.bulkheadMaxConcurrent, this.config.bulkheadMaxWaitMs);
    this.fallbackPayload = fallbackPayload;
  }

  public async execute<T = unknown>(
    fn: () => Promise<T>,
    fallbackFn?: () => T
  ): Promise<ExecutionResult> {
    const start = performance.now();
    this.totalCalls++;

    // 1. Check if circuit is OPEN
    this.checkStateTransition();

    if (this.state === 'OPEN') {
      this.shortCircuitedCalls++;
      const durationMs = Number((performance.now() - start).toFixed(2));
      const fallbackData = fallbackFn ? fallbackFn() : this.fallbackPayload;

      return {
        circuitId: this.id,
        state: this.state,
        outcome: 'SHORT_CIRCUITED',
        durationMs,
        data: fallbackData,
        isFallback: true,
        error: 'CircuitBreaker is OPEN: downstream call prevented to avoid cascading failures',
      };
    }

    // 2. Check HALF_OPEN concurrency restriction
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.config.halfOpenTrialCalls) {
        this.shortCircuitedCalls++;
        const durationMs = Number((performance.now() - start).toFixed(2));
        const fallbackData = fallbackFn ? fallbackFn() : this.fallbackPayload;
        return {
          circuitId: this.id,
          state: this.state,
          outcome: 'SHORT_CIRCUITED',
          durationMs,
          data: fallbackData,
          isFallback: true,
          error: 'CircuitBreaker is HALF_OPEN: trial concurrency limit reached',
        };
      }
      this.halfOpenAttempts++;
    }

    // 3. Acquire Bulkhead slot
    let releaseSlot: (() => void) | null = null;
    try {
      releaseSlot = await this.bulkhead.acquire();
    } catch (err: any) {
      this.bulkheadRejections++;
      const durationMs = Number((performance.now() - start).toFixed(2));
      const fallbackData = fallbackFn ? fallbackFn() : this.fallbackPayload;
      return {
        circuitId: this.id,
        state: this.state,
        outcome: 'BULKHEAD_REJECTED',
        durationMs,
        data: fallbackData,
        isFallback: true,
        error: err.message || 'Bulkhead concurrency exceeded',
      };
    }

    // 4. Dispatch downstream execution
    try {
      const data = await fn();
      const durationMs = Number((performance.now() - start).toFixed(2));
      const isSlow = durationMs >= this.config.slowCallDurationThresholdMs;

      if (isSlow) {
        this.slowCalls++;
        this.recordOutcome('SLOW', durationMs);
      } else {
        this.successCalls++;
        this.recordOutcome('SUCCESS', durationMs);
      }

      this.handleSuccessInState(isSlow);

      return {
        circuitId: this.id,
        state: this.state,
        outcome: isSlow ? 'SLOW' : 'SUCCESS',
        durationMs,
        data,
        isFallback: false,
      };
    } catch (err: any) {
      this.failedCalls++;
      const durationMs = Number((performance.now() - start).toFixed(2));
      this.recordOutcome('FAILURE', durationMs, err.message);

      this.handleFailureInState();

      const fallbackData = fallbackFn ? fallbackFn() : this.fallbackPayload;
      return {
        circuitId: this.id,
        state: this.state,
        outcome: 'FAILURE',
        durationMs,
        data: fallbackData,
        isFallback: true,
        error: err.message || 'Downstream service invocation failed',
      };
    } finally {
      if (releaseSlot) {
        releaseSlot();
      }
    }
  }

  private checkStateTransition(): void {
    if (this.state === 'OPEN' && this.openedAt) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.config.resetTimeoutMs) {
        // Transition from OPEN to HALF_OPEN
        this.state = 'HALF_OPEN';
        this.halfOpenSuccesses = 0;
        this.halfOpenAttempts = 0;
        this.openedAt = null;
      }
    }
  }

  private handleSuccessInState(isSlow: boolean): void {
    if (this.state === 'HALF_OPEN') {
      if (isSlow) {
        // The downstream answered without throwing, but a trial probe that
        // breaches the slow-call threshold means it is still degraded.
        // Counting it as a healthy probe would let a merely-slow dependency
        // heal the circuit; trip back to OPEN the same as a failed probe.
        this.tripOpen();
        return;
      }
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenTrialCalls) {
        // All trial probe calls succeeded! Reset to CLOSED
        this.state = 'CLOSED';
        this.window = [];
        this.halfOpenSuccesses = 0;
        this.halfOpenAttempts = 0;
        this.openedAt = null;
      }
    } else if (this.state === 'CLOSED') {
      this.evaluateSlidingWindow();
    }
  }

  private handleFailureInState(): void {
    if (this.state === 'HALF_OPEN') {
      // Single probe failure in HALF_OPEN trips circuit back to OPEN immediately
      this.tripOpen();
    } else if (this.state === 'CLOSED') {
      this.evaluateSlidingWindow();
    }
  }

  private evaluateSlidingWindow(): void {
    if (this.window.length < this.config.minCallsThreshold) {
      return;
    }

    const failureCount = this.window.filter((c) => c.outcome === 'FAILURE').length;
    const slowCount = this.window.filter((c) => c.outcome === 'SLOW').length;
    const total = this.window.length;

    const failureRate = (failureCount / total) * 100;
    const slowRate = (slowCount / total) * 100;

    if (
      failureRate >= this.config.failureRateThresholdPercent ||
      slowRate >= this.config.slowCallRateThresholdPercent
    ) {
      this.tripOpen();
    }
  }

  public tripOpen(): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
    this.halfOpenSuccesses = 0;
    this.halfOpenAttempts = 0;
  }

  public forceReset(): void {
    this.state = 'CLOSED';
    this.window = [];
    this.openedAt = null;
    this.halfOpenSuccesses = 0;
    this.halfOpenAttempts = 0;
  }

  public updateConfig(newConfig: Partial<CircuitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.bulkheadMaxConcurrent || newConfig.bulkheadMaxWaitMs) {
      this.bulkhead.setConfig(this.config.bulkheadMaxConcurrent, this.config.bulkheadMaxWaitMs);
    }
  }

  private recordOutcome(outcome: CallOutcome, durationMs: number, errorMessage?: string): void {
    const record: CallRecord = {
      id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      outcome,
      durationMs,
      errorMessage,
    };

    this.window.push(record);
    if (this.window.length > this.config.slidingWindowSize) {
      this.window.shift();
    }
  }

  public getInfo(): CircuitBreakerInfo {
    this.checkStateTransition();

    const failureCount = this.window.filter((c) => c.outcome === 'FAILURE').length;
    const slowCount = this.window.filter((c) => c.outcome === 'SLOW').length;
    const total = this.window.length;

    const failureRatePercent = total > 0 ? Number(((failureCount / total) * 100).toFixed(1)) : 0;
    const slowCallRatePercent = total > 0 ? Number(((slowCount / total) * 100).toFixed(1)) : 0;

    let timeUntilResetMs: number | null = null;
    if (this.state === 'OPEN' && this.openedAt) {
      const remaining = this.config.resetTimeoutMs - (Date.now() - this.openedAt);
      timeUntilResetMs = Math.max(0, remaining);
    }

    const metrics: CircuitMetrics = {
      failureRatePercent,
      slowCallRatePercent,
      totalCalls: this.totalCalls,
      successCalls: this.successCalls,
      failedCalls: this.failedCalls,
      slowCalls: this.slowCalls,
      shortCircuitedCalls: this.shortCircuitedCalls,
      bulkheadRejections: this.bulkheadRejections,
      activeConcurrency: this.bulkhead.getActiveCount(),
      waitingQueueDepth: this.bulkhead.getQueueDepth(),
      timeUntilResetMs,
    };

    return {
      id: this.id,
      name: this.name,
      serviceTarget: this.serviceTarget,
      state: this.state,
      config: { ...this.config },
      metrics,
      recentRecords: [...this.window].reverse(),
      fallbackPayload: this.fallbackPayload,
    };
  }
}