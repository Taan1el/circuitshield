import { describe, expect, it } from 'vitest';
import type { BreakerSettings } from '../../../shared/breaker-core.js';
import { DEFAULT_BREAKER_SETTINGS } from '../../../shared/breaker-settings.js';
import {
  OUTCOME_ERROR,
  OUTCOME_OK,
  OUTCOME_TIMEOUT,
  replayTimeline,
  timelineFromCalls,
  type TimelineCall,
} from '../../../shared/replay.js';
import { compareReplays, describeTransition, formatClock, formatDuration, summarizeReplay } from '../../../shared/replay-summary.js';
import { FIXTURE_START_MS, SAMPLE_INCIDENTS } from '../local/incidentFixtures.js';

const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);

const SMALL: BreakerSettings = {
  failureRateThresholdPercent: 50,
  slowCallRateThresholdPercent: 50,
  slowCallDurationThresholdMs: 500,
  minCallsThreshold: 4,
  slidingWindowSize: 4,
  resetTimeoutMs: 3000,
  halfOpenTrialCalls: 2,
};

/** One call a second starting at T0, so call i is at T0 + i * 1000. */
function everySecond(outcomes: Array<'ok' | 'error' | 'timeout' | number>): TimelineCall[] {
  return outcomes.map((outcome, index) => ({
    t: T0 + index * 1000,
    outcome: outcome === 'error' ? OUTCOME_ERROR : outcome === 'timeout' ? OUTCOME_TIMEOUT : OUTCOME_OK,
    latencyMs: typeof outcome === 'number' ? outcome : outcome === 'ok' ? 20 : 20,
  }));
}

describe('replayTimeline on a small timeline checked by hand', () => {
  // Calls 2 and 3 fail, so after call 3 the window (ok ok error error) is 50% failed and the circuit opens at +3000.
  // Calls 4 and 5 arrive while it is open. At +6000 the open duration is over; calls 6 and 7 are the two probes.
  const calls = everySecond(['ok', 'ok', 'error', 'error', 'error', 'error', 'ok', 'ok', 'ok', 'ok', 'ok']);
  const result = replayTimeline(timelineFromCalls(calls), SMALL);

  it('opens, goes half-open and closes at exact times', () => {
    expect(result.transitions.map((t) => [t.atMs - T0, t.from, t.to, t.reason])).toEqual([
      [3000, 'CLOSED', 'OPEN', 'failure-rate'],
      [6000, 'OPEN', 'HALF_OPEN', 'reset-timeout'],
      [7000, 'HALF_OPEN', 'CLOSED', 'probes-passed'],
    ]);
    expect(result.transitions[0]).toMatchObject({ failureRatePercent: 50, windowCalls: 4 });
  });

  it('counts the calls the breaker blocked and the errors that still got through', () => {
    expect(result).toMatchObject({
      totalCalls: 11,
      admittedCalls: 9,
      shortCircuited: 2,
      errorsInTimeline: 4,
      errorsReachingUsers: 2,
      errorsAvoided: 2,
      healthyBlocked: 0,
      timesOpened: 1,
      firstOpenedAtMs: T0 + 3000,
      finalState: 'CLOSED',
    });
  });

  it('adds up the time spent in each state', () => {
    expect(result.spanMs).toBe(10_000);
    expect(result.msOpen).toBe(3000);
    expect(result.msHalfOpen).toBe(1000);
    expect(result.msClosed).toBe(6000);
  });

  it('puts every call in exactly one chart slice', () => {
    const total = result.buckets.reduce((sum, b) => sum + b.passed + b.slow + b.errors + b.blocked, 0);
    expect(total).toBe(11);
    expect(result.buckets.reduce((sum, b) => sum + b.blocked, 0)).toBe(2);
    expect(result.buckets.reduce((sum, b) => sum + b.errors, 0)).toBe(2);
  });

  it('says what happened in words', () => {
    expect(summarizeReplay(result)).toBe(
      'The breaker opened once, first at 00:00:03 UTC, 3 s into the timeline. It was open for 3 s in total (30% of the timeline) and the timeline ends with it closed. ' +
        'It short-circuited 2 of 11 calls: 2 would have failed and 0 would have succeeded. 2 failed calls still reached users, against 4 with no breaker.'
    );
    expect(result.transitions.map((t) => describeTransition(t, result.settings))).toEqual([
      'Opened: 50% of the last 4 calls failed (threshold 50%).',
      'Half-open: the open duration of 3 s has passed, so probe calls are let through.',
      'Closed: 2 probe calls succeeded.',
    ]);
  });
});

