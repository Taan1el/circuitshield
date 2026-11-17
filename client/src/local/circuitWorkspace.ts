import type { Timeline } from '../../../shared/replay.js';
import {
  clearWorkspace,
  INCIDENT_KEY,
  loadMode,
  loadWorkspace,
  saveMode,
  saveWorkspace,
  SavedWorkspaceError,
  subscribeToOtherTabs,
  WorkspaceConflictError,
  type WorkspaceMode,
} from './workspace.js';
import type { IncidentFormat, ParsedIncident } from './incidentFile.js';
import {
  defaultTuning,
  emptyWorkspaceData,
  equalWorkspaceData,
  parseWorkspaceValue,
  type CircuitSpec,
  type Tuning,
  type WorkspaceData,
} from './workspaceFile.js';

export type { WorkspaceMode } from './workspace.js';

/** The saved shape of the workspace: the data, and the baseline last written to a file. */
interface StoredWorkspace {
  version: 1;
  data: unknown;
  backup: unknown;
}

/** The imported incident, saved on its own so changing a setting never rewrites the timeline. */
export interface StoredIncident {
  version: 1;
  fileName: string;
  format: IncidentFormat;
  rows: number;
  skippedCount: number;
  hasLatency: boolean;
  timeline: Timeline;
}

export interface WorkspaceState {
  ready: boolean;
  mode: WorkspaceMode;
  /** The saved workspace. Null until the first change, import or incident. */
  data: WorkspaceData | null;
  backup: WorkspaceData | null;
  incident: StoredIncident | null;
  /** True while the saved workspace differs from the last file written. */
  unbacked: boolean;
  /** Sample-mode tuning. It lives in memory only and is reset with the sample data. */
  sampleTuning: Tuning;
  /** Set when another tab saved and this tab picked up the change. */
  notice: string;
}

let state: WorkspaceState = {
  ready: false,
  mode: 'sample',
  data: null,
  backup: null,
  incident: null,
  unbacked: false,
  sampleTuning: defaultTuning(),
  notice: '',
};
let revision = 0;
let incidentRevision = 0;
let ready: Promise<void> | undefined;
let stopListening: (() => void) | undefined;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A new object whenever anything changes, so it can be used with useSyncExternalStore. */
export function workspaceState(): WorkspaceState {
  return state;
}

function publish(patch: Partial<WorkspaceState>): void {
  const next = { ...state, ...patch };
  next.unbacked = next.data !== null && !equalWorkspaceData(next.data, next.backup ?? emptyWorkspaceData());
  state = next;
  listeners.forEach((listener) => listener());
}

/** Runs changes one after another, so each save starts from the revision the last one produced. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function unreadable(detail: string): SavedWorkspaceError {
  return new SavedWorkspaceError(`The saved workspace in this browser cannot be read (${detail}). Clear it to start again, or import a workspace file to replace it.`);
}

function restoreData(value: unknown, label: string): WorkspaceData {
  // The saved record is held to the same rules as an imported file.
  const result = parseWorkspaceValue(isObject(value) ? { format: 'circuitshield-workspace', version: 1, ...value } : value);
  if (!result.ok) throw unreadable(`${label} ${result.problems[0].path}: ${result.problems[0].message}`);
  return result.data;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function restoreIncident(saved: StoredIncident): StoredIncident {
  const timeline = saved?.timeline;
  const valid =
    saved && saved.version === 1 && typeof saved.fileName === 'string' && timeline &&
    timeline.t instanceof Float64Array && timeline.outcome instanceof Uint8Array && timeline.latencyMs instanceof Float64Array &&
    timeline.t.length === timeline.outcome.length && timeline.t.length === timeline.latencyMs.length && timeline.t.length > 0;
  if (!valid) throw unreadable('the saved incident timeline is damaged');
  return saved;
}

async function readAll(): Promise<void> {
  const [mode, saved, savedIncident] = await Promise.all([
    loadMode(),
    loadWorkspace<StoredWorkspace>(),
    loadWorkspace<StoredIncident>(INCIDENT_KEY),
  ]);
  let data: WorkspaceData | null = null;
  let backup: WorkspaceData | null = null;
  if (saved) {
    if (!saved.data || saved.data.version !== 1) {
      throw new SavedWorkspaceError('The saved workspace in this browser has an unsupported format. Clear it to start again, or import a workspace file to replace it.');
    }
    data = restoreData(saved.data.data, 'data');
    backup = saved.data.backup === null || saved.data.backup === undefined ? null : restoreData(saved.data.backup, 'backup');
  }
  const incident = savedIncident ? restoreIncident(savedIncident.data) : null;
  revision = saved?.revision ?? 0;
  incidentRevision = savedIncident?.revision ?? 0;
  publish({ ready: true, mode, data, backup, incident });
}

/** Another tab saved: take its version. Edits made here are already saved, so none are lost. */
async function followOtherTab(): Promise<void> {
  try {
    const before = `${revision}/${incidentRevision}`;
    await readAll();
    if (`${revision}/${incidentRevision}` !== before) {
      publish({ notice: 'Another tab changed this workspace. This tab now shows the latest saved version.' });
    }
  } catch {
    // The next explicit read reports the problem.
  }
}

