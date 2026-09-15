# ADR-001: Finite State Machine Circuit Breaker Pattern

## Status
Accepted

## Context
When microservices depend on external APIs (e.g. payment gateways, inventory ERPs, fraud scoring), network latency spikes or upstream outages can cause calls to block and fail. If incoming traffic continues unabated, thread pools, socket descriptors, and event loops exhaust rapidly, triggering cascading failure across the entire service cluster.

## Decision
We implemented a three-state Finite State Machine (FSM), in the spirit of Martin Fowler's Circuit Breaker pattern and libraries like Netflix Hystrix and Resilience4j (not a conformance implementation of either):
1. **`CLOSED`**: All requests dispatched downstream. Outcomes recorded to a bounded sliding-window buffer. If the failure or slow-call rate breaches its threshold, the breaker trips to `OPEN`.
2. **`OPEN`**: All incoming requests fail fast, without executing any I/O, and return the pre-configured fallback. The test suite asserts this happens in under 10ms; in practice it is well under a millisecond since it is a single in-memory state check.
3. **`HALF_OPEN`**: After a cooldown period (`resetTimeoutMs`), a limited trial probe (`halfOpenTrialCalls` requests) is permitted through. A probe that fails, or that succeeds but breaches the slow-call threshold, trips the circuit back to `OPEN` immediately (a slow-but-not-erroring downstream is still an unhealthy one). Only once every trial probe both succeeds and is fast does the circuit reset to `CLOSED`.

## Consequences
### Positive
- Fail-fast protection against degraded dependencies, with no network I/O spent while a dependency is known to be unhealthy.
- Self-healing on a timer, without requiring manual intervention or a restart.

### Trade-offs
- Requests during `OPEN` receive degraded fallback responses rather than live data.
- The FSM lives in a single process's memory; it is not shared across multiple instances of the gateway (see the README's design notes and limitations).