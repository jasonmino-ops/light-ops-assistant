# ES-DINE-IN-01-FOOD-ROLLOUT-01 Engineering Authorization V1.0

## Governance

Governed by ES-GOV-001, ES-ENG-001, AGENTS.md, the E-Shop Founder-Gated Agent Development Workflow V1, Scope Guard, and Release Lineage Gate. This is a task authorization record and does not modify any FINAL or Freeze asset.

## Authorized Package

Founder-authorized implementation for `ES-DINE-IN-01-FOOD-ROLLOUT-01`: remove the formal `DINE_IN_TRIAL_STORE_CODES` dependency from new-business dine-in eligibility while preserving the existing `ACTIVE + FOOD + V3_ACTIVE + Desktop/device authorization + tenant/store isolation` gates. No second-store pre-release FIELD is required.

## Authorized Branch

`codex/es-dine-in-01-food-rollout-01`

## Authorized Starting HEAD

`3febba7ce838ef21d438a21a9303dff7bcf6e062` (`origin/main` at line creation). Production reference: `9ca16050e42de3a1afbf97f0896041120c2f9287`.

## Allowed Scope

Product implementation paths:

1. `.env.example`
2. `lib/dine-in/eligibility.ts`
3. `tests/dine-in-m1-contract.test.ts`
4. `tests/dine-in-m1-db.test.ts`

Governance evidence paths for this task:

5. `docs/governance/ES-DINE-IN-01-FOOD-ROLLOUT-01-READINESS.md`
6. `docs/governance/ES-DINE-IN-01-FOOD-ROLLOUT-01-AUTHORIZATION.md`

## Prohibited Scope

No schema, migration, payment, print contract, cashier, dine-in business-flow, identity, tenant/store authorization redesign, M1 freeze/closure record, Production, merge to main, deployment, or unrelated cleanup. No expansion beyond the four product paths without renewed Founder authorization.

## Required Outputs

Minimal bounded diff, focused tests, governance records, independent review result, and an explicit Release Gate handoff. No Production release is part of this authorization.

## Required Evidence

M1 closure/freeze evidence, baseline and Production lineage, exact-file Scope Guard, focused contract test, typecheck, build, disposable database integration result, independent ES-ENG-001 review, and final clean-candidate checks.

## Required Verification

Verify that trial-list configuration is not read by runtime eligibility, all existing safety gates remain enforced, non-FOOD remains blocked, tenant/store isolation is unchanged, and no forbidden path is changed. Environment-blocked checks must remain marked UNKNOWN/BLOCKED rather than PASS.

## Review Requirement

Fresh-context ES-ENG-001 independent read-only review is required before the Release Gate. Reviewers must inspect the live diff and distinguish verified evidence from inference.

## Acceptance Requirement

Implementation acceptance is conditional on the required verification evidence. Production deploy/full FOOD rollout is the formal Release Gate. No second-store pre-release FIELD is required under the Founder decision.

## Freeze Requirement

M1 remains `FIELD VERIFIED / FINAL FROZEN / CLOSED`. This task does not reopen M1 or alter its frozen records. Any scope expansion requires a new Founder authorization.

## Decision

AUTHORIZED for the bounded implementation package only. NOT AUTHORIZED for merge/main, Production deploy, or full FOOD rollout; those remain the next Founder Release Gate.
