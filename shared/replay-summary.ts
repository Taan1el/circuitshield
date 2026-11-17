import type { BreakerSettings } from './breaker-core.js';
import { metaFor, SETTING_META } from './breaker-settings.js';
import type { ReplayResult, Transition } from './replay.js';

function count(value: number): string {
  return value.toLocaleString('en-US');
}

export function plural(value: number, word: string): string {
  return `${count(value)} ${word}${value === 1 ? '' : 's'}`;
}

function trimmed(value: number): string {
  return String(Number(value.toFixed(1)));
}

/** A length of time in the largest sensible units, for example "850 ms", "1.5 s" or "2 min 5 s". */
export function formatDuration(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 10_000) return `${trimmed(value / 1000)} s`;
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** A UTC time of day such as "12:01:32" or "12:01:32.250", with the date when asked. */
export function formatClock(ms: number, withDate = false): string {
  const iso = new Date(ms).toISOString();
  const time = iso.slice(11, 19) + (iso.slice(19, 23) === '.000' ? '' : iso.slice(19, 23));
  return withDate ? `${iso.slice(0, 10)} ${time}` : time;
}

/** Whether the timeline crosses midnight UTC, so times need their date to be unambiguous. */
export function spansDays(result: ReplayResult): boolean {
  return new Date(result.startMs).toISOString().slice(0, 10) !== new Date(result.endMs).toISOString().slice(0, 10);
}

function at(result: ReplayResult, ms: number): string {
  return `${formatClock(ms, spansDays(result))} UTC`;
}

function stateWords(state: ReplayResult['finalState']): string {
  return state === 'HALF_OPEN' ? 'half-open' : state.toLowerCase();
}

function opens(value: number): string {
  if (value === 0) return 'never opens';
  return value === 1 ? 'opens once' : `opens ${value} times`;
}

function times(value: number): string {
  if (value === 0) return 'never';
  return value === 1 ? 'once' : `${value} times`;
}

/** A short account of what the breaker did on the timeline, in plain sentences. */
export function summarizeReplay(result: ReplayResult): string {
  if (result.totalCalls === 0) return 'The timeline has no calls.';
  if (result.timesOpened === 0) {
    return `The breaker never opened. All ${plural(result.totalCalls, 'call')} went through, and ${plural(result.errorsInTimeline, 'call')} failed in the recording, so all of those reached users.`;
  }
  const first = result.firstOpenedAtMs as number;
  const parts: string[] = [];
  parts.push(`The breaker opened ${times(result.timesOpened)}, first at ${at(result, first)}, ${formatDuration(first - result.startMs)} into the timeline.`);
  const share = result.spanMs > 0 ? ` (${Math.round((result.msOpen / result.spanMs) * 100)}% of the timeline)` : '';
  parts.push(`It was open for ${formatDuration(result.msOpen)} in total${share} and the timeline ends with it ${stateWords(result.finalState)}.`);
  parts.push(
    `It short-circuited ${count(result.shortCircuited)} of ${plural(result.totalCalls, 'call')}: ${count(result.errorsAvoided)} would have failed and ${count(result.healthyBlocked)} would have succeeded.`
  );
  parts.push(`${plural(result.errorsReachingUsers, 'failed call')} still reached users, against ${count(result.errorsInTimeline)} with no breaker.`);
  return parts.join(' ');
}

/** One state change in words, for the table next to the chart. */
export function describeTransition(transition: Transition, settings: BreakerSettings): string {
  switch (transition.reason) {
    case 'failure-rate':
      return `Opened: ${trimmed(transition.failureRatePercent ?? 0)}% of the last ${plural(transition.windowCalls ?? 0, 'call')} failed (threshold ${settings.failureRateThresholdPercent}%).`;
    case 'slow-rate':
      return `Opened: ${trimmed(transition.slowRatePercent ?? 0)}% of the last ${plural(transition.windowCalls ?? 0, 'call')} were slow (threshold ${settings.slowCallRateThresholdPercent}%).`;
    case 'reset-timeout':
      return `Half-open: the open duration of ${formatDuration(settings.resetTimeoutMs)} has passed, so probe calls are let through.`;
    case 'probes-passed':
      return `Closed: ${plural(settings.halfOpenTrialCalls, 'probe call')} succeeded.`;
    case 'probe-failed':
      return 'Opened again: a probe call failed.';
    case 'probe-slow':
      return `Opened again: a probe call was slow (at least ${formatDuration(settings.slowCallDurationThresholdMs)}).`;
  }
}

function settingValue(key: keyof BreakerSettings, value: number): string {
  const meta = metaFor(key);
  if (meta.unit === 'ms') return formatDuration(value);
  if (meta.unit === '%') return `${value}%`;
  return `${value} ${meta.unit}`;
}

