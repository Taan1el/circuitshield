import type { BreakerSettings } from '../../../shared/breaker-core.js';
import { BREAKER_SETTING_KEYS } from '../../../shared/breaker-core.js';
import { DEFAULT_BREAKER_SETTINGS } from '../../../shared/breaker-settings.js';
import type { CircuitDefinition } from '../../../shared/circuit.service.js';
import type { CircuitConfig } from '../../../shared/types.js';
import { CONFIG_RULES, isFiniteNumber } from '../../../shared/validation.js';
import { SAMPLE_INCIDENTS } from './incidentFixtures.js';

export const WORKSPACE_FORMAT = 'circuitshield-workspace';
export const WORKSPACE_LIMITS = { fileBytes: 1024 * 1024, circuits: 50 } as const;

export interface ThresholdSet {
  label: string;
  settings: BreakerSettings;
}

export interface Tuning {
  /** 'workspace' for the imported incident, otherwise the id of a sample incident. */
  timeline: string;
  a: ThresholdSet;
  b: ThresholdSet | null;
}

export interface CircuitSpec {
  id: string;
  name: string;
  serviceTarget: string;
  config: CircuitConfig;
}

export interface WorkspaceData {
  circuits: CircuitSpec[];
  tuning: Tuning;
}

export interface FileProblem {
  path: string;
  message: string;
}

export const DEFAULT_BULKHEAD = { bulkheadMaxConcurrent: 5, bulkheadMaxWaitMs: 200 } as const;

export function defaultTuning(): Tuning {
  return {
    timeline: SAMPLE_INCIDENTS[0].id,
    a: { label: 'Current', settings: { ...DEFAULT_BREAKER_SETTINGS } },
    b: null,
  };
}

export function emptyWorkspaceData(): WorkspaceData {
  return { circuits: [], tuning: { ...defaultTuning(), timeline: 'workspace' } };
}

export function newCircuitConfig(settings: BreakerSettings = DEFAULT_BREAKER_SETTINGS): CircuitConfig {
  return { ...settings, ...DEFAULT_BULKHEAD };
}

