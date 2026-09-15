import React, { useState, useEffect, useCallback } from 'react';
import type { GlobalStats, CircuitBreakerInfo } from '../../shared/types.js';
import { fetchStats, fetchCircuits } from './services/index.js';
import { Header } from './components/Header.js';
import { StatsBar } from './components/StatsBar.js';
import { CircuitCard } from './components/CircuitCard.js';
import { ChaosSimulator } from './components/ChaosSimulator.js';
import { DemoBanner } from './components/DemoBanner.js';
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
          <div className="alert alert-error global-alert" role="alert">
            <span>⚠️ {error}</span>
            <button className="btn btn-secondary btn-xs" onClick={() => loadData(true)}>
              Retry
            </button>
          </div>
        )}

        <StatsBar stats={stats} />

        <ChaosSimulator onMutated={() => loadData(false)} />

        <div className="circuits-section">
          <div className="section-title-row">
            <h2 className="section-heading">Protected Microservice Routes ({circuits.length})</h2>
            <span className="section-sub">
              Finite state machines monitoring error rates and slow calls via sliding-window ring buffers.
            </span>
          </div>

          <div className="circuits-grid">
            {circuits.map((circuit) => (
              <CircuitCard
                key={circuit.id}
                circuit={circuit}
                onMutated={() => loadData(false)}
              />
            ))}
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <div>
          <strong>CircuitShield</strong> &bull; Production Distributed Circuit Breaker &amp; Bulkhead Gateway
        </div>
        <div className="footer-links">
          <span>Netflix Hystrix / Resilience4j Spec</span>
          <span>&bull;</span>
          <span>Sliding-Window Ring Buffer</span>
          <span>&bull;</span>
          <span>Sub-Millisecond Fast Fails</span>
        </div>
      </footer>
    </div>
  );
};

export default App;