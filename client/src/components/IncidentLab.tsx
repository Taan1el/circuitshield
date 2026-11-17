import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GitCompare, Upload, X } from 'lucide-react';
import type { BreakerSettings } from '../../../shared/breaker-core.js';
import { SETTING_META } from '../../../shared/breaker-settings.js';
import type { ReplayResult, Timeline } from '../../../shared/replay.js';
import { compareReplays, formatClock, formatDuration, plural } from '../../../shared/replay-summary.js';
import {
  activeTuning,
  subscribeWorkspace,
  updateTuning,
  upsertCircuit,
  workspaceState,
} from '../local/circuitWorkspace.js';
import { SAMPLE_INCIDENTS, sampleIncident } from '../local/incidentFixtures.js';
import { replayAsync } from '../local/incidentRunner.js';
import { circuitIdFor, newCircuitConfig, type ThresholdSet, type Tuning } from '../local/workspaceFile.js';
import { ExportPanel, type ExportSet } from './ExportPanel.js';
import { IncidentImportDialog } from './IncidentImportDialog.js';
import { ReplayResults } from './ReplayResults.js';
import { SettingsFields } from './SettingsFields.js';

const sampleTimelines = new Map<string, Timeline>();

function timelineForSample(id: string): Timeline {
  let timeline = sampleTimelines.get(id);
  if (!timeline) {
    timeline = (sampleIncident(id) ?? SAMPLE_INCIDENTS[0]).build();
    sampleTimelines.set(id, timeline);
  }
  return timeline;
}

/** Replays a timeline with a set of settings, keeping only the newest answer. */
function useReplay(timeline: Timeline, settings: BreakerSettings | null): { result: ReplayResult | null; busy: boolean } {
  const [state, setState] = useState<{ result: ReplayResult | null; busy: boolean }>({ result: null, busy: false });
  const latest = useRef(0);
  const key = JSON.stringify(settings);
  useEffect(() => {
    if (!settings) {
      setState({ result: null, busy: false });
      return;
    }
    const ticket = ++latest.current;
    setState((previous) => ({ ...previous, busy: true }));
    replayAsync(timeline, settings).then(
      (result) => { if (ticket === latest.current) setState({ result, busy: false }); },
      () => { if (ticket === latest.current) setState({ result: null, busy: false }); }
    );
    // `settings` is tracked through `key`, which changes exactly when its content does.
  }, [timeline, key]);
  return state;
}

interface IncidentLabProps {
  /** True on the Pages build, where a workspace can be saved and a timeline imported. */
  persisted: boolean;
}

function labelsFor(tuning: Tuning): [string, string] {
  const a = tuning.a.label.trim() || 'Set A';
  const b = tuning.b ? tuning.b.label.trim() || 'Set B' : 'Set B';
  return [a, b === a ? `${b} (B)` : b];
}

interface SetPanelProps {
  id: string;
  heading: string;
  set: ThresholdSet;
  onChange: (set: ThresholdSet) => void;
  onRemove?: () => void;
}

const SetPanel: React.FC<SetPanelProps> = ({ id, heading, set, onChange, onRemove }) => (
  <div className="set-panel">
    <div className="set-panel-head">
      <h3 className="panel-heading">{heading}</h3>
      {onRemove && (
        <button type="button" className="btn btn-secondary" onClick={onRemove}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
          Remove set B
        </button>
      )}
    </div>
    <div className="field">
      <label className="field-label" htmlFor={`${id}-label`}>Name</label>
      <input
        id={`${id}-label`}
        className="number-input"
        type="text"
        maxLength={40}
        value={set.label}
        onChange={(event) => onChange({ ...set, label: event.target.value })}
      />
    </div>
    <SettingsFields
      idPrefix={id}
      fields={SETTING_META}
      values={set.settings as unknown as Record<string, number>}
      onValid={(values) => onChange({ ...set, settings: values as unknown as BreakerSettings })}
    />
  </div>
);

