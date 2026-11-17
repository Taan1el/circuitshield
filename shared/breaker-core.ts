import type { CallOutcome, CallRecord, CircuitConfig, CircuitState } from './types.js';

/** The settings the state machine itself reads. Bulkhead settings belong to the live breaker only. */
export type BreakerSettings = Pick<
  CircuitConfig,
  | 'failureRateThresholdPercent'
  | 'slowCallRateThresholdPercent'
  | 'slowCallDurationThresholdMs'
  | 'minCallsThreshold'
  | 'slidingWindowSize'
  | 'resetTimeoutMs'
  | 'halfOpenTrialCalls'
>;

export const BREAKER_SETTING_KEYS = [
  'failureRateThresholdPercent',
  'slowCallRateThresholdPercent',
  'slowCallDurationThresholdMs',
  'minCallsThreshold',
  'slidingWindowSize',
  'resetTimeoutMs',
  'halfOpenTrialCalls',
] as const satisfies ReadonlyArray<keyof BreakerSettings>;

export type Admission = { admitted: true } | { admitted: false; reason: 'OPEN' | 'HALF_OPEN_LIMIT' };

export interface WindowStats {
  total: number;
  failures: number;
  slow: number;
}

interface WindowEntry {
  seq: number;
  timestamp: number;
  outcome: CallOutcome;
  durationMs: number;
  errorMessage?: string;
}

function pickSettings(config: BreakerSettings): BreakerSettings {
  return {
    failureRateThresholdPercent: config.failureRateThresholdPercent,
    slowCallRateThresholdPercent: config.slowCallRateThresholdPercent,
    slowCallDurationThresholdMs: config.slowCallDurationThresholdMs,
    minCallsThreshold: config.minCallsThreshold,
    slidingWindowSize: config.slidingWindowSize,
    resetTimeoutMs: config.resetTimeoutMs,
    halfOpenTrialCalls: config.halfOpenTrialCalls,
  };
}

/**
 * The breaker's state machine and sliding window with no I/O and no clock of
 * its own: time comes from the `now` function. The live CircuitBreaker drives
 * it with Date.now() and real downstream calls; the incident replay drives it
 * with the timestamps from a recorded timeline. Both therefore make exactly
 * the same open, half-open and close decisions.
 */
export class BreakerCore {
  private settings: BreakerSettings;
  private readonly now: () => number;
  private currentState: CircuitState = 'CLOSED';

  // Bounded sliding window of recent call outcomes. Entries before `head`
  // are evicted and are dropped for good when the array is compacted.
  private entries: WindowEntry[] = [];
  private head = 0;
  private failures = 0;
  private slow = 0;
  private seq = 0;

  private openedAtMs: number | null = null;
  private halfOpenSuccesses = 0;
  private halfOpenAttempts = 0;

  constructor(settings: BreakerSettings, now: () => number = () => Date.now()) {
    this.settings = pickSettings(settings);
    this.now = now;
  }

  public get state(): CircuitState {
    return this.currentState;
  }

  /** When the circuit last opened, or null unless it is open. */
  public get openedAt(): number | null {
    return this.openedAtMs;
  }

  public get config(): BreakerSettings {
    return { ...this.settings };
  }

