export type WorkspaceMode = 'sample' | 'workspace';

const DATABASE_NAME = 'circuitshield-local';
const DATABASE_VERSION = 1;
const STORE_NAME = 'settings';
const WORKSPACE_KEY = 'workspace';
/** The imported incident timeline is kept under its own key, so editing settings never rewrites it. */
export const INCIDENT_KEY = 'incident';
const MODE_KEY = 'mode';
const CHANNEL_NAME = 'circuitshield-workspace';

/** The saved workspace exists but cannot be used, as opposed to browser storage failing to open. */
export class SavedWorkspaceError extends Error {}

/** The workspace was saved by another tab after this tab read it, so this write was refused. */
export class WorkspaceConflictError extends Error {}

/**
 * What is stored under the workspace key. `revision` goes up by one on every
 * write, including a clear, so a tab can tell that the record changed after
 * it read it. `data` is null once the workspace has been cleared.
 */
interface WorkspaceRecord<T> {
  version: 1;
  revision: number;
  data: T | null;
}

export interface LoadedWorkspace<T> {
  data: T;
  revision: number;
}

type Migration = (database: IDBDatabase, transaction: IDBTransaction) => void;

// Add one migration per database version. IndexedDB applies the whole upgrade
// transaction atomically, preserving existing workspace records on failure.
const migrations: Record<number, Migration> = {
  1: (database) => {
    database.createObjectStore(STORE_NAME);
  },
};

let databasePromise: Promise<IDBDatabase> | undefined;
let operations: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (!transaction) return;
      for (let version = event.oldVersion + 1; version <= DATABASE_VERSION; version += 1) {
        migrations[version]?.(request.result, transaction);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Browser storage could not open.'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other CircuitShield tabs to update browser storage.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      database.onclose = () => { databasePromise = undefined; };
      resolve(database);
    };
  }).catch((error: unknown) => {
    databasePromise = undefined;
    throw error;
  });

  return databasePromise;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.then(() => undefined, () => undefined);
  return result;
}

function storageError(transaction: IDBTransaction, request: IDBRequest | undefined, message: string): DOMException | Error {
  return transaction.error ?? (request?.readyState === 'done' ? request.error : null) ?? new Error(message);
}

async function readRecord<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    let value: T | undefined;
    request.onsuccess = () => { value = request.result as T | undefined; };
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(storageError(transaction, request, 'Browser storage read failed.'));
    transaction.onerror = () => reject(storageError(transaction, request, 'Browser storage read failed.'));
  });
}

async function writeMode(mode: WorkspaceMode): Promise<void> {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    let request: IDBRequest | undefined;
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageError(transaction, request, 'Browser storage write failed.'));
    transaction.onerror = () => reject(storageError(transaction, request, 'Browser storage write failed.'));
    try {
      request = transaction.objectStore(STORE_NAME).put(mode, MODE_KEY);
    } catch (error: unknown) {
      transaction.abort();
      reject(error);
    }
  });
}

interface WriteOptions {
  /** Which saved record to write. Defaults to the workspace record. */
  key?: string;
  mode?: WorkspaceMode;
  /** The revision this tab last read. The write is refused when the stored revision is different. */
  expectedRevision?: number;
}

/** Reads the current revision and writes the next one in one transaction, so two tabs cannot both win. */
async function writeWorkspaceRecord<T>(data: T | null, options: WriteOptions): Promise<number> {
  const key = options.key ?? WORKSPACE_KEY;
  const database = await openDatabase();
  return new Promise<number>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let request: IDBRequest | undefined;
    let nextRevision = 0;
    let conflict = false;
    transaction.oncomplete = () => resolve(nextRevision);
    transaction.onabort = () => {
      reject(conflict
        ? new WorkspaceConflictError('The workspace was changed in another tab, so this change was not saved. The latest saved version is shown.')
        : storageError(transaction, request, 'Browser storage write failed.'));
    };
    transaction.onerror = () => reject(storageError(transaction, request, 'Browser storage write failed.'));
    try {
      request = store.get(key);
      const read = request;
      read.onsuccess = () => {
        const current = read.result as WorkspaceRecord<unknown> | undefined;
        const currentRevision = current && typeof current.revision === 'number' ? current.revision : 0;
        if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
          conflict = true;
          transaction.abort();
          return;
        }
        nextRevision = currentRevision + 1;
        const record: WorkspaceRecord<T> = { version: 1, revision: nextRevision, data };
        request = store.put(record, key);
        if (options.mode) store.put(options.mode, MODE_KEY);
      };
    } catch (error: unknown) {
      transaction.abort();
      reject(error);
    }
  });
}

/** Tells this page's own messages apart from another tab's, since a page also hears what it posts. */
const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function notifyOtherTabs(revision: number, key: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ revision, key, source: PAGE_ID });
    channel.close();
  } catch {
    // Other tabs then see the change the next time they read the workspace.
  }
}

/** Calls the listener when another tab saves the workspace. Returns a function that stops listening. */
export function subscribeToOtherTabs(listener: (key: string) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<{ key?: string; source?: string }>) => {
    if (event.data?.source === PAGE_ID) return;
    listener(event.data?.key ?? WORKSPACE_KEY);
  };
  return () => channel.close();
}

export function loadWorkspace<T>(key: string = WORKSPACE_KEY): Promise<LoadedWorkspace<T> | null> {
  return serialize(async () => {
    const record = await readRecord<WorkspaceRecord<T>>(key);
    if (record === undefined) return null;
    if (
      !record || typeof record !== 'object' || record.version !== 1
      || typeof record.revision !== 'number' || !Object.hasOwn(record, 'data')
    ) {
      throw new SavedWorkspaceError('The saved workspace in this browser has an unsupported format. Clear it to start again, or import a workspace file to replace it.');
    }
    return record.data === null ? null : { data: record.data, revision: record.revision };
  });
}

/** Saves the workspace and returns its new revision. Pass `expectedRevision` to refuse the write if another tab saved in between. */
export function saveWorkspace<T>(data: T, options: WriteOptions = {}): Promise<number> {
  // Capture the call's value before it waits behind an earlier write.
  try {
    const snapshot = structuredClone(data);
    return serialize(async () => {
      const revision = await writeWorkspaceRecord(snapshot, options);
      notifyOtherTabs(revision, options.key ?? WORKSPACE_KEY);
      return revision;
    });
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}

/** Empties the workspace. The revision keeps counting, so a tab holding an older revision is still refused. */
export function clearWorkspace(options: Pick<WriteOptions, 'expectedRevision' | 'key'> = {}): Promise<number> {
  return serialize(async () => {
    const revision = await writeWorkspaceRecord<never>(null, options);
    notifyOtherTabs(revision, options.key ?? WORKSPACE_KEY);
    return revision;
  });
}

export function loadMode(): Promise<WorkspaceMode> {
  return serialize(async () => {
    const mode = await readRecord<WorkspaceMode>(MODE_KEY);
    return mode === 'workspace' ? 'workspace' : 'sample';
  });
}

export function saveMode(mode: WorkspaceMode): Promise<void> {
  return serialize(() => writeMode(mode));
}
