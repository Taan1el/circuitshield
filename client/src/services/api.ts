import type {
  CircuitBreakerInfo,
  CircuitConfig,
  ExecutionResult,
  BurstTestRequest,
  BurstTestResult,
  GlobalStats,
  DownstreamServiceConfig,
} from '../../../shared/types.js';

const API_BASE = '/api';

export async function fetchStats(): Promise<GlobalStats> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function fetchCircuits(): Promise<CircuitBreakerInfo[]> {
  const res = await fetch(`${API_BASE}/circuits`);
  if (!res.ok) throw new Error(`Failed to fetch circuits: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function executeCircuitCall(circuitId: string, payload?: any): Promise<ExecutionResult> {
  const res = await fetch(`${API_BASE}/circuits/${encodeURIComponent(circuitId)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) throw new Error(`Execution failed: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function resetCircuit(circuitId: string): Promise<CircuitBreakerInfo> {
  const res = await fetch(`${API_BASE}/circuits/${encodeURIComponent(circuitId)}/reset`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Reset failed: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function tripCircuit(circuitId: string): Promise<CircuitBreakerInfo> {
  const res = await fetch(`${API_BASE}/circuits/${encodeURIComponent(circuitId)}/trip`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Trip failed: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function updateCircuitConfig(circuitId: string, config: Partial<CircuitConfig>): Promise<CircuitBreakerInfo> {
  const res = await fetch(`${API_BASE}/circuits/${encodeURIComponent(circuitId)}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Config update failed: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function updateServiceChaos(serviceId: string, latencyMs: number, errorRatePercent: number): Promise<DownstreamServiceConfig> {
  const res = await fetch(`${API_BASE}/services/${encodeURIComponent(serviceId)}/chaos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latencyMs, errorRatePercent }),
  });
  if (!res.ok) throw new Error(`Chaos update failed: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function runBurstTest(req: BurstTestRequest): Promise<BurstTestResult> {
  const res = await fetch(`${API_BASE}/circuits/${encodeURIComponent(req.circuitId)}/burst-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Burst test failed: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}