export function initializeWorkspace(): Promise<void> {
  ready ??= (async () => {
    await readAll();
    stopListening ??= subscribeToOtherTabs(() => { void followOtherTab(); });
  })().catch((error: unknown) => { ready = undefined; throw error; });
  return ready;
}

export function dismissNotice(): void {
  if (state.notice) publish({ notice: '' });
}

export async function chooseWorkspaceMode(next: WorkspaceMode): Promise<void> {
  await initializeWorkspace();
  await saveMode(next);
  publish({ mode: next, notice: '' });
}

/** The tuning in use: the workspace's in workspace mode, the in-memory one in sample mode. */
export function activeTuning(from: WorkspaceState = state): Tuning {
  return from.mode === 'workspace' ? (from.data?.tuning ?? emptyWorkspaceData().tuning) : from.sampleTuning;
}

async function conflictFallback(error: unknown): Promise<never> {
  if (error instanceof WorkspaceConflictError) {
    try { await readAll(); } catch { /* the error below is the one to show */ }
  }
  throw error;
}

async function persist(data: WorkspaceData, backup: WorkspaceData | null, mode?: WorkspaceMode): Promise<void> {
  const stored: StoredWorkspace = { version: 1, data, backup };
  try {
    revision = await saveWorkspace(stored, { expectedRevision: revision, mode });
  } catch (error) {
    return conflictFallback(error);
  }
  publish({ data, backup, ...(mode ? { mode } : {}) });
}

/** Applies a change to the tuning in use. In the workspace it is saved. In sample mode it stays in memory. */
export function updateTuning(change: (current: Tuning) => Tuning): Promise<void> {
  return enqueue(async () => {
    if (state.mode !== 'workspace') {
      publish({ sampleTuning: change(state.sampleTuning) });
      return;
    }
    await initializeWorkspace();
    const current = state.data ?? emptyWorkspaceData();
    await persist({ ...current, tuning: change(current.tuning) }, state.backup);
  });
}

/** Adds a circuit, or replaces the one with the same id, and saves it. */
export function upsertCircuit(circuit: CircuitSpec): Promise<void> {
  return enqueue(async () => {
    await initializeWorkspace();
    const current = state.data ?? emptyWorkspaceData();
    const exists = current.circuits.some((entry) => entry.id === circuit.id);
    const circuits = exists ? current.circuits.map((entry) => (entry.id === circuit.id ? circuit : entry)) : [...current.circuits, circuit];
    await persist({ ...current, circuits }, state.backup, 'workspace');
  });
}

export function removeCircuit(id: string): Promise<void> {
  return enqueue(async () => {
    await initializeWorkspace();
    const current = state.data;
    if (!current) return;
    await persist({ ...current, circuits: current.circuits.filter((entry) => entry.id !== id) }, state.backup);
  });
}

/** Replaces the whole workspace with an imported file. `data` also becomes the backup baseline. */
export function replaceWorkspaceData(data: WorkspaceData): Promise<void> {
  return enqueue(async () => {
    // An explicit import can replace an unreadable saved workspace.
    await initializeWorkspace().catch(() => undefined);
    revision = await saveWorkspace({ version: 1, data, backup: data } satisfies StoredWorkspace, { mode: 'workspace' });
    ready = Promise.resolve();
    publish({ ready: true, mode: 'workspace', data, backup: data, notice: '' });
  });
}

/** Saves an imported incident as the workspace timeline and selects it. */
export function replaceIncident(parsed: ParsedIncident): Promise<void> {
  return enqueue(async () => {
    await initializeWorkspace().catch(() => undefined);
    const incident: StoredIncident = {
      version: 1,
      fileName: parsed.fileName,
      format: parsed.format,
      rows: parsed.rows,
      skippedCount: parsed.skippedCount,
      hasLatency: parsed.hasLatency,
      timeline: parsed.timeline,
    };
    incidentRevision = await saveWorkspace(incident, { key: INCIDENT_KEY, mode: 'workspace' });
    ready = Promise.resolve();
    publish({ ready: true, mode: 'workspace', incident, notice: '' });
    const current = state.data ?? emptyWorkspaceData();
    await persist({ ...current, tuning: { ...current.tuning, timeline: 'workspace' } }, state.backup, 'workspace');
  });
}

/** Records that the current workspace was written to a file, so the backup reminder goes away. */
export function markBackedUp(): Promise<void> {
  return enqueue(async () => {
    await initializeWorkspace();
    const current = state.data;
    if (!current) return;
    await persist(current, current);
  });
}

/** Clears the workspace and its incident. An unreadable workspace can still be cleared. */
export function removeWorkspace(): Promise<void> {
  return enqueue(async () => {
    await initializeWorkspace().catch(() => undefined);
    revision = await clearWorkspace();
    incidentRevision = await clearWorkspace({ key: INCIDENT_KEY });
    ready = Promise.resolve();
    publish({ ready: true, data: null, backup: null, incident: null, notice: '' });
  });
}

/** Puts the sample tuning back to its starting values. The saved workspace is never touched. */
export function resetSampleTuning(): void {
  publish({ sampleTuning: defaultTuning() });
}

/** Test helper: stops listening to other tabs. */
export function stopWorkspaceListening(): void {
  stopListening?.();
  stopListening = undefined;
}
