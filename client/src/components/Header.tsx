import React from 'react';

interface HeaderProps {
  totalCircuits: number;
  openCount: number;
  onRefresh: () => void;
  isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  totalCircuits,
  openCount,
  onRefresh,
  isLoading,
}) => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-logo">
          <span className="brand-icon">🛡️</span>
          <div className="pulse-ring"></div>
        </div>
        <div className="brand-titles">
          <div className="brand-row">
            <h1 className="brand-name">CircuitShield</h1>
            <span className="badge badge-version">v1.0</span>
            {openCount > 0 ? (
              <span className="badge badge-danger blink">
                ⚠️ {openCount} Circuit{openCount > 1 ? 's' : ''} OPEN
              </span>
            ) : (
              <span className="badge badge-success">
                ✓ All Systems Protected
              </span>
            )}
          </div>
          <p className="brand-subtitle">
            Distributed Circuit Breaker Gateway, Bulkhead Isolation &amp; Adaptive Fault Tolerance
          </p>
        </div>
      </div>

      <div className="header-actions">
        <div className="live-pill">
          <span className={`live-dot ${openCount > 0 ? 'dot-open' : 'dot-closed'}`}></span>
          <span>{totalCircuits} Circuits Monitored</span>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onRefresh}
          disabled={isLoading}
          title="Manual refresh"
        >
          {isLoading ? 'Polling...' : '↻ Refresh'}
        </button>
      </div>
    </header>
  );
};