import React from 'react';
import type { GlobalStats } from '../../../shared/types.js';

interface StatsBarProps {
  stats: GlobalStats | null;
}

export const StatsBar: React.FC<StatsBarProps> = ({ stats }) => {
  if (!stats) {
    return <p className="tally-loading">Loading telemetry.</p>;
  }

  const fastFailPercent = stats.totalCalls > 0
    ? ((stats.shortCircuitedCalls / stats.totalCalls) * 100).toFixed(1)
    : '0.0';

  const rows: Array<[string, number, string?]> = [
    ['Total calls', stats.totalCalls],
    ['Passed', stats.passedCalls],
    ['Fast-failed', stats.shortCircuitedCalls, `${fastFailPercent}% of calls`],
    ['Bulkhead rejections', stats.bulkheadRejections],
    ['Fallbacks served', stats.fallbacksServed],
  ];

  return (
    <dl className="tally">
      {rows.map(([label, value, note]) => (
        <div className="tally-row" key={label}>
          <dt>{label}</dt>
          <dd>
            {note && <span className="tally-note">{note}</span>}
            <span className="tally-value">{value.toLocaleString()}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
};
