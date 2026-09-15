import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { Bulkhead } from '../src/bulkhead/bulkhead.js';
import { CircuitBreaker } from '../src/circuit/circuit-breaker.js';
import { CircuitService } from '../src/services/circuit.service.js';
import { createApp } from '../src/app.js';

describe('Bulkhead Concurrency Limiter', () => {
  it('enforces maximum concurrent execution slots and queues excess', async () => {
    const bulkhead = new Bulkhead(2, 50); // max 2 concurrent, 50ms wait

    const release1 = await bulkhead.acquire();
    const release2 = await bulkhead.acquire();

    expect(bulkhead.getActiveCount()).toBe(2);

    // Third call should fail with timeout when not released within 50ms
    await expect(bulkhead.acquire()).rejects.toThrow(/BULKHEAD_REJECTED/);

    release1();
    expect(bulkhead.getActiveCount()).toBe(1);

    // Now acquisition succeeds
    const release3 = await bulkhead.acquire();
    expect(bulkhead.getActiveCount()).toBe(2);

    release2();
    release3();
    expect(bulkhead.getActiveCount()).toBe(0);
  });
});

describe('CircuitBreaker Finite State Machine', () => {
  let circuit: CircuitBreaker;

  beforeEach(() => {
    circuit = new CircuitBreaker(
      'test-circuit',
      'Test Circuit',
      'test-downstream',
      {
        minCallsThreshold: 4,
        failureRateThresholdPercent: 50,
        resetTimeoutMs: 150, // short for test
        halfOpenTrialCalls: 2,
        bulkheadMaxConcurrent: 10,
      },
      { fallback: true }
    );
  });

  it('starts in CLOSED state and handles successful calls', async () => {
    const res = await circuit.execute(async () => 'hello');
    expect(res.state).toBe('CLOSED');
    expect(res.outcome).toBe('SUCCESS');
    expect(res.data).toBe('hello');
    expect(res.isFallback).toBe(false);
  });

  it('trips OPEN when failure rate breaches threshold after min calls', async () => {
    // 2 successes, 2 failures => 50% failure rate over 4 calls
    await circuit.execute(async () => 'ok');
    await circuit.execute(async () => 'ok');
    await circuit.execute(async () => { throw new Error('fail'); });
    await circuit.execute(async () => { throw new Error('fail'); });

    expect(circuit.getInfo().state).toBe('OPEN');

    // Immediate next call must be SHORT_CIRCUITED in <2ms with fallback
    const start = performance.now();
    const fastFail = await circuit.execute(async () => 'never called');
    const elapsed = performance.now() - start;

    expect(fastFail.state).toBe('OPEN');
    expect(fastFail.outcome).toBe('SHORT_CIRCUITED');
    expect(fastFail.isFallback).toBe(true);
    expect(fastFail.data).toEqual({ fallback: true });
    expect(elapsed).toBeLessThan(10);
  });

  it('transitions from OPEN to HALF_OPEN after cooldown, and heals to CLOSED upon successful probes', async () => {
    circuit.tripOpen();
    expect(circuit.getInfo().state).toBe('OPEN');

    // Wait for cooldown (150ms)
    await new Promise((r) => setTimeout(r, 180));

    // First call after cooldown should trigger HALF_OPEN
    const probe1 = await circuit.execute(async () => 'probe1 ok');
    expect(probe1.state).toBe('HALF_OPEN');
    expect(probe1.outcome).toBe('SUCCESS');

    // Second trial call succeeds, should heal circuit to CLOSED
    const probe2 = await circuit.execute(async () => 'probe2 ok');
    expect(probe2.state).toBe('CLOSED');
    expect(circuit.getInfo().state).toBe('CLOSED');
  });

  it('trips back to OPEN if a probe fails during HALF_OPEN', async () => {
    circuit.tripOpen();
    await new Promise((r) => setTimeout(r, 180));

    // Probe failure
    const failedProbe = await circuit.execute(async () => { throw new Error('downstream still dead'); });
    expect(failedProbe.isFallback).toBe(true);
    expect(circuit.getInfo().state).toBe('OPEN');
  });

  it('treats a slow probe during HALF_OPEN as a failed probe instead of healing the circuit', async () => {
    const slowCircuit = new CircuitBreaker(
      'slow-probe-circuit',
      'Slow Probe Circuit',
      'test-downstream',
      {
        minCallsThreshold: 4,
        failureRateThresholdPercent: 50,
        resetTimeoutMs: 150,
        halfOpenTrialCalls: 2,
        bulkheadMaxConcurrent: 10,
        slowCallDurationThresholdMs: 20,
      },
      { fallback: true }
    );

    slowCircuit.tripOpen();
    await new Promise((r) => setTimeout(r, 180));

    // The probe answers successfully but takes longer than the slow-call
    // threshold, so the downstream is still effectively unhealthy.
    const slowProbe = await slowCircuit.execute(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return 'slow but alive';
    });

    expect(slowProbe.outcome).toBe('SLOW');
    expect(slowProbe.isFallback).toBe(false);
    expect(slowProbe.state).toBe('OPEN');
    expect(slowCircuit.getInfo().state).toBe('OPEN');
  });
});

describe('CircuitShield Service & REST API Integration', () => {
  let app: any;
  let service: CircuitService;

  beforeEach(() => {
    service = new CircuitService();
    const created = createApp(service);
    app = created.app;
  });

  it('GET /api/health returns gateway status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('CircuitShield');
    expect(res.body.circuitsCount).toBe(3);
  });

  it('GET /api/circuits lists default configured circuits', async () => {
    const res = await request(app).get('/api/circuits');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.data.some((c: any) => c.id === 'payments')).toBe(true);
  });

  it('POST /api/circuits/:id/execute executes call through circuit', async () => {
    const res = await request(app).post('/api/circuits/payments/execute').send({
      payload: { testOrder: 'ord_123' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('SUCCESS');
    expect(res.body.data.isFallback).toBe(false);
  });

  it('POST /api/circuits/:id/trip and /api/circuits/:id/reset control circuit state', async () => {
    const tripRes = await request(app).post('/api/circuits/payments/trip');
    expect(tripRes.status).toBe(200);
    expect(tripRes.body.data.state).toBe('OPEN');

    const execRes = await request(app).post('/api/circuits/payments/execute');
    expect(execRes.body.data.outcome).toBe('SHORT_CIRCUITED');
    expect(execRes.body.data.isFallback).toBe(true);

    const resetRes = await request(app).post('/api/circuits/payments/reset');
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.data.state).toBe('CLOSED');
  });

  it('POST /api/circuits/:id/burst-test executes concurrent traffic and returns summary', async () => {
    const res = await request(app)
      .post('/api/circuits/inventory/burst-test')
      .send({ concurrency: 10, latencyMs: 10, errorRatePercent: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data.totalRequests).toBe(10);
    expect(res.body.data.successes).toBe(10);
  });
});