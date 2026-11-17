import { BREAKER_SETTING_KEYS, type BreakerSettings } from './breaker-core.js';
import { CONFIG_RULES, isFiniteNumber, type ValidationOutcome } from './validation.js';

/** The same defaults a new CircuitBreaker starts with. */
export const DEFAULT_BREAKER_SETTINGS: BreakerSettings = {
  failureRateThresholdPercent: 50,
  slowCallRateThresholdPercent: 50,
  slowCallDurationThresholdMs: 500,
  minCallsThreshold: 5,
  slidingWindowSize: 20,
  resetTimeoutMs: 5000,
  halfOpenTrialCalls: 3,
};

export interface SettingMeta {
  key: keyof BreakerSettings;
  label: string;
  unit: string;
  help: string;
}

/** Plain names and units for each setting, shared by the form, the explanations and the exports. */
export const SETTING_META: SettingMeta[] = [
  { key: 'failureRateThresholdPercent', label: 'Failure threshold', unit: '%', help: 'Open when this share of the calls in the window failed.' },
  { key: 'slowCallRateThresholdPercent', label: 'Slow call share', unit: '%', help: 'Open when this share of the calls in the window was slow.' },
  { key: 'slowCallDurationThresholdMs', label: 'Slow call duration', unit: 'ms', help: 'A call that takes at least this long counts as slow.' },
  { key: 'minCallsThreshold', label: 'Minimum calls', unit: 'calls', help: 'The window must hold at least this many calls before it is judged.' },
  { key: 'slidingWindowSize', label: 'Window size', unit: 'calls', help: 'How many of the most recent calls are judged.' },
  { key: 'resetTimeoutMs', label: 'Open duration', unit: 'ms', help: 'How long the circuit stays open before it lets probe calls through.' },
  { key: 'halfOpenTrialCalls', label: 'Half-open probes', unit: 'calls', help: 'Probe calls that must succeed, with none failing, to close the circuit.' },
];

export function metaFor(key: keyof BreakerSettings): SettingMeta {
  return SETTING_META.find((meta) => meta.key === key) as SettingMeta;
}

/** Checks a full set of breaker settings against the same ranges the API enforces on a config update. */
export function validateBreakerSettings(input: unknown): ValidationOutcome<BreakerSettings> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'Settings must be an object' };
  }
  const source = input as Record<string, unknown>;
  const value: Record<string, number> = {};
  for (const key of BREAKER_SETTING_KEYS) {
    const rule = CONFIG_RULES.find((candidate) => candidate.key === key);
    const raw = source[key];
    if (!isFiniteNumber(raw)) return { error: `Setting '${key}' must be a number` };
    if (!rule) continue;
    if (raw < rule.min || raw > rule.max || (rule.integer === true && !Number.isInteger(raw))) {
      return { error: `Setting '${key}' must be ${rule.integer ? 'a whole number' : 'a number'} between ${rule.min} and ${rule.max}` };
    }
    value[key] = raw;
  }
  const settings = value as unknown as BreakerSettings;
  if (settings.minCallsThreshold > settings.slidingWindowSize) {
    return { error: `Setting 'minCallsThreshold' (${settings.minCallsThreshold}) cannot exceed 'slidingWindowSize' (${settings.slidingWindowSize}); the window would never hold enough calls to be judged` };
  }
  return { value: settings };
}
