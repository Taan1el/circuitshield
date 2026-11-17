import React from 'react';
import { isDemoMode, resetDemoData } from '../services/index.js';
import { resetSampleTuning, type WorkspaceMode } from '../local/circuitWorkspace.js';

interface DemoBannerProps {
  onReset: () => void;
  mode?: WorkspaceMode;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onReset, mode = 'sample' }) => {
  if (!isDemoMode) return null;

  const handleReset = () => {
    if (window.confirm('Reset all circuits back to their starting state?')) {
      resetDemoData();
      // The sample thresholds go back too. A saved workspace is never touched.
      resetSampleTuning();
      onReset();
    }
  };

  return (
    <div className="demo-bar" role="status">
      <div className="demo-bar-inner">
        <span>
          {mode === 'sample'
            ? 'Demo: everything runs in your browser with sample data.'
            : 'Your workspace: circuits, thresholds and timeline saved in this browser.'}
        </span>
        <span className="demo-bar-links">
          {mode === 'sample' && (
            <button type="button" className="link-btn" onClick={handleReset}>
              Reset sample data
            </button>
          )}
          <a href="https://github.com/Taan1el/circuitshield" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </span>
      </div>
    </div>
  );
};
