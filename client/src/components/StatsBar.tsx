import React from 'react';
import type { GlobalStats } from '../../../shared/types.js';

interface StatsBarProps {
  stats: GlobalStats | null;
}

export const StatsBar: React.FC<StatsBarProps> = ({ stats }) => {
  if (!stats) {
    return <div className="stats-strip-loading">Loading telemetry.</div>;
  }

  const fastFailPercent = stats.totalCalls > 0
    ? ((stats.shortCircuitedCalls / stats.totalCalls) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="stats-strip">
      <div className="stat-cell">
        <span className="stat-label">Total calls</span>
        <span className="stat-value">{stats.totalCalls.toLocaleString()}</span>
      </div>

      <div className="stat-cell">
        <span className="stat-label">Passed</span>
        <span className="stat-value">{stats.passedCalls.toLocaleString()}</span>
      </div>

      <div className="stat-cell">
        <span className="stat-label">Fast-failed</span>
        <span className="stat-value">{stats.shortCircuitedCalls.toLocaleString()}</span>
        <span className="stat-note">{fastFailPercent}% of calls</span>
      </div>

      <div className="stat-cell">
        <span className="stat-label">Bulkhead rejections</span>
        <span className="stat-value">{stats.bulkheadRejections.toLocaleString()}</span>
      </div>

      <div className="stat-cell">
        <span className="stat-label">Fallbacks served</span>
        <span className="stat-value">{stats.fallbacksServed.toLocaleString()}</span>
      </div>
    </div>
  );
};
