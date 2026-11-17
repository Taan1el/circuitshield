import { describe, expect, it } from 'vitest';
import { DEFAULT_BREAKER_SETTINGS, validateBreakerSettings } from '../../../shared/breaker-settings.js';
import {
  circuitIdFor,
  defaultTuning,
  emptyWorkspaceData,
  formatFileProblem,
  newCircuitConfig,
  parseWorkspaceText,
  serializeWorkspace,
  toDefinition,
  type WorkspaceData,
} from '../local/workspaceFile.js';

function sample(): WorkspaceData {
  return {
    circuits: [
      { id: 'checkout', name: 'Checkout', serviceTarget: 'checkout-api', config: newCircuitConfig() },
      { id: 'search', name: 'Search', serviceTarget: 'search-api', config: { ...newCircuitConfig(), failureRateThresholdPercent: 30 } },
    ],
    tuning: { ...defaultTuning(), b: { label: 'Candidate', settings: { ...DEFAULT_BREAKER_SETTINGS, resetTimeoutMs: 9000 } } },
  };
}

function problemsFor(mutate: (value: any) => void): string[] {
  const value = JSON.parse(serializeWorkspace(sample()));
  mutate(value);
  const result = parseWorkspaceText(JSON.stringify(value));
  if (result.ok) throw new Error('expected the file to be refused');
  return result.problems.map((problem) => formatFileProblem('workspace.json', problem));
}

describe('workspace file', () => {
  it('round-trips through its own export', () => {
    const data = sample();
    const result = parseWorkspaceText(serializeWorkspace(data));
    expect(result).toEqual({ ok: true, data });
  });

  it('accepts a byte order mark and a workspace with no circuits and no second set', () => {
    const empty = emptyWorkspaceData();
    expect(parseWorkspaceText(`﻿${serializeWorkspace(empty)}`)).toEqual({ ok: true, data: empty });
  });

  it('says a file that is not JSON is not JSON', () => {
    const result = parseWorkspaceText('{ nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].message).toMatch(/^not valid JSON \(/);
  });

  it('names the path, the expected value and what was found for each problem', () => {
    expect(problemsFor((v) => { v.format = 'something'; })).toEqual(['workspace.json, format: expected "circuitshield-workspace", got "something"']);
    expect(problemsFor((v) => { v.version = 2; })).toEqual(['workspace.json, version: expected 1, got 2']);
    expect(problemsFor((v) => { v.circuits[1].config.slidingWindowSize = 0; })).toEqual([
      'workspace.json, circuits[1].config.slidingWindowSize: expected a whole number between 1 and 10000, got 0',
    ]);
    expect(problemsFor((v) => { v.circuits[0].config.failureRateThresholdPercent = 140; })).toEqual([
      'workspace.json, circuits[0].config.failureRateThresholdPercent: expected a number between 0 and 100, got 140',
    ]);
    expect(problemsFor((v) => { delete v.circuits[0].config.resetTimeoutMs; })).toEqual([
      'workspace.json, circuits[0].config.resetTimeoutMs: expected a number between 0 and 600000, got nothing',
    ]);
    expect(problemsFor((v) => { v.circuits[0].id = 'Not Valid'; })).toEqual([
      'workspace.json, circuits[0].id: expected 1 to 40 lower case letters, digits or hyphens, got "Not Valid"',
    ]);
    expect(problemsFor((v) => { v.circuits[1].id = 'checkout'; })).toEqual([
      'workspace.json, circuits[1].id: expected a unique id, but "checkout" is used twice',
    ]);
    expect(problemsFor((v) => { v.circuits[0].name = ''; })).toEqual(['workspace.json, circuits[0].name: expected text of 1 to 60 characters, got ""']);
    expect(problemsFor((v) => { v.tuning.timeline = 'elsewhere'; })[0]).toMatch(/^workspace\.json, tuning\.timeline: expected one of "workspace", "error-burst", "slow-degradation", "flapping", got "elsewhere"$/);
    expect(problemsFor((v) => { v.tuning.a.settings.minCallsThreshold = 90; })).toEqual([
      'workspace.json, tuning.a.settings.minCallsThreshold: expected at most slidingWindowSize (20), got 90',
    ]);
    expect(problemsFor((v) => { v.tuning.b.label = 7; })).toEqual(['workspace.json, tuning.b.label: expected text of 1 to 40 characters, got 7']);
    expect(problemsFor((v) => { v.circuits = {}; })).toEqual(['workspace.json, circuits: expected a list of circuits, got {}']);
    expect(problemsFor((v) => { v.circuits = Array.from({ length: 51 }, () => ({})); })).toEqual(['workspace.json, circuits: expected at most 50 circuits, got 51']);
  });

  it('reports every problem it finds in one pass', () => {
    const lines = problemsFor((v) => {
      v.circuits[0].config.slidingWindowSize = 0;
      v.circuits[1].config.halfOpenTrialCalls = 'many';
      v.tuning.a.settings.resetTimeoutMs = -5;
    });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('workspace.json, circuits[1].config.halfOpenTrialCalls: expected a whole number between 1 and 1000, got "many"');
  });

  it('refuses a value that is not an object at all', () => {
    const result = parseWorkspaceText('[1, 2]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].message).toBe('expected a JSON object, got [1,2]');
  });
});

describe('circuits and settings', () => {
  it('derives a unique id from a name', () => {
    expect(circuitIdFor('Checkout API!', [])).toBe('checkout-api');
    expect(circuitIdFor('Checkout API!', ['checkout-api'])).toBe('checkout-api-2');
    expect(circuitIdFor('Checkout API!', ['checkout-api', 'checkout-api-2'])).toBe('checkout-api-3');
    expect(circuitIdFor('***', [])).toBe('circuit');
  });

  it('turns a saved circuit into what the console runs, with a fallback answer', () => {
    const definition = toDefinition(sample().circuits[1]);
    expect(definition).toMatchObject({ id: 'search', name: 'Search', serviceTarget: 'search-api' });
    expect(definition.config.failureRateThresholdPercent).toBe(30);
    expect(definition.fallbackPayload).toEqual({ status: 'FALLBACK', message: 'Search is open, so this fallback answer was served.' });
  });

  it('checks full sets of settings against the same ranges as the API', () => {
    expect(validateBreakerSettings(DEFAULT_BREAKER_SETTINGS)).toEqual({ value: DEFAULT_BREAKER_SETTINGS });
    expect(validateBreakerSettings({ ...DEFAULT_BREAKER_SETTINGS, slidingWindowSize: 0 })).toEqual({ error: "Setting 'slidingWindowSize' must be a whole number between 1 and 10000" });
    expect(validateBreakerSettings({ ...DEFAULT_BREAKER_SETTINGS, failureRateThresholdPercent: 101 })).toEqual({ error: "Setting 'failureRateThresholdPercent' must be a number between 0 and 100" });
    expect(validateBreakerSettings({ ...DEFAULT_BREAKER_SETTINGS, resetTimeoutMs: undefined })).toEqual({ error: "Setting 'resetTimeoutMs' must be a number" });
    expect(validateBreakerSettings({ ...DEFAULT_BREAKER_SETTINGS, minCallsThreshold: 30 })).toMatchObject({ error: expect.stringContaining("cannot exceed 'slidingWindowSize'") });
    expect(validateBreakerSettings(null)).toEqual({ error: 'Settings must be an object' });
  });
});
