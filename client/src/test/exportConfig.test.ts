import { describe, expect, it } from 'vitest';
import type { BreakerSettings } from '../../../shared/breaker-core.js';
import { DEFAULT_BREAKER_SETTINGS, validateBreakerSettings } from '../../../shared/breaker-settings.js';
import { replayTimeline } from '../../../shared/replay.js';
import { EXPORT_FORMATS, exportSettingsJson, opossumJs, pollyCsharp, resilience4jYaml } from '../local/exportConfig.js';
import { SAMPLE_INCIDENTS } from '../local/incidentFixtures.js';

const SETTINGS: BreakerSettings = {
  failureRateThresholdPercent: 40,
  slowCallRateThresholdPercent: 60,
  slowCallDurationThresholdMs: 750,
  minCallsThreshold: 8,
  slidingWindowSize: 25,
  resetTimeoutMs: 12_000,
  halfOpenTrialCalls: 4,
};

describe('JSON export', () => {
  it('writes the settings under their own names with a format and version', () => {
    const body = JSON.parse(exportSettingsJson({ name: 'Candidate', settings: SETTINGS }));
    expect(body).toEqual({ format: 'circuitshield-settings', version: 1, name: 'Candidate', settings: SETTINGS });
  });

  it('adds a short summary of the replay it was chosen on', () => {
    const timeline = SAMPLE_INCIDENTS[0].build();
    const replay = replayTimeline(timeline, SETTINGS);
    const body = JSON.parse(exportSettingsJson({ name: 'Candidate', settings: SETTINGS, replay, timelineName: 'Sample: Short error burst' }));
    expect(body.replay).toEqual({
      timeline: 'Sample: Short error burst',
      calls: 1200,
      timesOpened: replay.timesOpened,
      shortCircuitedCalls: replay.shortCircuited,
      failedCallsReachingUsers: replay.errorsReachingUsers,
      healthyCallsBlocked: replay.healthyBlocked,
      millisecondsOpen: Math.round(replay.msOpen),
    });
  });

  it('reads back as valid settings', () => {
    const body = JSON.parse(exportSettingsJson({ name: 'x', settings: SETTINGS }));
    expect(validateBreakerSettings(body.settings)).toEqual({ value: SETTINGS });
  });

  it('keeps a hostile name on one line', () => {
    const body = JSON.parse(exportSettingsJson({ name: 'a\nb */ c', settings: SETTINGS }));
    expect(body.name).toBe('a b * / c');
  });
});

