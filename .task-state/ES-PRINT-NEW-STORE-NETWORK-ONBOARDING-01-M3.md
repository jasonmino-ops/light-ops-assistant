# ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01 — M3 Readiness / Implementation State

## Route

- Task level: L3 — Windows installer packaging and real FIELD candidate.
- Starting HEAD: `c4a675b5e7bbf95be4b5ab9ad81cec97b5c7584b`.
- Production SHA used for STRICT lineage: `4bb3cbcea90f7e29e22d4b1f71c03f948056773a`.
- Release Lineage: PASS; Production is an ancestor of trusted `origin/main`; clean worktree; Safe Development Base YES.
- UI Fast Path: NO; installer and lifecycle behavior are in scope.
- Real-world validation: FORMAL_FIELD remains pending and is not performed by this implementation.

## Goal

Produce one Desktop installer that carries the exact approved Network Print Add-on candidate and owns its install, upgrade, version-binding, and uninstall orchestration. The Add-on remains a separate runtime process.

## In scope

- Desktop installer resource bundling for the approved Add-on candidate.
- Desktop NSIS install / upgrade / uninstall orchestration.
- Exact Add-on installer hash and manifest verification.
- Packaging tests, installer structural verification, TypeScript, Desktop build, Scope Guard and diff checks.
- Fresh-context independent review before the pre-FIELD stop.

## Explicit non-scope

- No changes to M1/M2 runtime or printing semantics.
- No RAW TCP, durable jobs, RC10, SHARED_PRINTER, mobile, database, migration, Production deployment or release promotion.
- No independent Add-on installer as merchant delivery.
- No real V727 install or paper output in this milestone.

## Packaging inputs

- Add-on version: `0.1.0-commercial-rc.10`.
- Add-on candidate SHA-256: `adc273c99a823d6dd640aa40bca6e385d0f651c7a10248e7471d508fadbf5456`.
- Add-on source commit recorded by the approved candidate: `304a341f43fa633ce70699917c12bade0ff9aa19`.
- Desktop package version remains the frozen `0.2.0-pilot.2`; M3 is distinguished by its new source commit, embedded Add-on binding and installer SHA. No prior installer hash will be reused as final M3 evidence.

## Acceptance

- The output is one `E-Shop-Desktop-Setup-<version>.exe`.
- The Desktop installer embeds the exact Add-on candidate and verifies its hash before build.
- Install invokes the embedded Add-on installer without operator hand-installation.
- Upgrade preserves Add-on state and does not uninstall the Add-on during Desktop predecessor handoff.
- Uninstall removes the managed Add-on component while preserving its application state according to the existing Add-on lifecycle contract.
- Missing, mismatched or failed Add-on payloads fail closed.
- The candidate remains unsigned/internal and is not a commercial release claim.
