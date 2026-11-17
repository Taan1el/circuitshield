import React from 'react';
import type { ReplayResult } from '../../../shared/replay.js';
import { describeTransition, formatClock, formatDuration, spansDays, summarizeReplay } from '../../../shared/replay-summary.js';
import type { CircuitState } from '../../../shared/types.js';
import { ReplayChart } from './ReplayChart.js';

const STATE_NAME: Record<CircuitState, string> = { CLOSED: 'Closed', OPEN: 'Open', HALF_OPEN: 'Half-open' };

interface ReplayResultsProps {
  result: ReplayResult;
  label: string;
  /** False when the timeline has no latency figures, so slow-call settings cannot matter. */
  hasLatency: boolean;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

export const ReplayResults: React.FC<ReplayResultsProps> = ({ result, label, hasLatency }) => {
  const withDate = spansDays(result);
  const openShare = result.spanMs > 0 ? `${Math.round((result.msOpen / result.spanMs) * 100)}% of the timeline` : 'the timeline has no length';

  return (
    <div className="replay-results">
      <p className="replay-summary">{summarizeReplay(result)}</p>
      {!hasLatency && (
        <p className="field-help">
          This timeline has no latency figures, so the slow call settings have no effect on it.
        </p>
      )}

      <dl className="replay-metrics">
        <div className="metric">
          <dt>Calls short-circuited</dt>
          <dd className="mono">{count(result.shortCircuited)}</dd>
          <dd className="metric-note">of {count(result.totalCalls)} calls</dd>
        </div>
        <div className="metric">
          <dt>Failed calls still reaching users</dt>
          <dd className="mono">{count(result.errorsReachingUsers)}</dd>
          <dd className="metric-note">{count(result.errorsInTimeline)} with no breaker</dd>
        </div>
        <div className="metric">
          <dt>Healthy calls blocked</dt>
          <dd className="mono">{count(result.healthyBlocked)}</dd>
          <dd className="metric-note">would have succeeded</dd>
        </div>
        <div className="metric">
          <dt>Time open</dt>
          <dd className="mono">{formatDuration(result.msOpen)}</dd>
          <dd className="metric-note">{openShare}</dd>
        </div>
        <div className="metric">
          <dt>Times opened</dt>
          <dd className="mono">{result.timesOpened}</dd>
          <dd className="metric-note">{result.timesOpened === 0 ? 'never tripped' : `first ${formatClock(result.firstOpenedAtMs as number, withDate)} UTC`}</dd>
        </div>
      </dl>

      <ReplayChart result={result} label={label} />

      <h4 className="table-heading">State changes for {label}</h4>
      {result.transitions.length === 0 ? (
        <p className="empty-note">The breaker stayed closed for the whole timeline.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label={`State changes for ${label}`} tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Time (UTC)</th>
                <th scope="col">Into the timeline</th>
                <th scope="col">Now</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {result.transitions.map((transition, index) => (
                <tr key={`${transition.atMs}-${index}`}>
                  <th scope="row" className="mono">{formatClock(transition.atMs, withDate)}</th>
                  <td className="mono">{formatDuration(transition.atMs - result.startMs)}</td>
                  <td>{STATE_NAME[transition.to]}</td>
                  <td>{describeTransition(transition, result.settings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
