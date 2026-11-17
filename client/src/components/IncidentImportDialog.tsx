import React, { useRef, useState } from 'react';
import { formatClock, formatDuration, plural } from '../../../shared/replay-summary.js';
import { formatProblem, INCIDENT_LIMITS, type IncidentProblem, type ParsedIncident } from '../local/incidentFile.js';
import { parseIncidentFile } from '../local/incidentRunner.js';
import { replaceIncident, type StoredIncident } from '../local/circuitWorkspace.js';
import { Dialog } from './Dialog.js';

interface IncidentImportDialogProps {
  saved: StoredIncident | null;
  onClose: () => void;
  onImported: (incident: ParsedIncident) => void;
}

function describeSaved(saved: StoredIncident): string {
  return `${saved.fileName}, ${plural(saved.timeline.t.length, 'call')}`;
}

/** Reads an incident file, says what it holds and what it replaces, and saves it only after confirmation. */
export const IncidentImportDialog: React.FC<IncidentImportDialogProps> = ({ saved, onClose, onImported }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [incident, setIncident] = useState<ParsedIncident | null>(null);
  const [problems, setProblems] = useState<IncidentProblem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async (file: File | undefined) => {
    setIncident(null);
    setProblems([]);
    setError('');
    setFileName(file?.name ?? '');
    if (!file) return;
    setReading(true);
    try {
      const result = await parseIncidentFile(file);
      if (result.ok) {
        setIncident(result.incident);
      } else {
        setProblems(result.problems);
        setTruncated(result.truncated);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The file could not be read.');
    } finally {
      setReading(false);
    }
  };

  const confirm = async () => {
    if (!incident) return;
    setBusy(true);
    setError('');
    try {
      await replaceIncident(incident);
      onImported(incident);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The timeline could not be saved. Your current timeline was kept.');
    } finally {
      setBusy(false);
    }
  };

  const timeline = incident?.timeline;
  const first = timeline ? timeline.t[0] : 0;
  const last = timeline ? timeline.t[timeline.t.length - 1] : 0;

  return (
    <Dialog
      title="Import an incident timeline"
      onClose={onClose}
      initialFocusRef={fileRef}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={!incident || busy}>
            {busy ? 'Saving' : saved ? 'Replace timeline' : 'Import into workspace'}
          </button>
        </>
      }
    >
      <p>
        Choose a CSV file with a header row, up to {INCIDENT_LIMITS.fileBytes / (1024 * 1024)} MB. Either one row per call
        (<code>timestamp,outcome,latency_ms</code>, with outcome ok, error or timeout) or one row per interval
        (<code>timestamp,requests,errors</code>). Timestamps are ISO times or epoch milliseconds. The file is read in this
        browser and checked completely before anything is saved.
      </p>
      <div className="field">
        <label className="field-label" htmlFor="incident-file">Incident CSV file</label>
        <input
          id="incident-file"
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="file-plain"
          disabled={busy}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
      <div role="status">
        {reading && <p>Reading {fileName}.</p>}
        {incident && timeline && (
          <div>
            <p>
              <strong>{fileName}</strong> is readable: {plural(timeline.t.length, 'call')} from {formatClock(first)} to {formatClock(last)} UTC
              ({formatDuration(last - first)}), {incident.format === 'calls' ? 'one row per call' : `${plural(incident.rows, 'interval')}, spread evenly across each interval`}.
            </p>
            {incident.format === 'intervals' && (
              <p className="field-help">
                Interval files carry no latency, so slow call settings have no effect. The last interval is assumed to be as long as the one before it
                ({formatDuration(incident.assumedLastIntervalMs ?? 0)}).
              </p>
            )}
            {incident.sorted && <p className="field-help">The rows were not in time order, so they were sorted.</p>}
            {incident.skippedCount > 0 && (
              <div className="problem-box">
                <p><strong>{plural(incident.skippedCount, 'row')} could not be read and will be left out:</strong></p>
                <ul className="problem-list">
                  {incident.skipped.map((problem) => <li key={`${problem.line}-${problem.message}`}>{formatProblem(fileName, problem)}</li>)}
                </ul>
                {incident.skippedCount > incident.skipped.length && (
                  <p className="field-help">{plural(incident.skippedCount - incident.skipped.length, 'more row')} not listed.</p>
                )}
              </div>
            )}
            <p>
              {saved
                ? `Importing replaces your saved timeline (${describeSaved(saved)}) with this one. Your settings and circuits are kept.`
                : 'Importing saves this timeline in your workspace in this browser.'}
            </p>
          </div>
        )}
      </div>
      {problems.length > 0 && (
        <div role="alert" className="problem-box">
          <p><strong>{fileName} cannot be used.</strong> Nothing was changed.</p>
          <ul className="problem-list">
            {problems.map((problem) => <li key={`${problem.line}-${problem.message}`}>{formatProblem(fileName, problem)}</li>)}
          </ul>
          {truncated && <p className="field-help">More problems follow. Fix these first.</p>}
        </div>
      )}
      {error && <p role="alert" className="inline-error">{error}</p>}
    </Dialog>
  );
};
