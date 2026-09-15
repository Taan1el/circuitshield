// The one place that decides whether the app talks to the real Express API
// or the in-browser demo. Components import from here, never directly from
// ./api.js or ./demoApi.js, so the choice stays in a single spot.
import * as realApi from './api.js';
import * as demoApi from './demoApi.js';

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

const impl = isDemoMode ? demoApi : realApi;

export const fetchStats = impl.fetchStats;
export const fetchCircuits = impl.fetchCircuits;
export const executeCircuitCall = impl.executeCircuitCall;
export const resetCircuit = impl.resetCircuit;
export const tripCircuit = impl.tripCircuit;
export const updateCircuitConfig = impl.updateCircuitConfig;
export const updateServiceChaos = impl.updateServiceChaos;
export const runBurstTest = impl.runBurstTest;

// Only meaningful in demo mode; the real API has no equivalent action a
// browser client can trigger, so the demo banner is the only caller.
export const resetDemoData = demoApi.resetDemoData;
