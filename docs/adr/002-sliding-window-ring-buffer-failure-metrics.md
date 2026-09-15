# ADR-002: Sliding-Window Buffer for Failure & Slow-Call Metrics

## Status
Accepted

## Context
Evaluating service health using cumulative historical counters causes hysteresis: an old incident dilutes current recovery, while a short burst of traffic can trigger false alarms. We need a localized, recent view of service performance.

## Decision
We implemented a count-based rolling sliding window, a bounded array that drops the oldest call once it is full:
1. The window retains the last $N$ call outcomes (`slidingWindowSize`, default 20 calls).
2. Each record stores timestamp, outcome (`SUCCESS`, `FAILURE`, `SLOW`, `SHORT_CIRCUITED`, `BULKHEAD_REJECTED`), and duration in milliseconds.
3. Health evaluations require a minimum call volume (`minCallsThreshold`, default 5 calls) before tripping evaluations activate, preventing premature trips on single errors. `minCallsThreshold` is rejected by the config API if it would exceed `slidingWindowSize`, since the window could then never hold enough calls to evaluate.
4. Slow calls exceeding `slowCallDurationThresholdMs` are tracked separately to catch degraded latency before outright socket disconnects, and count against the circuit the same way failures do (including during a `HALF_OPEN` trial probe).

## Consequences
### Positive
- $O(1)$ space per circuit, bounded by `slidingWindowSize` regardless of how many calls it has served.
- Fast adaptation to changing downstream conditions: only the last `slidingWindowSize` calls matter, not the circuit's whole lifetime.
- Resistance to false alarms on low-volume initialization.

### Trade-offs
- Evaluating the window is $O(N)$ in `slidingWindowSize`, not $O(1)$: each call recomputes the failure and slow-call rate over the whole window. At the default size of 20 (and the 10,000-call ceiling the config API enforces) this cost is negligible, but it is not free.
- Rapid bursts exceeding window size displace older calls quickly.