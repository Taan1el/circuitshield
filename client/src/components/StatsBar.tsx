import React from 'react';
import type { GlobalStats } from '../../../shared/types.js';

interface StatsBarProps {
  stats: GlobalStats | null;
}

export const StatsBar: React.FC<StatsBarProps> = ({ stats }) => {
  if (!stats) {
    return <div className="stats-bar-skeleton">Loading resilience telemetry...</div>;
  }

  const fastFailPercent = stats.totalCalls > 0
    ? ((stats.shortCircuitedCalls / stats.totalCalls) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="stats-bar-grid">
      <div className="stat-card">
        <div className="stat-header">
          <span className="stat-label">Total Calls</span>
          <span className="stat-icon">📊</span>
        </div>
        <div className="stat-value">{stats.totalCalls.toLocaleString()}</div>
        <div className="stat-subtext">Requests evaluated by gateway</div>
      </div>

      <div className="stat-card stat-passed">
        <div className="stat-header">
          <span className="stat-label">Passed Calls</span>
          <span className="stat-icon">✅</span>
        </div>
        <div className="stat-value text-emerald">{stats.passedCalls.toLocaleString()}</div>
        <div className="stat-subtext">Normal &amp; healthy executions</div>
      </div>

      <div className="stat-card stat-fast-fail">
        <div className="stat-header">
          <span className="stat-label">Short-Circuited Fast Fails</span>
          <span className="stat-icon">⚡</span>
        </div>
        <div className="stat-value text-rose">{stats.shortCircuitedCalls.toLocaleString()}</div>
        <div className="stat-subtext">{fastFailPercent}% calls spared network I/O (&lt;1ms)</div>
      </div>

      <div className="stat-card">
        <div className="stat-header">
          <span className="stat-label">Bulkhead Rejections</span>
          <span className="stat-icon">🛡️</span>
        </div>
        <div className="stat-value text-amber">{stats.bulkheadRejections.toLocaleString()}</div>
        <div className="stat-subtext">Concurrency saturation rejections</div>
      </div>

      <div className="stat-card stat-fallbacks">
        <div className="stat-header">
          <span className="stat-label">Fallbacks Served</span>
          <span className="stat-icon">📦</span>
        </div>
        <div className="stat-value text-purple">{stats.fallbacksServed.toLocaleString()}</div>
        <div className="stat-subtext">Gracefully degraded responses</div>
      </div>
    </div>
  );
};