import { CircuitBreaker } from '../circuit/circuit-breaker.js';
import type {
  CircuitBreakerInfo,
  CircuitConfig,
  DownstreamServiceConfig,
  ExecutionResult,
  BurstTestRequest,
  BurstTestResult,
  GlobalStats,
} from '../../../shared/types.js';

export class CircuitService {
  private circuits = new Map<string, CircuitBreaker>();
  private downstreamChaos = new Map<string, DownstreamServiceConfig>();

  constructor() {
    this.initDefaultCircuits();
  }

  private initDefaultCircuits(): void {
    // 1. Payment Gateway Circuit
    const paymentCircuit = new CircuitBreaker(
      'payments',
      'Stripe / Adyen Payment Gateway',
      'payment-provider-cluster',
      {
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
      {
        status: 'DEGRADED_OFFLINE_QUEUED',
        message: 'Payment received and queued in offline reconciliation journal. Ledger will settle once gateway recovers.',
        settlementDelaySeconds: 60,
      }
    );

    // 2. Inventory Reservation Circuit
    const inventoryCircuit = new CircuitBreaker(
      'inventory',
      'Tallinn Warehouse Stock Verification',
      'warehouse-erp-grpc',
      {
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
      {
        status: 'ESTIMATED_AVAILABLE',
        availableUnits: 250,
        source: 'local_cached_snapshot',
        staleWarning: 'Inventory verified via local cache while warehouse API is degraded',
      }
    );

    // 3. Fraud Detection Circuit
    const fraudCircuit = new CircuitBreaker(
      'fraud-detection',
      'AI Real-Time Fraud & AML Scoring',
      'aml-risk-engine-api',
      {
        failureRateThresholdPercent: 50,
        slowCallRateThresholdPercent: 50,
        slowCallDurationThresholdMs: 350,
        minCallsThreshold: 5,
        slidingWindowSize: 20,
        resetTimeoutMs: 4500,
        halfOpenTrialCalls: 3,
        bulkheadMaxConcurrent: 5,
        bulkheadMaxWaitMs: 150,
      },
      {
        status: 'ALLOW_WITH_MANUAL_REVIEW',
        riskScore: 0.15,
        ruleHit: 'CIRCUIT_BREAKER_FALLBACK',
        flaggedForAudit: true,
      }
    );

    this.circuits.set('payments', paymentCircuit);
    this.circuits.set('inventory', inventoryCircuit);
    this.circuits.set('fraud-detection', fraudCircuit);

    // Initial downstream configs (healthy)
    this.downstreamChaos.set('payments', { serviceId: 'payments', simulatedLatencyMs: 60, simulatedErrorRatePercent: 0 });
    this.downstreamChaos.set('inventory', { serviceId: 'inventory', simulatedLatencyMs: 40, simulatedErrorRatePercent: 0 });
    this.downstreamChaos.set('fraud-detection', { serviceId: 'fraud-detection', simulatedLatencyMs: 80, simulatedErrorRatePercent: 0 });
  }

  public getAllCircuits(): CircuitBreakerInfo[] {
    return Array.from(this.circuits.values()).map((c) => c.getInfo());
  }

  public getCircuit(id: string): CircuitBreakerInfo | undefined {
    const circuit = this.circuits.get(id);
    return circuit ? circuit.getInfo() : undefined;
  }

  public async executeCall(circuitId: string, customPayload?: any): Promise<ExecutionResult> {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) throw new Error(`Circuit '${circuitId}' not found`);

    const chaos = this.downstreamChaos.get(circuitId) || {
      serviceId: circuitId,
      simulatedLatencyMs: 50,
      simulatedErrorRatePercent: 0,
    };

    return circuit.execute(async () => {
      // Simulate network latency
      if (chaos.simulatedLatencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, chaos.simulatedLatencyMs));
      }

      // Simulate network error
      const isError = Math.random() * 100 < chaos.simulatedErrorRatePercent;
      if (isError) {
        throw new Error(`Downstream 503 Service Unavailable: upstream timeout on target`);
      }

      return {
        confirmed: true,
        transactionId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        circuitId,
        latencyMs: chaos.simulatedLatencyMs,
        timestamp: new Date().toISOString(),
        payload: customPayload || { amountEur: 120, target: 'Estonia-Merchant-1' },
      };
    });
  }

  public forceReset(circuitId: string): void {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) throw new Error(`Circuit '${circuitId}' not found`);
    circuit.forceReset();
  }

  public forceTrip(circuitId: string): void {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) throw new Error(`Circuit '${circuitId}' not found`);
    circuit.tripOpen();
  }

  public updateCircuitConfig(circuitId: string, config: Partial<CircuitConfig>): void {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) throw new Error(`Circuit '${circuitId}' not found`);
    circuit.updateConfig(config);
  }

  public updateDownstreamChaos(serviceId: string, latencyMs: number, errorRatePercent: number): DownstreamServiceConfig {
    const chaos: DownstreamServiceConfig = {
      serviceId,
      simulatedLatencyMs: Math.max(0, latencyMs),
      simulatedErrorRatePercent: Math.min(100, Math.max(0, errorRatePercent)),
    };
    this.downstreamChaos.set(serviceId, chaos);
    return chaos;
  }

  public getDownstreamChaos(serviceId: string): DownstreamServiceConfig {
    return this.downstreamChaos.get(serviceId) || {
      serviceId,
      simulatedLatencyMs: 50,
      simulatedErrorRatePercent: 0,
    };
  }

  public async runBurstTest(req: BurstTestRequest): Promise<BurstTestResult> {
    const { circuitId, concurrency } = req;
    const count = Math.min(Math.max(1, concurrency), 100);

    if (req.simulatedLatencyMs !== undefined || req.simulatedErrorRatePercent !== undefined) {
      const existing = this.getDownstreamChaos(circuitId);
      this.updateDownstreamChaos(
        circuitId,
        req.simulatedLatencyMs ?? existing.simulatedLatencyMs,
        req.simulatedErrorRatePercent ?? existing.simulatedErrorRatePercent
      );
    }

    const promises: Promise<ExecutionResult>[] = [];
    for (let i = 0; i < count; i++) {
      promises.push(this.executeCall(circuitId));
    }

    const results = await Promise.all(promises);

    const successes = results.filter((r) => r.outcome === 'SUCCESS' || r.outcome === 'SLOW').length;
    const failures = results.filter((r) => r.outcome === 'FAILURE').length;
    const shortCircuits = results.filter((r) => r.outcome === 'SHORT_CIRCUITED').length;
    const bulkheadRejections = results.filter((r) => r.outcome === 'BULKHEAD_REJECTED').length;
    const fallbacksServed = results.filter((r) => r.isFallback).length;
    const avgLatencyMs = Number(
      (results.reduce((acc, r) => acc + r.durationMs, 0) / results.length).toFixed(2)
    );

    const circuit = this.circuits.get(circuitId)!;
    const finalState = circuit.getInfo().state;

    return {
      circuitId,
      totalRequests: count,
      successes,
      failures,
      shortCircuits,
      bulkheadRejections,
      fallbacksServed,
      avgLatencyMs,
      finalCircuitState: finalState,
    };
  }

  public getGlobalStats(): GlobalStats {
    let totalCalls = 0;
    let passedCalls = 0;
    let shortCircuitedCalls = 0;
    let bulkheadRejections = 0;
    let fallbacksServed = 0;
    let openCircuitsCount = 0;

    for (const circuit of this.circuits.values()) {
      const info = circuit.getInfo();
      totalCalls += info.metrics.totalCalls;
      passedCalls += info.metrics.successCalls + info.metrics.slowCalls;
      shortCircuitedCalls += info.metrics.shortCircuitedCalls;
      bulkheadRejections += info.metrics.bulkheadRejections;
      fallbacksServed += info.metrics.shortCircuitedCalls + info.metrics.failedCalls + info.metrics.bulkheadRejections;
      if (info.state === 'OPEN') {
        openCircuitsCount++;
      }
    }

    return {
      totalCalls,
      passedCalls,
      shortCircuitedCalls,
      bulkheadRejections,
      fallbacksServed,
      circuitsCount: this.circuits.size,
      openCircuitsCount,
    };
  }
}