import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../App.js';
import type { GlobalStats, CircuitBreakerInfo } from '../../../shared/types.js';

const mockStats: GlobalStats = {
  totalCalls: 1450,
  passedCalls: 1200,
  shortCircuitedCalls: 220,
  bulkheadRejections: 30,
  fallbacksServed: 250,
  circuitsCount: 3,
  openCircuitsCount: 1,
};

const mockCircuits: CircuitBreakerInfo[] = [
  {
    id: 'payments',
    name: 'Stripe / Adyen Payment Gateway',
    serviceTarget: 'payment-provider-cluster',
    state: 'OPEN',
    config: {
      failureRateThresholdPercent: 50,
      slowCallRateThresholdPercent: 50,
      slowCallDurationThresholdMs: 400,
      minCallsThreshold: 5,
      slidingWindowSize: 20,
      resetTimeoutMs: 5000,
      halfOpenTrialCalls: 3,
      bulkheadMaxConcurrent: 4,
      bulkheadMaxWaitMs: 150,
    },
    metrics: {
      failureRatePercent: 75,
      slowCallRatePercent: 0,
      totalCalls: 40,
      successCalls: 10,
      failedCalls: 30,
      slowCalls: 0,
      shortCircuitedCalls: 12,
      bulkheadRejections: 0,
      activeConcurrency: 0,
      waitingQueueDepth: 0,
      timeUntilResetMs: 3200,
    },
    recentRecords: [
      { id: '1', timestamp: Date.now(), outcome: 'FAILURE', durationMs: 450 },
      { id: '2', timestamp: Date.now(), outcome: 'SHORT_CIRCUITED', durationMs: 1 },
    ],
    fallbackPayload: { status: 'DEGRADED_OFFLINE_QUEUED' },
  },
  {
    id: 'inventory',
    name: 'Tallinn Warehouse Stock Verification',
    serviceTarget: 'warehouse-erp-grpc',
    state: 'CLOSED',
    config: {
      failureRateThresholdPercent: 40,
      slowCallRateThresholdPercent: 50,
      slowCallDurationThresholdMs: 300,
      minCallsThreshold: 5,
      slidingWindowSize: 20,
      resetTimeoutMs: 4000,
      halfOpenTrialCalls: 2,
      bulkheadMaxConcurrent: 6,
      bulkheadMaxWaitMs: 200,
    },
    metrics: {
      failureRatePercent: 0,
      slowCallRatePercent: 0,
      totalCalls: 25,
      successCalls: 25,
      failedCalls: 0,
      slowCalls: 0,
      shortCircuitedCalls: 0,
      bulkheadRejections: 0,
      activeConcurrency: 1,
      waitingQueueDepth: 0,
      timeUntilResetMs: null,
    },
    recentRecords: [
      { id: '3', timestamp: Date.now(), outcome: 'SUCCESS', durationMs: 35 },
    ],
    fallbackPayload: { status: 'ESTIMATED_AVAILABLE' },
  },
];

describe('CircuitShield Operations Console', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: mockStats }),
        });
      }
      if (url.includes('/circuits')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: mockCircuits }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      });
    });
  });

  it('renders branding and an open circuits status line', async () => {
    render(<App />);

    expect(screen.getAllByText('CircuitShield').length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(screen.getByText(/1 circuit open/i)).toBeInTheDocument();
      expect(screen.getByText('1,450')).toBeInTheDocument();
      expect(screen.getByText('220')).toBeInTheDocument();
    });
  });

  it('renders circuit rows with state indicators and sliding window', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Stripe / Adyen Payment Gateway')).toBeInTheDocument();
      expect(screen.getByText('Tallinn Warehouse Stock Verification')).toBeInTheDocument();
    });

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('renders the chaos and burst test controls', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Chaos and burst test/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Send 25 requests/i)).toBeInTheDocument();
  });

  it('displays bulkhead concurrency metrics on each circuit row', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('0 / 4')).toBeInTheDocument();
      expect(screen.getByText('1 / 6')).toBeInTheDocument();
    });
  });

  it('associates every chaos simulator control with a label a screen reader can announce', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Chaos and burst test/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Target circuit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Latency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Failure rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Concurrency/i)).toBeInTheDocument();
  });

  it('shows an inline, accessible error instead of a native alert when a call fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/execute')) {
        return Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
          json: async () => ({ success: false, error: 'Internal server error' }),
        });
      }
      if (url.includes('/stats')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: mockStats }) });
      }
      if (url.includes('/circuits')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, data: mockCircuits }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<App />);

    const executeButtons = await screen.findAllByRole('button', { name: /Test call/i });
    fireEvent.click(executeButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Call failed/i);
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });
});