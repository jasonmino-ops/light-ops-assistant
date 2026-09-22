# ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 Final Candidate Aggregate Exception Proposal

> **Status: PROPOSED / NOT AUTHORIZED / NOT ACTIVE.** This record does not change the aggregate result to PASS or PASS WITH BASELINE EXCEPTION.

## Exact scope

- Task: `ES-PRINT-LOCAL-FIRST-SHARED-CORE-01`
- Baseline: `origin/main@b47380af8c091cfea23ba4fcceeb9d39bc8e991f`
- Candidate: `b194089`
- Test file: `desktop/tests/release-foundation.test.ts`
- Candidate aggregate: 290 PASS / 2 FAIL / 1 SKIP
- New aggregate regression failures: 0

## Exact proposed failures

1. `risk-based source acceptance policy > accepts the exact registered P2 source pilot without packaging`
   - Command targets task `ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` at source commit `db56bb9035afd74c28d26df42a7f7de89843bbce`.
   - Exact material signature: `scope exception is not the exact active authorization for ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION`.
2. `risk-based source acceptance policy > fails closed when the source commit is not descended from the trusted baseline`
   - Expected assertion: `/Production SHA is not an ancestor/`.
   - Actual command failure contains the same exact scope-exception signature above before ancestry evaluation.

## Baseline evidence and causality

Both exact test names and material signatures reproduce in an isolated clean checkout of `origin/main@b47380af8c091cfea23ba4fcceeb9d39bc8e991f`. The candidate reproduces exactly those two failures and no additional aggregate failure.

The failures concern another task's trusted source-acceptance exception. The V3 candidate does not modify that task's exception record. Candidate changes to release-foundation are limited to exact immutable successor snapshot alignment required by this V3 candidate; they do not cause or suppress the failing task-specific exception lookup. This proposal therefore records baseline equivalence, not test success.

## Automatic invalidation

This proposal, if authorized, is valid only for the task, baseline, candidate lineage, two exact test names, and signatures above. It becomes invalid if the failure count increases, another test fails, either name/signature changes, baseline reproduction differs, the candidate modifies the other task's exception, `origin/main` fixes the failures, or the exception is used for another task/candidate.

## Non-authorizations

No test is skipped or weakened. This proposal does not authorize Production deployment, migration, activation, installer, FIELD, merge, release-foundation repair, or reuse of any prior aggregate exception.
