import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { downloadFile, readFileText } from '../local/files.js';
import {
  chooseWorkspaceMode,
  dismissNotice,
  initializeWorkspace,
  markBackedUp,
  removeWorkspace,
  replaceWorkspaceData,
  subscribeWorkspace,
  workspaceState,
  type WorkspaceMode,
} from '../local/circuitWorkspace.js';
import {
  emptyWorkspaceData,
  formatFileProblem,
  parseWorkspaceText,
  serializeWorkspace,
  WORKSPACE_LIMITS,
  type FileProblem,
  type WorkspaceData,
} from '../local/workspaceFile.js';
import { pluralize } from '../utils/pluralize.js';
import { ConfirmDialog, Dialog } from './Dialog.js';

function counts(data: WorkspaceData): string {
  return `${data.circuits.length} ${pluralize(data.circuits.length, 'circuit')} and ${data.tuning.b ? 'two' : 'one'} ${data.tuning.b ? 'threshold sets' : 'threshold set'}`;
}

interface ImportDialogProps {
  saved: WorkspaceData | null;
  onClose: () => void;
  onImported: (data: WorkspaceData) => void;
}

/** Reads a workspace file, checks it, and says what it will replace before anything is saved. */
const ImportDialog: React.FC<ImportDialogProps> = ({ saved, onClose, onImported }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [problems, setProblems] = useState<FileProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async (file: File | undefined) => {
    setData(null);
    setProblems([]);
    setError('');
    setFileName(file?.name ?? '');
    if (!file) return;
    if (file.size > WORKSPACE_LIMITS.fileBytes) {
      setProblems([{ path: '(file)', message: `expected a file of at most ${WORKSPACE_LIMITS.fileBytes / (1024 * 1024)} MB, got ${(file.size / (1024 * 1024)).toFixed(1)} MB` }]);
      return;
    }
    const result = parseWorkspaceText(await readFileText(file));
    if (result.ok) setData(result.data);
    else setProblems(result.problems);
  };

  const confirm = async () => {
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      await replaceWorkspaceData(data);
      onImported(data);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The workspace could not be saved. Your current workspace was kept.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Import a workspace file"
      onClose={onClose}
      initialFocusRef={fileRef}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={!data || busy}>
            {busy ? 'Saving' : saved ? 'Replace workspace' : 'Import into workspace'}
          </button>
        </>
      }
    >
      <p>
        Choose a workspace file exported from this page, up to {WORKSPACE_LIMITS.fileBytes / (1024 * 1024)} MB. It is checked
        completely before anything is saved. The incident timeline is not part of the file; import it again from your CSV.
      </p>
      <div className="field">
        <label className="field-label" htmlFor="import-workspace-file">Workspace file</label>
        <input
          id="import-workspace-file"
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="file-plain"
          disabled={busy}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
      <div role="status">
        {data && (
          <p>
            <strong>{fileName}</strong> is valid: {counts(data)}.{' '}
            {saved
              ? `Importing replaces your saved workspace (${counts(saved)}) with these. Export a backup first if you need the old one.`
              : 'Importing creates your workspace from it.'}
          </p>
        )}
      </div>
      {problems.length > 0 && (
        <div role="alert" className="problem-box">
          <p><strong>{fileName} cannot be used.</strong> Nothing was changed.</p>
          <ul className="problem-list">
            {problems.slice(0, 20).map((problem) => <li key={`${problem.path}-${problem.message}`}>{formatFileProblem(fileName, problem)}</li>)}
          </ul>
          {problems.length > 20 && <p className="field-help">{problems.length - 20} more problems follow. Fix these first.</p>}
        </div>
      )}
      {error && <p role="alert" className="inline-error">{error}</p>}
    </Dialog>
  );
};

/** Switch between sample data and your own workspace, and import, export or clear the workspace. */
export const WorkspaceBar: React.FC = () => {
  const state = useSyncExternalStore(subscribeWorkspace, workspaceState, workspaceState);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    initializeWorkspace().catch((reason: unknown) => {
      setLoadFailed(true);
      setError(reason instanceof Error ? reason.message : 'Browser storage is unavailable. Check storage permissions and keep exported backups.');
    });
  }, []);

  const inWorkspace = state.mode === 'workspace';
  const hasSaved = state.data !== null || state.incident !== null;

  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The operation failed. Your data was kept.');
    } finally {
      setBusy(false);
    }
  };

  const exportWorkspace = () =>
    run(async () => {
      const data = state.data ?? emptyWorkspaceData();
      downloadFile('circuitshield-workspace.json', serializeWorkspace(data), 'application/json');
      await markBackedUp();
      setFlash(`Exported ${counts(data)} to circuitshield-workspace.json.`);
    });

  return (
    <section className="workspace-bar" aria-label="Workspace">
      <div className="workspace-inner">
        <div className="workspace-controls">
          <div className="field workspace-mode">
            <label className="field-label" htmlFor="workspace-data-source">Data source</label>
            <select
              id="workspace-data-source"
              value={state.mode}
              disabled={busy}
              onChange={(event) => void run(() => chooseWorkspaceMode(event.target.value as WorkspaceMode))}
            >
              <option value="sample">Sample data</option>
              <option value="workspace">Your workspace</option>
            </select>
          </div>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setError(''); setFlash(''); setImporting(true); }}>
            <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
            Import workspace
          </button>
          {inWorkspace && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void exportWorkspace()}>
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              Export workspace
            </button>
          )}
          {(hasSaved || loadFailed) && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setClearing(true)}>
              <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
              Clear workspace
            </button>
          )}
        </div>

        <p className="workspace-note">
          Your data stays in this browser: nothing is uploaded. The workspace holds your circuits, your threshold sets and the imported timeline.
        </p>
        <div role="status" className="workspace-status">
          {flash && <p className="workspace-note">{flash}</p>}
          {inWorkspace && state.unbacked && (
            <p className="workspace-note">
              Changes are saved in this browser only.{' '}
              <button type="button" className="link-btn" disabled={busy} onClick={() => void exportWorkspace()}>Export a backup file</button>
            </p>
          )}
          {state.notice && (
            <p className="workspace-note">
              {state.notice}{' '}
              <button type="button" className="link-btn" onClick={dismissNotice}>Dismiss</button>
            </p>
          )}
        </div>
        {error && !importing && <p role="alert" className="inline-error workspace-note">{error}</p>}
      </div>

      {importing && (
        <ImportDialog
          saved={state.data}
          onClose={() => setImporting(false)}
          onImported={(data) => setFlash(`Imported ${counts(data)} into your workspace.`)}
        />
      )}
      {clearing && (
        <ConfirmDialog
          title="Clear workspace"
          confirmLabel="Clear workspace"
          busy={busy}
          onClose={() => setClearing(false)}
          onConfirm={() => {
            void run(async () => {
              await removeWorkspace();
              setLoadFailed(false);
              setError('');
              setClearing(false);
              setFlash('Workspace cleared.');
            });
          }}
        >
          <p>
            This removes {state.data ? counts(state.data) : 'the saved workspace'}
            {state.incident ? ` and the imported timeline (${state.incident.fileName})` : ''} from this browser. It cannot be undone.
            {state.unbacked ? ' You have changes that were not exported.' : ''}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
};