export const IncidentLab: React.FC<IncidentLabProps> = ({ persisted }) => {
  const ws = useSyncExternalStore(subscribeWorkspace, workspaceState, workspaceState);
  const tuning = activeTuning(ws);
  const inWorkspace = persisted && ws.mode === 'workspace';
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const options = useMemo(
    () => [
      ...(ws.incident ? [{ id: 'workspace', name: `Your file: ${ws.incident.fileName}` }] : []),
      ...SAMPLE_INCIDENTS.map((incident) => ({ id: incident.id, name: `Sample: ${incident.name}` })),
    ],
    [ws.incident]
  );
  const selected = options.some((option) => option.id === tuning.timeline) ? tuning.timeline : options[0].id;
  const timeline = selected === 'workspace' && ws.incident ? ws.incident.timeline : timelineForSample(selected);
  const hasLatency = selected === 'workspace' && ws.incident ? ws.incident.hasLatency : true;
  const timelineName = options.find((option) => option.id === selected)?.name ?? selected;
  const sample = sampleIncident(selected);

  const a = useReplay(timeline, tuning.a.settings);
  const b = useReplay(timeline, tuning.b ? tuning.b.settings : null);
  const [labelA, labelB] = labelsFor(tuning);

  const change = (apply: (current: Tuning) => Tuning) => {
    setError('');
    setFlash('');
    updateTuning(apply).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The change could not be saved.');
    });
  };

  const comparison = useMemo(
    () => (a.result && b.result && tuning.b ? compareReplays(a.result, b.result, labelA, labelB) : []),
    [a.result, b.result, tuning.b, labelA, labelB]
  );

  const exportSets: ExportSet[] = [
    { id: 'a', label: labelA, settings: tuning.a.settings, result: a.result },
    ...(tuning.b ? [{ id: 'b', label: labelB, settings: tuning.b.settings, result: b.result }] : []),
  ];

  const saveAsCircuit = async (set: ExportSet, name: string) => {
    const existing = ws.data?.circuits.find((circuit) => circuit.name === name);
    const id = existing?.id ?? circuitIdFor(name, (ws.data?.circuits ?? []).map((circuit) => circuit.id));
    await upsertCircuit({
      id,
      name,
      serviceTarget: existing?.serviceTarget ?? 'my-service',
      config: { ...(existing?.config ?? newCircuitConfig()), ...set.settings },
    });
  };

  const first = timeline.t[0];
  const last = timeline.t[timeline.t.length - 1];

  return (
    <section className="lab" aria-labelledby="lab-heading">
      <div className="lab-head">
        <h2 id="lab-heading" className="section-heading">Tune a breaker against an incident</h2>
        <p className="section-description">
          Replay a recorded timeline of calls through the same breaker code the console runs, with your own thresholds, and see
          when it would have opened and closed. This simulates a breaker on recorded calls. It does not sit in front of live traffic.
        </p>
      </div>

      <div className="lab-body">
        <div className="lab-timeline">
          <div className="field lab-timeline-select">
            <label className="field-label" htmlFor="lab-timeline">Timeline</label>
            <select
              id="lab-timeline"
              value={selected}
              onChange={(event) => {
                // Read the value now: the select is reset to its saved value before a queued change runs.
                const next = event.target.value;
                change((current) => ({ ...current, timeline: next }));
              }}
            >
              {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </div>
          {persisted && (
            <button type="button" className="btn btn-primary" onClick={() => { setError(''); setFlash(''); setImporting(true); }}>
              <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
              Import timeline
            </button>
          )}
        </div>
        <p className="field-help lab-timeline-info">
          {plural(timeline.t.length, 'call')} from {formatClock(first)} to {formatClock(last)} UTC ({formatDuration(last - first)}).
          {sample ? ` ${sample.description}` : ''}
          {selected === 'workspace' && ws.incident && ws.incident.skippedCount > 0 ? ` ${plural(ws.incident.skippedCount, 'row')} in the file could not be read and were left out.` : ''}
          {selected === 'workspace' && ws.incident && !ws.incident.hasLatency ? ' This file has no latency figures, so slow call settings have no effect.' : ''}
        </p>
        {flash && <p className="status-note" role="status">{flash}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}

        <div className={`lab-sets${tuning.b ? ' is-comparing' : ''}`}>
          <SetPanel
            id="set-a"
            heading={tuning.b ? 'Set A' : 'Thresholds'}
            set={tuning.a}
            onChange={(set) => change((current) => ({ ...current, a: set }))}
          />
          {tuning.b ? (
            <SetPanel
              id="set-b"
              heading="Set B"
              set={tuning.b}
              onChange={(set) => change((current) => ({ ...current, b: set }))}
              onRemove={() => change((current) => ({ ...current, b: null }))}
            />
          ) : (
            <div className="set-panel set-panel-empty">
              <h3 className="panel-heading">Compare two sets</h3>
              <p className="field-help">
                Add a second set of thresholds and replay both on the same timeline. The differences are written out beside the results.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => change((current) => ({ ...current, b: { label: 'Candidate', settings: { ...current.a.settings } } }))}
              >
                <GitCompare size={16} strokeWidth={1.75} aria-hidden="true" />
                Compare with another set
              </button>
            </div>
          )}
        </div>

        <div aria-live="polite" className="lab-results">
          {(a.busy || b.busy) && <p className="status-note">Replaying the timeline.</p>}
          {comparison.length > 0 && (
            <section className="comparison" aria-labelledby="comparison-heading">
              <h3 id="comparison-heading" className="panel-heading">How {labelB} differs from {labelA}</h3>
              <ul className="comparison-list">
                {comparison.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </section>
          )}
          {a.result && (
            <section aria-labelledby="results-a-heading" className="result-block">
              <h3 id="results-a-heading" className="panel-heading">Result for {labelA}</h3>
              <ReplayResults result={a.result} label={labelA} hasLatency={hasLatency} />
            </section>
          )}
          {b.result && tuning.b && (
            <section aria-labelledby="results-b-heading" className="result-block">
              <h3 id="results-b-heading" className="panel-heading">Result for {labelB}</h3>
              <ReplayResults result={b.result} label={labelB} hasLatency={hasLatency} />
            </section>
          )}
        </div>

        <ExportPanel sets={exportSets} timelineName={timelineName} canSave={inWorkspace} onSave={saveAsCircuit} />
      </div>

      {importing && (
        <IncidentImportDialog
          saved={ws.incident}
          onClose={() => setImporting(false)}
          onImported={(incident) => setFlash(`Imported ${plural(incident.timeline.t.length, 'call')} from ${incident.fileName}.`)}
        />
      )}
    </section>
  );
};
