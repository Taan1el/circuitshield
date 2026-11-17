import { describe, expect, it } from 'vitest';
import { CircuitService, DEFAULT_CIRCUIT_DEFINITIONS, type CircuitDefinition } from '../../shared/circuit.service.js';

function definition(id: string, overrides: Partial<CircuitDefinition> = {}): CircuitDefinition {
  return {
    id,
    name: `Circuit ${id}`,
    serviceTarget: `${id}-service`,
    config: { failureRateThresholdPercent: 50, minCallsThreshold: 2, slidingWindowSize: 4, resetTimeoutMs: 1000 },
    fallbackPayload: { status: 'FALLBACK' },
    ...overrides,
  };
}

describe('CircuitService definitions', () => {
  it('starts with the three example circuits when given no definitions', () => {
    const service = new CircuitService();
    expect(service.getAllCircuits().map((circuit) => circuit.id)).toEqual(['payments', 'inventory', 'fraud-detection']);
    expect(DEFAULT_CIRCUIT_DEFINITIONS).toHaveLength(3);
  });

  it('runs only the circuits it is given', () => {
    const service = new CircuitService([definition('checkout'), definition('search')]);
    expect(service.getAllCircuits().map((circuit) => circuit.id)).toEqual(['checkout', 'search']);
    expect(service.getCircuit('payments')).toBeUndefined();
    expect(service.getGlobalStats().circuitsCount).toBe(2);
    expect(service.getCircuit('checkout')?.config.resetTimeoutMs).toBe(1000);
  });

  it('can have no circuits at all', () => {
    const service = new CircuitService([]);
    expect(service.getAllCircuits()).toEqual([]);
    expect(service.getGlobalStats()).toMatchObject({ circuitsCount: 0, totalCalls: 0 });
  });

  it('adds and removes circuits and keeps the counters of the ones that did not change', async () => {
    const service = new CircuitService([definition('checkout'), definition('search')]);
    await service.executeCall('checkout');
    await service.executeCall('checkout');

    service.syncDefinitions([definition('search'), definition('checkout'), definition('billing')]);
    expect(service.getAllCircuits().map((circuit) => circuit.id)).toEqual(['search', 'checkout', 'billing']);
    expect(service.getCircuit('checkout')?.metrics.totalCalls).toBe(2);
    expect(service.getCircuit('billing')?.metrics.totalCalls).toBe(0);

    service.syncDefinitions([definition('billing')]);
    expect(service.getCircuit('checkout')).toBeUndefined();
    await expect(service.executeCall('checkout')).rejects.toThrow("Circuit 'checkout' not found");
  });

  it('applies a changed setting to the running breaker without resetting it', async () => {
    const service = new CircuitService([definition('checkout')]);
    await service.executeCall('checkout');
    service.syncDefinitions([definition('checkout', { config: { failureRateThresholdPercent: 20, minCallsThreshold: 2, slidingWindowSize: 4, resetTimeoutMs: 9000 } })]);
    const info = service.getCircuit('checkout')!;
    expect(info.config).toMatchObject({ failureRateThresholdPercent: 20, resetTimeoutMs: 9000 });
    expect(info.metrics.totalCalls).toBe(1);
  });

  it('replaces the breaker when the name or target changes', async () => {
    const service = new CircuitService([definition('checkout')]);
    await service.executeCall('checkout');
    service.syncDefinitions([definition('checkout', { name: 'Checkout API' })]);
    const info = service.getCircuit('checkout')!;
    expect(info.name).toBe('Checkout API');
    expect(info.metrics.totalCalls).toBe(0);
  });

  it('gives a circuit its own starting latency for the simulated service', () => {
    const service = new CircuitService([definition('checkout', { baseLatencyMs: 120 }), definition('search')]);
    expect(service.getDownstreamChaos('checkout').simulatedLatencyMs).toBe(120);
    expect(service.getDownstreamChaos('search').simulatedLatencyMs).toBe(50);
  });
});
