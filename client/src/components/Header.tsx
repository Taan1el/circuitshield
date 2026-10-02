import React from 'react';
import { RefreshCw } from 'lucide-react';
import { pluralize } from '../utils/pluralize.js';

interface HeaderProps {
  totalCircuits: number;
  openCount: number;
  onRefresh: () => void;
  isLoading: boolean;
  children?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ totalCircuits, openCount, onRefresh, isLoading, children }) => {
  return (
    <header className="plate">
      <div className="plate-main">
        <h1 className="brand-name">CircuitShield</h1>
        <p className="brand-subtitle">
          Circuit breaker and bulkhead gateway that trips a failing route, isolates its concurrency, and
          heals it back once the downstream call recovers.
        </p>
        <div className="plate-actions">
          <button className="btn btn-secondary" onClick={onRefresh} disabled={isLoading} title="Manual refresh">
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            {isLoading ? 'Refreshing' : 'Refresh'}
          </button>
          <span className="key-count">
            {totalCircuits} {pluralize(totalCircuits, 'circuit')} monitored
          </span>
        </div>
      </div>

      <div className="plate-side">
        <div className={`overall ${openCount > 0 ? 'bad' : 'ok'}`}>
          <span className="overall-label">Panel state</span>
          <span className="overall-value">
            {openCount > 0 ? `${openCount} ${pluralize(openCount, 'circuit')} open` : 'All circuits closed'}
          </span>
        </div>
        {children}
      </div>
    </header>
  );
};
