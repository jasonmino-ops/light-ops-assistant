# ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 V3 Candidate Baseline Aggregate Exception

> **Status: INVALIDATED / NOT APPLICABLE TO THE CURRENT CANDIDATE.** Later authorized V3 changes overlap the failure signatures' change surface, so this historical exception must not be used to report the current aggregate as PASS or PASS WITH BASELINE EXCEPTION. A fresh full aggregate and causality analysis are required.

## Authorization and scope

- Task: `ES-PRINT-LOCAL-FIRST-SHARED-CORE-01`
- Purpose: V3 candidate safety-remediation verification only.
- Founder decision: `APPROVED WITH NARROWED SCOPE — candidate-scoped baseline exception`, 2026-09-23.
- Baseline SHA: `98a82eaa0733fc732788013aab2f9d80be621f6a`
- Safety-remediation implementation SHA: `10732a3`
- Test file: `desktop/tests/release-foundation.test.ts`
- Clean-candidate aggregate result: 273 PASS / 4 FAIL / 1 SKIP.
- Authorized interpretation: `Desktop Aggregate = PASS WITH BASELINE EXCEPTION`; baseline-excepted failures = 4; new aggregate regressions = 0. The four tests did not pass.

This record does not modify, skip, delete, or weaken any test or assertion. It does not authorize release-foundation repair, runtime/control-plane wiring, or reuse by another task or milestone.

## Exact authorized failures

| ID | Exact test name | Required failure fingerprint |
| --- | --- | --- |
| V3-BAE-01 | `EP-MB3-07A release foundation policy > keeps desktop/package.json as the unique Desktop version source` | command `release-foundation.mjs policy`; stderr contains exactly `frozen boundary changed: cashier/customer/mobile business` |
| V3-BAE-02 | `EP-MB3-07A release foundation policy > accepts only the exact authorized launch-context successor bytes` | command `release-foundation.mjs policy`; stderr contains exactly `frozen boundary changed: cashier/customer/mobile business` |
| V3-BAE-03 | `risk-based source acceptance policy > accepts the exact registered P2 source pilot without packaging` | command `release-foundation.mjs source-policy --task-id ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION --source-commit db56bb9035afd74c28d26df42a7f7de89843bbce --production-sha b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4`; stderr contains exactly `scope exception is not the exact active authorization for ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` |
| V3-BAE-04 | `risk-based source acceptance policy > fails closed when the source commit is not descended from the trusted baseline` | assertion expected `/Production SHA is not an ancestor/`; received command failure whose stderr contains exactly `scope exception is not the exact active authorization for ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` |

## Baseline equivalence and causality

The exact baseline SHA was previously reproduced in an isolated clean clone: the same four test identities and required fingerprints failed, with no additional failure. The clean safety-remediation candidate reproduced exactly those four failures and no others.

The V3 candidate changes only isolated `desktop/src/main/printing/` modules, their tests, and task-scoped evidence. It does not modify `desktop/scripts/release-foundation.mjs`, `desktop/tests/release-foundation.test.ts`, source-policy assets, Scope Guard, release-foundation governance, or V2 frozen paths. Matching baseline signatures plus this disjoint change surface exclude the V3 candidate as the cause.

## Validity and automatic invalidation

This exception is valid only for this task, baseline, and candidate safety-remediation line. It automatically becomes invalid if any of the following occurs:

1. A failing test name changes.
2. A required failure fingerprint changes materially.
3. The failure count increases or another test fails.
4. The candidate changes release-foundation or related governance assets.
5. The candidate scope reaches source-policy or release-foundation behavior.
6. Exact baseline reproduction can no longer be established.
7. A later `origin/main` formally fixes a covered failure.
8. The exception is used for another task or milestone.
9. Candidate and baseline failure equivalence cannot be demonstrated.

## Non-authorizations

No Production deployment, migration, database change, installer, FIELD activity, Feature Flag activation, V2 Frozen modification, release-foundation repair, assertion weakening, real runtime/control-plane wiring, or Scope Guard change is authorized by this record.