  /**
   * Decides whether a call may go downstream. Moves OPEN to HALF_OPEN once the
   * reset timeout has passed, and counts the call as a half-open probe.
   */
  public admit(): Admission {
    this.refresh();
    if (this.currentState === 'OPEN') return { admitted: false, reason: 'OPEN' };
    if (this.currentState === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.settings.halfOpenTrialCalls) {
        return { admitted: false, reason: 'HALF_OPEN_LIMIT' };
      }
      this.halfOpenAttempts++;
    }
    return { admitted: true };
  }

  /** Moves OPEN to HALF_OPEN when the reset timeout has passed. Called by admit() and when reading state. */
  public refresh(): void {
    if (this.currentState === 'OPEN' && this.openedAtMs !== null) {
      if (this.now() - this.openedAtMs >= this.settings.resetTimeoutMs) {
        this.currentState = 'HALF_OPEN';
        this.halfOpenSuccesses = 0;
        this.halfOpenAttempts = 0;
        this.openedAtMs = null;
      }
    }
  }

  /** Whether a call of this duration counts as slow under the current settings. */
  public isSlow(durationMs: number): boolean {
    return durationMs >= this.settings.slowCallDurationThresholdMs;
  }

  /** Records a call that returned, in the window, and applies the state change it causes. */
  public recordSuccess(durationMs: number): CallOutcome {
    const slow = this.isSlow(durationMs);
    const outcome: CallOutcome = slow ? 'SLOW' : 'SUCCESS';
    this.push(outcome, durationMs);
    this.handleSuccessInState(slow);
    return outcome;
  }

  /** Records a call that failed, in the window, and applies the state change it causes. */
  public recordFailure(durationMs: number, errorMessage?: string): void {
    this.push('FAILURE', durationMs, errorMessage);
    if (this.currentState === 'HALF_OPEN') {
      // A single probe failure in HALF_OPEN trips the circuit back to OPEN immediately.
      this.tripOpen();
    } else if (this.currentState === 'CLOSED') {
      this.evaluateSlidingWindow();
    }
  }

  public tripOpen(): void {
    this.currentState = 'OPEN';
    this.openedAtMs = this.now();
    this.halfOpenSuccesses = 0;
    this.halfOpenAttempts = 0;
  }

  public forceReset(): void {
    this.currentState = 'CLOSED';
    this.clearWindow();
    this.openedAtMs = null;
    this.halfOpenSuccesses = 0;
    this.halfOpenAttempts = 0;
  }

  public updateConfig(patch: Partial<BreakerSettings>): void {
    this.settings = pickSettings({ ...this.settings, ...patch });
    // A smaller window takes effect straight away for the calls already held.
    this.evictToCapacity();
  }

  public windowStats(): WindowStats {
    return { total: this.entries.length - this.head, failures: this.failures, slow: this.slow };
  }

  /** The calls in the window, oldest first. */
  public records(): CallRecord[] {
    const out: CallRecord[] = [];
    for (let i = this.head; i < this.entries.length; i++) {
      const entry = this.entries[i];
      out.push({
        id: `rec_${entry.timestamp}_${entry.seq.toString(36)}`,
        timestamp: entry.timestamp,
        outcome: entry.outcome,
        durationMs: entry.durationMs,
        errorMessage: entry.errorMessage,
      });
    }
    return out;
  }

  private handleSuccessInState(isSlow: boolean): void {
    if (this.currentState === 'HALF_OPEN') {
      if (isSlow) {
        // The downstream answered without throwing, but a trial probe that
        // breaches the slow-call threshold means it is still degraded.
        // Counting it as a healthy probe would let a merely-slow dependency
        // heal the circuit; trip back to OPEN the same as a failed probe.
        this.tripOpen();
        return;
      }
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.settings.halfOpenTrialCalls) {
        // All trial probe calls succeeded: reset to CLOSED.
        this.currentState = 'CLOSED';
        this.clearWindow();
        this.halfOpenSuccesses = 0;
        this.halfOpenAttempts = 0;
        this.openedAtMs = null;
      }
    } else if (this.currentState === 'CLOSED') {
      this.evaluateSlidingWindow();
    }
  }

  private evaluateSlidingWindow(): void {
    const { total, failures, slow } = this.windowStats();
    if (total < this.settings.minCallsThreshold) return;

    const failureRate = (failures / total) * 100;
    const slowRate = (slow / total) * 100;

    if (
      failureRate >= this.settings.failureRateThresholdPercent ||
      slowRate >= this.settings.slowCallRateThresholdPercent
    ) {
      this.tripOpen();
    }
  }

  private push(outcome: CallOutcome, durationMs: number, errorMessage?: string): void {
    this.entries.push({ seq: this.seq++, timestamp: this.now(), outcome, durationMs, errorMessage });
    if (outcome === 'FAILURE') this.failures++;
    else if (outcome === 'SLOW') this.slow++;
    this.evictToCapacity();
  }

  private evictToCapacity(): void {
    while (this.entries.length - this.head > this.settings.slidingWindowSize) {
      const oldest = this.entries[this.head++];
      if (oldest.outcome === 'FAILURE') this.failures--;
      else if (oldest.outcome === 'SLOW') this.slow--;
    }
    // Drop evicted entries once they make up most of the array, so a long run stays bounded.
    if (this.head > 1024 && this.head * 2 > this.entries.length) {
      this.entries = this.entries.slice(this.head);
      this.head = 0;
    }
  }

  private clearWindow(): void {
    this.entries = [];
    this.head = 0;
    this.failures = 0;
    this.slow = 0;
  }
}
