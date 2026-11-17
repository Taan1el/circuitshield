import React, { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { SETTING_META } from '../../../shared/breaker-settings.js';
import { formatDuration } from '../../../shared/replay-summary.js';
import { circuitIdFor, newCircuitConfig, type CircuitSpec } from '../local/workspaceFile.js';
import { removeCircuit, upsertCircuit } from '../local/circuitWorkspace.js';
import { ConfirmDialog, Dialog } from './Dialog.js';
import { SettingsFields, type FieldMeta } from './SettingsFields.js';
import { pluralize } from '../utils/pluralize.js';

const CIRCUIT_FIELDS: FieldMeta[] = [
  ...SETTING_META,
  { key: 'bulkheadMaxConcurrent', label: 'Bulkhead concurrency', unit: 'calls', help: 'Calls that may run at once.' },
  { key: 'bulkheadMaxWaitMs', label: 'Bulkhead queue wait', unit: 'ms', help: 'How long an extra call waits for a slot before it is rejected.' },
];

interface CircuitDialogProps {
  existing: CircuitSpec | null;
  taken: string[];
  onClose: () => void;
}

const CircuitDialog: React.FC<CircuitDialogProps> = ({ existing, taken, onClose }) => {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(existing?.name ?? '');
  const [target, setTarget] = useState(existing?.serviceTarget ?? 'my-service');
  const [config, setConfig] = useState<Record<string, number>>(() => ({ ...(existing?.config ?? newCircuitConfig()) }));
  const [valid, setValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the circuit a name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await upsertCircuit({
        id: existing?.id ?? circuitIdFor(trimmed, taken),
        name: trimmed,
        serviceTarget: target.trim() || 'my-service',
        config: config as unknown as CircuitSpec['config'],
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The circuit could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={existing ? 'Edit circuit' : 'Add a circuit'}
      onClose={onClose}
      initialFocusRef={nameRef}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !valid} onClick={() => void save()}>
            {busy ? 'Saving' : existing ? 'Save changes' : 'Add circuit'}
          </button>
        </>
      }
    >
      <div className="dialog-grid">
        <div className="field">
          <label className="field-label" htmlFor="circuit-name">Name</label>
          <input id="circuit-name" ref={nameRef} className="number-input" type="text" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="circuit-target">Service it protects</label>
          <input id="circuit-target" className="number-input" type="text" maxLength={60} value={target} onChange={(event) => setTarget(event.target.value)} />
        </div>
      </div>
      <SettingsFields idPrefix="circuit" fields={CIRCUIT_FIELDS} values={config} onValid={setConfig} onStatus={setValid} />
      {error && <p className="inline-error" role="alert">{error}</p>}
    </Dialog>
  );
};

interface CircuitManagerProps {
  circuits: CircuitSpec[];
}

/** Add, change and remove the circuits that make up the workspace. */
export const CircuitManager: React.FC<CircuitManagerProps> = ({ circuits }) => {
  const [editing, setEditing] = useState<CircuitSpec | null | 'new'>(null);
  const [removing, setRemoving] = useState<CircuitSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      await removeCircuit(removing.id);
      setRemoving(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The circuit could not be removed.');
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="circuit-manager" aria-labelledby="manager-heading">
      <div className="manager-head">
        <h3 id="manager-heading" className="panel-heading">Your circuits</h3>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Add circuit
        </button>
      </div>
      {circuits.length === 0 ? (
        <p className="empty-note">
          No circuits yet. Add one here, or save thresholds from the tuning section as a circuit.
        </p>
      ) : (
        <ul className="manager-list">
          {circuits.map((circuit) => (
            <li key={circuit.id} className="manager-item">
              <div className="manager-text">
                <span className="circuit-name">{circuit.name}</span>
                <span className="circuit-target mono">
                  {circuit.serviceTarget} / opens at {circuit.config.failureRateThresholdPercent}% failures / {formatDuration(circuit.config.resetTimeoutMs)} open
                </span>
              </div>
              <div className="manager-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(circuit)} aria-label={`Edit ${circuit.name}`}>
                  <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                  Edit
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setRemoving(circuit)} aria-label={`Remove ${circuit.name}`}>
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="field-help">{circuits.length} {pluralize(circuits.length, 'circuit')} saved in this browser.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}

      {editing && (
        <CircuitDialog
          existing={editing === 'new' ? null : editing}
          taken={circuits.map((circuit) => circuit.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove circuit"
          confirmLabel="Remove circuit"
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={() => void remove()}
        >
          <p>This removes {removing.name} and its settings from the workspace in this browser. Its counters in the console are lost.</p>
        </ConfirmDialog>
      )}
    </section>
  );
};
