# ES-ELIFE-PRODUCT-CATALOG-FIX-01 task-scoped SOURCE admission

This proposed successor applies only after exact Founder authorization and lawful adoption on trusted `main` under Workflow V2 §6, §§10–12 and Workflow V1 §§6, 12. Business risk is L2 per the Founder decision. The admission rule itself is a governance change and requires fresh independent review and exact governance merge authorization. This task-scoped profile applies only to the manifest's exact product commit, candidate SHA/tree and parents, pinned application baseline, GitHub release base and sealed approved evidence. It expires at 2026-11-15 08:00:00 UTC, the existing dispositions' earliest cutoff.

## Admission

The profile evaluates the complete, immutable evidence from the original exact runs. It does not make CORE or INTEGRATION green. The historical CORE result is 101 PASS / 2 FAIL and INTEGRATION is 16 PASS / 2 FAIL, both 0 SKIP and BLOCKED. The five CORE assertion identities and two INTEGRATION assertion identities are approved as inputs, not generic allowed tests. Whole logs, runner outputs and the independently reviewed exact failure lists must all match their SHA-256. Each lane on both SHAs must have completed the full original test manifest without environment failures or skips. A changed byte in any sealed result, new or changed failure, missing evidence, different build or test input, different Git object, extra path, unapproved main/release drift, or expiry blocks the evaluation. Any contradictory later verification result voids the earlier evidence. Do not invoke the evaluator with superseded evidence. This local evaluator does not discover test runs outside the submitted evidence.

The legacy Diamond check still runs unchanged and its failure is preserved. The evaluator independently proves the entire 27-path application-candidate delta and each path's digest, checks the protected test and its distinct grant bytes against the frozen digest, executes the original Scope Guard without a task exception, and checks the rest of the failed boundary's protected-path predicates. Existing grants, historical tests, global failure records and protections are untouched. The baseline fixture, H5 replay and Dashboard errors retain their original attribution. The H5 replay's downstream live and Shadow comparisons were not reached and earn no PASS. Both catalog browser cases, build, catalog/ID/capacity and protected regression artifacts are bound. Production verification and FIELD are separate.

## Use

Run from an isolated, trusted operator checkout using the repository's Node runtime, authenticated GitHub access and the immutable sealed evidence directory supplied from the approved archive. No automatic CI, publish, merge, deployment or database action is added.

```sh
node scripts/governance/es-elife-task-source-admission.mjs --verify-draft <sealed-checkout> <evidence-directory>
node scripts/governance/es-elife-task-source-admission.mjs --evaluate <sealed-checkout> <evidence-directory>
```

Draft mode returns HOLD even when the evidence verifies. Active evaluation requires a fresh read of the official GitHub main, release and sealed pull-request head refs and the corresponding Git objects already available locally. Only one four-file governance commit may follow the approved baseline, directly or through an exact two-parent merge. It verifies the trusted rule and executable bytes and both remaining governance artifact hashes. A returned SOURCE PASS applies to the sealed candidate only. It grants no permission to merge the product, update release, deploy, migrate, or claim FIELD or Closure. The release validator and relevant release checks remain mandatory.