describe('replayTimeline details', () => {
  it('goes half-open at opened-at plus the open duration even when the next call comes later', () => {
    const calls = everySecond(['ok', 'ok', 'error', 'error', 'error', 'error', 'ok', 'ok', 'ok']);
    const result = replayTimeline(timelineFromCalls(calls), { ...SMALL, resetTimeoutMs: 2500 });
    const half = result.transitions.find((t) => t.to === 'HALF_OPEN');
    // Opened at +3000, so half-open from +5500, although the call that finds it half-open is at +6000.
    expect(half?.atMs).toBe(T0 + 5500);
    expect(result.msOpen).toBe(2500);
  });

  it('reports a half-open circuit at the end when the open duration is zero', () => {
    const calls = everySecond(['ok', 'ok', 'error', 'error']);
    const result = replayTimeline(timelineFromCalls(calls), { ...SMALL, resetTimeoutMs: 0 });
    expect(result.transitions.map((t) => [t.atMs - T0, t.to])).toEqual([[3000, 'OPEN'], [3000, 'HALF_OPEN']]);
    expect(result.finalState).toBe('HALF_OPEN');
    expect(result.msOpen).toBe(0);
  });

  it('stays open at the end when the last call is blocked before the open duration is over', () => {
    const calls = everySecond(['ok', 'ok', 'error', 'error', 'ok']);
    const result = replayTimeline(timelineFromCalls(calls), SMALL);
    expect(result.finalState).toBe('OPEN');
    expect(result.msOpen).toBe(1000);
    expect(summarizeReplay(result)).toContain('the timeline ends with it open.');
  });

  it('opens again when a probe fails', () => {
    const calls = everySecond(['error', 'error', 'error', 'error', 'ok', 'ok', 'error', 'ok']);
    const result = replayTimeline(timelineFromCalls(calls), SMALL);
    expect(result.transitions.map((t) => [t.atMs - T0, t.to, t.reason])).toEqual([
      [3000, 'OPEN', 'failure-rate'],
      [6000, 'HALF_OPEN', 'reset-timeout'],
      [6000, 'OPEN', 'probe-failed'],
    ]);
    expect(result.timesOpened).toBe(2);
  });

  it('counts timeouts as failed calls', () => {
    const calls = everySecond(['ok', 'ok', 'timeout', 'timeout']);
    const result = replayTimeline(timelineFromCalls(calls), SMALL);
    expect(result.errorsInTimeline).toBe(2);
    expect(result.transitions[0]).toMatchObject({ to: 'OPEN', reason: 'failure-rate' });
  });

  it('opens on slow calls when the slow share is reached, and not when the slow duration is raised', () => {
    const calls = everySecond([700, 700, 'ok', 'ok', 700, 'ok']);
    const slow = replayTimeline(timelineFromCalls(calls), { ...SMALL, slowCallRateThresholdPercent: 50 });
    expect(slow.transitions[0]).toMatchObject({ to: 'OPEN', reason: 'slow-rate', slowRatePercent: 50 });
    expect(slow.slowAdmitted).toBeGreaterThanOrEqual(2);
    const tolerant = replayTimeline(timelineFromCalls(calls), { ...SMALL, slowCallDurationThresholdMs: 1000 });
    expect(tolerant.timesOpened).toBe(0);
    expect(tolerant.slowAdmitted).toBe(0);
  });

  it('never opens on healthy traffic and says so', () => {
    const result = replayTimeline(timelineFromCalls(everySecond(['ok', 'ok', 'ok', 'ok', 'ok'])), SMALL);
    expect(result).toMatchObject({ timesOpened: 0, shortCircuited: 0, firstOpenedAtMs: null, msOpen: 0, msClosed: 4000 });
    expect(summarizeReplay(result)).toBe('The breaker never opened. All 5 calls went through, and 0 calls failed in the recording, so all of those reached users.');
  });

  it('does not judge the window before the minimum number of calls', () => {
    const result = replayTimeline(timelineFromCalls(everySecond(['error', 'error', 'error'])), { ...SMALL, minCallsThreshold: 4 });
    expect(result.timesOpened).toBe(0);
  });

  it('handles an empty timeline and a single call', () => {
    expect(summarizeReplay(replayTimeline(timelineFromCalls([]), SMALL))).toBe('The timeline has no calls.');
    const single = replayTimeline(timelineFromCalls(everySecond(['error'])), SMALL);
    expect(single).toMatchObject({ totalCalls: 1, spanMs: 0, errorsReachingUsers: 1, timesOpened: 0 });
    expect(single.buckets).toHaveLength(1);
  });

  it('sorts unordered calls and keeps calls with the same time in the order given', () => {
    const timeline = timelineFromCalls([
      { t: 5, outcome: OUTCOME_ERROR, latencyMs: 1 },
      { t: 1, outcome: OUTCOME_OK, latencyMs: 2 },
      { t: 5, outcome: OUTCOME_OK, latencyMs: 3 },
    ]);
    expect(Array.from(timeline.t)).toEqual([1, 5, 5]);
    expect(Array.from(timeline.latencyMs)).toEqual([2, 1, 3]);
  });

  it('gives the same answer every time', () => {
    const timeline = SAMPLE_INCIDENTS[2].build();
    expect(replayTimeline(timeline, DEFAULT_BREAKER_SETTINGS)).toEqual(replayTimeline(timeline, DEFAULT_BREAKER_SETTINGS));
  });
});

