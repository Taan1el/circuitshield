# ADR-003: Bulkhead Concurrency Isolation and Graceful Fallbacks

## Status
Accepted

## Context
Even when a circuit breaker is in the `CLOSED` state, a sudden surge of requests against a single slow dependency can consume all available event-loop slots or worker connections, starving other healthy services running within the same application process.

## Decision
We implemented Bulkhead Concurrency Isolation:
1. Each protected downstream dependency is assigned an isolated concurrency quota (`bulkheadMaxConcurrent`, e.g. 4 slots for Payments, 6 for Inventory).
2. Incoming calls must acquire a bulkhead slot before dispatching.
3. If all slots are occupied, calls wait in a bounded FIFO queue up to `bulkheadMaxWaitMs`. If the queue overflows or times out, the call is rejected immediately with `BULKHEAD_REJECTED`.
4. Rejections and short-circuited calls execute pre-configured fallback providers, returning cached or degraded payloads (e.g. offline queuing, stale snapshots).

## Consequences
### Positive
- Strict blast-radius containment: a slow endpoint cannot exhaust global gateway resources.
- Deterministic response times even during downstream latency surges.
- Graceful degradation preserves end-user transaction workflows.

### Trade-offs
- Concurrency thresholds must be tuned appropriately per dependency traffic profile.