# ADR-001: Finite State Machine Circuit Breaker Pattern

## Status
Accepted

## Context
When microservices depend on external APIs (e.g. payment gateways, inventory ERPs, fraud scoring), network latency spikes or upstream outages can cause calls to block and fail. If incoming traffic continues unabated, thread pools, socket descriptors, and event loops exhaust rapidly, triggering cascading failure across the entire service cluster.

## Decision
We implemented a strict three-state Finite State Machine (FSM) conforming to Martin Fowler, Netflix Hystrix, and Resilience4j specifications:
1. **`CLOSED`**: All requests dispatched downstream. Outcomes recorded to a sliding-window ring buffer. If failure or slow call rate breaches threshold, the breaker trips to `OPEN`.
2. **`OPEN`**: All incoming requests fail fast ($<0.1\text{ms}$) and return pre-configured fallbacks without executing network I/O, protecting upstream resources and allowing downstream dependencies time to recover.
3. **`HALF_OPEN`**: After a cooldown period (`resetTimeoutMs`), a limited trial probe ($N$ requests) is permitted through. If all probes succeed, the circuit resets to `CLOSED`. If any probe fails, it trips back to `OPEN` immediately.

## Consequences
### Positive
- Sub-millisecond fail-fast protection against degraded dependencies.
- Zero network I/O wasted during outages.
- Autonomous self-healing without requiring manual engineering intervention or restarts.

### Trade-offs
- Requests during `OPEN` receive degraded fallback responses rather than live data.