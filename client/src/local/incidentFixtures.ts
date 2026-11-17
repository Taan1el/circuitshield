import { OUTCOME_ERROR, OUTCOME_OK, OUTCOME_TIMEOUT, timelineFromCalls, type Timeline, type TimelineCall } from '../../../shared/replay.js';

/** All synthetic timelines start here: 2025-03-04T12:00:00Z. */
export const FIXTURE_START_MS = Date.UTC(2025, 2, 4, 12, 0, 0);

export interface SampleIncident {
  id: 'error-burst' | 'slow-degradation' | 'flapping';
  name: string;
  description: string;
  build: () => Timeline;
}

// Small deterministic generator, so a fixture is the same on every run and in every browser.
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shape {
  seed: number;
  seconds: number;
  callsPerSecond: number;
  /** Chance that a call at this many seconds in fails. */
  errorRate: (second: number) => number;
  /** Latency of a call at this many seconds in, before jitter. */
  latency: (second: number) => number;
  /** Chance that a slow call times out instead of returning. */
  timeoutRate?: (second: number) => number;
}

function generate(shape: Shape): Timeline {
  const random = seeded(shape.seed);
  const calls: TimelineCall[] = [];
  const total = shape.seconds * shape.callsPerSecond;
  const spacing = 1000 / shape.callsPerSecond;
  for (let index = 0; index < total; index++) {
    const offsetMs = Math.round(index * spacing);
    const second = offsetMs / 1000;
    const jitter = 0.85 + random() * 0.3;
    const latencyMs = Math.round(shape.latency(second) * jitter);
    const timedOut = random() < (shape.timeoutRate?.(second) ?? 0);
    const failed = random() < shape.errorRate(second);
    calls.push({
      t: FIXTURE_START_MS + offsetMs,
      outcome: timedOut ? OUTCOME_TIMEOUT : failed ? OUTCOME_ERROR : OUTCOME_OK,
      latencyMs: timedOut ? 2000 : latencyMs,
    });
  }
  return timelineFromCalls(calls);
}

export const SAMPLE_INCIDENTS: SampleIncident[] = [
  {
    id: 'error-burst',
    name: 'Short error burst',
    description: 'Four minutes at 5 calls a second. From 1:30 to 2:00 the dependency fails 85% of calls, then recovers.',
    build: () => generate({
      seed: 11,
      seconds: 240,
      callsPerSecond: 5,
      errorRate: (second) => (second >= 90 && second < 120 ? 0.85 : 0.01),
      latency: () => 80,
    }),
  },
  {
    id: 'slow-degradation',
    name: 'Slow degradation',
    description: 'Six minutes at 4 calls a second. Latency climbs from 80 ms to 1.6 s over the first five minutes, some calls time out near the peak, then it recovers.',
    build: () => generate({
      seed: 23,
      seconds: 360,
      callsPerSecond: 4,
      errorRate: () => 0.01,
      latency: (second) => (second < 300 ? 80 + (1520 * second) / 300 : 80),
      timeoutRate: (second) => (second >= 240 && second < 300 ? 0.15 : 0),
    }),
  },
  {
    id: 'flapping',
    name: 'Flapping dependency',
    description: 'Five minutes at 4 calls a second. The dependency alternates 20 seconds healthy and 20 seconds failing 90% of calls.',
    build: () => generate({
      seed: 37,
      seconds: 300,
      callsPerSecond: 4,
      errorRate: (second) => (Math.floor(second / 20) % 2 === 1 ? 0.9 : 0.01),
      latency: () => 70,
    }),
  },
];

export function sampleIncident(id: string): SampleIncident | undefined {
  return SAMPLE_INCIDENTS.find((incident) => incident.id === id);
}
