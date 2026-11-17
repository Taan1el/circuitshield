import type { BreakerSettings } from '../../../shared/breaker-core.js';
import type { ReplayResult } from '../../../shared/replay.js';

export interface ExportContext {
  /** What the person calls these settings. */
  name: string;
  settings: BreakerSettings;
  /** The replay these settings were chosen on, summarised in the JSON file when present. */
  replay?: ReplayResult | null;
  /** Name of the timeline the replay ran on. */
  timelineName?: string;
}

/** A name that is safe inside a comment: one line, no comment terminators. */
function commentSafe(name: string): string {
  return name.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /').trim() || 'my circuit';
}

/** A name usable as a YAML key: lower case letters, digits and hyphens. */
function slug(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return value || 'my-circuit';
}

export function exportSettingsJson(context: ExportContext): string {
  const { settings, replay } = context;
  const body: Record<string, unknown> = {
    format: 'circuitshield-settings',
    version: 1,
    name: commentSafe(context.name),
    settings: {
      failureRateThresholdPercent: settings.failureRateThresholdPercent,
      slowCallRateThresholdPercent: settings.slowCallRateThresholdPercent,
      slowCallDurationThresholdMs: settings.slowCallDurationThresholdMs,
      minCallsThreshold: settings.minCallsThreshold,
      slidingWindowSize: settings.slidingWindowSize,
      resetTimeoutMs: settings.resetTimeoutMs,
      halfOpenTrialCalls: settings.halfOpenTrialCalls,
    },
  };
  if (replay && replay.totalCalls > 0) {
    body.replay = {
      timeline: context.timelineName ?? null,
      calls: replay.totalCalls,
      timesOpened: replay.timesOpened,
      shortCircuitedCalls: replay.shortCircuited,
      failedCallsReachingUsers: replay.errorsReachingUsers,
      healthyCallsBlocked: replay.healthyBlocked,
      millisecondsOpen: Math.round(replay.msOpen),
    };
  }
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function resilience4jYaml(context: ExportContext): string {
  const s = context.settings;
  const lines = [
    `# resilience4j settings for "${commentSafe(context.name)}" (Spring Boot application.yml, resilience4j-spring-boot).`,
    '#',
    '# Map exactly:',
    '#   failureRateThreshold, slowCallRateThreshold, slowCallDurationThreshold,',
    '#   minimumNumberOfCalls, slidingWindowSize (a count window, like CircuitShield),',
    '#   waitDurationInOpenState.',
    '# Map with a difference:',
    '#   permittedNumberOfCallsInHalfOpenState: resilience4j judges the failure rate across the',
    '#   probe calls. CircuitShield opens again on the first failed or slow probe and closes only',
    '#   when every probe succeeds.',
    '#   A call that fails and is also slow counts in both rates in resilience4j. CircuitShield',
    '#   counts it as a failure only.',
    '# Not set: automaticTransitionFromOpenToHalfOpenEnabled. Its default (false) moves to',
    '#   half-open on the next call, which is what CircuitShield does.',
    '# resilience4j does not time calls out. Add a TimeLimiter if calls can hang.',
  ];
  if (s.failureRateThresholdPercent <= 0 || s.slowCallRateThresholdPercent <= 0) {
    lines.push('# A threshold of 0 is not accepted by resilience4j, which expects a value above 0 and up to 100. Raise it before using this file.');
  }
  lines.push(
    'resilience4j:',
    '  circuitbreaker:',
    '    instances:',
    `      ${slug(context.name)}:`,
    '        slidingWindowType: COUNT_BASED',
    `        slidingWindowSize: ${s.slidingWindowSize}`,
    `        minimumNumberOfCalls: ${s.minCallsThreshold}`,
    `        failureRateThreshold: ${s.failureRateThresholdPercent}`,
    `        slowCallRateThreshold: ${s.slowCallRateThresholdPercent}`,
    `        slowCallDurationThreshold: ${s.slowCallDurationThresholdMs}ms`,
    `        waitDurationInOpenState: ${s.resetTimeoutMs}ms`,
    `        permittedNumberOfCallsInHalfOpenState: ${s.halfOpenTrialCalls}`
  );
  return `${lines.join('\n')}\n`;
}

export function pollyCsharp(context: ExportContext): string {
  const s = context.settings;
  const throughput = Math.max(2, s.minCallsThreshold);
  const lines = [
    `// Polly v8 circuit breaker for "${commentSafe(context.name)}" (NuGet package: Polly.Core).`,
    '//',
    '// Map exactly:',
    '//   FailureRatio     from the failure rate threshold, as a fraction (50% is 0.5).',
    '//   BreakDuration    from the open duration.',
    '// Map with a difference:',
    `//   MinimumThroughput from the minimum calls.${s.minCallsThreshold < 2 ? ` Polly needs at least 2, so ${s.minCallsThreshold} became 2.` : ''}`,
    '// Not mapped, left at the Polly default:',
    `//   SamplingDuration. Polly judges a time window (30 s by default), not the last ${s.slidingWindowSize} calls.`,
    `//     Choose a duration that covers about ${s.slidingWindowSize} calls at your usual traffic.`,
    `//   Half-open probes (${s.halfOpenTrialCalls}). Polly lets one probe call through when half-open and`,
    '//     closes on its success or opens again on its failure.',
    '//   Slow calls. The Polly circuit breaker has no slow-call rate or duration threshold.',
    '//   ShouldHandle. The default counts exceptions only. Add a predicate to count results such',
    '//     as HTTP 5xx responses.',
  ];
  if (s.resetTimeoutMs < 500) {
    lines.push('// Polly v8 checks BreakDuration against a minimum of 500 ms. Raise it if the pipeline fails to build.');
  }
  lines.push(
    '',
    'using Polly;',
    'using Polly.CircuitBreaker;',
    '',
    'var options = new CircuitBreakerStrategyOptions',
    '{',
    `    FailureRatio = ${Number((s.failureRateThresholdPercent / 100).toFixed(4))},`,
    `    MinimumThroughput = ${throughput},`,
    `    BreakDuration = TimeSpan.FromMilliseconds(${s.resetTimeoutMs}),`,
    '};',
    '',
    'var pipeline = new ResiliencePipelineBuilder()',
    '    .AddCircuitBreaker(options)',
    '    .Build();'
  );
  return `${lines.join('\n')}\n`;
}

export function opossumJs(context: ExportContext): string {
  const s = context.settings;
  const lines = [
    `// opossum circuit breaker options for "${commentSafe(context.name)}" (npm package: opossum).`,
    '//',
    '// Map exactly:',
    '//   errorThresholdPercentage  from the failure rate threshold.',
    '//   resetTimeout              from the open duration.',
    '//   volumeThreshold           from the minimum calls.',
    '// Map with a difference:',
    `//   timeout (${s.slowCallDurationThresholdMs} ms) from the slow call threshold. opossum stops waiting for a call that runs`,
    '//     longer than this and counts it as a failure. CircuitShield only counts it as slow.',
    '//     Remove it if you want slow calls to be left alone.',
    '// Not mapped, left at the opossum default:',
    `//   The window. opossum judges a rolling time window (rollingCountTimeout, 10 s by default),`,
    `//     not the last ${s.slidingWindowSize} calls. No value is derived from the window size here.`,
    `//   Slow call rate threshold (${s.slowCallRateThresholdPercent}%). opossum has no separate slow-call rate.`,
    `//   Half-open probes (${s.halfOpenTrialCalls}). opossum lets one call through when half-open.`,
    '',
    "import CircuitBreaker from 'opossum';",
    '',
    'const options = {',
    `  errorThresholdPercentage: ${s.failureRateThresholdPercent},`,
    `  resetTimeout: ${s.resetTimeoutMs},`,
    `  volumeThreshold: ${s.minCallsThreshold},`,
    `  timeout: ${s.slowCallDurationThresholdMs},`,
    '};',
    '',
    '// callDownstream is your async function that makes the call.',
    'const breaker = new CircuitBreaker(callDownstream, options);',
  ];
  return `${lines.join('\n')}\n`;
}

export interface ExportFormat {
  id: 'json' | 'resilience4j' | 'polly' | 'opossum';
  label: string;
  fileName: string;
  mime: string;
  build: (context: ExportContext) => string;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  { id: 'json', label: 'CircuitShield settings (JSON)', fileName: 'circuitshield-settings.json', mime: 'application/json', build: exportSettingsJson },
  { id: 'resilience4j', label: 'resilience4j (YAML)', fileName: 'application-resilience4j.yml', mime: 'text/yaml', build: resilience4jYaml },
  { id: 'polly', label: 'Polly (C#)', fileName: 'CircuitBreakerOptions.cs', mime: 'text/plain', build: pollyCsharp },
  { id: 'opossum', label: 'opossum (JavaScript)', fileName: 'breaker.js', mime: 'text/javascript', build: opossumJs },
];
