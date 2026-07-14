# ES-MB-PHASE1-IMPLEMENTATION-RECORD-001 HRT Logic Core Phase 1 Implementation Record

## Basic Information

| Item | Value |
| --- | --- |
| Milestone | Milestone B |
| Phase | Engineering Phase 1 |
| Workstream | WS-1 — Desktop Runtime / HRT Logic Core |
| Branch | mb/ws1-hrt-logic-core |
| Baseline HEAD | 1982ed0a8fdde892d4fd7828193d181c1720f096 |
| Date | 2026-07-14 |
| Status | IMPLEMENTED FOR PHASE 1 REVIEW |

## Scope

Phase 1 establishes the first implementation baseline for the shared HRT Contract, Desktop Runtime HRT Logic Core skeleton, Provider Simulator, and executable tests.

## Modified Areas

- `packages/hrt-contract/`
- `packages/hrt-provider-simulator/`
- `desktop/src/main/hrt/`
- `tests/hrt-contract.test.ts`
- `desktop/tests/hrt-logic-core.test.ts`

## Contract Baseline

The contract package defines:

- versioned JSON frame shape;
- command request and command result schemas;
- frozen six-value Command Outcome set;
- three-state Side-Effect Boundary set;
- device kinds for printer, scanner, and customer display;
- provider registration, health snapshot, scanner event, command request, and command result types;
- validators and fixtures.

## Desktop Runtime HRT Logic Core Skeleton

The Desktop Runtime skeleton includes:

- provider registration and compatibility check;
- device registry;
- command router;
- health engine;
- audit emitter;
- provider client boundary.

The skeleton does not connect to real hardware and does not replace any existing POS, cashier, print, scanner, customer display, or legacy flow.

## Provider Simulator

The simulator provides:

- provider registration payload;
- printer, scanner, and customer display capabilities;
- successful command execution responses;
- scanner barcode event generation;
- health snapshot generation.

## Verification

Required verification commands:

- `npx tsx tests/hrt-contract.test.ts`
- `npm --prefix desktop test -- tests/hrt-logic-core.test.ts`
- `npm --prefix desktop run typecheck`

## Windows Provider Repository

The Windows Provider private repository was not created in this phase execution. Provider Simulator remains inside the main repository as a test and contract validation aid.

## Risk

Risk level: Low.

No production business code, database schema, migration, CI, package manifest, lockfile, or existing runtime flow was modified.

## MB-1 Contract Completion Addendum

| Item | Value |
| --- | --- |
| Date | 2026-07-15 |
| Starting HEAD | 1464a0dc712a5bc19564afb52f90964e8bac1c93 |
| Status | IMPLEMENTED FOR MB-1 GATE REVIEW |

### Completed Gaps

- Closed cross-package imports of `packages/hrt-contract/src/*` by moving consumers to `@eshop/hrt-contract`.
- Expanded the public contract export surface for lifecycle, handshake, compatibility, capability, identity, scanner event, customer display snapshot, health, diagnostics, validators, fixtures, and constants.
- Added schema files for provider registration, handshake, compatibility, scanner event, customer display snapshot, health snapshot, and diagnostics.
- Added validators and fixtures for the newly covered contract families.
- Extended Provider Simulator coverage for incompatible contract, missing capability, duplicate registration, restart, stale instance, disconnect, timeout uncertainty, `UNKNOWN`, `CROSSING_UNKNOWN`, scanner duplicate/stale/wrong-scope events, customer display scope/expiry/last-snapshot-wins, provider health, device health, malformed frame, and missing correlation ID.
- Extended Desktop HRT Logic Core skeleton to use contract compatibility evaluation, reject duplicate registration, clear device registry on provider restart, and reject stale provider instance command results.

### Verification Commands

- `npm --prefix packages/hrt-contract ci`
- `npm --prefix packages/hrt-contract run build`
- `npx tsx tests/hrt-contract.test.ts`
- `npm --prefix desktop run typecheck`
- `npm --prefix desktop test`
- `npm --prefix desktop run compile`

### Boundary Confirmation

The HRT Logic Core remains dormant. No Legacy print, Legacy scan, Web Serial customer display, cloud print, cashier, sales flow, database, Prisma, migration, real hardware executor, VID/PID, COM, printer queue, or Windows Provider repository was modified.