/** The settings that differ between two sets, in words. */
export function describeSettingChanges(a: BreakerSettings, b: BreakerSettings, labelA: string, labelB: string): string {
  const changes = SETTING_META.filter((meta) => a[meta.key] !== b[meta.key]).map(
    (meta) => `${meta.label.toLowerCase()} is ${settingValue(meta.key, a[meta.key])} in ${labelA} and ${settingValue(meta.key, b[meta.key])} in ${labelB}`
  );
  if (changes.length === 0) return `${labelA} and ${labelB} use the same settings.`;
  return `The settings differ: ${changes.join('; ')}.`;
}

function sameTransitions(a: ReplayResult, b: ReplayResult): boolean {
  return a.transitions.length === b.transitions.length && a.transitions.every((t, i) => t.atMs === b.transitions[i].atMs && t.to === b.transitions[i].to);
}

/** The differences between two replays of the same timeline, one statement each. */
export function compareReplays(a: ReplayResult, b: ReplayResult, labelA: string, labelB: string): string[] {
  const out: string[] = [describeSettingChanges(a.settings, b.settings, labelA, labelB)];

  if (
    sameTransitions(a, b) &&
    a.shortCircuited === b.shortCircuited &&
    a.errorsReachingUsers === b.errorsReachingUsers &&
    a.healthyBlocked === b.healthyBlocked
  ) {
    out.push(`${labelA} and ${labelB} behave the same on this timeline: same openings, same blocked calls, same errors reaching users.`);
    return out;
  }

  if (a.timesOpened === b.timesOpened) {
    out.push(`Both open ${times(a.timesOpened)}.`);
  } else {
    out.push(`${labelB} ${opens(b.timesOpened)} and ${labelA} ${opens(a.timesOpened)}.`);
  }

  if (a.firstOpenedAtMs !== null && b.firstOpenedAtMs !== null) {
    if (a.firstOpenedAtMs === b.firstOpenedAtMs) {
      out.push(`Both first open at ${at(a, a.firstOpenedAtMs)}.`);
    } else {
      const later = b.firstOpenedAtMs > a.firstOpenedAtMs;
      out.push(
        `${labelB} first opens at ${at(b, b.firstOpenedAtMs)}, ${formatDuration(Math.abs(b.firstOpenedAtMs - a.firstOpenedAtMs))} ${later ? 'later' : 'earlier'} than ${labelA} (${at(a, a.firstOpenedAtMs)}).`
      );
    }
  } else if (a.firstOpenedAtMs !== null) {
    out.push(`${labelA} first opens at ${at(a, a.firstOpenedAtMs)}; ${labelB} never opens.`);
  } else if (b.firstOpenedAtMs !== null) {
    out.push(`${labelB} first opens at ${at(b, b.firstOpenedAtMs)}; ${labelA} never opens.`);
  }

  if (a.msOpen !== b.msOpen) {
    out.push(`${labelB} spends ${formatDuration(b.msOpen)} open against ${formatDuration(a.msOpen)} for ${labelA}.`);
  }

  if (a.shortCircuited !== b.shortCircuited) {
    const gap = Math.abs(b.shortCircuited - a.shortCircuited);
    out.push(`${labelB} short-circuits ${plural(b.shortCircuited, 'call')}, ${count(gap)} ${b.shortCircuited > a.shortCircuited ? 'more' : 'fewer'} than ${labelA}.`);
  }

  if (a.errorsReachingUsers !== b.errorsReachingUsers) {
    const gap = Math.abs(b.errorsReachingUsers - a.errorsReachingUsers);
    out.push(
      `${labelB} lets ${count(gap)} ${b.errorsReachingUsers > a.errorsReachingUsers ? 'more' : 'fewer'} failed ${gap === 1 ? 'call' : 'calls'} reach users (${count(b.errorsReachingUsers)} against ${count(a.errorsReachingUsers)}).`
    );
  }
  if (a.healthyBlocked !== b.healthyBlocked) {
    const gap = Math.abs(b.healthyBlocked - a.healthyBlocked);
    out.push(
      `${labelB} blocks ${count(gap)} ${b.healthyBlocked > a.healthyBlocked ? 'more' : 'fewer'} ${gap === 1 ? 'call' : 'calls'} that would have succeeded (${count(b.healthyBlocked)} against ${count(a.healthyBlocked)}).`
    );
  }
  const saferForUsers = b.errorsReachingUsers < a.errorsReachingUsers;
  const blocksMore = b.healthyBlocked > a.healthyBlocked;
  if ((saferForUsers && blocksMore) || (b.errorsReachingUsers > a.errorsReachingUsers && b.healthyBlocked < a.healthyBlocked)) {
    out.push(
      saferForUsers
        ? `The trade-off: ${labelB} keeps more errors from users but blocks more healthy calls than ${labelA}.`
        : `The trade-off: ${labelB} blocks fewer healthy calls but lets more errors reach users than ${labelA}.`
    );
  }
  return out;
}