describe('resilience4j YAML', () => {
  const yaml = resilience4jYaml({ name: 'Payments API', settings: SETTINGS });

  it('maps every setting that has an equivalent, under an instance named after the circuit', () => {
    expect(yaml).toContain('resilience4j:\n  circuitbreaker:\n    instances:\n      payments-api:\n');
    for (const line of [
      'slidingWindowType: COUNT_BASED',
      'slidingWindowSize: 25',
      'minimumNumberOfCalls: 8',
      'failureRateThreshold: 40',
      'slowCallRateThreshold: 60',
      'slowCallDurationThreshold: 750ms',
      'waitDurationInOpenState: 12000ms',
      'permittedNumberOfCallsInHalfOpenState: 4',
    ]) {
      expect(yaml).toContain(`        ${line}\n`);
    }
  });

  it('states which settings map exactly and which do not', () => {
    expect(yaml).toMatch(/# Map exactly:\n#   failureRateThreshold, slowCallRateThreshold, slowCallDurationThreshold,/);
    expect(yaml).toMatch(/# Map with a difference:\n#   permittedNumberOfCallsInHalfOpenState/);
    expect(yaml).toContain('first failed or slow probe');
    expect(yaml).toContain('automaticTransitionFromOpenToHalfOpenEnabled');
  });

  it('warns about a threshold of zero, which resilience4j does not accept', () => {
    expect(resilience4jYaml({ name: 'x', settings: { ...SETTINGS, failureRateThresholdPercent: 0 } })).toContain('A threshold of 0 is not accepted');
    expect(yaml).not.toContain('A threshold of 0');
  });

  it('is valid YAML in the shape resilience4j reads', () => {
    const body = yaml.split('\n').filter((line) => !line.startsWith('#') && line.trim() !== '');
    // Indentation is two spaces per level and every key line has a value or opens a block.
    for (const line of body) expect(line).toMatch(/^( {2})*[A-Za-z0-9-]+:( .+)?$/);
  });
});

describe('Polly C#', () => {
  const code = pollyCsharp({ name: 'Payments', settings: SETTINGS });

  it('maps the failure ratio, the minimum throughput and the break duration', () => {
    expect(code).toContain('    FailureRatio = 0.4,');
    expect(code).toContain('    MinimumThroughput = 8,');
    expect(code).toContain('    BreakDuration = TimeSpan.FromMilliseconds(12000),');
    expect(code).toContain('var options = new CircuitBreakerStrategyOptions');
    expect(code).toContain('.AddCircuitBreaker(options)');
  });

  it('says what does not map and leaves it out', () => {
    expect(code).toContain('// Not mapped, left at the Polly default:');
    expect(code).toContain('SamplingDuration');
    expect(code).toContain('last 25 calls');
    expect(code).toContain('Half-open probes (4)');
    expect(code).toContain('no slow-call rate or duration threshold');
    expect(code).not.toMatch(/SamplingDuration\s*=/);
    expect(code).not.toContain('SlowCall');
  });

  it('raises a minimum throughput below 2 to the 2 that Polly needs, and says so', () => {
    const lifted = pollyCsharp({ name: 'x', settings: { ...SETTINGS, minCallsThreshold: 1 } });
    expect(lifted).toContain('    MinimumThroughput = 2,');
    expect(lifted).toContain('Polly needs at least 2, so 1 became 2.');
  });

  it('notes the minimum break duration when the open duration is below it', () => {
    expect(pollyCsharp({ name: 'x', settings: { ...SETTINGS, resetTimeoutMs: 100 } })).toContain('minimum of 500 ms');
    expect(code).not.toContain('minimum of 500 ms');
  });

  it('writes a fraction without float noise', () => {
    expect(pollyCsharp({ name: 'x', settings: { ...SETTINGS, failureRateThresholdPercent: 33.3 } })).toContain('FailureRatio = 0.333,');
  });
});

describe('opossum JavaScript', () => {
  const code = opossumJs({ name: 'Payments', settings: SETTINGS });

  it('maps the error threshold, reset timeout, volume threshold and timeout', () => {
    expect(code).toContain("import CircuitBreaker from 'opossum';");
    expect(code).toContain('  errorThresholdPercentage: 40,');
    expect(code).toContain('  resetTimeout: 12000,');
    expect(code).toContain('  volumeThreshold: 8,');
    expect(code).toContain('  timeout: 750,');
    expect(code).toContain('new CircuitBreaker(callDownstream, options)');
  });

  it('says that the window, the slow share and the probes do not map, and does not invent an option for them', () => {
    expect(code).toContain('// Not mapped, left at the opossum default:');
    expect(code).toContain('rollingCountTimeout');
    expect(code).toContain('last 25 calls');
    expect(code).toContain('Slow call rate threshold (60%)');
    expect(code).toContain('Half-open probes (4)');
    const options = code.slice(code.indexOf('const options'), code.indexOf('};'));
    expect(options).not.toMatch(/rolling|slowCall|halfOpen|window/i);
  });

  it('is syntactically valid JavaScript once the import and the callback are provided', () => {
    const body = code.replace("import CircuitBreaker from 'opossum';", 'const CircuitBreaker = class { constructor(fn, options) { this.options = options; } };');
    const run = new Function(`const callDownstream = async () => 1;\n${body}\nreturn breaker.options;`);
    expect(run()).toEqual({ errorThresholdPercentage: 40, resetTimeout: 12000, volumeThreshold: 8, timeout: 750 });
  });
});

describe('export formats', () => {
  it('offers the JSON file and the three libraries, each with a file name and a media type', () => {
    expect(EXPORT_FORMATS.map((format) => format.id)).toEqual(['json', 'resilience4j', 'polly', 'opossum']);
    for (const format of EXPORT_FORMATS) {
      expect(format.fileName).toMatch(/\.[a-z]+$/);
      expect(format.build({ name: 'x', settings: DEFAULT_BREAKER_SETTINGS }).endsWith('\n')).toBe(true);
    }
  });

  it('never mentions a setting in a comment that it also sets with a different value', () => {
    const yaml = resilience4jYaml({ name: 'x', settings: SETTINGS });
    expect(yaml.match(/failureRateThreshold: \d+/g)).toEqual(['failureRateThreshold: 40']);
  });
});
