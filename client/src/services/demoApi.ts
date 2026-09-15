// In-browser stand-in for services/api.ts, used on the GitHub Pages build
// (import.meta.env.VITE_DEMO_MODE === 'true') where there is no Express API
// to call. It runs the exact same CircuitService, CircuitBreaker and
// Bulkhead classes the server uses (from shared/), so the breaker's state
// machine, sliding window and bulkhead queueing behave identically; only the
// transport is different. See services/index.ts for the switch.
import type {
  CircuitBreakerInfo,
  CircuitConfig,
  ExecutionResult,
  BurstTestRequest,
  BurstTestResult,
  GlobalStats,
  DownstreamServiceConfig,
} from '../../../shared/types.js';
import { CircuitService } from '../../../shared/circuit.service.js';
import { validateBurstRequest, validateChaosPatch, validateCircuitConfigPatch } from '../../../shared/validation.js';

let service = new CircuitService();

// Wipes the simulated gateway back to its starting state: the same three
// default circuits, zeroed counters and an empty sliding window, the same
// way restarting the real server would.
export function resetDemoData(): void {
  service = new CircuitService();
}

function notFound(circuitId: string): Error {
  // Matches the message the real API sends for a 404 (see
  // server/src/controllers/circuit.controller.ts).
  return new Error(`Circuit '${circuitId}' not found`);
}

export async function fetchStats(): Promise<GlobalStats> {
  return service.getGlobalStats();
}

export async function fetchCircuits(): Promise<CircuitBreakerInfo[]> {
  return service.getAllCircuits();
}

export async function executeCircuitCall(circuitId: string, payload?: unknown): Promise<ExecutionResult> {
  if (!service.getCircuit(circuitId)) throw notFound(circuitId);
  return service.executeCall(circuitId, payload);
}

export async function resetCircuit(circuitId: string): Promise<CircuitBreakerInfo> {
  if (!service.getCircuit(circuitId)) throw notFound(circuitId);
  service.forceReset(circuitId);
  return service.getCircuit(circuitId)!;
}

export async function tripCircuit(circuitId: string): Promise<CircuitBreakerInfo> {
  if (!service.getCircuit(circuitId)) throw notFound(circuitId);
  service.forceTrip(circuitId);
  return service.getCircuit(circuitId)!;
}

export async function updateCircuitConfig(circuitId: string, config: Partial<CircuitConfig>): Promise<CircuitBreakerInfo> {
  const circuit = service.getCircuit(circuitId);
  if (!circuit) throw notFound(circuitId);
  const validated = validateCircuitConfigPatch(config, circuit.config);
  if ('error' in validated) throw new Error(validated.error);
  service.updateCircuitConfig(circuitId, validated.value);
  return service.getCircuit(circuitId)!;
}

export async function updateServiceChaos(
  serviceId: string,
  latencyMs: number,
  errorRatePercent: number
): Promise<DownstreamServiceConfig> {
  const validated = validateChaosPatch({ latencyMs, errorRatePercent });
  if ('error' in validated) throw new Error(validated.error);
  return service.updateDownstreamChaos(serviceId, validated.value.latencyMs, validated.value.errorRatePercent);
}

export async function runBurstTest(req: BurstTestRequest): Promise<BurstTestResult> {
  if (!service.getCircuit(req.circuitId)) throw notFound(req.circuitId);
  const validated = validateBurstRequest({
    concurrency: req.concurrency,
    latencyMs: req.simulatedLatencyMs,
    errorRatePercent: req.simulatedErrorRatePercent,
  });
  if ('error' in validated) throw new Error(validated.error);
  return service.runBurstTest({
    circuitId: req.circuitId,
    concurrency: validated.value.concurrency,
    simulatedLatencyMs: validated.value.latencyMs,
    simulatedErrorRatePercent: validated.value.errorRatePercent,
  });
}
