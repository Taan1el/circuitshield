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
    <div className="demo-bar" role="status">
      <div className="demo-bar-inner">
        <span>Demo: everything runs in your browser with sample data.</span>
        <span className="demo-bar-links">
          <button type="button" className="link-btn" onClick={handleReset}>
            Reset sample data
          </button>
          <a href="https://github.com/Taan1el/circuitshield" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </span>
      </div>
    </div>
  );
};
