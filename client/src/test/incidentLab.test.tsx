import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncidentLab } from '../components/IncidentLab.js';
import {
  chooseWorkspaceMode,
  dismissNotice,
  initializeWorkspace,
  removeWorkspace,
  replaceIncident,
  resetSampleTuning,
  workspaceState,
} from '../local/circuitWorkspace.js';
import type { ParsedIncident } from '../local/incidentFile.js';
import { OUTCOME_ERROR, OUTCOME_OK, timelineFromCalls, type TimelineCall } from '../../../shared/replay.js';
import { axe } from './axe.js';

async function resetStore() {
  await initializeWorkspace();
  await removeWorkspace();
  await chooseWorkspaceMode('sample');
  resetSampleTuning();
  dismissNotice();
}

beforeEach(async () => {
  await resetStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderLab(persisted = false) {
  const view = render(<IncidentLab persisted={persisted} />);
  await screen.findByRole('heading', { name: 'Result for Current' });
  return view;
}

function field(name: string): HTMLInputElement {
  return screen.getByLabelText(name) as HTMLInputElement;
}

function incident(overrides: Partial<ParsedIncident> = {}): ParsedIncident {
  const calls = Array.from({ length: 30 }, (_, index): TimelineCall => ({
    t: Date.UTC(2025, 5, 1, 9, 0, 0) + index * 1000,
    outcome: index >= 10 && index < 20 ? OUTCOME_ERROR : OUTCOME_OK,
    latencyMs: 30,
  }));
  return { fileName: 'saved-incident.csv', format: 'calls', timeline: timelineFromCalls(calls), rows: 30, skipped: [], skippedCount: 0, sorted: false, hasLatency: true, assumedLastIntervalMs: null, ...overrides };
}

describe('tuning against a sample incident', () => {
  it('shows a summary sentence, the numbers, the chart and the state changes', async () => {
    await renderLab();
    expect(screen.getByRole('heading', { name: 'Tune a breaker against an incident' })).toBeInTheDocument();
    const summary = document.querySelector('.replay-summary') as HTMLElement;
    expect(summary).toHaveTextContent('The breaker opened 6 times, first at 12:01:31.800 UTC, 1 min 32 s into the timeline.');
    expect(summary).toHaveTextContent('30 failed calls still reached users, against 145 with no breaker.');

    const metrics = within(document.querySelector('.replay-metrics') as HTMLElement);
    expect(metrics.getByText('Calls short-circuited').nextElementSibling).toHaveTextContent('144');
    expect(metrics.getByText('Failed calls still reaching users').nextElementSibling).toHaveTextContent('30');
    expect(metrics.getByText('Healthy calls blocked').nextElementSibling).toHaveTextContent('29');
    expect(metrics.getByText('Time open').nextElementSibling).toHaveTextContent('30 s');

    const chart = screen.getByRole('img', { name: /Breaker state and calls over time, Current/ });
    const described = (chart.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '');
    expect(described[0]).toBe('Breaker state and calls over time, Current');
    expect(described[1]).toMatch(/^The breaker opened 6 times, first at 12:01:31\.800 UTC.* The same figures are in the table of state changes/);
    const rows = within(screen.getByRole('region', { name: 'State changes for Current' })).getAllByRole('row');
    expect(rows).toHaveLength(14);
    expect(rows[1]).toHaveTextContent('12:01:31.800');
    expect(rows[1]).toHaveTextContent('Opened: 50% of the last 20 calls failed (threshold 50%).');
    expect(rows[rows.length - 1]).toHaveTextContent('12:02:02.200');
    expect(rows[rows.length - 1]).toHaveTextContent('Closed: 3 probe calls succeeded.');
  });

  it('gives the chart a data table as a text alternative', async () => {
    await renderLab();
    const details = document.querySelector('details.data-details') as HTMLElement;
    expect(within(details).getByText('Data table: calls in each slice')).toBeInTheDocument();
    const rows = within(details).getAllByRole('row', { hidden: true });
    expect(rows.length).toBe(61);
  });

  it('updates the replay when a threshold changes', async () => {
    const user = userEvent.setup();
    await renderLab();
    await user.clear(field('Failure threshold'));
    await user.type(field('Failure threshold'), '80');
    await waitFor(() => expect(document.querySelector('.replay-summary')).toHaveTextContent('first at 12:01:33.400 UTC'));
    expect(document.querySelector('.replay-summary')).toHaveTextContent('37 failed calls still reached users');
  });

  it('explains an invalid value under its field and keeps replaying the last valid settings', async () => {
    await renderLab();
    const before = document.querySelector('.replay-summary')?.textContent;
    fireEvent.change(field('Failure threshold'), { target: { value: '150' } });
    expect(field('Failure threshold')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Failure threshold')).toHaveAccessibleDescription(/Use a number between 0 and 100\./);
    expect(screen.getByRole('alert')).toHaveTextContent('Use a number between 0 and 100.');
    expect(document.querySelector('.replay-summary')?.textContent).toBe(before);

    fireEvent.change(field('Failure threshold'), { target: { value: '50' } });
    expect(field('Failure threshold')).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a minimum that exceeds the window, with the reason', async () => {
    const user = userEvent.setup();
    await renderLab();
    await user.clear(field('Minimum calls'));
    await user.type(field('Minimum calls'), '30');
    expect(screen.getByRole('alert')).toHaveTextContent('Use at most the sliding window (20)');
  });

  it('switches between the three sample incidents', async () => {
    const user = userEvent.setup();
    await renderLab();
    await user.selectOptions(screen.getByLabelText('Timeline'), 'Sample: Flapping dependency');
    await waitFor(() => expect(document.querySelector('.replay-summary')).toHaveTextContent('first at 12:00:22.250 UTC'));
    expect(screen.getByText(/alternates 20 seconds healthy and 20 seconds failing/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Timeline'), 'Sample: Slow degradation');
    await waitFor(() => expect(document.querySelector('.replay-summary')).toHaveTextContent('first at 12:01:23.250 UTC'));
    expect(screen.getByText(/Latency climbs from 80 ms/)).toBeInTheDocument();
  });

  it('states what it is and what it is not', async () => {
    await renderLab();
    expect(screen.getByText(/simulates a breaker on recorded calls\. It does not sit in front of live traffic\./)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = await renderLab();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('comparing two sets', () => {
  it('adds a second set, writes the differences in words and removes it again', async () => {
    const user = userEvent.setup();
    await renderLab();
    await user.click(screen.getByRole('button', { name: 'Compare with another set' }));
    await screen.findByRole('heading', { name: 'Result for Candidate' });
    const sets = screen.getAllByLabelText('Failure threshold');
    expect(sets).toHaveLength(2);
    expect(await screen.findByText('Current and Candidate use the same settings.')).toBeInTheDocument();
    expect(screen.getByText(/behave the same on this timeline/)).toBeInTheDocument();

    await user.clear(sets[1]);
    await user.type(sets[1], '30');
    await screen.findByRole('heading', { name: 'How Candidate differs from Current' });
    expect(screen.getByText('The settings differ: failure threshold is 50% in Current and 30% in Candidate.')).toBeInTheDocument();
    expect(screen.getByText(/^Candidate first opens at 12:01:3\d(\.\d+)? UTC/)).toBeInTheDocument();
    expect(screen.getByText(/^Candidate lets \d+ (more|fewer) failed calls? reach users/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove set B' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Result for Candidate' })).toBeNull());
    expect(screen.queryByRole('heading', { name: /How Candidate differs/ })).toBeNull();
  });

  it('has no accessibility violations while comparing', async () => {
    const user = userEvent.setup();
    const { container } = await renderLab();
    await user.click(screen.getByRole('button', { name: 'Compare with another set' }));
    await screen.findByRole('heading', { name: 'Result for Candidate' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('export', () => {
  it('previews each format and says which settings do not map', async () => {
    const user = userEvent.setup();
    await renderLab();
    const preview = () => document.querySelector('pre.code-block') as HTMLElement;
    expect(preview()).toHaveTextContent('"format": "circuitshield-settings"');
    await user.selectOptions(screen.getByLabelText('Format'), 'resilience4j (YAML)');
    expect(preview()).toHaveTextContent('failureRateThreshold: 50');
    expect(preview()).toHaveTextContent('# Map with a difference:');
    await user.selectOptions(screen.getByLabelText('Format'), 'Polly (C#)');
    expect(preview()).toHaveTextContent('FailureRatio = 0.5,');
    expect(preview()).toHaveTextContent('// Not mapped, left at the Polly default:');
    await user.selectOptions(screen.getByLabelText('Format'), 'opossum (JavaScript)');
    expect(preview()).toHaveTextContent('errorThresholdPercentage: 50,');
    expect(preview()).toHaveAccessibleName('opossum (JavaScript) for Current');
  });

  it('exports the settings of the set that is chosen', async () => {
    const user = userEvent.setup();
    await renderLab();
    await user.click(screen.getByRole('button', { name: 'Compare with another set' }));
    const sets = await screen.findAllByLabelText('Failure threshold');
    await user.clear(sets[1]);
    await user.type(sets[1], '35');
    await user.selectOptions(screen.getByLabelText('Settings set'), 'Candidate');
    expect(document.querySelector('pre.code-block')).toHaveTextContent('"failureRateThresholdPercent": 35');
  });

  it('copies to the clipboard and downloads the file', async () => {
    const user = userEvent.setup();
    await renderLab();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"circuitshield-settings"'));
    expect(await screen.findByText('Copied to the clipboard.')).toBeInTheDocument();

    const create = vi.fn(() => 'blob:local/1');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.getByText('Downloaded circuitshield-settings.json.')).toBeInTheDocument();
  });

  it('says so when the browser will not copy', async () => {
    const user = userEvent.setup();
    await renderLab();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(/did not allow copying/)).toBeInTheDocument();
  });

  it('points to the workspace for saving settings as a circuit while on sample data', async () => {
    await renderLab(true);
    expect(screen.getByText(/Switch the data source to Your workspace to save these settings as a circuit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as circuit' })).toBeNull();
  });

  it('saves the chosen settings as a circuit in the workspace', async () => {
    const user = userEvent.setup();
    await chooseWorkspaceMode('workspace');
    await renderLab(true);
    await user.type(screen.getByLabelText('Circuit name'), 'Checkout API');
    await user.click(screen.getByRole('button', { name: 'Save as circuit' }));
    expect(await screen.findByText('Saved "Checkout API" as a circuit in your workspace.')).toBeInTheDocument();
    const circuits = workspaceState().data?.circuits ?? [];
    expect(circuits).toHaveLength(1);
    expect(circuits[0]).toMatchObject({ id: 'checkout-api', name: 'Checkout API' });
    expect(circuits[0].config.failureRateThresholdPercent).toBe(50);
    expect(circuits[0].config.bulkheadMaxConcurrent).toBe(5);

    // Saving under the same name replaces that circuit instead of adding another.
    await user.clear(screen.getAllByLabelText('Failure threshold')[0]);
    await user.type(screen.getAllByLabelText('Failure threshold')[0], '35');
    await user.type(screen.getByLabelText('Circuit name'), 'Checkout API');
    await user.click(screen.getByRole('button', { name: 'Save as circuit' }));
    await waitFor(() => expect(workspaceState().data?.circuits[0].config.failureRateThresholdPercent).toBe(35));
    expect(workspaceState().data?.circuits).toHaveLength(1);
  });
});

describe('importing a timeline', () => {
  const csv = (rows: string[]) => ['timestamp,outcome,latency_ms', ...rows].join('\n');

  function file(content: string, name = 'incident.csv', size?: number): File {
    const created = new File([content], name, { type: 'text/csv' });
    if (size !== undefined) Object.defineProperty(created, 'size', { value: size });
    return created;
  }

  it('reads the file, says what it holds, saves it after confirmation and uses it', async () => {
    const user = userEvent.setup();
    await renderLab(true);
    await user.click(screen.getByRole('button', { name: 'Import timeline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import an incident timeline' });
    expect(within(dialog).getByLabelText('Incident CSV file')).toHaveFocus();

    const rows = [
      ...Array.from({ length: 10 }, (_, i) => `2025-06-01T09:00:0${i}Z,ok,25`),
      ...Array.from({ length: 10 }, (_, i) => `2025-06-01T09:00:${10 + i}Z,error,900`),
      '2025-06-01T09:00:20Z,sometimes,1',
    ];
    await user.upload(within(dialog).getByLabelText('Incident CSV file'), file(csv(rows)));
    expect(await within(dialog).findByText(/is readable: 20 calls from 09:00:00 to 09:00:19 UTC \(19 s\), one row per call\./)).toBeInTheDocument();
    expect(within(dialog).getByText('1 row could not be read and will be left out:')).toBeInTheDocument();
    expect(within(dialog).getByText('incident.csv, line 22: outcome "sometimes" must be ok, error or timeout')).toBeInTheDocument();
    expect(within(dialog).getByText('Importing saves this timeline in your workspace in this browser.')).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();

    await user.click(within(dialog).getByRole('button', { name: 'Import into workspace' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Imported 20 calls from incident.csv.')).toBeInTheDocument();
    expect(screen.getByLabelText('Timeline')).toHaveDisplayValue('Your file: incident.csv');
    expect(workspaceState().incident?.timeline.t.length).toBe(20);
    expect(workspaceState().mode).toBe('workspace');
    expect(screen.getByText(/20 calls from 09:00:00 to 09:00:19 UTC \(19 s\)\./)).toBeInTheDocument();
    expect(screen.getByText(/1 row in the file could not be read and were left out\./)).toBeInTheDocument();
    // Focus goes back to the button that opened the dialog.
    expect(screen.getByRole('button', { name: 'Import timeline' })).toHaveFocus();
  });

  it('says what it replaces before a saved timeline is overwritten', async () => {
    const user = userEvent.setup();
    await replaceIncident(incident());
    await renderLab(true);
    await user.click(screen.getByRole('button', { name: 'Import timeline' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Incident CSV file'), file(csv(['2025-06-01T09:00:00Z,ok,5', '2025-06-01T09:00:01Z,ok,5'])));
    await within(dialog).findByText(/is readable: 2 calls/);
    expect(within(dialog).getByText(/Importing replaces your saved timeline \(saved-incident\.csv, 30 calls\) with this one\. Your settings and circuits are kept\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Replace timeline' }));
    await waitFor(() => expect(workspaceState().incident?.fileName).toBe('incident.csv'));
    expect(workspaceState().incident?.timeline.t.length).toBe(2);
  });

  it('does not touch the saved timeline when the file cannot be used, and lists problems with line numbers', async () => {
    const user = userEvent.setup();
    await replaceIncident(incident());
    await renderLab(true);
    await user.click(screen.getByRole('button', { name: 'Import timeline' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Incident CSV file'), file('when,what\n1,2\n'));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('incident.csv cannot be used. Nothing was changed.');
    expect(alert).toHaveTextContent('incident.csv, line 1: expected a header row with the columns timestamp,outcome,latency_ms');
    expect(within(dialog).getByRole('button', { name: 'Replace timeline' })).toBeDisabled();
    expect(workspaceState().incident?.fileName).toBe('saved-incident.csv');
  });

  it('gives the size limit message for a file that is too big, without reading it', async () => {
    const user = userEvent.setup();
    await renderLab(true);
    await user.click(screen.getByRole('button', { name: 'Import timeline' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Incident CSV file'), file('x', 'huge.csv', 8 * 1024 * 1024));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('huge.csv: huge.csv is 8.0 MB and the limit is 5.0 MB. Trim it to the hours around the incident');
  });

  it('reads a per-interval file and says that it has no latency', async () => {
    const user = userEvent.setup();
    await renderLab(true);
    await user.click(screen.getByRole('button', { name: 'Import timeline' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('Incident CSV file'), file('timestamp,requests,errors\n2025-06-01T09:00:00Z,50,5\n2025-06-01T09:01:00Z,50,40\n2025-06-01T09:02:00Z,50,0\n'));
    expect(await within(dialog).findByText(/is readable: 150 calls from 09:00:00 to 09:02:58\.800 UTC .* 3 intervals, spread evenly across each interval\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Interval files carry no latency, so slow call settings have no effect\./)).toBeInTheDocument();
  });

  it('closes on Escape and gives focus back', async () => {
    const user = userEvent.setup();
    await renderLab(true);
    const opener = screen.getByRole('button', { name: 'Import timeline' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    await renderLab(true);
    await user.click(screen.getByRole('button', { name: 'Import timeline' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('does not offer the import where nothing can be saved', async () => {
    await renderLab(false);
    expect(screen.queryByRole('button', { name: 'Import timeline' })).toBeNull();
  });
});

describe('the replay runs where it will not freeze the page', () => {
  it('replays a large timeline through the worker and a small one inline', async () => {
    const runner = await import('../local/incidentRunner.js');
    const { replayTimeline } = await import('../../../shared/replay.js');
    const { DEFAULT_BREAKER_SETTINGS } = await import('../../../shared/breaker-settings.js');
    const big = timelineFromCalls(Array.from({ length: runner.WORKER_REPLAY_CALLS }, (_, index) => ({ t: index * 10, outcome: index % 3 === 0 ? OUTCOME_ERROR : OUTCOME_OK, latencyMs: 5 })));

    // No Worker in jsdom: the large timeline falls back to replaying inline and gives the same answer.
    expect(typeof Worker).toBe('undefined');
    expect(await runner.replayAsync(big, DEFAULT_BREAKER_SETTINGS)).toEqual(replayTimeline(big, DEFAULT_BREAKER_SETTINGS));

    const posted: Array<{ id: number; kind: string }> = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: unknown, public options: unknown) {}
      postMessage(request: { id: number; kind: string; timeline: typeof big; settings: typeof DEFAULT_BREAKER_SETTINGS }) {
        posted.push(request);
        queueMicrotask(() => this.onmessage?.({ data: { id: request.id, kind: 'replay', result: replayTimeline(request.timeline, request.settings) } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.resetModules();
    const fresh = await import('../local/incidentRunner.js');
    const viaWorker = await fresh.replayAsync(big, DEFAULT_BREAKER_SETTINGS);
    expect(posted).toHaveLength(1);
    expect(viaWorker.totalCalls).toBe(big.t.length);
    const small = timelineFromCalls([{ t: 0, outcome: OUTCOME_OK, latencyMs: 1 }]);
    await fresh.replayAsync(small, DEFAULT_BREAKER_SETTINGS);
    expect(posted).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('reads a large file through the worker and falls back inline when the worker fails', async () => {
    const { timelineToCsv } = await import('../local/incidentFile.js');
    const text = timelineToCsv(timelineFromCalls(Array.from({ length: 8000 }, (_, index) => ({ t: 1_700_000_000_000 + index * 100, outcome: OUTCOME_OK, latencyMs: 12 }))));
    expect(text.length).toBeGreaterThan(200_000);
    class BrokenWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() { queueMicrotask(() => this.onerror?.()); }
      terminate() {}
    }
    vi.stubGlobal('Worker', BrokenWorker);
    vi.resetModules();
    const fresh = await import('../local/incidentRunner.js');
    const result = await fresh.parseIncidentFile(new File([text], 'big.csv'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.incident.timeline.t.length).toBe(8000);
    vi.unstubAllGlobals();
  });
});

describe('typing in a field does not lose what was typed', () => {
  it('keeps an intermediate value while the person types', async () => {
    const user = userEvent.setup();
    await renderLab();
    const input = field('Open duration');
    await user.clear(input);
    expect(input).toHaveValue(null);
    await user.type(input, '2500');
    expect(input).toHaveValue(2500);
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Enter a number.');
  });
});
