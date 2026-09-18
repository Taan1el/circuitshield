import type { CircuitState, CallOutcome } from '../../../shared/types.js';

// A single place mapping the breaker's three states to their display text
// and status-dot color, reused by the circuits table and the burst result
// panel so both read the same way.
export const STATE_LABEL: Record<CircuitState, string> = {
  CLOSED: 'Closed',
  OPEN: 'Open',
  HALF_OPEN: 'Half-open',
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
