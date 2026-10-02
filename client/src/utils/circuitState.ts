import type { CircuitState, CallOutcome } from '../../../shared/types.js';

// A single place mapping the breaker's three states to their plate label
// and status color, reused by the breaker rows and the burst result panel.
export const STATE_LABEL: Record<CircuitState, string> = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF-OPEN',
};

export const STATE_DOT: Record<CircuitState, 'ok' | 'warn' | 'bad'> = {
  CLOSED: 'ok',
  OPEN: 'bad',
  HALF_OPEN: 'warn',
};

// Short mono labels for a sliding-window call outcome chip.
export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  SUCCESS: 'OK',
  FAILURE: 'ERR',
  SLOW: 'SLOW',
  SHORT_CIRCUITED: 'FAST-FAIL',
  BULKHEAD_REJECTED: 'QUEUED',
};
