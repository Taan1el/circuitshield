export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type CallOutcome = 'SUCCESS' | 'FAILURE' | 'SLOW' | 'SHORT_CIRCUITED' | 'BULKHEAD_REJECTED';

export interface CallRecord {
  id: string;
  timestamp: number;
  outcome: CallOutcome;
  durationMs: number;
  errorMessage?: string;
}

export interface CircuitConfig {
  failureRateThresholdPercent: number; // e.g. 50%
  slowCallRateThresholdPercent: number; // e.g. 50%
  slowCallDurationThresholdMs: number; // e.g. 500ms
  minCallsThreshold: number; // e.g. 5 calls before evaluating
  slidingWindowSize: number; // e.g. 20 calls ring buffer
  resetTimeoutMs: number; // cooldown before HALF_OPEN, e.g. 5000ms
  halfOpenTrialCalls: number; // number of probe calls in HALF_OPEN, e.g. 3
  bulkheadMaxConcurrent: number; // max concurrent active calls, e.g. 5
  bulkheadMaxWaitMs: number; // max queue wait before rejection, e.g. 200ms
}

export interface CircuitMetrics {
  failureRatePercent: number;
  slowCallRatePercent: number;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  slowCalls: number;
  shortCircuitedCalls: number;
  bulkheadRejections: number;
  activeConcurrency: number;
  waitingQueueDepth: number;
  timeUntilResetMs: number | null;
}

export interface CircuitBreakerInfo {
  id: string;
  name: string;
  serviceTarget: string;
  state: CircuitState;
  config: CircuitConfig;
  metrics: CircuitMetrics;
  recentRecords: CallRecord[];
  fallbackPayload: Record<string, unknown>;
}

export interface DownstreamServiceConfig {
  serviceId: string;
  simulatedLatencyMs: number;
  simulatedErrorRatePercent: number;
}

export interface ExecutionResult {
  circuitId: string;
  state: CircuitState;
  outcome: CallOutcome;
  durationMs: number;
  data: unknown;
  isFallback: boolean;
  error?: string;
}

export interface BurstTestRequest {
  circuitId: string;
  concurrency: number;
  simulatedLatencyMs?: number;
  simulatedErrorRatePercent?: number;
}

export interface BurstTestResult {
  circuitId: string;
  totalRequests: number;
  successes: number;
  failures: number;
  shortCircuits: number;
  bulkheadRejections: number;
  fallbacksServed: number;
  avgLatencyMs: number;
  finalCircuitState: CircuitState;
}

export interface GlobalStats {
  totalCalls: number;
  passedCalls: number;
  shortCircuitedCalls: number;
  bulkheadRejections: number;
  fallbacksServed: number;
  circuitsCount: number;
  openCircuitsCount: number;
}