// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});

describe('browser workspace storage', () => {
  it('starts in sample mode with no workspace', async () => {
    const storage = await import('../local/workspace.js');
    expect(await storage.loadWorkspace()).toBeNull();
    expect(await storage.loadMode()).toBe('sample');
  });

  it('persists the workspace, its revision and the mode across a module reload', async () => {
    let storage = await import('../local/workspace.js');
    const data = { roles: [{ name: 'admin' }], members: [] };
    const revision = await storage.saveWorkspace(data, { mode: 'workspace' });
    expect(revision).toBe(1);
    vi.resetModules();
    storage = await import('../local/workspace.js');
    expect(await storage.loadWorkspace<typeof data>()).toEqual({ data, revision: 1 });
    expect(await storage.loadMode()).toBe('workspace');
  });

  it('counts revisions up on every write, including a clear, and never reuses one', async () => {
    const storage = await import('../local/workspace.js');
    expect(await storage.saveWorkspace({ n: 1 })).toBe(1);
    expect(await storage.saveWorkspace({ n: 2 })).toBe(2);
    expect(await storage.clearWorkspace()).toBe(3);
    expect(await storage.loadWorkspace()).toBeNull();
    expect(await storage.saveWorkspace({ n: 4 })).toBe(4);
  });

  it('refuses a write made from an older revision and keeps what is stored', async () => {
    const storage = await import('../local/workspace.js');
    const first = await storage.saveWorkspace({ who: 'this tab' });
    // Another tab saves after this tab read revision 1.
    await storage.saveWorkspace({ who: 'other tab' }, { expectedRevision: first });
    await expect(storage.saveWorkspace({ who: 'stale' }, { expectedRevision: first })).rejects.toBeInstanceOf(storage.WorkspaceConflictError);
    await expect(storage.clearWorkspace({ expectedRevision: first })).rejects.toBeInstanceOf(storage.WorkspaceConflictError);
    expect(await storage.loadWorkspace()).toEqual({ data: { who: 'other tab' }, revision: 2 });
    expect(await storage.saveWorkspace({ who: 'current' }, { expectedRevision: 2 })).toBe(3);
  });

  it('keeps the mode independent from the workspace data', async () => {
    const storage = await import('../local/workspace.js');
    await storage.saveWorkspace({ rows: [1, 2] }, { mode: 'workspace' });
    await storage.saveMode('sample');
    expect((await storage.loadWorkspace())?.data).toEqual({ rows: [1, 2] });
    await storage.clearWorkspace();
    expect(await storage.loadMode()).toBe('sample');
  });

  it('orders overlapping writes and snapshots input at the call', async () => {
    const storage = await import('../local/workspace.js');
    const firstData = { rows: [1] };
    const firstWrite = storage.saveWorkspace(firstData);
    firstData.rows.push(99);
    const secondWrite = storage.saveWorkspace({ rows: [2] });
    const clear = storage.clearWorkspace();
    const lastWrite = storage.saveWorkspace({ rows: [3] });
    expect(await Promise.all([firstWrite, secondWrite, clear, lastWrite])).toEqual([1, 2, 3, 4]);
    expect((await storage.loadWorkspace())?.data).toEqual({ rows: [3] });
  });

  it('reports a saved record in an unknown format instead of using it', async () => {
    const storage = await import('../local/workspace.js');
    await storage.saveWorkspace({ rows: [] });
    // Overwrite the record by hand with something this version does not know.
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('circuitshield-local', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put({ version: 9, data: {} }, 'workspace');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    await expect(storage.loadWorkspace()).rejects.toBeInstanceOf(storage.SavedWorkspaceError);
    await expect(storage.loadWorkspace()).rejects.toThrow(/unsupported format/);
  });

  it('tells other tabs when the workspace is saved, and stops when unsubscribed', async () => {
    const storage = await import('../local/workspace.js');
    const heard = vi.fn();
    const stop = storage.subscribeToOtherTabs(heard);
    await storage.saveWorkspace({ rows: [1] });
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    stop();
    await storage.saveWorkspace({ rows: [2] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('keeps separate records under their own keys, each with its own revision', async () => {
    const storage = await import('../local/workspace.js');
    expect(await storage.saveWorkspace({ settings: 1 })).toBe(1);
    expect(await storage.saveWorkspace({ big: [1, 2, 3] }, { key: storage.INCIDENT_KEY })).toBe(1);
    expect(await storage.saveWorkspace({ settings: 2 })).toBe(2);
    expect(await storage.loadWorkspace()).toEqual({ data: { settings: 2 }, revision: 2 });
    expect(await storage.loadWorkspace(storage.INCIDENT_KEY)).toEqual({ data: { big: [1, 2, 3] }, revision: 1 });
    // A stale write to one record is refused on its own revision, not the other record's.
    await expect(storage.saveWorkspace({ settings: 3 }, { expectedRevision: 1 })).rejects.toBeInstanceOf(storage.WorkspaceConflictError);
    expect(await storage.saveWorkspace({ big: [] }, { key: storage.INCIDENT_KEY, expectedRevision: 1 })).toBe(2);
    await storage.clearWorkspace({ key: storage.INCIDENT_KEY });
    expect(await storage.loadWorkspace(storage.INCIDENT_KEY)).toBeNull();
    expect((await storage.loadWorkspace())?.data).toEqual({ settings: 2 });
  });

  it('stores typed arrays as they are', async () => {
    const storage = await import('../local/workspace.js');
    await storage.saveWorkspace({ t: new Float64Array([1, 2.5]), outcome: new Uint8Array([0, 2]) }, { key: storage.INCIDENT_KEY });
    const loaded = await storage.loadWorkspace<{ t: Float64Array; outcome: Uint8Array }>(storage.INCIDENT_KEY);
    expect(loaded?.data.t).toBeInstanceOf(Float64Array);
    expect(Array.from(loaded?.data.t ?? [])).toEqual([1, 2.5]);
    expect(Array.from(loaded?.data.outcome ?? [])).toEqual([0, 2]);
  });
});
