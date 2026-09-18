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
    <div className="table-wrapper">
      <table className="circuits-table">
        <thead>
          <tr>
            <th scope="col">Circuit</th>
            <th scope="col">State</th>
            <th scope="col">Failure rate</th>
            <th scope="col">Concurrency</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {circuits.map((circuit) => {
            const { id, state, config, metrics } = circuit;
            const isExpanded = expandedId === id;
            const lastResult = lastResults[id];
            const rowError = rowErrors[id];
            const showFallback = showFallbackId === id;

            return (
              <React.Fragment key={id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="circuit-name-btn"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedId(isExpanded ? null : id)}
                    >
                      {isExpanded ? (
                        <ChevronUp size={16} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={16} aria-hidden="true" />
                      )}
                      <span>
                        <span className="circuit-name">{circuit.name}</span>
                        <span className="circuit-target mono">{circuit.serviceTarget}</span>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="status-line">
                      <span className={`status-dot ${STATE_DOT[state]}`}></span>
                      {STATE_LABEL[state]}
                    </span>
                  </td>
                  <td className="mono">{metrics.failureRatePercent}%</td>
                  <td className="mono">{metrics.activeConcurrency} / {config.bulkheadMaxConcurrent}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-row"
                        onClick={() => handleExecute(id)}
                        disabled={executingId === id}
                        title="Execute one request through this circuit"
                      >
                        {executingId === id ? 'Calling' : 'Test call'}
                      </button>
                      {state === 'OPEN' ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-row"
                          onClick={() => handleReset(id)}
                          title="Force this circuit back to closed"
                        >
                          Reset
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-danger btn-row"
                          onClick={() => handleTrip(id)}
                          title="Force this circuit open"
                        >
                          Trip circuit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {rowError && (
                  <tr className="detail-row">
                    <td colSpan={5}>
                      <p className="inline-error" role="alert">{rowError}</p>
                    </td>
                  </tr>
                )}

                {isExpanded && (
                  <tr className="detail-row">
                    <td colSpan={5}>
                      <div className="circuit-detail">
                        {state === 'OPEN' && metrics.timeUntilResetMs !== null && (
                          <p className="detail-note">
                            Probe in <span className="mono">{(metrics.timeUntilResetMs / 1000).toFixed(1)}s</span>
                          </p>
                        )}

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

                        <div className="detail-meters">
                          <div className="meter-row">
                            <div className="meter-label-row">
                              <span>Failure rate</span>
                              <span className="mono">
                                {metrics.failureRatePercent}%{' '}
                                <span className="ink-3">trips at {config.failureRateThresholdPercent}%</span>
                              </span>
                            </div>
                            <div className="meter-track">
                              <div
                                className="meter-fill"
                                style={{
                                  width: `${Math.min(100, metrics.failureRatePercent)}%`,
                                  backgroundColor: metrics.failureRatePercent >= config.failureRateThresholdPercent
                                    ? 'var(--bad)'
                                    : 'var(--accent)',
                                }}
                              ></div>
                              <div
                                className="meter-marker"
                                style={{ left: `${config.failureRateThresholdPercent}%` }}
                                title={`Threshold ${config.failureRateThresholdPercent}%`}
                              ></div>
                            </div>
                          </div>

                          <div className="meter-row">
                            <div className="meter-label-row">
                              <span>Bulkhead concurrency</span>
                              <span className="mono">
                                {metrics.activeConcurrency} / {config.bulkheadMaxConcurrent},{' '}
                                {metrics.waitingQueueDepth} waiting
                              </span>
                            </div>
                            <div className="meter-track">
                              <div
                                className="meter-fill"
                                style={{
                                  width: `${Math.min(100, (metrics.activeConcurrency / config.bulkheadMaxConcurrent) * 100)}%`,
                                }}
                              ></div>
                            </div>
                          </div>
                        </div>

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
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
