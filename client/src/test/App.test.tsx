import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('renders branding and open circuits warning banner', async () => {
    render(<App />);

    expect(screen.getAllByText('CircuitShield').length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(screen.getByText(/1 Circuit OPEN/i)).toBeInTheDocument();
      expect(screen.getByText('1,450')).toBeInTheDocument();
      expect(screen.getByText('220')).toBeInTheDocument();
    });
  });

  it('renders circuit cards with state indicators and sliding window', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Stripe / Adyen Payment Gateway')).toBeInTheDocument();
      expect(screen.getByText('Tallinn Warehouse Stock Verification')).toBeInTheDocument();
    });

    expect(screen.getByText(/OPEN \(Tripped\)/i)).toBeInTheDocument();
    expect(screen.getByText(/CLOSED/i)).toBeInTheDocument();
  });

  it('renders chaos injection and burst traffic generator', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Downstream Dependency Chaos & Burst Generator/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Fire 25 Concurrent Requests/i)).toBeInTheDocument();
  });

  it('displays bulkhead concurrency metrics on cards', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('0 / 4 active')).toBeInTheDocument();
      expect(screen.getByText('1 / 6 active')).toBeInTheDocument();
    });
  });
});