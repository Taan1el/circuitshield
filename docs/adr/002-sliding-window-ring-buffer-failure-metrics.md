# ADR-002: Sliding-Window Ring Buffer for Failure & Slow-Call Metrics

## Status
Accepted

## Context
Evaluating service health using cumulative historical counters causes hysteresis: an old incident dilutes current recovery, while a short burst of traffic can trigger false alarms. We need a localized, recent view of service performance.

## Decision
We implemented a count-based rolling sliding window using a fixed-size ring buffer:
1. A bounded ring buffer retains the last $N$ call outcomes (default: 20 calls).
2. Each record stores timestamp, outcome (`SUCCESS`, `FAILURE`, `SLOW`, `SHORT_CIRCUITED`, `BULKHEAD_REJECTED`), and duration in milliseconds.
3. Health evaluations require a minimum call volume (`minCallsThreshold`, default 5 calls) before tripping evaluations activate, preventing premature trips on single errors.
4. Slow calls exceeding `slowCallDurationThresholdMs` are tracked separately to catch degraded latency before outright socket disconnects.

## Consequences
### Positive
- Strict $O(1)$ space and execution complexity per request.
- Fast adaptation to changing downstream conditions.
- Resistance to false alarms on low-volume initialization.

### Trade-offs
- Rapid bursts exceeding window size displace older calls quickly.