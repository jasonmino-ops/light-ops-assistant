# ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 Kitchen Field Loss P1 Candidate Aggregate Exception

> **Status: ACTIVE / FOUNDER AUTHORIZED.** This record covers only the two exact baseline-reproduced failures below for the frozen Kitchen FIELD loss P1 correction. It does not state that either test passed and does not reuse an earlier exception.

## Exact scope

- Task: `ES-PRINT-LOCAL-FIRST-SHARED-CORE-01`
- FIELD incident: `S-20260924-ST169E7000-0036`
- Exact baseline: `origin/main@51f0e86e2734d92b4be2271f8756f3ea19b8c799`
- Exact implementation candidate: `f7fe1ac194395a2c57812626183d9445b5bc59f2`
- Authorized candidate lineage: the product-byte-identical governance-only descendant that adds this record
- Test file: `desktop/tests/release-foundation.test.ts`
- Candidate aggregate: `317 PASS / 2 FAIL / 1 SKIP`
- Exact-baseline aggregate: `311 PASS / 2 FAIL / 1 SKIP`
- Added candidate regression tests: `6 PASS`
- New aggregate regression failures: `0`
- Authorized aggregate interpretation: `PASS WITH EXACT CANDIDATE-SCOPED BASELINE EXCEPTION`

## Exact authorized failures

1. `risk-based source acceptance policy > accepts the exact registered P2 source pilot without packaging`
   - Command targets task `ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` at source commit `db56bb9035afd74c28d26df42a7f7de89843bbce` with Production SHA `b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4`.
   - Exact material signature: `scope exception is not the exact active authorization for ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION`.
2. `risk-based source acceptance policy > fails closed when the source commit is not descended from the trusted baseline`
   - Expected assertion: `/Production SHA is not an ancestor/`.
   - Actual command fails first with the same exact scope-exception signature above.

## Baseline reproduction evidence

The complete Desktop aggregate was run in an isolated clean checkout at exact baseline `51f0e86e2734d92b4be2271f8756f3ea19b8c799`. It produced `311 PASS / 2 FAIL / 1 SKIP` with the two exact test names and material signatures above. The complete Desktop aggregate at exact implementation candidate `f7fe1ac194395a2c57812626183d9445b5bc59f2` produced `317 PASS / 2 FAIL / 1 SKIP`, reproducing exactly those same two failures and no additional failure. The six added Kitchen FIELD loss regression cases passed. Therefore `new regression = 0`.

## Causality exclusion

The candidate changes only:

- `desktop/src/main/printing/controlPlaneRuntime.ts`
- `desktop/src/main/printing/v3PrintingRuntime.ts`
- `desktop/tests/control-plane-runtime.test.ts`
- `desktop/tests/v3-printing-runtime.test.ts`

It does not modify `desktop/scripts/release-foundation.mjs`, `desktop/tests/release-foundation.test.ts`, the `ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` exception record, source-acceptance policy, Scope Guard, or release-foundation governance. None of the changed files participates in the failing source-policy exception lookup. Matching baseline identities and signatures plus this causally disjoint change surface establish that the candidate introduced no new Desktop aggregate regression.

## Automatic invalidation and closure

This exception is valid only for this task, exact incident correction, exact baseline, exact implementation candidate and its product-byte-identical governance-only descendant, exact test file, exact two test names, and exact/equivalent signatures above. It is immediately invalid if the failure count increases, another test fails, either name or signature changes materially, baseline reproduction differs, new regression becomes non-zero, the candidate modifies the causal source-policy area, `origin/main` fixes either covered failure, or this record is used for another task or milestone.

After the authorized candidate is merged, this record remains only as immutable merge evidence and must not authorize any later candidate or aggregate run. It is closed for operational reuse at merge and expires immediately under any invalidation condition above.

## Non-authorizations

No test is skipped, deleted, or weakened. This exception does not authorize Production deployment, V727 deployment, FIELD resumption, historical order retry or reprint, migration, broader rollout, release-foundation repair, or any broader known-failure waiver.
