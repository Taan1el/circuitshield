import React from 'react';
import { RefreshCw } from 'lucide-react';
import { pluralize } from '../utils/pluralize.js';

interface HeaderProps {
  totalCircuits: number;
  openCount: number;
  onRefresh: () => void;
  isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({ totalCircuits, openCount, onRefresh, isLoading }) => {
  return (
    <header className="app-header">
      <div className="header-inner">
        <div>
          <h1 className="brand-name">CircuitShield</h1>
          <p className="brand-subtitle">
            Circuit breaker and bulkhead gateway that trips a failing route, isolates its concurrency, and
            heals it back once the downstream call recovers.
          </p>
          <div className="header-meta">
            <span className="badge">v1.0</span>
            <span className="status-line">
              <span className={`status-dot ${openCount > 0 ? 'bad' : 'ok'}`}></span>
              {openCount > 0 ? `${openCount} ${pluralize(openCount, 'circuit')} open` : 'All circuits closed'}
            </span>
          </div>
        </div>

        <div className="header-actions">
          <span className="key-count">
            <strong>{totalCircuits}</strong> {pluralize(totalCircuits, 'circuit')} monitored
          </span>
          <button
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={isLoading}
            title="Manual refresh"
          >
            <RefreshCw size={16} aria-hidden="true" />
            {isLoading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>
    </header>
  );
};
