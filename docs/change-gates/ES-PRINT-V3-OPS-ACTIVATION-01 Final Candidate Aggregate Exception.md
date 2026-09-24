# ES-PRINT-V3-OPS-ACTIVATION-01 Final Candidate Aggregate Exception

> **Status: ACTIVE / FOUNDER AUTHORIZED.** This record covers only the two exact baseline-reproduced failures below. It does not state that either test passed.

## Exact scope

- Task: `ES-PRINT-V3-OPS-ACTIVATION-01`
- Exact baseline: `origin/main@c944c0c8b8407855d5ea9c67b5f953aa5a2c08b3`
- Exact implementation candidate: `262177e35c6c9481795f206b330d83e167171e76`
- Authorized candidate lineage: the product-byte-identical governance-only descendant that adds this record
- Test file: `desktop/tests/release-foundation.test.ts`
- Candidate aggregate: `310 PASS / 2 FAIL / 1 SKIP`
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

The two exact test names and material signatures above were reproduced by running `desktop/tests/release-foundation.test.ts` from an isolated clean worktree at exact baseline `c944c0c8b8407855d5ea9c67b5f953aa5a2c08b3`. The baseline result was `12 PASS / 2 FAIL / 1 SKIP` for that file. The complete Desktop aggregate at implementation candidate `262177e35c6c9481795f206b330d83e167171e76` reproduced exactly those same two failures and no additional failure.

## Causality exclusion

This candidate does not modify `desktop/scripts/release-foundation.mjs`, `desktop/tests/release-foundation.test.ts`, the `ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` exception record, source-acceptance policy, Scope Guard, or release-foundation governance. The candidate changes the isolated Ops V3 printing control surface, the authorized Desktop V3 lifecycle composition, focused tests, and the OWNER raw `SET_MODE` hard block. None participates in the failing source-policy exception lookup. Matching baseline signatures plus this disjoint change surface establish `new regression = 0`.

## Automatic invalidation

This exception is valid only for this task, exact baseline, exact implementation candidate and its product-byte-identical governance-only descendant, exact test file, exact two test names, and exact/equivalent signatures above. It is invalid if the failure count increases, another test fails, either name or signature changes materially, baseline reproduction differs, new regression becomes non-zero, the candidate modifies the causal source-policy area, `origin/main` fixes the failures, or this record is reused for another task or milestone.

## Non-authorizations

No test is skipped, deleted, or weakened. This exception does not authorize Production deployment, migration, activation, installer, FIELD, merge, release-foundation repair, or any broader known-failure waiver.
