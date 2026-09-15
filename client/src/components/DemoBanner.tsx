import React from 'react';
import { isDemoMode, resetDemoData } from '../services/index.js';

interface DemoBannerProps {
  onReset: () => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onReset }) => {
  if (!isDemoMode) return null;

  const handleReset = () => {
    if (window.confirm('Reset all circuits back to their starting state?')) {
      resetDemoData();
      onReset();
    }
  };

  return (
    <div className="demo-banner" role="status">
      <span>
        Demo mode: this runs entirely in your browser using the same circuit breaker and bulkhead code as
        the server, with no backend and no data leaving your device.{' '}
        <a href="https://github.com/Taan1el/circuitshield" target="_blank" rel="noreferrer">
          View source on GitHub
        </a>{' '}
        to run the full stack.
      </span>
      <button type="button" className="btn btn-secondary btn-xs" onClick={handleReset}>
        Reset demo data
      </button>
    </div>
  );
};