describe('the synthetic incidents', () => {
  it('are the same on every build', () => {
    for (const sample of SAMPLE_INCIDENTS) {
      const first = sample.build();
      const second = sample.build();
      expect(Array.from(first.t)).toEqual(Array.from(second.t));
      expect(Array.from(first.outcome)).toEqual(Array.from(second.outcome));
      expect(Array.from(first.latencyMs)).toEqual(Array.from(second.latencyMs));
      expect(first.t[0]).toBe(FIXTURE_START_MS);
    }
  });

  it('pins the exact opening and closing times for the short error burst with the default settings', () => {
    const burst = SAMPLE_INCIDENTS.find((sample) => sample.id === 'error-burst')!;
    const timeline = burst.build();
    expect(timeline.t.length).toBe(1200);
    const result = replayTimeline(timeline, DEFAULT_BREAKER_SETTINGS);

    expect(result.firstOpenedAtMs).toBe(FIXTURE_START_MS + 91_800);
    expect(formatClock(result.firstOpenedAtMs as number, true)).toBe('2025-03-04 12:01:31.800');
    const last = result.transitions[result.transitions.length - 1];
    expect(last).toMatchObject({ from: 'HALF_OPEN', to: 'CLOSED', reason: 'probes-passed' });
    expect(last.atMs).toBe(FIXTURE_START_MS + 122_200);
    expect(result.transitions).toHaveLength(13);
    // Each failed probe reopens it every five seconds until the burst ends.
    expect(result.transitions.slice(0, 5).map((t) => [t.atMs - FIXTURE_START_MS, t.to])).toEqual([
      [91_800, 'OPEN'],
      [96_800, 'HALF_OPEN'],
      [96_800, 'OPEN'],
      [101_800, 'HALF_OPEN'],
      [101_800, 'OPEN'],
    ]);
    expect(result).toMatchObject({
      totalCalls: 1200,
      shortCircuited: 144,
      errorsInTimeline: 145,
      errorsReachingUsers: 30,
      errorsAvoided: 115,
      healthyBlocked: 29,
      timesOpened: 6,
      msOpen: 30_000,
      msHalfOpen: 400,
      msClosed: 209_400,
      finalState: 'CLOSED',
    });
    expect(summarizeReplay(result)).toBe(
      'The breaker opened 6 times, first at 12:01:31.800 UTC, 1 min 32 s into the timeline. It was open for 30 s in total (13% of the timeline) and the timeline ends with it closed. ' +
        'It short-circuited 144 of 1,200 calls: 115 would have failed and 29 would have succeeded. 30 failed calls still reached users, against 145 with no breaker.'
    );
  });

  it('open the breaker on slow calls in the slow degradation and on every bad stretch in the flapping dependency', () => {
    const slow = replayTimeline(SAMPLE_INCIDENTS[1].build(), DEFAULT_BREAKER_SETTINGS);
    expect(slow.transitions[0]).toMatchObject({ to: 'OPEN', reason: 'slow-rate' });
    expect(slow.firstOpenedAtMs).toBe(FIXTURE_START_MS + 83_250);
    const flapping = replayTimeline(SAMPLE_INCIDENTS[2].build(), DEFAULT_BREAKER_SETTINGS);
    expect(flapping.firstOpenedAtMs).toBe(FIXTURE_START_MS + 22_250);
    const closings = flapping.transitions.filter((t) => t.to === 'CLOSED');
    expect(closings.length).toBeGreaterThanOrEqual(5);
  });
});

