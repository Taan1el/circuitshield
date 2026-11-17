import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The Pages build runs the console on the in-browser adapter. Tests run as a
// development build, so switch the services module to that adapter here.
vi.mock('../services/index.js', async () => {
  const demo = await import('../services/demoApi.js');
  return { ...demo, isDemoMode: true };
});

import App from '../App.js';
import { chooseWorkspaceMode, dismissNotice, initializeWorkspace, removeWorkspace, resetSampleTuning, upsertCircuit, workspaceState } from '../local/circuitWorkspace.js';
import { newCircuitConfig } from '../local/workspaceFile.js';
import * as demoApi from '../services/demoApi.js';
import { axe } from './axe.js';

beforeEach(async () => {
  await initializeWorkspace();
  await removeWorkspace();
  await chooseWorkspaceMode('sample');
  resetSampleTuning();
  dismissNotice();
  demoApi.resetDemoData();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('console in the Pages build', () => {
  it('starts with sample data: the three example circuits, the workspace bar and the tuning section', async () => {
    render(<App />);
    expect(await screen.findByText('Stripe / Adyen Payment Gateway')).toBeInTheDocument();
    expect(screen.getByText('Tallinn Warehouse Stock Verification')).toBeInTheDocument();
    expect(screen.getByText('AI Real-Time Fraud & AML Scoring')).toBeInTheDocument();
    expect(screen.getByText('Demo: everything runs in your browser with sample data.')).toBeInTheDocument();
    expect(screen.getByLabelText('Data source')).toHaveDisplayValue('Sample data');
    expect(screen.getByRole('heading', { name: 'Tune a breaker against an incident' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your circuits' })).toBeNull();
    // The chaos test lists the circuits that exist.
    const target = screen.getByLabelText('Target circuit');
    expect(within(target).getAllByRole('option').map((option) => option.textContent)).toEqual(['Payments', 'Inventory', 'Fraud detection']);
  });

  it('runs your own circuits in the workspace instead of the three examples, and gives the sample back on return', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Stripe / Adyen Payment Gateway');

    await user.selectOptions(screen.getByLabelText('Data source'), 'Your workspace');
    await waitFor(() => expect(screen.queryByText('Stripe / Adyen Payment Gateway')).toBeNull());
    expect(await screen.findByText('0 circuits')).toBeInTheDocument();
    expect(screen.getByText('Your workspace: circuits, thresholds and timeline saved in this browser.')).toBeInTheDocument();
    expect(screen.getByText(/No circuits yet\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send \d+ requests/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reset sample data' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add circuit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Checkout API');
    await user.click(within(dialog).getByRole('button', { name: 'Add circuit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(await screen.findByText('1 circuit')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Checkout API/ })).toBeInTheDocument();
    const target = screen.getByLabelText('Target circuit');
    expect(within(target).getAllByRole('option').map((option) => option.textContent)).toEqual(['Checkout API']);
    expect(screen.getByRole('button', { name: /Send \d+ requests/ })).toBeEnabled();

    // Back on sample data the examples return, and the workspace circuit is still saved.
    await user.selectOptions(screen.getByLabelText('Data source'), 'Sample data');
    expect(await screen.findByText('Stripe / Adyen Payment Gateway')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Checkout API/ })).toBeNull();
    expect(workspaceState().data?.circuits.map((circuit) => circuit.name)).toEqual(['Checkout API']);
  });

  it('runs a user-defined circuit with its own settings through the real breaker', async () => {
    await upsertCircuit({ id: 'tight', name: 'Tight breaker', serviceTarget: 'svc', config: { ...newCircuitConfig(), minCallsThreshold: 1, slidingWindowSize: 1, failureRateThresholdPercent: 1, resetTimeoutMs: 60_000 } });
    render(<App />);
    expect(await screen.findByRole('button', { name: /^Tight breaker/ })).toBeInTheDocument();
    await demoApi.updateServiceChaos('tight', 5, 100);
    const first = await demoApi.executeCircuitCall('tight');
    expect(first.outcome).toBe('FAILURE');
    const second = await demoApi.executeCircuitCall('tight');
    expect(second.outcome).toBe('SHORT_CIRCUITED');
    await waitFor(() => expect(screen.getByText('1 circuit open')).toBeInTheDocument(), { timeout: 4000 });
  });

  it('keeps the saved workspace when the sample data is reset', async () => {
    const user = userEvent.setup();
    await upsertCircuit({ id: 'checkout', name: 'Checkout', serviceTarget: 'svc', config: newCircuitConfig() });
    await chooseWorkspaceMode('sample');
    render(<App />);
    await screen.findByText('Stripe / Adyen Payment Gateway');
    await user.click(screen.getByRole('button', { name: 'Reset sample data' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(workspaceState().data?.circuits.map((circuit) => circuit.id)).toEqual(['checkout']);
    expect(workspaceState().mode).toBe('sample');
  });

  it('shows the workspace saved earlier when the page opens', async () => {
    await upsertCircuit({ id: 'checkout', name: 'Checkout', serviceTarget: 'svc', config: newCircuitConfig() });
    render(<App />);
    expect(await screen.findByRole('button', { name: /^Checkout/ })).toBeInTheDocument();
    expect(screen.queryByText('Stripe / Adyen Payment Gateway')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your circuits' })).toBeInTheDocument();
  });

  it('has no accessibility violations in sample mode and in the workspace', async () => {
    const { container } = render(<App />);
    await screen.findByText('Stripe / Adyen Payment Gateway');
    expect(await axe(container)).toHaveNoViolations();
    await upsertCircuit({ id: 'checkout', name: 'Checkout', serviceTarget: 'svc', config: newCircuitConfig() });
    await screen.findByRole('button', { name: /^Checkout/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});
