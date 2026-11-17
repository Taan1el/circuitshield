import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakerCore, type BreakerSettings } from '../../shared/breaker-core.js';
import { CircuitBreaker } from '../../shared/circuit-breaker.js';
import { replayTimeline, timelineFromCalls, OUTCOME_ERROR, OUTCOME_OK, type TimelineCall } from '../../shared/replay.js';
import type { CircuitState } from '../../shared/types.js';

const SETTINGS: BreakerSettings = {
  failureRateThresholdPercent: 50,
  slowCallRateThresholdPercent: 50,
  slowCallDurationThresholdMs: 300,
  minCallsThreshold: 5,
  slidingWindowSize: 10,
  resetTimeoutMs: 1050,
  halfOpenTrialCalls: 2,
};

// Small deterministic generator so the scripted traffic is the same on every run.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScriptedCall {
  gapMs: number;
  failed: boolean;
  latencyMs: number;
}

// Traffic in phases: healthy, failing, slow and healthy again, so every state change is exercised.
function script(seed: number, count: number): ScriptedCall[] {
  const random = seeded(seed);
  const calls: ScriptedCall[] = [];
  for (let i = 0; i < count; i++) {
    const phase = Math.floor(i / 40) % 4;
    const failed = phase === 1 ? random() < 0.8 : phase === 0 ? random() < 0.05 : false;
    const latencyMs = phase === 2 ? 400 : 5 + Math.floor(random() * 10);
    calls.push({ gapMs: random() < 0.3 ? 700 : 100, failed, latencyMs });
  }
  return calls;
}

describe('the live breaker and the replay use one state machine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  for (const seed of [1, 2, 3]) {
    it(`takes the same decisions on scripted traffic (seed ${seed})`, async () => {
      const calls = script(seed, 240);
      const live = new CircuitBreaker('t', 'Test', 'svc', { ...SETTINGS, bulkheadMaxConcurrent: 50 });

      const timeline: TimelineCall[] = [];
      const liveStates: CircuitState[] = [];
      let liveShortCircuited = 0;
      let liveErrorsThrough = 0;
      let liveHealthyBlocked = 0;

      for (const call of calls) {
        await vi.advanceTimersByTimeAsync(call.gapMs);
        const result = await live.execute(async () => {
          await vi.advanceTimersByTimeAsync(call.latencyMs);
          if (call.failed) throw new Error('downstream failed');
          return 'ok';
        });
        // The replay applies a call's result at its timestamp, so the timeline
        // records when each call finished, which is when the live breaker applied it.
        timeline.push({ t: Date.now(), outcome: call.failed ? OUTCOME_ERROR : OUTCOME_OK, latencyMs: call.latencyMs });
        if (result.outcome === 'SHORT_CIRCUITED') {
          liveShortCircuited++;
          if (!call.failed) liveHealthyBlocked++;
        } else if (result.outcome === 'FAILURE') {
          liveErrorsThrough++;
        }
        const state = live.getInfo().state;
        if (liveStates[liveStates.length - 1] !== state) liveStates.push(state);
      }

      const replay = replayTimeline(timelineFromCalls(timeline), SETTINGS);
      expect(replay.shortCircuited).toBe(liveShortCircuited);
      expect(replay.errorsReachingUsers).toBe(liveErrorsThrough);
      expect(replay.healthyBlocked).toBe(liveHealthyBlocked);
      // The replay starts closed and notes each change; the live run noted the state after each call.
      const replayStates = replay.transitions.map((transition) => transition.to);
      expect(replayStates.length).toBeGreaterThan(2);
      const liveChanges = liveStates[0] === 'CLOSED' ? liveStates.slice(1) : liveStates;
      // The live state is only read after a call, so a half-open stretch with no call in it is not seen.
      const settled = (states: CircuitState[]) =>
        states.filter((state) => state !== 'HALF_OPEN').filter((state, index, all) => state !== all[index - 1]);
      expect(settled(replayStates)).toEqual(settled(liveChanges));
    });
  }
});

describe('BreakerCore', () => {
  it('opens at the failure rate, goes half-open after the reset timeout and closes after the probes pass', () => {
    let now = 1000;
    const core = new BreakerCore({ ...SETTINGS, minCallsThreshold: 4, slidingWindowSize: 4 }, () => now);
    for (let i = 0; i < 4; i++) {
      expect(core.admit()).toEqual({ admitted: true });
      core.recordFailure(10);
    }
    expect(core.state).toBe('OPEN');
    expect(core.openedAt).toBe(1000);

    now = 2049;
    expect(core.admit()).toEqual({ admitted: false, reason: 'OPEN' });
    now = 2050;
    expect(core.admit()).toEqual({ admitted: true });
    expect(core.state).toBe('HALF_OPEN');
    core.recordSuccess(10);
    expect(core.admit()).toEqual({ admitted: true });
    core.recordSuccess(10);
    expect(core.state).toBe('CLOSED');
    expect(core.windowStats().total).toBe(0);
  });

  it('treats an opening time of zero as a real time', () => {
    let now = 0;
    const core = new BreakerCore({ ...SETTINGS, minCallsThreshold: 1, slidingWindowSize: 1 }, () => now);
    core.admit();
    core.recordFailure(1);
    expect(core.state).toBe('OPEN');
    now = 5000;
    expect(core.admit().admitted).toBe(true);
    expect(core.state).toBe('HALF_OPEN');
  });

  it('trips back to open when a half-open probe is slow', () => {
    let now = 0;
    const core = new BreakerCore({ ...SETTINGS, minCallsThreshold: 1, slidingWindowSize: 1 }, () => now);
    core.admit();
    core.recordFailure(1);
    now = 5000;
    core.admit();
    core.recordSuccess(900);
    expect(core.state).toBe('OPEN');
  });

  it('limits half-open probes to the trial count', () => {
    let now = 0;
    const core = new BreakerCore({ ...SETTINGS, minCallsThreshold: 1, slidingWindowSize: 1, halfOpenTrialCalls: 2 }, () => now);
    core.admit();
    core.recordFailure(1);
    now = 5000;
    expect(core.admit().admitted).toBe(true);
    expect(core.admit().admitted).toBe(true);
    expect(core.admit()).toEqual({ admitted: false, reason: 'HALF_OPEN_LIMIT' });
  });

  it('keeps the window at its size and counts only what is inside it', () => {
    const core = new BreakerCore({ ...SETTINGS, minCallsThreshold: 100, slidingWindowSize: 3 }, () => 0);
    for (const failed of [true, true, false, false, false]) {
      core.admit();
      if (failed) core.recordFailure(1);
      else core.recordSuccess(1);
    }
    expect(core.windowStats()).toEqual({ total: 3, failures: 0, slow: 0 });
  });
});

describe('CircuitBreaker.updateConfig sliding window size', () => {
  it('shrinks the window it already holds when the size is lowered', async () => {
    const circuit = new CircuitBreaker('shrink', 'Shrink', 'svc', { slidingWindowSize: 20, minCallsThreshold: 20, failureRateThresholdPercent: 100 });
    for (let i = 0; i < 20; i++) await circuit.execute(async () => 'ok');
    expect(circuit.getInfo().recentRecords).toHaveLength(20);

    circuit.updateConfig({ slidingWindowSize: 5, minCallsThreshold: 5 });
    await circuit.execute(async () => 'ok');
    expect(circuit.getInfo().recentRecords).toHaveLength(5);
  });
});
