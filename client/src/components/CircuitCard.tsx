import React, { useState } from 'react';
import type { CircuitBreakerInfo, ExecutionResult } from '../../../shared/types.js';
import { executeCircuitCall, resetCircuit, tripCircuit } from '../services/index.js';

interface CircuitCardProps {
  circuit: CircuitBreakerInfo;
  onMutated: () => void;
}

export const CircuitCard: React.FC<CircuitCardProps> = ({ circuit, onMutated }) => {
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleExecute = async () => {
    setExecuting(true);
    setActionError(null);
    try {
      const result = await executeCircuitCall(circuit.id);
      setLastResult(result);
      onMutated();
    } catch (err: any) {
      setActionError(`Call failed: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const handleReset = async () => {
    setActionError(null);
    try {
      await resetCircuit(circuit.id);
      onMutated();
    } catch (err: any) {
      setActionError(`Reset failed: ${err.message}`);
    }
  };

  const handleTrip = async () => {
    setActionError(null);
    try {
      await tripCircuit(circuit.id);
      onMutated();
    } catch (err: any) {
      setActionError(`Trip failed: ${err.message}`);
    }
  };

  const { state, config, metrics, recentRecords } = circuit;

  const failureThreshold = config.failureRateThresholdPercent;
  const currentFailureRate = metrics.failureRatePercent;
  const isTripRisk = currentFailureRate >= failureThreshold * 0.7;

  return (
    <div className={`circuit-card state-border-${state.toLowerCase()}`}>
      <div className="circuit-header">
        <div className="circuit-title-area">
          <div className="circuit-name-row">
            <h3 className="circuit-name">{circuit.name}</h3>
            <span className={`state-badge state-${state.toLowerCase()}`}>
              {state === 'CLOSED' && '🟢 CLOSED'}
              {state === 'OPEN' && '🔴 OPEN (Tripped)'}
              {state === 'HALF_OPEN' && '🟡 HALF-OPEN (Probing)'}
            </span>
          </div>
          <span className="target-service-tag">
            Target: <code>{circuit.serviceTarget}</code>
          </span>
        </div>

        <div className="circuit-btn-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={handleExecute}
            disabled={executing}
            title="Execute 1 request through circuit"
          >
            {executing ? '...' : '⚡ Test 1 Call'}
          </button>
          {state === 'OPEN' ? (
            <button className="btn btn-secondary btn-sm" onClick={handleReset} title="Force reset to CLOSED">
              Reset
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={handleTrip} title="Force trip to OPEN">
              Force Trip
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <p className="inline-error" role="alert">{actionError}</p>
      )}

      {/* Countdown timer if OPEN */}
      {state === 'OPEN' && metrics.timeUntilResetMs !== null && (
        <div className="reset-countdown-bar">
          <span>⏳ Cooldown before trial probe: <strong>{(metrics.timeUntilResetMs / 1000).toFixed(1)}s</strong></span>
        </div>
      )}

      {/* Sliding Window Ring Buffer */}
      <div className="ring-buffer-section">
        <div className="ring-header">
          <span className="ring-label">Sliding Window (Last {recentRecords.length} / {config.slidingWindowSize} calls)</span>
          <span className="ring-legend">
            <span className="legend-item"><span className="bead bead-success"></span> OK</span>
            <span className="legend-item"><span className="bead bead-failure"></span> ERR</span>
            <span className="legend-item"><span className="bead bead-slow"></span> SLOW</span>
            <span className="legend-item"><span className="bead bead-short"></span> FAST-FAIL</span>
          </span>
        </div>
        <div className="ring-beads-row">
          {recentRecords.length === 0 ? (
            <span className="ring-empty">Window empty (cold circuit)</span>
          ) : (
            recentRecords.slice(0, config.slidingWindowSize).map((rec) => (
              <div
                key={rec.id}
                className={`bead bead-${rec.outcome.toLowerCase()}`}
                title={`${rec.outcome} (${rec.durationMs}ms)`}
              >
                {rec.outcome === 'SUCCESS' && '✓'}
                {rec.outcome === 'FAILURE' && '✕'}
                {rec.outcome === 'SLOW' && '⏱'}
                {rec.outcome === 'SHORT_CIRCUITED' && '⊘'}
                {rec.outcome === 'BULKHEAD_REJECTED' && '!'}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Metrics & Threshold Gauges */}
      <div className="gauges-grid">
        <div className="gauge-box">
          <div className="gauge-label-row">
            <span>Failure Rate</span>
            <span className={`gauge-val ${isTripRisk ? 'text-rose' : ''}`}>
              {currentFailureRate}% <span className="gauge-thresh">(Trip: &ge;{failureThreshold}%)</span>
            </span>
          </div>
          <div className="gauge-track">
            <div
              className={`gauge-fill ${currentFailureRate >= failureThreshold ? 'fill-danger' : 'fill-primary'}`}
              style={{ width: `${Math.min(100, currentFailureRate)}%` }}
            ></div>
            <div
              className="threshold-marker"
              style={{ left: `${failureThreshold}%` }}
              title={`Threshold: ${failureThreshold}%`}
            ></div>
          </div>
        </div>

        <div className="gauge-box">
          <div className="gauge-label-row">
            <span>Bulkhead Concurrency</span>
            <span className="gauge-val">
              {metrics.activeConcurrency} / {config.bulkheadMaxConcurrent} active
            </span>
          </div>
          <div className="gauge-track">
            <div
              className="gauge-fill fill-amber"
              style={{ width: `${Math.min(100, (metrics.activeConcurrency / config.bulkheadMaxConcurrent) * 100)}%` }}
            ></div>
          </div>
          <span className="gauge-sub">Queue: {metrics.waitingQueueDepth} waiting</span>
        </div>
      </div>

      {/* Last Result Banner */}
      {lastResult && (
        <div className={`last-result-banner ${lastResult.isFallback ? 'banner-fallback' : 'banner-success'}`}>
          <div className="res-top">
            <span className="res-tag">
              Outcome: <strong>{lastResult.outcome}</strong> ({lastResult.durationMs}ms)
            </span>
            <span className={`res-badge ${lastResult.isFallback ? 'badge-fallback' : 'badge-normal'}`}>
              {lastResult.isFallback ? '📦 Fallback Served' : '✓ Direct Passthrough'}
            </span>
          </div>
          {lastResult.error && <p className="res-error">{lastResult.error}</p>}
        </div>
      )}

      {/* Fallback Inspector Toggle */}
      <div className="fallback-toggle-row">
        <button
          type="button"
          className="btn-text"
          onClick={() => setShowFallback(!showFallback)}
        >
          {showFallback ? 'Hide Fallback Response ▲' : 'View Configured Fallback Response ▼'}
        </button>
        {showFallback && (
          <pre className="fallback-pre">
            {JSON.stringify(circuit.fallbackPayload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};