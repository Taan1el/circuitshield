import { BreakerCore, type BreakerSettings } from './breaker-core.js';
import type { CircuitState } from './types.js';

/** Outcome codes in a Timeline. Both error and timeout count as failed calls. */
export const OUTCOME_OK = 0;
export const OUTCOME_ERROR = 1;
export const OUTCOME_TIMEOUT = 2;

/**
 * A recorded series of calls, sorted by time, in typed arrays so it can be
 * handed to a worker cheaply. `t` is epoch milliseconds.
 */
export interface Timeline {
  t: Float64Array;
  outcome: Uint8Array;
  latencyMs: Float64Array;
}

export interface TimelineCall {
  t: number;
  outcome: typeof OUTCOME_OK | typeof OUTCOME_ERROR | typeof OUTCOME_TIMEOUT;
  latencyMs: number;
}

/** Builds a Timeline from plain calls, sorting them by time (ties keep their order). */
export function timelineFromCalls(calls: TimelineCall[]): Timeline {
  const order = calls.map((_, index) => index).sort((x, y) => calls[x].t - calls[y].t || x - y);
  const timeline: Timeline = {
    t: new Float64Array(calls.length),
    outcome: new Uint8Array(calls.length),
    latencyMs: new Float64Array(calls.length),
  };
  order.forEach((source, target) => {
    timeline.t[target] = calls[source].t;
    timeline.outcome[target] = calls[source].outcome;
    timeline.latencyMs[target] = calls[source].latencyMs;
  });
  return timeline;
}

export type TransitionReason =
  | 'failure-rate'
  | 'slow-rate'
  | 'reset-timeout'
  | 'probes-passed'
  | 'probe-failed'
  | 'probe-slow';

export interface Transition {
  atMs: number;
  from: CircuitState;
  to: CircuitState;
  reason: TransitionReason;
  /** Window figures at the moment the circuit opened because of a rate. */
  failureRatePercent?: number;
  slowRatePercent?: number;
  windowCalls?: number;
}

export interface ReplayBucket {
  startMs: number;
  endMs: number;
  /** Calls the breaker let through that succeeded within the slow-call threshold. */
  passed: number;
  /** Calls the breaker let through that succeeded but were slow. */
  slow: number;
  /** Failed calls the breaker let through. These reach users. */
  errors: number;
  /** Calls the breaker blocked. */
  blocked: number;
}

export interface ReplayResult {
  settings: BreakerSettings;
  startMs: number;
  endMs: number;
  spanMs: number;
  totalCalls: number;
  admittedCalls: number;
  shortCircuited: number;
  /** Failed calls in the recording, which is what users would see with no breaker. */
  errorsInTimeline: number;
  /** Failed calls the breaker let through. */
  errorsReachingUsers: number;
  /** Blocked calls that would have failed. */
  errorsAvoided: number;
  /** Blocked calls that would have succeeded. */
  healthyBlocked: number;
  slowAdmitted: number;
  timesOpened: number;
  firstOpenedAtMs: number | null;
  msOpen: number;
  msHalfOpen: number;
  msClosed: number;
  finalState: CircuitState;
  transitions: Transition[];
  buckets: ReplayBucket[];
}

export interface ReplayOptions {
  /** Number of equal time slices for the chart. Defaults to 60. */
  bucketCount?: number;
}

const EMPTY_RESULT = (settings: BreakerSettings): ReplayResult => ({
  settings,
  startMs: 0,
  endMs: 0,
  spanMs: 0,
  totalCalls: 0,
  admittedCalls: 0,
  shortCircuited: 0,
  errorsInTimeline: 0,
  errorsReachingUsers: 0,
  errorsAvoided: 0,
  healthyBlocked: 0,
  slowAdmitted: 0,
  timesOpened: 0,
  firstOpenedAtMs: null,
  msOpen: 0,
  msHalfOpen: 0,
  msClosed: 0,
  finalState: 'CLOSED',
  transitions: [],
  buckets: [],
});

/**
 * Replays a recorded timeline through the same BreakerCore the live breaker
 * uses, with a clock that follows the recorded timestamps.
 *
 * Each call is decided at its own timestamp and its result is applied at that
 * same instant, so a call's latency does not delay the state change it causes.
 * The circuit leaves OPEN at opened-at plus the open duration, even when no
 * call arrives at that moment; the next call finds it half-open.
 */
