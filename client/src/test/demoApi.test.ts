import { describe, it, expect, beforeEach } from 'vitest';
import * as demoApi from '../services/demoApi.js';

// These exercise the in-browser demo adapter directly (no fetch mocking):
// it wraps the real CircuitService from shared/, so this is effectively an
// end-to-end check that the GitHub Pages build behaves like the real API.
describe('demoApi (in-browser demo adapter)', () => {
  beforeEach(() => {
    demoApi.resetDemoData();
  });

  it('seeds the same three default circuits as the real API', async () => {
    const circuits = await demoApi.fetchCircuits();
    expect(circuits.map((c) => c.id).sort()).toEqual(['fraud-detection', 'inventory', 'payments']);
    expect(circuits.every((c) => c.state === 'CLOSED')).toBe(true);

    const stats = await demoApi.fetchStats();
    expect(stats.circuitsCount).toBe(3);
    expect(stats.totalCalls).toBe(0);
  });

  it('executes a call through the real breaker and bulkhead logic', async () => {
    const result = await demoApi.executeCircuitCall('payments', { amountEur: 42 });
    expect(result.circuitId).toBe('payments');
    expect(['SUCCESS', 'SLOW']).toContain(result.outcome);
    expect(result.isFallback).toBe(false);

    const stats = await demoApi.fetchStats();
    expect(stats.totalCalls).toBe(1);
  });

  it('throws the same not-found message the real API returns, for every id-based call', async () => {
    const notFoundMessage = "Circuit 'does-not-exist' not found";
    await expect(demoApi.executeCircuitCall('does-not-exist')).rejects.toThrow(notFoundMessage);
    await expect(demoApi.resetCircuit('does-not-exist')).rejects.toThrow(notFoundMessage);
    await expect(demoApi.tripCircuit('does-not-exist')).rejects.toThrow(notFoundMessage);
    await expect(demoApi.updateCircuitConfig('does-not-exist', {})).rejects.toThrow(notFoundMessage);
    await expect(demoApi.runBurstTest({ circuitId: 'does-not-exist', concurrency: 1 })).rejects.toThrow(notFoundMessage);
  });

  it('force-trips and resets a circuit', async () => {
    const tripped = await demoApi.tripCircuit('inventory');
    expect(tripped.state).toBe('OPEN');

    const reset = await demoApi.resetCircuit('inventory');
    expect(reset.state).toBe('CLOSED');
  });

  it('validates config updates the same way the real API does', async () => {
    await expect(
      demoApi.updateCircuitConfig('payments', { failureRateThresholdPercent: 500 })
    ).rejects.toThrow(/failureRateThresholdPercent/);

    await expect(
      demoApi.updateCircuitConfig('payments', { slidingWindowSize: 2, minCallsThreshold: 5 })
    ).rejects.toThrow(/minCallsThreshold/);

    const updated = await demoApi.updateCircuitConfig('payments', { resetTimeoutMs: 999 });
    expect(updated.config.resetTimeoutMs).toBe(999);
  });

  it('validates chaos updates and applies valid ones', async () => {
    await expect(demoApi.updateServiceChaos('payments', -1, 0)).rejects.toThrow(/latencyMs/);
    await expect(demoApi.updateServiceChaos('payments', 10, 150)).rejects.toThrow(/errorRatePercent/);

    const chaos = await demoApi.updateServiceChaos('payments', 20, 5);
    expect(chaos).toEqual({ serviceId: 'payments', simulatedLatencyMs: 20, simulatedErrorRatePercent: 5 });
  });

  it('rejects an out-of-range burst concurrency instead of returning a NaN average', async () => {
    await expect(demoApi.runBurstTest({ circuitId: 'payments', concurrency: 0 })).rejects.toThrow(/concurrency/i);
    await expect(demoApi.runBurstTest({ circuitId: 'payments', concurrency: 500 })).rejects.toThrow(/concurrency/i);
  });

  it('runs a burst test and reports a real summary', async () => {
    const result = await demoApi.runBurstTest({
      circuitId: 'inventory',
      concurrency: 8,
      simulatedLatencyMs: 5,
      simulatedErrorRatePercent: 0,
    });
    expect(result.totalRequests).toBe(8);
    expect(result.successes).toBe(8);
    expect(Number.isFinite(result.avgLatencyMs)).toBe(true);
  });

  it('resetDemoData wipes state back to the starting scenario', async () => {
    await demoApi.tripCircuit('payments');
    await demoApi.executeCircuitCall('inventory');

    demoApi.resetDemoData();

    const circuits = await demoApi.fetchCircuits();
    const stats = await demoApi.fetchStats();
    expect(circuits.every((c) => c.state === 'CLOSED')).toBe(true);
    expect(stats.totalCalls).toBe(0);
  });
});
