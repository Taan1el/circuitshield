import React, { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { GlobalStats, CircuitBreakerInfo } from '../../shared/types.js';
import { fetchStats, fetchCircuits, isDemoMode, setCircuitDefinitions } from './services/index.js';
import { Header } from './components/Header.js';
import { StatsBar } from './components/StatsBar.js';
import { CircuitsTable } from './components/CircuitsTable.js';
import { ChaosSimulator } from './components/ChaosSimulator.js';
import { DemoBanner } from './components/DemoBanner.js';
import { WorkspaceBar } from './components/WorkspaceBar.js';
import { CircuitManager } from './components/CircuitManager.js';
import { IncidentLab } from './components/IncidentLab.js';
import { subscribeWorkspace, workspaceState } from './local/circuitWorkspace.js';
import { toDefinition } from './local/workspaceFile.js';
import { formatCount } from './utils/pluralize.js';
import './App.css';

export const App: React.FC = () => {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [circuits, setCircuits] = useState<CircuitBreakerInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const workspace = useSyncExternalStore(subscribeWorkspace, workspaceState, workspaceState);
  const inWorkspace = isDemoMode && workspace.mode === 'workspace';
  const workspaceCircuits = workspace.data?.circuits;

  const loadData = useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const [statsData, circuitsData] = await Promise.all([
        fetchStats(),
        fetchCircuits(),
      ]);
      setStats(statsData);
      setCircuits(circuitsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load circuit data');
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }, []);

  // In your workspace the console runs your own circuits instead of the three
  // examples. Circuits that did not change keep their counters.
  const circuitsKey = inWorkspace ? JSON.stringify(workspaceCircuits ?? []) : 'sample';
  useEffect(() => {
    if (!isDemoMode || !workspace.ready) return;
    setCircuitDefinitions(inWorkspace ? (workspaceCircuits ?? []).map(toDefinition) : null);
    void loadData(false);
    // The circuit list is tracked through circuitsKey, which changes exactly when its content does.
  }, [circuitsKey, workspace.ready, inWorkspace]);

  useEffect(() => {
    loadData(true);
    // Poll telemetry every 2 seconds for live countdowns and sliding window updates
    const timer = setInterval(() => {
      loadData(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [loadData]);

  const openCircuits = circuits.filter((c) => c.state === 'OPEN').length;

  return (
    <div className="app-container">
      <DemoBanner onReset={() => loadData(true)} mode={inWorkspace ? 'workspace' : 'sample'} />
      {isDemoMode && <WorkspaceBar />}
      <Header
        totalCircuits={circuits.length}
        openCount={openCircuits}
        onRefresh={() => loadData(true)}
        isLoading={isLoading}
      >
        <StatsBar stats={stats} />
      </Header>

      <main className="app-main">
        {error && (
          <div className="alert alert-error" role="alert">
            <span className="alert-message">
              <TriangleAlert size={16} aria-hidden="true" /> {error}
            </span>
            <button className="btn btn-secondary" onClick={() => loadData(true)}>
              Retry
            </button>
          </div>
        )}

        <section aria-labelledby="circuits-heading">
          <h2 id="circuits-heading" className="section-heading">
            {formatCount(circuits.length, 'circuit')}
          </h2>
          <p className="section-description">
            Each circuit tracks its own failure and slow-call rate over a sliding window of recent calls.
          </p>
          <CircuitsTable circuits={circuits} onMutated={() => loadData(false)} />
          {inWorkspace && <CircuitManager circuits={workspaceCircuits ?? []} />}
        </section>

        <IncidentLab persisted={isDemoMode} />

        <ChaosSimulator circuits={circuits} onMutated={() => loadData(false)} />
      </main>

      <footer className="app-footer">
        <div><strong>CircuitShield</strong> / MIT License</div>
        <div className="footer-links">
          <a href="https://github.com/Taan1el/circuitshield" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
};

export default App;