export function replayTimeline(timeline: Timeline, settings: BreakerSettings, options: ReplayOptions = {}): ReplayResult {
  const count = timeline.t.length;
  if (count === 0) return EMPTY_RESULT({ ...settings });

  let clock = timeline.t[0];
  const core = new BreakerCore(settings, () => clock);

  const startMs = timeline.t[0];
  const endMs = timeline.t[count - 1];
  const spanMs = endMs - startMs;
  const bucketCount = Math.max(1, Math.floor(options.bucketCount ?? 60));
  const bucketWidth = Math.max(1, Math.ceil(spanMs / bucketCount));
  const bucketTotal = spanMs === 0 ? 1 : Math.min(bucketCount, Math.ceil((spanMs + 1) / bucketWidth));
  const buckets: ReplayBucket[] = Array.from({ length: bucketTotal }, (_, index) => ({
    startMs: startMs + index * bucketWidth,
    endMs: Math.min(endMs, startMs + (index + 1) * bucketWidth),
    passed: 0,
    slow: 0,
    errors: 0,
    blocked: 0,
  }));

  const transitions: Transition[] = [];
  let state: CircuitState = core.state;
  let admittedCalls = 0;
  let shortCircuited = 0;
  let errorsInTimeline = 0;
  let errorsReachingUsers = 0;
  let errorsAvoided = 0;
  let healthyBlocked = 0;
  let slowAdmitted = 0;

  // Called after each recorded call; notes any state change that call caused.
  const observe = (kind: 'failure' | 'slow' | 'ok'): void => {
    if (core.state === state) return;
    transitions.push(stateChange(core, clock, state, core.state, kind));
    state = core.state;
  };

  for (let index = 0; index < count; index++) {
    clock = timeline.t[index];
    const failed = timeline.outcome[index] !== OUTCOME_OK;
    const latency = timeline.latencyMs[index];
    if (failed) errorsInTimeline++;

    const bucket = buckets[Math.min(bucketTotal - 1, Math.floor((clock - startMs) / bucketWidth))];

    // The circuit goes half-open when the open duration has passed, which may be before this call arrived.
    const openedAt = core.openedAt;
    const admission = core.admit();
    if (state === 'OPEN' && core.state === 'HALF_OPEN' && openedAt !== null) {
      transitions.push({ atMs: openedAt + core.config.resetTimeoutMs, from: 'OPEN', to: 'HALF_OPEN', reason: 'reset-timeout' });
      state = 'HALF_OPEN';
    }

    if (!admission.admitted) {
      shortCircuited++;
      bucket.blocked++;
      if (failed) errorsAvoided++;
      else healthyBlocked++;
      continue;
    }

    admittedCalls++;
    if (failed) {
      errorsReachingUsers++;
      bucket.errors++;
      core.recordFailure(latency);
      observe('failure');
    } else {
      const slow = core.isSlow(latency);
      if (slow) {
        slowAdmitted++;
        bucket.slow++;
      } else {
        bucket.passed++;
      }
      core.recordSuccess(latency);
      observe(slow ? 'slow' : 'ok');
    }
  }

  // If the open duration ended after the last call, the circuit is half-open by the end of the recording.
  clock = endMs;
  const lastOpenedAt = core.openedAt;
  core.refresh();
  if (state === 'OPEN' && core.state === 'HALF_OPEN' && lastOpenedAt !== null) {
    transitions.push({ atMs: lastOpenedAt + core.config.resetTimeoutMs, from: 'OPEN', to: 'HALF_OPEN', reason: 'reset-timeout' });
    state = 'HALF_OPEN';
  }

  let msOpen = 0;
  let msHalfOpen = 0;
  let msClosed = 0;
  let cursor = startMs;
  let current: CircuitState = 'CLOSED';
  const add = (untilMs: number): void => {
    const length = Math.max(0, Math.min(untilMs, endMs) - cursor);
    if (current === 'OPEN') msOpen += length;
    else if (current === 'HALF_OPEN') msHalfOpen += length;
    else msClosed += length;
    cursor = Math.max(cursor, Math.min(untilMs, endMs));
  };
  for (const transition of transitions) {
    add(transition.atMs);
    current = transition.to;
  }
  add(endMs);

  const opens = transitions.filter((transition) => transition.to === 'OPEN');

  return {
    settings: { ...settings },
    startMs,
    endMs,
    spanMs,
    totalCalls: count,
    admittedCalls,
    shortCircuited,
    errorsInTimeline,
    errorsReachingUsers,
    errorsAvoided,
    healthyBlocked,
    slowAdmitted,
    timesOpened: opens.length,
    firstOpenedAtMs: opens.length > 0 ? opens[0].atMs : null,
    msOpen,
    msHalfOpen,
    msClosed,
    finalState: state,
    transitions,
    buckets,
  };
}

function stateChange(
  core: BreakerCore,
  atMs: number,
  from: CircuitState,
  to: CircuitState,
  kind: 'failure' | 'slow' | 'ok'
): Transition {
  if (from === 'HALF_OPEN') {
    if (to === 'CLOSED') return { atMs, from, to, reason: 'probes-passed' };
    return { atMs, from, to, reason: kind === 'slow' ? 'probe-slow' : 'probe-failed' };
  }
  // CLOSED to OPEN: report the window figures that crossed a threshold.
  const stats = core.windowStats();
  const total = stats.total;
  const failureRatePercent = total > 0 ? (stats.failures / total) * 100 : 0;
  const slowRatePercent = total > 0 ? (stats.slow / total) * 100 : 0;
  const byFailures = failureRatePercent >= core.config.failureRateThresholdPercent;
  return {
    atMs,
    from,
    to,
    reason: byFailures ? 'failure-rate' : 'slow-rate',
    failureRatePercent,
    slowRatePercent,
    windowCalls: total,
  };
}
