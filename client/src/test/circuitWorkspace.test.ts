// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineFromCalls, OUTCOME_ERROR, OUTCOME_OK } from '../../../shared/replay.js';
import type { ParsedIncident } from '../local/incidentFile.js';
import { newCircuitConfig } from '../local/workspaceFile.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});

function parsed(): ParsedIncident {
  return {
    fileName: 'checkout.csv',
    format: 'calls',
    timeline: timelineFromCalls([
      { t: 1_700_000_000_000, outcome: OUTCOME_OK, latencyMs: 40 },
      { t: 1_700_000_001_000, outcome: OUTCOME_ERROR, latencyMs: 900 },
    ]),
    rows: 2,
    skipped: [],
    skippedCount: 0,
    sorted: false,
    hasLatency: true,
    assumedLastIntervalMs: null,
  };
}

const circuit = { id: 'checkout', name: 'Checkout', serviceTarget: 'checkout-api', config: newCircuitConfig() };

describe('workspace state', () => {
  it('starts in sample mode with the default thresholds and nothing saved', async () => {
    const store = await import('../local/circuitWorkspace.js');
    await store.initializeWorkspace();
    const state = store.workspaceState();
    expect(state).toMatchObject({ ready: true, mode: 'sample', data: null, incident: null, unbacked: false });
    expect(store.activeTuning().a.label).toBe('Current');
  });

  it('keeps sample-mode tuning in memory and never writes it to the workspace', async () => {
    const store = await import('../local/circuitWorkspace.js');
    await store.initializeWorkspace();
    await store.updateTuning((tuning) => ({ ...tuning, a: { ...tuning.a, label: 'Mine' } }));
    expect(store.activeTuning().a.label).toBe('Mine');
    expect(store.workspaceState().data).toBeNull();
    const storage = await import('../local/workspace.js');
    expect(await storage.loadWorkspace()).toBeNull();
  });

  it('resets the sample tuning without touching a saved workspace', async () => {
    const store = await import('../local/circuitWorkspace.js');
    await store.initializeWorkspace();
    await store.upsertCircuit(circuit);
    await store.updateTuning((tuning) => ({ ...tuning, a: { ...tuning.a, label: 'Workspace set' } }));
    await store.chooseWorkspaceMode('sample');
    await store.updateTuning((tuning) => ({ ...tuning, a: { ...tuning.a, label: 'Sample set' } }));
    store.resetSampleTuning();
    expect(store.activeTuning().a.label).toBe('Current');
    await store.chooseWorkspaceMode('workspace');
    expect(store.activeTuning().a.label).toBe('Workspace set');
    expect(store.workspaceState().data?.circuits).toHaveLength(1);
  });

  it('saves circuits and tuning and finds them again after a reload', async () => {
    let store = await import('../local/circuitWorkspace.js');
    await store.initializeWorkspace();
    await store.upsertCircuit(circuit);
    await store.upsertCircuit({ ...circuit, name: 'Checkout API' });
    await store.updateTuning((tuning) => ({ ...tuning, b: { label: 'Candidate', settings: { ...tuning.a.settings, resetTimeoutMs: 9000 } } }));
    expect(store.workspaceState().data?.circuits.map((entry) => entry.name)).toEqual(['Checkout API']);

    vi.resetModules();
    store = await import('../local/circuitWorkspace.js');
    await store.initializeWorkspace();
    const state = store.workspaceState();
    expect(state.mode).toBe('workspace');
    expect(state.data?.circuits).toHaveLength(1);
    expect(state.data?.tuning.b?.settings.resetTimeoutMs).toBe(9000);
    expect(state.unbacked).toBe(true);

    await store.removeCircuit('checkout');
    expect(store.workspaceState().data?.circuits).toEqual([]);
  });

  it('saves many quick changes in order without refusing any of them', async () => {
    const store = await import('../local/circuitWorkspace.js');
    await store.initializeWorkspace();
    await store.upsertCircuit(circuit);
    const edits = Array.from({ length: 12 }, (_, index) =>
      store.updateTuning((tuning) => ({ ...tuning, a: { ...tuning.a, settings: { ...tuning.a.settings, resetTimeoutMs: 1000 + index } } }))
    );
    await Promise.all(edits);
    expect(store.activeTuning().a.settings.resetTimeoutMs).toBe(1011);
  });

  it('saves an imported timeline separately and selects it, and editing settings leaves it alone', async () => {
    const store = await import('../local/circuitWorkspace.js');
    const storage = await import('../local/workspace.js');
    await store.initializeWorkspace();
    await store.replaceIncident(parsed());
    expect(store.workspaceState().mode).toBe('workspace');
    expect(store.activeTuning().timeline).toBe('workspace');
    const saved = await storage.loadWorkspace(storage.INCIDENT_KEY);
    expect(saved?.revision).toBe(1);

    await store.updateTuning((tuning) => ({ ...tuning, a: { ...tuning.a, label: 'Tighter' } }));
    expect((await storage.loadWorkspace(storage.INCIDENT_KEY))?.revision).toBe(1);

    vi.resetModules();
    const again = await import('../local/circuitWorkspace.js');
    await again.initializeWorkspace();
    const incident = again.workspaceState().incident;
    expect(incident?.fileName).toBe('checkout.csv');
    expect(Array.from(incident?.timeline.t ?? [])).toEqual([1_700_000_000_000, 1_700_000_001_000]);
    expect(Array.from(incident?.timeline.outcome ?? [])).toEqual([OUTCOME_OK, OUTCOME_ERROR]);
  });

  it('replaces the whole workspace from an imported file and treats it as backed up', async () => {
    const store = await import('../local/circuitWorkspace.js');
    const files = await import('../local/workspaceFile.js');
    await store.initializeWorkspace();
    await store.upsertCircuit(circuit);
    const data = { circuits: [{ ...circuit, id: 'other', name: 'Other' }], tuning: files.defaultTuning() };
    await store.replaceWorkspaceData(data);
    expect(store.workspaceState().data?.circuits.map((entry) => entry.id)).toEqual(['other']);
    expect(store.workspaceState().unbacked).toBe(false);
    await store.removeCircuit('other');
    expect(store.workspaceState().unbacked).toBe(true);
    await store.markBackedUp();
    expect(store.workspaceState().unbacked).toBe(false);
  });

  it('can clear a workspace that cannot be read, after reporting why', async () => {
    const storage = await import('../local/workspace.js');
    await storage.saveWorkspace({ version: 1, data: { circuits: 'not a list' }, backup: null });
    const store = await import('../local/circuitWorkspace.js');
    await expect(store.initializeWorkspace()).rejects.toThrow(/cannot be read.*circuits/);
    await store.removeWorkspace();
    expect(store.workspaceState()).toMatchObject({ data: null, incident: null });
    await store.initializeWorkspace();
    expect(store.workspaceState().ready).toBe(true);
  });

  it('reports a damaged saved timeline and can clear it', async () => {
    const storage = await import('../local/workspace.js');
    await storage.saveWorkspace({ version: 1, fileName: 'x.csv', timeline: { t: [1] } }, { key: storage.INCIDENT_KEY });
    const store = await import('../local/circuitWorkspace.js');
    await expect(store.initializeWorkspace()).rejects.toThrow(/timeline is damaged/);
    await store.removeWorkspace();
    await store.initializeWorkspace();
    expect(store.workspaceState().incident).toBeNull();
  });

  it('picks up a change saved by another tab and says so', async () => {
    const store = await import('../local/circuitWorkspace.js');
    const storage = await import('../local/workspace.js');
    const files = await import('../local/workspaceFile.js');
    await store.initializeWorkspace();
    await storage.saveWorkspace(
      { version: 1, data: { circuits: [circuit], tuning: files.defaultTuning() }, backup: null },
      { mode: 'workspace' }
    );
    await vi.waitFor(() => expect(store.workspaceState().data?.circuits).toHaveLength(1));
    expect(store.workspaceState().notice).toMatch(/another tab/i);
    store.dismissNotice();
    expect(store.workspaceState().notice).toBe('');
    store.stopWorkspaceListening();
  });

  it('refuses a stale save from this tab and shows what the other tab saved', async () => {
    const store = await import('../local/circuitWorkspace.js');
    const storage = await import('../local/workspace.js');
    const files = await import('../local/workspaceFile.js');
    await store.initializeWorkspace();
    await store.upsertCircuit(circuit);
    // Another tab saves a newer revision while this one still holds the old one.
    await storage.saveWorkspace(
      { version: 1, data: { circuits: [{ ...circuit, name: 'From the other tab' }], tuning: files.defaultTuning() }, backup: null },
      { mode: 'workspace' }
    );
    store.stopWorkspaceListening();
    await expect(store.upsertCircuit({ ...circuit, name: 'Stale edit' })).rejects.toBeInstanceOf(storage.WorkspaceConflictError);
    expect(store.workspaceState().data?.circuits[0].name).toBe('From the other tab');
  });
});
