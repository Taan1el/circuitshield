# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-09-15

### Added
- Express gateway with a three-state circuit breaker (`CLOSED` / `OPEN` / `HALF_OPEN`), a bounded
  sliding-window failure and slow-call detector, and bulkhead concurrency isolation with a FIFO wait queue,
  covering three example routes (Payments, Inventory, Fraud) with simulated downstream latency and error
  rates.
- React 19 console: live telemetry, per-circuit sliding-window and bulkhead visualizations, and a chaos and
  burst generator for injecting latency and errors and firing concurrent traffic.
- In-browser demo mode for GitHub Pages: `client/src/services/demoApi.ts` runs the exact same
  `CircuitService`, `CircuitBreaker` and `Bulkhead` classes the server uses, with a banner explaining the demo
  and a "Reset demo data" control.
- Request validation (`shared/validation.ts`) for the config, chaos and burst-test routes, reused by both the
  real API and the demo adapter so the two paths enforce identical rules.
- Docker image (multi-stage build) and Compose file for local use, and a Docker build job in CI.
- CI workflow (lint, test, build, Docker build) and a GitHub Pages deployment workflow.
- Server tests for breaker state transitions, bulkhead queueing and timeouts, and API input validation; client
  tests for the console, accessible labels, and the demo adapter.

### Fixed
- The production build's entry point did not exist at the path `npm start` and the Docker image both expected
  (`tsc`'s output nests under `dist/server/src/`, not `dist/`), so both crashed immediately after
  `npm run build`.
- The Docker image ran `node` from the repo root instead of `server/`, so the static client build's existence
  check always failed and the container silently served a 404 for every page instead of the built UI.
- A `HALF_OPEN` trial probe that returned successfully but breached the slow-call threshold counted toward
  healing the circuit back to `CLOSED`, instead of being treated as a failed probe the way it would be judged
  in `CLOSED` state.
- Updating a circuit's bulkhead concurrency or wait time to `0` through the config API was silently ignored
  by a truthy check, leaving the live bulkhead out of sync with the config `GET /api/circuits/:id` reported as
  active.
- The config, chaos and burst-test routes accepted out-of-range or wrong-typed values, including a burst
  `concurrency` of `0` or a non-numeric string, which produced a `NaN` average instead of a validation error.
  A `minCallsThreshold` greater than `slidingWindowSize` was also accepted, even though the window could then
  never hold enough calls to evaluate.
- Every route returned a generic 500 for an unknown circuit id instead of a 404, and unexpected errors
  returned the raw exception message to the client instead of a generic one logged server-side.
- Chaos simulator form fields had visible labels that were never associated with their input via `htmlFor`,
  and the circuit dropdown's focus ring was suppressed with no replacement. `--text-muted` also fell below
  the 4.5:1 contrast ratio needed for the small text it was used on.
- The global error banner's classes matched no CSS rule and rendered unstyled; it and the native `alert()`
  dialogs on card and chaos actions were replaced with inline, accessible error messages.
- Removed unmeasured performance claims ("sub-millisecond", "<0.1ms"), the false "zero external runtime
  dependencies" claim (the server depends on `express` and `cors`), and language implying conformance to the
  Hystrix/Resilience4j specifications rather than inspiration from them, from the README, ADRs and UI copy.
