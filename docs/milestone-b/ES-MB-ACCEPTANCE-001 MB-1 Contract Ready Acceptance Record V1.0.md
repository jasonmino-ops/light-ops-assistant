# ES-MB-ACCEPTANCE-001 MB-1 Contract Ready Acceptance Record V1.0

## 1. Document Control

| Item | Value |
| --- | --- |
| Document ID | ES-MB-ACCEPTANCE-001 |
| Version | V1.0 |
| Status | ACCEPTED / FINAL |
| Milestone | Milestone B |
| Gate | MB-1 Contract Ready |
| Workstream | WS-1 Desktop Runtime / HRT Logic Core |
| Approval Authority | Milestone B Gate Owner |
| Independent Review Authority | Claude Desktop Architecture Review |
| Acceptance Date | 2026-07-15 |
| Gate Status | PASS |

## 2. Baselines

| Item | Value |
| --- | --- |
| Milestone B Document Baseline | 1982ed0a8fdde892d4fd7828193d181c1720f096 |
| Branch | mb/ws1-hrt-logic-core |
| Reviewed Implementation HEAD | c86d54f175ec0f060ccb42fb6744c3d1e058f6cc |
| Evidence Finalization HEAD | f0b2bbe7759ffdf4386ed70530d54daef80ce1aa |
| Evidence Pack | MB1-Review-Evidence-Pack-c86d54f-final.zip |
| Evidence Pack Path | docs/milestone-b/MB1-Review-Evidence-Pack-c86d54f-final.zip |
| Evidence Pack Size | 48098 bytes |
| Evidence Pack MD5 | cff64b66049d960ababd18716ab83f53 |
| Evidence Pack SHA-256 | dc06918af22f1c2687207097b3c1987fee52540812b470f82496a4022e2e2508 |
| Windows CI | run 29355948063 / PASS |
| Vercel Preview | READY / https://light-ops-assistant-9l69ys36w-sunxiaojian0910-2556s-projects.vercel.app |

## 3. Accepted Scope

- `packages/hrt-contract`
- Contract package boundary
- schemas
- validators
- fixtures
- six-value Command Outcome
- three-state Side-Effect Boundary
- Provider lifecycle
- Runtime-authoritative handshake
- compatibility and capability
- Provider identity / instance identity
- provider health / device health separation
- scanner event contract
- customer display snapshot contract
- diagnostics contract
- Provider Simulator
- Desktop Runtime HRT Logic Core skeleton
- Windows CI integration
- Web build boundary

## 4. Independent Review Result

- Evidence sufficient
- Architecture healthy
- Contract not overweight
- Package boundaries healthy
- Simulator reasonable
- HRT Core dormant
- Handshake satisfies ADR-002
- Outcome / Side-Effect aligned with ES-HRT-001
- Windows Provider can naturally integrate
- No new blockers
- Risk: LOW
- Score: 94/100
- MB-1: PASS

## 5. Frozen Terminology

Command Outcome:

- `SUCCEEDED`
- `FAILED`
- `REJECTED`
- `TIMED_OUT`
- `CANCELLED`
- `UNKNOWN`

Side-Effect Boundary:

- `NOT_CROSSED`
- `CROSSING_UNKNOWN`
- `CROSSED`

Printer attached action:

- `OPEN_ATTACHED_CASH_DRAWER`

Closure confirmation:

- `TIMEOUT` formal enum references: 0
- `MAY_HAVE_CROSSED` formal enum references: 0
- `OPEN_CASH_DRAWER` formal command references: 0
- No legacy value alias is retained.
- Cash drawer is not modeled as a fourth device category.

## 6. Build and Test Evidence

| Check | Result |
| --- | --- |
| Contract build | PASS |
| Contract tests | PASS |
| Desktop typecheck | PASS |
| Desktop tests | PASS, 8 files / 74 tests |
| Desktop compile | PASS |
| Root Next build | PASS |
| Windows CI | PASS, run 29355948063 |
| Electron Builder | PASS |
| Artifact Upload | PASS |
| Vercel Preview | READY |

## 7. Non-Regression

- Legacy print was not modified.
- Legacy scan was not modified.
- Web Serial customer display was not modified.
- Cloud print was not modified.
- Cashier / sales flow was not modified.
- Database was not modified.
- Prisma / Migration was not modified.
- Real hardware was not connected.
- HRT Core remains dormant.

## 8. Gate Decision

| Gate | Status |
| --- | --- |
| MB-1 Contract Ready | PASS |
| MB-2 Runtime Core Ready | IN PROGRESS |
| MB-3 Windows Hardware Ready | BLOCKED |

## 9. Non-Blocking MB-2 Backlog

The following items are carried into MB-2 and are not MB-1 blockers:

- Provider Simulator adds a formal package.json.
- Printer Contract tests deepen.
- Assignment Contract tests deepen.
- fixtures upgrade to language-neutral conformance vectors.
- Evidence generator automatically injects real HEAD values.

## 10. Merge Authorization

- `mb/ws1-hrt-logic-core` is authorized to merge into `main`.
- This merge does not authorize all MB-2 development.
- This merge does not authorize real device executors.
- MB-3 remains BLOCKED.
