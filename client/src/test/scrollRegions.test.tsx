import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.js';
import type { GlobalStats, CircuitBreakerInfo } from '../../../shared/types.js';

const stats: GlobalStats = {
  totalCalls: 1450,
  passedCalls: 1200,
  shortCircuitedCalls: 220,
  bulkheadRejections: 30,
  fallbacksServed: 250,
  circuitsCount: 2,
  openCircuitsCount: 1,
};

function makeCircuit(
  id: string,
  name: string,
  state: CircuitBreakerInfo['state'],
  failureRate: number,
): CircuitBreakerInfo {
  return {
    id,
    name,
    serviceTarget: `${id}-service`,
    state,
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
      failureRatePercent: failureRate,
      slowCallRatePercent: 0,
      totalCalls: 40,
      successCalls: 10,
      failedCalls: 30,
      slowCalls: 0,
      shortCircuitedCalls: 12,
      bulkheadRejections: 0,
      activeConcurrency: 0,
      waitingQueueDepth: 0,
      timeUntilResetMs: state === 'OPEN' ? 3200 : null,
    },
    recentRecords: [
      { id: `${id}-1`, timestamp: Date.now(), outcome: 'FAILURE', durationMs: 450 },
      { id: `${id}-2`, timestamp: Date.now(), outcome: 'SUCCESS', durationMs: 35 },
    ],
    fallbackPayload: { status: 'DEGRADED' },
  };
}

const circuits = [
  makeCircuit('payments', 'Payment Gateway', 'OPEN', 75),
  makeCircuit('inventory', 'Warehouse Stock', 'CLOSED', 0),
];

const SCROLL_SELECTOR = '.value-preview, [style*="overflow"]';

function expectScrollersFocusable(container: HTMLElement) {
  const scrollers = Array.from(container.querySelectorAll<HTMLElement>(SCROLL_SELECTOR));
  for (const el of scrollers) {
    expect(el).toHaveAttribute('role', 'region');
    expect(el).toHaveAttribute('tabindex', '0');
    expect((el.getAttribute('aria-label') ?? '').trim()).not.toBe('');
  }
  return scrollers.length;
}

describe('scrollable regions are keyboard reachable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const data = url.includes('/stats') ? stats : url.includes('/circuits') ? circuits : {};
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data }) });
    });
  });

  it('breaker list and chaos panel', async () => {
    const { container } = render(<App />);
    await screen.findByText('Payment Gateway');
    await screen.findByText(/Chaos and burst test/i);
    expectScrollersFocusable(container);
  });

  it('expanded row with the fallback response shown', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole('button', { name: /Payment Gateway/ }));
    await user.click(screen.getAllByRole('button', { name: /Show fallback response/ })[0]);
    expect(expectScrollersFocusable(container)).toBeGreaterThan(0);
  });
});
