import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CircuitBreakerInfo, ExecutionResult } from '../../../shared/types.js';
import { executeCircuitCall, resetCircuit, tripCircuit } from '../services/index.js';
import { pluralize } from '../utils/pluralize.js';
import { OUTCOME_LABEL, STATE_DOT, STATE_LABEL } from '../utils/circuitState.js';

interface CircuitsTableProps {
  circuits: CircuitBreakerInfo[];
  onMutated: () => void;
}

export const CircuitsTable: React.FC<CircuitsTableProps> = ({ circuits, onMutated }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<Record<string, ExecutionResult>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [showFallbackId, setShowFallbackId] = useState<string | null>(null);

  const setRowError = (id: string, message: string) => {
    setRowErrors((prev) => ({ ...prev, [id]: message }));
  };

  const handleExecute = async (id: string) => {
    setExecutingId(id);
    setRowError(id, '');
    try {
      const result = await executeCircuitCall(id);
      setLastResults((prev) => ({ ...prev, [id]: result }));
      onMutated();
    } catch (err: any) {
      setRowError(id, `Call failed: ${err.message}`);
    } finally {
      setExecutingId(null);
    }
  };

  const handleReset = async (id: string) => {
    setRowError(id, '');
    try {
      await resetCircuit(id);
      onMutated();
    } catch (err: any) {
      setRowError(id, `Reset failed: ${err.message}`);
    }
  };

  const handleTrip = async (id: string) => {
    setRowError(id, '');
    try {
      await tripCircuit(id);
      onMutated();
    } catch (err: any) {
      setRowError(id, `Trip failed: ${err.message}`);
    }
  };

  if (circuits.length === 0) {
    return <p className="empty-note">No circuits configured.</p>;
  }

  return (
    <ul className="breakers">
      {circuits.map((circuit) => {
        const { id, state, config, metrics } = circuit;
        const isExpanded = expandedId === id;
        const lastResult = lastResults[id];
        const rowError = rowErrors[id];
        const showFallback = showFallbackId === id;
        const overThreshold = metrics.failureRatePercent >= config.failureRateThresholdPercent;
        const loadPercent = Math.min(100, (metrics.activeConcurrency / config.bulkheadMaxConcurrent) * 100);

        return (
          <li key={id} className="breaker">
            <div className="breaker-row">
              <div className={`state-plate ${STATE_DOT[state]}`}>
                <span className="state-label">{STATE_LABEL[state]}</span>
                {state === 'OPEN' && metrics.timeUntilResetMs !== null && (
                  <span className="state-note">Probe in {(metrics.timeUntilResetMs / 1000).toFixed(1)}s</span>
                )}
              </div>

              <div className="breaker-body">
                <button
                  type="button"
                  className="circuit-name-btn"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(isExpanded ? null : id)}
                >
                  {isExpanded ? (
                    <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                  )}
                  <span>
                    <span className="circuit-name">{circuit.name}</span>
                    <span className="circuit-target mono">{circuit.serviceTarget}</span>
                  </span>
                </button>

                <div className="meters">
                  <div className="meter-row">
                    <span className="meter-name">Failure rate</span>
                    <div className="meter-track">
                      <div
                        className={`meter-fill ${overThreshold ? 'bad' : ''}`}
                        style={{ width: `${Math.min(100, metrics.failureRatePercent)}%` }}
                      ></div>
                      <div
                        className="meter-marker"
                        style={{ left: `${config.failureRateThresholdPercent}%` }}
                        title={`Threshold ${config.failureRateThresholdPercent}%`}
                      ></div>
                    </div>
                    <span className="meter-value mono">{metrics.failureRatePercent}%</span>
                  </div>
                  <div className="meter-row">
                    <span className="meter-name">Bulkhead</span>
                    <div className="meter-track">
                      <div className="meter-fill" style={{ width: `${loadPercent}%` }}></div>
                    </div>
                    <span className="meter-value mono">{metrics.activeConcurrency} / {config.bulkheadMaxConcurrent}</span>
                  </div>
                </div>
              </div>

              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleExecute(id)}
                  disabled={executingId === id}
                  title="Execute one request through this circuit"
                >
                  {executingId === id ? 'Calling' : 'Test call'}
                </button>
                {state === 'OPEN' ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleReset(id)}
                    title="Force this circuit back to closed"
                  >
                    Reset
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleTrip(id)}
                    title="Force this circuit open"
                  >
                    Trip circuit
                  </button>
                )}
              </div>
            </div>

            {rowError && <p className="inline-error" role="alert">{rowError}</p>}

            {isExpanded && (
              <div className="circuit-detail">
                <div className="detail-block">
                  <span className="detail-label">
                    Last {circuit.recentRecords.length} of {config.slidingWindowSize} {pluralize(config.slidingWindowSize, 'call')}
                  </span>
                  <div className="call-chips">
                    {circuit.recentRecords.length === 0 ? (
                      <span className="ink-3">Window empty</span>
                    ) : (
                      circuit.recentRecords.map((rec) => (
                        <span
                          key={rec.id}
                          className={`call-chip call-${rec.outcome.toLowerCase()}`}
                          title={`${rec.outcome}, ${rec.durationMs}ms`}
                        >
                          {OUTCOME_LABEL[rec.outcome]}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <p className="detail-note">
                  Trips at <span className="mono">{config.failureRateThresholdPercent}%</span> failures.{' '}
                  <span className="mono">{metrics.waitingQueueDepth}</span> waiting for a bulkhead slot.
                </p>

                {lastResult && (
                  <p className="detail-note">
                    Last call: <span className="mono">{lastResult.outcome}</span> in{' '}
                    <span className="mono">{lastResult.durationMs}ms</span>,{' '}
                    {lastResult.isFallback ? 'served fallback' : 'direct passthrough'}
                    {lastResult.error && `. ${lastResult.error}`}
                  </p>
                )}

                <div>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setShowFallbackId(showFallback ? null : id)}
                  >
                    {showFallback ? 'Hide fallback response' : 'Show fallback response'}
                  </button>
                  {showFallback && (
                    <pre className="value-preview">{JSON.stringify(circuit.fallbackPayload, null, 2)}</pre>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