describe('comparing two sets', () => {
  const timeline = SAMPLE_INCIDENTS[0].build();
  const patient = replayTimeline(timeline, { ...DEFAULT_BREAKER_SETTINGS, failureRateThresholdPercent: 80 });
  const quick = replayTimeline(timeline, { ...DEFAULT_BREAKER_SETTINGS, failureRateThresholdPercent: 30, resetTimeoutMs: 10_000 });

  it('writes out what changed in the settings and in the results', () => {
    const lines = compareReplays(patient, quick, 'Current', 'Candidate');
    expect(lines[0]).toBe('The settings differ: failure threshold is 80% in Current and 30% in Candidate; open duration is 5 s in Current and 10 s in Candidate.');
    expect(lines).toContain('Candidate opens 3 times and Current opens 6 times.');
    expect(lines).toContain('Candidate first opens at 12:01:30.800 UTC, 2.6 s earlier than Current (12:01:33.400 UTC).');
    expect(lines).toContain('Candidate short-circuits 147 calls, 3 more than Current.');
    expect(lines).toContain('Candidate lets 14 fewer failed calls reach users (23 against 37).');
    expect(lines).toContain('Candidate blocks 11 fewer calls that would have succeeded (25 against 36).');
    expect(lines.some((line) => /^Candidate short-circuits [\d,]+ calls?, [\d,]+ (more|fewer) than Current\.$/.test(line))).toBe(true);
    expect(lines.some((line) => /^Candidate lets [\d,]+ (more|fewer) failed calls? reach users \([\d,]+ against [\d,]+\)\.$/.test(line))).toBe(true);
    expect(lines.some((line) => /^Candidate blocks [\d,]+ (more|fewer) calls? that would have succeeded/.test(line))).toBe(true);
  });

  it('agrees with the individual replays', () => {
    const lines = compareReplays(patient, quick, 'Current', 'Candidate').join('\n');
    const gap = Math.abs(quick.shortCircuited - patient.shortCircuited);
    expect(lines).toContain(`${quick.shortCircuited.toLocaleString('en-US')} call${quick.shortCircuited === 1 ? '' : 's'}, ${gap.toLocaleString('en-US')} ${quick.shortCircuited > patient.shortCircuited ? 'more' : 'fewer'} than Current`);
  });

  it('names the trade-off when one set protects users better but blocks more healthy calls', () => {
    const lines = compareReplays(patient, quick, 'Current', 'Candidate');
    if (quick.errorsReachingUsers < patient.errorsReachingUsers && quick.healthyBlocked > patient.healthyBlocked) {
      expect(lines[lines.length - 1]).toBe('The trade-off: Candidate keeps more errors from users but blocks more healthy calls than Current.');
    } else {
      expect(lines.join(' ')).not.toContain('The trade-off');
    }
  });

  it('says so when two sets behave the same', () => {
    const lines = compareReplays(patient, patient, 'A', 'B');
    expect(lines).toEqual(['A and B use the same settings.', 'A and B behave the same on this timeline: same openings, same blocked calls, same errors reaching users.']);
  });

  it('reports a set that never opens against one that does', () => {
    const never = replayTimeline(timeline, { ...DEFAULT_BREAKER_SETTINGS, failureRateThresholdPercent: 100, slowCallRateThresholdPercent: 100, minCallsThreshold: 20 });
    expect(never.timesOpened).toBe(0);
    const lines = compareReplays(never, quick, 'Never', 'Quick');
    expect(lines).toContain('Quick opens 3 times and Never never opens.');
    expect(lines).toContain('Quick first opens at 12:01:30.800 UTC; Never never opens.');
    expect(lines).toContain('Quick spends 30 s open against 0 ms for Never.');
  });
});

describe('formatting', () => {
  it('writes durations in sensible units', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(5000)).toBe('5 s');
    expect(formatDuration(65_000)).toBe('1 min 5 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(3_900_000)).toBe('1 h 5 min');
  });

  it('writes UTC clock times, with the date on request', () => {
    expect(formatClock(Date.UTC(2025, 2, 4, 12, 1, 31, 250))).toBe('12:01:31.250');
    expect(formatClock(Date.UTC(2025, 2, 4, 12, 1, 31), true)).toBe('2025-03-04 12:01:31');
  });
});
