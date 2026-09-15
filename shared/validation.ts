import type { CircuitConfig } from './types.js';

// Small hand-rolled request validation. The input surface here is a handful
// of numeric fields, so a schema library would add a dependency for less
// clarity than writing out the specific, honest error message for each rule.

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

interface ConfigFieldRule {
  key: keyof CircuitConfig;
  min: number;
  max: number;
  integer?: boolean;
}

// Bounds are generous on purpose (this is a sandbox for exploring circuit
// behavior, not a hardened production config surface); they exist to catch
// obviously-wrong input (negative durations, NaN, an accidental string)
// rather than to second-guess a deliberate tuning choice.
const CONFIG_RULES: ConfigFieldRule[] = [
  { key: 'failureRateThresholdPercent', min: 0, max: 100 },
  { key: 'slowCallRateThresholdPercent', min: 0, max: 100 },
  { key: 'slowCallDurationThresholdMs', min: 0, max: 600_000 },
  { key: 'minCallsThreshold', min: 1, max: 10_000, integer: true },
  { key: 'slidingWindowSize', min: 1, max: 10_000, integer: true },
  { key: 'resetTimeoutMs', min: 0, max: 600_000 },
  { key: 'halfOpenTrialCalls', min: 1, max: 1_000, integer: true },
  { key: 'bulkheadMaxConcurrent', min: 1, max: 10_000, integer: true },
  { key: 'bulkheadMaxWaitMs', min: 0, max: 600_000 },
];

export type ValidationOutcome<T> = { value: T } | { error: string };

export function validateCircuitConfigPatch(
  body: unknown,
  current: CircuitConfig
): ValidationOutcome<Partial<CircuitConfig>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }
  const input = body as Record<string, unknown>;
  const patch: Partial<CircuitConfig> = {};

  for (const rule of CONFIG_RULES) {
    const raw = input[rule.key];
    if (raw === undefined) continue;
    const bad =
      !isFiniteNumber(raw) || raw < rule.min || raw > rule.max || (rule.integer === true && !Number.isInteger(raw));
    if (bad) {
      return {
        error: `Field '${rule.key}' must be ${rule.integer ? 'an integer' : 'a number'} between ${rule.min} and ${rule.max}`,
      };
    }
    (patch as Record<string, number>)[rule.key] = raw;
  }

  const nextMinCalls = patch.minCallsThreshold ?? current.minCallsThreshold;
  const nextWindowSize = patch.slidingWindowSize ?? current.slidingWindowSize;
  if (nextMinCalls > nextWindowSize) {
    return {
      error: `Field 'minCallsThreshold' (${nextMinCalls}) cannot exceed 'slidingWindowSize' (${nextWindowSize}); the window would never hold enough calls to evaluate`,
    };
  }

  return { value: patch };
}

export function validateChaosPatch(
  body: unknown
): ValidationOutcome<{ latencyMs: number; errorRatePercent: number }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }
  const input = body as Record<string, unknown>;
  const latencyMs = input.latencyMs ?? 50;
  const errorRatePercent = input.errorRatePercent ?? 0;

  if (!isFiniteNumber(latencyMs) || latencyMs < 0 || latencyMs > 60_000) {
    return { error: "Field 'latencyMs' must be a number between 0 and 60000" };
  }
  if (!isFiniteNumber(errorRatePercent) || errorRatePercent < 0 || errorRatePercent > 100) {
    return { error: "Field 'errorRatePercent' must be a number between 0 and 100" };
  }

  return { value: { latencyMs, errorRatePercent } };
}

export function validateBurstRequest(
  body: unknown
): ValidationOutcome<{ concurrency: number; latencyMs?: number; errorRatePercent?: number }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }
  const input = body as Record<string, unknown>;

  const concurrencyRaw = input.concurrency ?? 20;
  const concurrency = typeof concurrencyRaw === 'string' ? Number(concurrencyRaw) : concurrencyRaw;
  if (!isFiniteNumber(concurrency) || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
    return { error: "Field 'concurrency' must be an integer between 1 and 100" };
  }

  const value: { concurrency: number; latencyMs?: number; errorRatePercent?: number } = { concurrency };

  if (input.latencyMs !== undefined) {
    if (!isFiniteNumber(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > 60_000) {
      return { error: "Field 'latencyMs' must be a number between 0 and 60000" };
    }
    value.latencyMs = input.latencyMs;
  }

  if (input.errorRatePercent !== undefined) {
    if (!isFiniteNumber(input.errorRatePercent) || input.errorRatePercent < 0 || input.errorRatePercent > 100) {
      return { error: "Field 'errorRatePercent' must be a number between 0 and 100" };
    }
    value.errorRatePercent = input.errorRatePercent;
  }

  return { value };
}
