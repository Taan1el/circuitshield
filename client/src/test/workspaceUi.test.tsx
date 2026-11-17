import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CircuitManager } from '../components/CircuitManager.js';
import { WorkspaceBar } from '../components/WorkspaceBar.js';
import {
  chooseWorkspaceMode,
  dismissNotice,
  initializeWorkspace,
  removeWorkspace,
  replaceWorkspaceData,
  resetSampleTuning,
  upsertCircuit,
  workspaceState,
} from '../local/circuitWorkspace.js';
import { defaultTuning, newCircuitConfig, serializeWorkspace, type CircuitSpec, type WorkspaceData } from '../local/workspaceFile.js';
import { axe } from './axe.js';

const checkout: CircuitSpec = { id: 'checkout', name: 'Checkout', serviceTarget: 'checkout-api', config: newCircuitConfig() };
const search: CircuitSpec = { id: 'search', name: 'Search', serviceTarget: 'search-api', config: { ...newCircuitConfig(), failureRateThresholdPercent: 30 } };

function data(circuits: CircuitSpec[] = [checkout, search]): WorkspaceData {
  return { circuits, tuning: defaultTuning() };
}

beforeEach(async () => {
  await initializeWorkspace();
  await removeWorkspace();
  await chooseWorkspaceMode('sample');
  resetSampleTuning();
  dismissNotice();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonFile(content: string, name = 'workspace.json', size?: number): File {
  const file = new File([content], name, { type: 'application/json' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function renderBar() {
  const view = render(<WorkspaceBar />);
  await waitFor(() => expect(workspaceState().ready).toBe(true));
  return view;
}

describe('workspace bar', () => {
  it('offers sample data and your workspace, and says the data stays in the browser', async () => {
    await renderBar();
    const select = screen.getByLabelText('Data source');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Sample data', 'Your workspace']);
    expect(select).toHaveDisplayValue('Sample data');
    expect(screen.getByText(/Your data stays in this browser: nothing is uploaded\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export workspace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear workspace' })).toBeNull();
  });

  it('switches to the workspace and remembers the choice', async () => {
    const user = userEvent.setup();
    await renderBar();
    await user.selectOptions(screen.getByLabelText('Data source'), 'Your workspace');
    await waitFor(() => expect(workspaceState().mode).toBe('workspace'));
    expect(screen.getByRole('button', { name: 'Export workspace' })).toBeInTheDocument();
  });

  it('reminds you to back up after a change and stops once a backup file is exported', async () => {
    const user = userEvent.setup();
    await upsertCircuit(checkout);
    await renderBar();
    expect(screen.getByText(/Changes are saved in this browser only\./)).toBeInTheDocument();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:local/1'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Export a backup file' }));
    expect(await screen.findByText('Exported 1 circuit and one threshold set to circuitshield-workspace.json.')).toBeInTheDocument();
    expect(screen.queryByText(/Changes are saved in this browser only\./)).toBeNull();
    expect(workspaceState().unbacked).toBe(false);
  });

  it('exports a file that reads back as the same workspace', async () => {
    const user = userEvent.setup();
    await upsertCircuit(checkout);
    await upsertCircuit(search);
    await renderBar();
    let written = '';
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => { void blob.text?.(); written = 'blob'; return 'blob:local/2'; }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Export workspace' }));
    expect(written).toBe('blob');
    expect(serializeWorkspace(workspaceState().data as WorkspaceData)).toContain('"format": "circuitshield-workspace"');
  });

  describe('import', () => {
    it('checks the file, says what it holds and creates the workspace when none exists', async () => {
      const user = userEvent.setup();
      await renderBar();
      await user.click(screen.getByRole('button', { name: 'Import workspace' }));
      const dialog = await screen.findByRole('dialog', { name: 'Import a workspace file' });
      expect(within(dialog).getByLabelText('Workspace file')).toHaveFocus();
      await user.upload(within(dialog).getByLabelText('Workspace file'), jsonFile(serializeWorkspace(data())));
      expect(await within(dialog).findByText(/is valid: 2 circuits and one threshold set\./)).toBeInTheDocument();
      expect(within(dialog).getByText(/Importing creates your workspace from it\./)).toBeInTheDocument();
      expect(await axe(dialog)).toHaveNoViolations();
      await user.click(within(dialog).getByRole('button', { name: 'Import into workspace' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(workspaceState().data?.circuits.map((circuit) => circuit.id)).toEqual(['checkout', 'search']);
      expect(workspaceState().mode).toBe('workspace');
      expect(screen.getByText('Imported 2 circuits and one threshold set into your workspace.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Import workspace' })).toHaveFocus();
    });

    it('asks first, with counts, before it replaces a saved workspace', async () => {
      const user = userEvent.setup();
      await upsertCircuit(checkout);
      await renderBar();
      await user.click(screen.getByRole('button', { name: 'Import workspace' }));
      const dialog = await screen.findByRole('dialog');
      await user.upload(within(dialog).getByLabelText('Workspace file'), jsonFile(serializeWorkspace(data([search]))));
      expect(await within(dialog).findByText(/Importing replaces your saved workspace \(1 circuit and one threshold set\) with these\./)).toBeInTheDocument();
      // Nothing has been replaced yet.
      expect(workspaceState().data?.circuits.map((circuit) => circuit.id)).toEqual(['checkout']);
      await user.click(within(dialog).getByRole('button', { name: 'Replace workspace' }));
      await waitFor(() => expect(workspaceState().data?.circuits.map((circuit) => circuit.id)).toEqual(['search']));
    });

    it('lists each problem with its path and changes nothing when the file is invalid', async () => {
      const user = userEvent.setup();
      await upsertCircuit(checkout);
      await renderBar();
      await user.click(screen.getByRole('button', { name: 'Import workspace' }));
      const dialog = await screen.findByRole('dialog');
      const broken = JSON.parse(serializeWorkspace(data()));
      broken.circuits[1].config.slidingWindowSize = 0;
      broken.tuning.timeline = 'elsewhere';
      await user.upload(within(dialog).getByLabelText('Workspace file'), jsonFile(JSON.stringify(broken)));
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent('workspace.json cannot be used. Nothing was changed.');
      expect(alert).toHaveTextContent('workspace.json, circuits[1].config.slidingWindowSize: expected a whole number between 1 and 10000, got 0');
      expect(alert).toHaveTextContent('workspace.json, tuning.timeline: expected one of "workspace", "error-burst"');
      expect(within(dialog).getByRole('button', { name: 'Replace workspace' })).toBeDisabled();
      expect(workspaceState().data?.circuits).toHaveLength(1);
    });

    it('says when the file is not JSON, or too large', async () => {
      const user = userEvent.setup();
      await renderBar();
      await user.click(screen.getByRole('button', { name: 'Import workspace' }));
      const dialog = await screen.findByRole('dialog');
      await user.upload(within(dialog).getByLabelText('Workspace file'), jsonFile('{ nope'));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/workspace\.json, \(file\): not valid JSON/);
      await user.upload(within(dialog).getByLabelText('Workspace file'), jsonFile('{}', 'big.json', 3 * 1024 * 1024));
      await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('big.json, (file): expected a file of at most 1 MB, got 3.0 MB'));
    });
  });

  describe('clear workspace', () => {
    it('asks first, says what goes, and keeps everything on cancel', async () => {
      const user = userEvent.setup();
      await upsertCircuit(checkout);
      await upsertCircuit(search);
      await renderBar();
      const opener = screen.getByRole('button', { name: 'Clear workspace' });
      await user.click(opener);
      const dialog = await screen.findByRole('dialog', { name: 'Clear workspace' });
      expect(within(dialog).getByText(/This removes 2 circuits and one threshold set from this browser\. It cannot be undone\. You have changes that were not exported\./)).toBeInTheDocument();
      expect(await axe(dialog)).toHaveNoViolations();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(opener).toHaveFocus();
      expect(workspaceState().data?.circuits).toHaveLength(2);

      await user.click(opener);
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear workspace' }));
      await waitFor(() => expect(workspaceState().data).toBeNull());
      expect(screen.getByText('Workspace cleared.')).toBeInTheDocument();
    });

    it('closes on Escape and returns focus to the button', async () => {
      const user = userEvent.setup();
      await upsertCircuit(checkout);
      await renderBar();
      const opener = screen.getByRole('button', { name: 'Clear workspace' });
      await user.click(opener);
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(opener).toHaveFocus();
    });
  });

  it('has no accessibility violations in either state', async () => {
    const { container } = await renderBar();
    expect(await axe(container)).toHaveNoViolations();
    await upsertCircuit(checkout);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export workspace' })).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('circuit manager', () => {
  it('says there are no circuits yet', () => {
    render(<CircuitManager circuits={[]} />);
    expect(screen.getByText(/No circuits yet\./)).toBeInTheDocument();
    expect(screen.getByText('0 circuits saved in this browser.')).toBeInTheDocument();
  });

  it('adds a circuit with its own name and settings', async () => {
    const user = userEvent.setup();
    render(<CircuitManager circuits={[]} />);
    await user.click(screen.getByRole('button', { name: 'Add circuit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a circuit' });
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    expect(within(dialog).getByLabelText('Bulkhead concurrency')).toHaveValue(5);

    // A name is required.
    await user.click(within(dialog).getByRole('button', { name: 'Add circuit' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Give the circuit a name.');

    await user.type(within(dialog).getByLabelText('Name'), 'Billing API');
    await user.clear(within(dialog).getByLabelText('Service it protects'));
    await user.type(within(dialog).getByLabelText('Service it protects'), 'billing-grpc');
    await user.clear(within(dialog).getByLabelText('Failure threshold'));
    await user.type(within(dialog).getByLabelText('Failure threshold'), '35');
    await user.clear(within(dialog).getByLabelText('Open duration'));
    await user.type(within(dialog).getByLabelText('Open duration'), '7000');
    await user.click(within(dialog).getByRole('button', { name: 'Add circuit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const saved = workspaceState().data?.circuits ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'billing-api', name: 'Billing API', serviceTarget: 'billing-grpc' });
    expect(saved[0].config).toMatchObject({ failureRateThresholdPercent: 35, resetTimeoutMs: 7000, bulkheadMaxConcurrent: 5 });
  });

  it('will not save while a field is invalid', async () => {
    const user = userEvent.setup();
    render(<CircuitManager circuits={[]} />);
    await user.click(screen.getByRole('button', { name: 'Add circuit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'X');
    fireEvent.change(within(dialog).getByLabelText('Window size'), { target: { value: '0' } });
    expect(within(dialog).getByRole('button', { name: 'Add circuit' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Window size')).toHaveAttribute('aria-invalid', 'true');
    expect(await axe(dialog)).toHaveNoViolations();
    fireEvent.change(within(dialog).getByLabelText('Window size'), { target: { value: '20' } });
    expect(within(dialog).getByRole('button', { name: 'Add circuit' })).toBeEnabled();
  });

  it('edits a circuit and keeps its id', async () => {
    const user = userEvent.setup();
    await replaceWorkspaceData(data([checkout]));
    render(<CircuitManager circuits={[checkout]} />);
    await user.click(screen.getByRole('button', { name: 'Edit Checkout' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit circuit' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Checkout');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Checkout v2');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(workspaceState().data?.circuits[0].name).toBe('Checkout v2'));
    expect(workspaceState().data?.circuits[0].id).toBe('checkout');
  });

  it('asks before it removes a circuit', async () => {
    const user = userEvent.setup();
    await replaceWorkspaceData(data([checkout, search]));
    render(<CircuitManager circuits={[checkout, search]} />);
    await user.click(screen.getByRole('button', { name: 'Remove Checkout' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove circuit' });
    expect(dialog).toHaveTextContent('This removes Checkout and its settings from the workspace in this browser.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(workspaceState().data?.circuits).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Remove Checkout' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove circuit' }));
    await waitFor(() => expect(workspaceState().data?.circuits.map((circuit) => circuit.id)).toEqual(['search']));
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<CircuitManager circuits={[checkout, search]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
