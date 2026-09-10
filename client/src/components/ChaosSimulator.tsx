import React, { useState } from 'react';
import type { BurstTestResult } from '../../../shared/types.js';
import { runBurstTest, updateServiceChaos } from '../services/api.js';

interface ChaosSimulatorProps {
  onMutated: () => void;
}

export const ChaosSimulator: React.FC<ChaosSimulatorProps> = ({ onMutated }) => {
  const [selectedCircuit, setSelectedCircuit] = useState('payments');
  const [latencyMs, setLatencyMs] = useState(150);
  const [errorRate, setErrorRate] = useState(60);
  const [concurrency, setConcurrency] = useState(25);
  const [isApplying, setIsApplying] = useState(false);
  const [isRunningBurst, setIsRunningBurst] = useState(false);
  const [burstResult, setBurstResult] = useState<BurstTestResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleApplyChaos = async () => {
    setIsApplying(true);
    setStatusMsg(null);
    try {
      await updateServiceChaos(selectedCircuit, latencyMs, errorRate);
      setStatusMsg(`Chaos profile applied to ${selectedCircuit}: ${latencyMs}ms, ${errorRate}% errors`);
      onMutated();
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleRunBurst = async () => {
    setIsRunningBurst(true);
    setBurstResult(null);
    try {
      const result = await runBurstTest({
        circuitId: selectedCircuit,
        concurrency,
        simulatedLatencyMs: latencyMs,
        simulatedErrorRatePercent: errorRate,
      });
      setBurstResult(result);
      onMutated();
    } catch (err: any) {
      alert(`Burst failed: ${err.message}`);
    } finally {
      setIsRunningBurst(false);
    }
  };

  return (
    <div className="chaos-simulator-card">
      <div className="card-header">
        <span className="section-badge badge-red">Chaos Injection &amp; Stress Test</span>
        <h2 className="card-title">Downstream Dependency Chaos &amp; Burst Generator</h2>
        <p className="card-subtitle">
          Inject latency and errors into downstream microservices, then fire concurrent bursts to witness the Circuit Breaker trip and protect the system with sub-millisecond fallbacks.
        </p>
      </div>

      <div className="sim-controls-grid">
        <div className="sim-group">
          <label className="form-label">Target Service Circuit</label>
          <select
            className="form-select"
            value={selectedCircuit}
            onChange={(e) => setSelectedCircuit(e.target.value)}
            disabled={isRunningBurst}
          >
            <option value="payments">Stripe / Adyen Payments (payments)</option>
            <option value="inventory">Warehouse Inventory (inventory)</option>
            <option value="fraud-detection">AI Risk &amp; Fraud (fraud-detection)</option>
          </select>
        </div>

        <div className="sim-group">
          <div className="slider-label-row">
            <label className="form-label">Simulated Latency</label>
            <span className="slider-val">{latencyMs} ms</span>
          </div>
          <input
            type="range"
            min="10"
            max="1000"
            step="20"
            value={latencyMs}
            onChange={(e) => setLatencyMs(Number(e.target.value))}
            className="slider-range"
            disabled={isRunningBurst}
          />
        </div>

        <div className="sim-group">
          <div className="slider-label-row">
            <label className="form-label">Simulated Failure Rate</label>
            <span className="slider-val text-rose">{errorRate}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={errorRate}
            onChange={(e) => setErrorRate(Number(e.target.value))}
            className="slider-range"
            disabled={isRunningBurst}
          />
        </div>

        <div className="sim-group">
          <div className="slider-label-row">
            <label className="form-label">Burst Concurrency</label>
            <span className="slider-val text-cyan">{concurrency} reqs</span>
          </div>
          <input
            type="range"
            min="5"
            max="50"
            step="5"
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className="slider-range"
            disabled={isRunningBurst}
          />
        </div>
      </div>

      <div className="sim-action-row">
        <button
          type="button"
          className="btn btn-secondary btn-md"
          onClick={handleApplyChaos}
          disabled={isApplying || isRunningBurst}
        >
          {isApplying ? 'Applying...' : 'Apply Downstream Chaos'}
        </button>

        <button
          type="button"
          className="btn btn-primary btn-md"
          onClick={handleRunBurst}
          disabled={isRunningBurst}
        >
          {isRunningBurst ? (
            <>
              <span className="spinner"></span> Firing {concurrency} Requests...
            </>
          ) : (
            <>🚀 Fire {concurrency} Concurrent Requests</>
          )}
        </button>

        {statusMsg && <span className="status-note">{statusMsg}</span>}
      </div>

      {burstResult && (
        <div className="burst-results-box">
          <div className="burst-results-header">
            <h3>Burst Summary for <code>{burstResult.circuitId}</code></h3>
            <span className={`state-badge state-${burstResult.finalCircuitState.toLowerCase()}`}>
              Final State: {burstResult.finalCircuitState}
            </span>
          </div>

          <div className="burst-metrics-grid">
            <div className="burst-stat">
              <span className="b-label">Total Requests</span>
              <span className="b-val">{burstResult.totalRequests}</span>
            </div>
            <div className="burst-stat">
              <span className="b-label">Successes</span>
              <span className="b-val text-emerald">{burstResult.successes}</span>
            </div>
            <div className="burst-stat">
              <span className="b-label">Downstream Failures</span>
              <span className="b-val text-rose">{burstResult.failures}</span>
            </div>
            <div className="burst-stat">
              <span className="b-label">Short-Circuits (&lt;1ms)</span>
              <span className="b-val text-amber">{burstResult.shortCircuits}</span>
            </div>
            <div className="burst-stat">
              <span className="b-label">Bulkhead Rejections</span>
              <span className="b-val text-purple">{burstResult.bulkheadRejections}</span>
            </div>
            <div className="burst-stat">
              <span className="b-label">Avg Duration</span>
              <span className="b-val">{burstResult.avgLatencyMs} ms</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};