import React, { useState, useEffect, useCallback } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { GlobalStats, CircuitBreakerInfo } from '../../shared/types.js';
import { fetchStats, fetchCircuits } from './services/index.js';
import { Header } from './components/Header.js';
import { StatsBar } from './components/StatsBar.js';
import { CircuitsTable } from './components/CircuitsTable.js';
import { ChaosSimulator } from './components/ChaosSimulator.js';
import { DemoBanner } from './components/DemoBanner.js';
import { formatCount } from './utils/pluralize.js';
import './App.css';

export const App: React.FC = () => {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [circuits, setCircuits] = useState<CircuitBreakerInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
      <DemoBanner onReset={() => loadData(true)} />
      <Header
        totalCircuits={circuits.length}
        openCount={openCircuits}
        onRefresh={() => loadData(true)}
        isLoading={isLoading}
      />

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

        <StatsBar stats={stats} />

        <ChaosSimulator onMutated={() => loadData(false)} />

        <section aria-labelledby="circuits-heading">
          <h2 id="circuits-heading" className="section-heading">
            {formatCount(circuits.length, 'circuit')}
          </h2>
          <p className="section-description">
            Each circuit tracks its own failure and slow-call rate over a sliding window of recent calls.
          </p>
          <CircuitsTable circuits={circuits} onMutated={() => loadData(false)} />
        </section>
      </main>

      <footer className="app-footer">
        <div><strong>CircuitShield</strong> &bull; MIT License</div>
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
