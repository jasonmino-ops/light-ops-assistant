# ES-DESKTOP-NEW-PC-RUNTIME-START-FAILURE-01 / M1 Successor-Change Review

## Governance

Governed by ES-GOV-001, ES-ENG-001, the E-Shop Founder-Gated Agent Development Workflow V1, the Release Lineage Gate, Scope Guard, the EP-MB3-07A Release Foundation freeze, and the Desktop Milestone A freeze.

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-NEW-PC-RUNTIME-START-FAILURE-01 / M1` |
| Status | `DRAFT / PENDING — LOCAL SUCCESSOR CANDIDATE` |
| Risk | `L3` — FINAL/FROZEN Desktop Runtime startup boundary |
| Founder authorization | Formal successor-governance authorization supplied in the task instruction |
| Starting trusted `origin/main` | `0d5e221aaec8a325a71372591c39e4fdb4c914a3` |
| Production SHA used for lineage | `a35b2e88c372f79b8ce2614306ab92f13c6a3e58` |
| Candidate branch | `codex/es-desktop-new-pc-runtime-start-failure-01` |
| Immutable candidate commit | `PENDING — local candidate preparation` |
| Classification | `AUTHORIZED DESKTOP RUNTIME CORRECTIVE SUCCESSOR CHANGE` |

This record creates the formal successor-change package. It does not revise the historical freeze record, activate a permanent exception, weaken the Release Foundation assertion, authorize merge, push, deploy, installer release, V727, or Windows FIELD.

## Reason

After a new merchant's first Windows PIN activation, the Desktop can report `AUTHORIZED_RUNTIME_START_FAILED`. The frozen Runtime startup boundary lacks sufficient persistent stage-level diagnostics, and partial-start Retry has a duplicate IPC registration defect.

This is a production/runtime failure corrective successor, not a feature expansion.

## Exact Authorized Candidate Paths

### Product

| Path | SHA-256 |
| --- | --- |
| `desktop/src/main/activation/activationRuntime.ts` | `5e1ad55a7fb29a5c96c8fef0455cbdcdcdb8a07ff2d1db512aa1e6cf1e85a44b` |
| `desktop/src/main/main.ts` | `ae6dc84429ccb32e79586c7d92dda451465af6bfac86ae4dd6e9f8e5cd4ea2a9` |

### Tests

| Path | SHA-256 |
| --- | --- |
| `desktop/tests/activation-state-machine.test.ts` | `f62bdee02fe4d24ce566fcf249c224b45ef82d8fd146139681dbb6041e1e7821` |
| `desktop/tests/authorized-runtime-start.test.ts` | `0a03c4d61d2c2c8f9b401095ad8def108ceb8e1bc1c7741e4d1af4049a087f23` |

If any bound file changes, this authorization is invalidated and the drift must be reported before further work.

## Authorized Purpose

Only:

1. Authorized Runtime startup diagnostics;
2. Partial-start Retry idempotency.

The permitted diagnostics cover hardware, IPC, employee-window, customer-window, display-watch, and tray `BEGIN/PASS/FAILED` stages, failed stage, correlation ID, redacted error/stack, and persistent diagnostic evidence. Retry may reuse already initialized IPC, Window, and Tray resources without duplicate registration.

No other Desktop Runtime behavior is authorized.

## Explicit Exclusions

- `desktop/src/main/ipcRouter.ts`
- `desktop/src/main/tray.ts`
- Provider or Installer
- database, schema, or migration
- Production, V727, printing core, V2, or Agent
- authorization-security semantics
- every other unlisted product or test path

## Release Foundation Treatment

This is a successor change, not a Scope Guard exception or known-failure waiver. The alignment uses the Founder-authorized trusted `origin/main` baseline and registers only the exact immutable candidate snapshot for `ActivationRuntime` and `main startup gate`. The historical frozen comparison anchor remains preserved in the alignment record; explicit comparison against the historical anchor remains fail-closed.

The successor registry must retain the exact frozen groups, paths, comparison operation, failure condition, release-asset rules, provenance checks, and security invariants. Unknown future bytes remain rejected.

## Evidence Status

Already available before governance alignment:

- Release Lineage: `PASS`;
- Scope Guard: `PASS`;
- TypeScript: `PASS`;
- Compile: `PASS`;
- focused M1 tests: `13/13 PASS`;
- Desktop full suite: `354 PASS`, with four Release Foundation governance tests blocked by the frozen boundary assertion;
- candidate content drift during governance preflight: `NO`.

Still required after alignment:

- Release Foundation policy and governance tests: `PENDING`;
- fresh immutable candidate SHA and exact binding: `PENDING`;
- independent review package: required before any merge consideration.

## Stop Boundary

This record authorizes only local successor-governance preparation and a LOCAL COMMIT after all required gates pass. Push, merge, deployment, Production promotion, installer release, V727, Windows FIELD, FINAL FROZEN, and CLOSED remain prohibited.