/** An id for a circuit name, unique among the ids already taken. */
export function circuitIdFor(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'circuit';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base.slice(0, 36)}-${n}`;
  return id;
}

/** What the console runs for a saved circuit. A circuit you define answers with a plain fallback while it is open. */
export function toDefinition(spec: CircuitSpec): CircuitDefinition {
  return {
    id: spec.id,
    name: spec.name,
    serviceTarget: spec.serviceTarget,
    config: spec.config,
    fallbackPayload: { status: 'FALLBACK', message: `${spec.name} is open, so this fallback answer was served.` },
  };
}

export function equalWorkspaceData(a: WorkspaceData, b: WorkspaceData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function serializeWorkspace(data: WorkspaceData): string {
  return `${JSON.stringify({ format: WORKSPACE_FORMAT, version: 1, circuits: data.circuits, tuning: data.tuning }, null, 2)}\n`;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function readNumbers(
  source: unknown,
  keys: ReadonlyArray<keyof CircuitConfig>,
  path: string,
  problems: FileProblem[]
): Record<string, number> | null {
  if (!isRecord(source)) {
    problems.push({ path, message: `expected an object with ${keys.join(', ')}, got ${describe(source)}` });
    return null;
  }
  const out: Record<string, number> = {};
  let ok = true;
  for (const key of keys) {
    const rule = CONFIG_RULES.find((candidate) => candidate.key === key);
    const raw = source[key];
    if (!isFiniteNumber(raw) || !rule || raw < rule.min || raw > rule.max || (rule.integer === true && !Number.isInteger(raw))) {
      const expected = rule ? `${rule.integer ? 'a whole number' : 'a number'} between ${rule.min} and ${rule.max}` : 'a number';
      problems.push({ path: `${path}.${key}`, message: `expected ${expected}, got ${describe(raw)}` });
      ok = false;
      continue;
    }
    out[key] = raw;
  }
  if (ok && typeof out.minCallsThreshold === 'number' && out.minCallsThreshold > out.slidingWindowSize) {
    problems.push({ path: `${path}.minCallsThreshold`, message: `expected at most slidingWindowSize (${out.slidingWindowSize}), got ${out.minCallsThreshold}` });
    return null;
  }
  return ok ? out : null;
}

function readSet(source: unknown, path: string, problems: FileProblem[]): ThresholdSet | null {
  if (!isRecord(source)) {
    problems.push({ path, message: `expected an object with label and settings, got ${describe(source)}` });
    return null;
  }
  const before = problems.length;
  const label = typeof source.label === 'string' && source.label.trim() !== '' && source.label.length <= 40 ? source.label.trim() : null;
  if (label === null) problems.push({ path: `${path}.label`, message: `expected text of 1 to 40 characters, got ${describe(source.label)}` });
  const settings = readNumbers(source.settings, BREAKER_SETTING_KEYS, `${path}.settings`, problems);
  if (problems.length > before || label === null || !settings) return null;
  return { label, settings: settings as unknown as BreakerSettings };
}

export type WorkspaceParse = { ok: true; data: WorkspaceData } | { ok: false; problems: FileProblem[] };

/** Checks a decoded workspace file completely. Every problem names its path, what was expected and what was found. */
export function parseWorkspaceValue(value: unknown): WorkspaceParse {
  const problems: FileProblem[] = [];
  if (!isRecord(value)) return { ok: false, problems: [{ path: '(file)', message: `expected a JSON object, got ${describe(value)}` }] };
  if (value.format !== WORKSPACE_FORMAT) problems.push({ path: 'format', message: `expected "${WORKSPACE_FORMAT}", got ${describe(value.format)}` });
  if (value.version !== 1) problems.push({ path: 'version', message: `expected 1, got ${describe(value.version)}` });

  const circuits: CircuitSpec[] = [];
  if (!Array.isArray(value.circuits)) {
    problems.push({ path: 'circuits', message: `expected a list of circuits, got ${describe(value.circuits)}` });
  } else if (value.circuits.length > WORKSPACE_LIMITS.circuits) {
    problems.push({ path: 'circuits', message: `expected at most ${WORKSPACE_LIMITS.circuits} circuits, got ${value.circuits.length}` });
  } else {
    const seen = new Set<string>();
    value.circuits.forEach((entry, index) => {
      const path = `circuits[${index}]`;
      if (!isRecord(entry)) {
        problems.push({ path, message: `expected an object, got ${describe(entry)}` });
        return;
      }
      const before = problems.length;
      const id = typeof entry.id === 'string' && ID_PATTERN.test(entry.id) ? entry.id : null;
      if (id === null) problems.push({ path: `${path}.id`, message: `expected 1 to 40 lower case letters, digits or hyphens, got ${describe(entry.id)}` });
      else if (seen.has(id)) problems.push({ path: `${path}.id`, message: `expected a unique id, but ${describe(id)} is used twice` });
      else seen.add(id);
      const name = typeof entry.name === 'string' && entry.name.trim() !== '' && entry.name.length <= 60 ? entry.name.trim() : null;
      if (name === null) problems.push({ path: `${path}.name`, message: `expected text of 1 to 60 characters, got ${describe(entry.name)}` });
      const target = typeof entry.serviceTarget === 'string' && entry.serviceTarget.length <= 60 ? entry.serviceTarget.trim() : null;
      if (target === null) problems.push({ path: `${path}.serviceTarget`, message: `expected text of up to 60 characters, got ${describe(entry.serviceTarget)}` });
      const config = readNumbers(entry.config, [...BREAKER_SETTING_KEYS, 'bulkheadMaxConcurrent', 'bulkheadMaxWaitMs'], `${path}.config`, problems);
      if (problems.length === before && id && name && target !== null && config) {
        circuits.push({ id, name, serviceTarget: target, config: config as unknown as CircuitConfig });
      }
    });
  }

  let tuning: Tuning | null = null;
  if (!isRecord(value.tuning)) {
    problems.push({ path: 'tuning', message: `expected an object with timeline, a and b, got ${describe(value.tuning)}` });
  } else {
    const before = problems.length;
    const known = ['workspace', ...SAMPLE_INCIDENTS.map((incident) => incident.id)];
    const timeline = typeof value.tuning.timeline === 'string' && known.includes(value.tuning.timeline) ? value.tuning.timeline : null;
    if (timeline === null) problems.push({ path: 'tuning.timeline', message: `expected one of ${known.map((id) => `"${id}"`).join(', ')}, got ${describe(value.tuning.timeline)}` });
    const a = readSet(value.tuning.a, 'tuning.a', problems);
    const b = value.tuning.b === null ? null : readSet(value.tuning.b, 'tuning.b', problems);
    if (problems.length === before && timeline && a) tuning = { timeline, a, b };
  }

  if (problems.length > 0 || !tuning) return { ok: false, problems };
  return { ok: true, data: { circuits, tuning } };
}

export function formatFileProblem(fileName: string, problem: FileProblem): string {
  return `${fileName}, ${problem.path}: ${problem.message}`;
}

/** Reads the text of a workspace file. A file that is not JSON gets one clear message. */
export function parseWorkspaceText(text: string): WorkspaceParse {
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    return { ok: false, problems: [{ path: '(file)', message: `not valid JSON (${reason})` }] };
  }
  return parseWorkspaceValue(value);
}
