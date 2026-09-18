import React, { useState } from 'react';
import type { BurstTestResult } from '../../../shared/types.js';
import { runBurstTest, updateServiceChaos } from '../services/index.js';
import { STATE_DOT, STATE_LABEL } from '../utils/circuitState.js';

const CIRCUIT_OPTIONS = [
  { value: 'payments', label: 'Payments' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'fraud-detection', label: 'Fraud detection' },
];

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleApplyChaos = async () => {
    setIsApplying(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await updateServiceChaos(selectedCircuit, latencyMs, errorRate);
      setStatusMsg(`Applied to ${selectedCircuit}: ${latencyMs}ms latency, ${errorRate}% errors.`);
      onMutated();
    } catch (err: any) {
      setErrorMsg(`Failed to apply chaos profile: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleRunBurst = async () => {
    setIsRunningBurst(true);
    setBurstResult(null);
    setErrorMsg(null);
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
      setErrorMsg(`Burst test failed: ${err.message}`);
    } finally {
      setIsRunningBurst(false);
    }
  };

  return (
    <section className="chaos-section" aria-labelledby="chaos-heading">
      <div className="chaos-form">
        <div>
          <h2 id="chaos-heading" className="section-heading">Chaos and burst test</h2>
          <p className="section-description">
            Set a downstream latency and failure rate, then send a concurrent burst through the circuit.
          </p>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="chaos-target-circuit">Target circuit</label>
          <select
            id="chaos-target-circuit"
            value={selectedCircuit}
            onChange={(e) => setSelectedCircuit(e.target.value)}
            disabled={isRunningBurst}
          >
            {CIRCUIT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <div className="field-row">
            <label className="field-label" htmlFor="chaos-latency">Latency</label>
            <span className="field-value">{latencyMs} ms</span>
          </div>
          <input
            id="chaos-latency"
            type="range"
            min="10"
            max="1000"
            step="20"
            value={latencyMs}
            onChange={(e) => setLatencyMs(Number(e.target.value))}
            disabled={isRunningBurst}
            aria-valuetext={`${latencyMs} milliseconds`}
          />
        </div>

        <div className="field">
          <div className="field-row">
            <label className="field-label" htmlFor="chaos-error-rate">Failure rate</label>
            <span className="field-value">{errorRate}%</span>
          </div>
          <input
            id="chaos-error-rate"
            type="range"
            min="0"
            max="100"
            step="5"
            value={errorRate}
            onChange={(e) => setErrorRate(Number(e.target.value))}
            disabled={isRunningBurst}
            aria-valuetext={`${errorRate} percent`}
          />
        </div>

        <div className="field">
          <div className="field-row">
            <label className="field-label" htmlFor="chaos-concurrency">Concurrency</label>
            <span className="field-value">{concurrency} requests</span>
          </div>
          <input
            id="chaos-concurrency"
            type="range"
            min="5"
            max="50"
            step="5"
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            disabled={isRunningBurst}
            aria-valuetext={`${concurrency} requests`}
          />
        </div>

        {errorMsg && <p className="inline-error" role="alert">{errorMsg}</p>}

        <div className="chaos-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleApplyChaos}
            disabled={isApplying || isRunningBurst}
          >
            {isApplying ? 'Applying' : 'Apply chaos'}
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRunBurst}
            disabled={isRunningBurst}
          >
            {isRunningBurst ? (
              <>
                <span className="spinner"></span> Sending
              </>
            ) : (
              `Send ${concurrency} requests`
            )}
          </button>
        </div>

        {statusMsg && <p className="status-note">{statusMsg}</p>}
      </div>

      <div className="chaos-results">
        <h3 className="panel-heading">Burst result</h3>
        {burstResult ? (
          <div>
            <div className="result-top">
              <span className="mono">{burstResult.circuitId}</span>
              <span className="status-line">
                <span className={`status-dot ${STATE_DOT[burstResult.finalCircuitState]}`}></span>
                {STATE_LABEL[burstResult.finalCircuitState]}
              </span>
            </div>
            <dl className="result-list">
              <div className="result-row">
                <dt>Requests</dt>
                <dd className="mono">{burstResult.totalRequests}</dd>
              </div>
              <div className="result-row">
                <dt>Successes</dt>
                <dd className="mono">{burstResult.successes}</dd>
              </div>
              <div className="result-row">
                <dt>Failures</dt>
                <dd className="mono">{burstResult.failures}</dd>
              </div>
              <div className="result-row">
                <dt>Fast-failed</dt>
                <dd className="mono">{burstResult.shortCircuits}</dd>
              </div>
              <div className="result-row">
                <dt>Bulkhead rejections</dt>
                <dd className="mono">{burstResult.bulkheadRejections}</dd>
              </div>
              <div className="result-row">
                <dt>Average duration</dt>
                <dd className="mono">{burstResult.avgLatencyMs} ms</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="empty-note">Send a burst to see results here.</p>
        )}
      </div>
    </section>
  );
};
