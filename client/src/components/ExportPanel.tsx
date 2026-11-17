import React, { useId, useMemo, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import type { BreakerSettings } from '../../../shared/breaker-core.js';
import type { ReplayResult } from '../../../shared/replay.js';
import { EXPORT_FORMATS, type ExportFormat } from '../local/exportConfig.js';
import { downloadFile } from '../local/files.js';

export interface ExportSet {
  id: string;
  label: string;
  settings: BreakerSettings;
  result: ReplayResult | null;
}

interface ExportPanelProps {
  sets: ExportSet[];
  timelineName: string;
  /** Whether settings can be saved as a circuit in the workspace. */
  canSave: boolean;
  onSave: (set: ExportSet, name: string) => Promise<void>;
}

export const ExportPanel: React.FC<ExportPanelProps> = ({ sets, timelineName, canSave, onSave }) => {
  const uid = useId().replace(/:/g, '');
  const [setId, setSetId] = useState(sets[0]?.id ?? 'a');
  const [formatId, setFormatId] = useState<ExportFormat['id']>('json');
  const [status, setStatus] = useState('');
  const [circuitName, setCircuitName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const chosen = sets.find((set) => set.id === setId) ?? sets[0];
  const format = EXPORT_FORMATS.find((candidate) => candidate.id === formatId) ?? EXPORT_FORMATS[0];
  const text = useMemo(
    () => format.build({ name: chosen.label, settings: chosen.settings, replay: chosen.result, timelineName }),
    [format, chosen, timelineName]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied to the clipboard.');
    } catch {
      setStatus('The browser did not allow copying. Select the text and copy it, or download the file.');
    }
  };

  const save = async () => {
    const name = circuitName.trim() || chosen.label;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(chosen, name);
      setStatus(`Saved "${name}" as a circuit in your workspace.`);
      setCircuitName('');
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'The circuit could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="export-panel" aria-labelledby={`${uid}-heading`}>
      <h3 id={`${uid}-heading`} className="panel-heading">Take the settings with you</h3>
      <p className="section-description">
        Export the settings as a file, or as a starting configuration for resilience4j, Polly or opossum. The comments in each
        snippet say which settings carry over exactly and which do not.
      </p>
      <div className="export-controls">
        {sets.length > 1 && (
          <div className="field">
            <label className="field-label" htmlFor={`${uid}-set`}>Settings set</label>
            <select id={`${uid}-set`} value={chosen.id} onChange={(event) => { setSetId(event.target.value); setStatus(''); }}>
              {sets.map((set) => <option key={set.id} value={set.id}>{set.label}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-format`}>Format</label>
          <select id={`${uid}-format`} value={format.id} onChange={(event) => { setFormatId(event.target.value as ExportFormat['id']); setStatus(''); }}>
            {EXPORT_FORMATS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </div>
        <div className="export-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
            <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
            Copy
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { downloadFile(format.fileName, text, format.mime); setStatus(`Downloaded ${format.fileName}.`); }}>
            <Download size={16} strokeWidth={1.75} aria-hidden="true" />
            Download
          </button>
        </div>
      </div>
      <pre className="code-block" tabIndex={0} aria-label={`${format.label} for ${chosen.label}`}><code>{text}</code></pre>
      <p className="status-note" role="status">{status}</p>

      <div className="save-circuit">
        <h4 className="table-heading">Use these settings in the console</h4>
        {canSave ? (
          <div className="export-controls">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}-circuit-name`}>Circuit name</label>
              <input
                id={`${uid}-circuit-name`}
                className="number-input"
                type="text"
                maxLength={60}
                placeholder={chosen.label}
                value={circuitName}
                onChange={(event) => setCircuitName(event.target.value)}
              />
            </div>
            <div className="export-actions">
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving' : 'Save as circuit'}
              </button>
            </div>
          </div>
        ) : (
          <p className="field-help">Switch the data source to Your workspace to save these settings as a circuit you can test with the chaos controls.</p>
        )}
        {saveError && <p className="inline-error" role="alert">{saveError}</p>}
      </div>
    </section>
  );
};
