# ES-DESKTOP-UX-01 / P4-1 Source Acceptance

## Decision

**Source Acceptance: PASS** for the authorized P4-1 Minimal Operator Boundary MVP.

This acceptance is a source-conformance decision. It is not `FIELD VERIFIED`,
not a merge/deploy approval, and not P4-1B authorization.

## Root-cause context

The root-core blocker was classified as **A — GOVERNANCE BASELINE REGISTRATION
ONLY**. `tests/cashier-realtime-integration.test.ts:168-179` compares the
tracked `git diff --name-only HEAD` against a historical realtime task
allowlist. The current baseline HEAD is
`9453a34b3509d0fc9578e482b2eba2ea0b1744e2`. The assertion does not execute a
realtime runtime regression check at the failure point, and the preceding
realtime assertions passed.

The P4-1 delta does not modify `app/cashier/**`, `app/api/cashier/**`,
cashier-realtime sources, printing, Prisma, or migrations. The tracked files
visible to that assertion are the authorized Desktop boundary implementation
and its test-manifest registration; the new boundary route, evidence records,
and static test are untracked at the time of this acceptance and are not read
by the assertion.

## Conformance checks

| Authorized source boundary | Result |
| --- | --- |
| Explicit Desktop `ACCOUNT` / `DEVICE` choice | PASS |
| Existing device authorization and legacy OWNER fallback | PASS |
| Existing User/UserStoreRole and `operatorUserId` reuse | PASS |
| No silent ACCOUNT-cookie override of Desktop device identity | PASS |
| Server rollback with `DESKTOP_OPERATOR_BOUNDARY_ENABLED=0` | PASS |
| Offline CASH remains unblocked; no offline credential cache | PASS |
| No runtime operator Switch; incomplete cart is not handed over | PASS |
| Browser `/cashier` behavior unchanged | PASS |
| Desktop Activation and POS Authorization architecture unchanged | PASS |
| No schema, migration, credential framework, or P4-1B capability | PASS |

## Acceptance boundary

This record accepts only the source implementation against the Founder-approved
minimal boundary. Core-suite completion, fresh independent review, Source
Acceptance-to-candidate promotion, merge/deploy, real-device acceptance, and
`FIELD VERIFIED` remain separately gated.
