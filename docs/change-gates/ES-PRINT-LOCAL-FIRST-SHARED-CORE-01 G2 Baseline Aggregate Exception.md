# ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 G2 Baseline Aggregate Exception

## Authorization and scope

- Task: `ES-PRINT-LOCAL-FIRST-SHARED-CORE-01`
- Purpose: close only the G2 Narrow Corrective Contract Amendment.
- Founder decision: `APPROVED — Task-Scoped Baseline Aggregate Exception`, 2026-09-23.
- Baseline SHA: `98a82eaa0733fc732788013aab2f9d80be621f6a`
- Amendment SHA: `885c85a3273f8645c3e08761303c35c56c78fcea`
- Test file: `desktop/tests/release-foundation.test.ts`
- Candidate aggregate result: 222 PASS / 4 FAIL / 1 SKIP.
- Authorized interpretation: `Desktop Aggregate = PASS WITH BASELINE EXCEPTION`; baseline-excepted failures = 4; new aggregate regressions = 0. The four tests did not pass.

This record does not modify, skip, delete, or weaken any test or assertion. It does not authorize a release-foundation repair or any use by another task or milestone.

## Exact authorized failures

| ID | Exact test name | Required failure fingerprint |
| --- | --- | --- |
| G2-BAE-01 | `EP-MB3-07A release foundation policy > keeps desktop/package.json as the unique Desktop version source` | command `release-foundation.mjs policy`; stderr contains exactly `frozen boundary changed: cashier/customer/mobile business` |
| G2-BAE-02 | `EP-MB3-07A release foundation policy > accepts only the exact authorized launch-context successor bytes` | command `release-foundation.mjs policy`; stderr contains exactly `frozen boundary changed: cashier/customer/mobile business` |
| G2-BAE-03 | `risk-based source acceptance policy > accepts the exact registered P2 source pilot without packaging` | command `release-foundation.mjs source-policy --task-id ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION --source-commit db56bb9035afd74c28d26df42a7f7de89843bbce --production-sha b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4`; stderr contains exactly `scope exception is not the exact active authorization for ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` |
| G2-BAE-04 | `risk-based source acceptance policy > fails closed when the source commit is not descended from the trusted baseline` | assertion expected `/Production SHA is not an ancestor/`; received command failure whose stderr contains exactly `scope exception is not the exact active authorization for ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION` |

## Baseline reproduction and causality

The exact baseline SHA was checked out in an isolated temporary clone with a clean Git worktree. Running:

`./node_modules/.bin/vitest run tests/release-foundation.test.ts --reporter=verbose`

produced the same four failing test identities and the same four fingerprints above: 4 FAIL / 10 PASS / 1 SKIP. The candidate aggregate produced those same failures and no others. The amendment diff from baseline contains only:

- `desktop/src/main/printing/executionLedger.ts`
- `desktop/tests/execution-ledger.test.ts`

It does not change `desktop/scripts/release-foundation.mjs`, `desktop/tests/release-foundation.test.ts`, source-policy assets, Scope Guard, or release-foundation governance. The matching baseline reproduction and disjoint change surface exclude this amendment as the cause of the four failures.

## Validity and automatic invalidation

This exception is valid only for the G2 amendment SHA and baseline named above. It automatically becomes invalid if any of the following occurs:

1. Any failing test name changes.
2. Any required failure fingerprint changes materially.
3. The failure count increases or another test fails.
4. The amendment changes release-foundation or related governance assets.
5. The amendment scope reaches source-policy or release-foundation behavior.
6. The exact baseline reproduction cannot be repeated.
7. A later `origin/main` formally fixes any covered failure.
8. The exception is used for another task or milestone.
9. Candidate and baseline failure equivalence cannot be demonstrated.

Later V3 candidates may not inherit this exception automatically. Any proposed reuse requires fresh signature/count/causality/baseline validation under the applicable repository governance.

## Non-authorizations

No Production deployment, migration, database change, installer, FIELD activity, Feature Flag activation, V2 Frozen modification, release-foundation repair, assertion weakening, or Scope Guard change is authorized by this record.
