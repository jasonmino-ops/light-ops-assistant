# ES-DINE-IN-01-FOOD-ROLLOUT-01 Readiness Review V1.0

## Governance

Governed by ES-GOV-001, ES-ENG-001, AGENTS.md, the E-Shop Founder-Gated Agent Development Workflow V1, Scope Guard, and Release Lineage Gate. This record does not amend the frozen M1 records.

## Goal

Remove the formal `DINE_IN_TRIAL_STORE_CODES` prerequisite from new-business dine-in eligibility so the already validated M1 capability can be opened to every store that satisfies the existing safety gates.

## Current State

- `ES-DINE-IN-01 M1` is `FIELD VERIFIED / FINAL FROZEN / CLOSED`.
- M1 closure evidence and Production lineage are reused as the behavioral baseline; M1 is not reopened.
- The current implementation has a centralized trial-store prerequisite in `lib/dine-in/eligibility.ts`.
- Founder approved the adjusted strategy: no second FOOD-store pre-release FIELD is required; Production deploy/full FOOD rollout remains the Release Gate. This waiver does not remove the standing acceptance, regression, lineage, Production, or applicable Closure evidence requirements.

## Prerequisites

- Founder approval is recorded in the task instruction for `ES-DINE-IN-01-FOOD-ROLLOUT-01`.
- Development base is `origin/main` `3febba7ce838ef21d438a21a9303dff7bcf6e062`.
- Production SHA at readiness is `9ca16050e42de3a1afbf97f0896041120c2f9287`; STRICT Release Lineage passed before implementation.
- M1 closure and freeze records are available and remain unchanged.

## Scope

- Remove only the trial-list prerequisite from centralized new-business eligibility.
- Preserve `ACTIVE`, `FOOD`, `V3_ACTIVE`, Desktop/device authorization, tenant/store isolation, and all recovery behavior.
- Update the directly affected contract/integration assertions and remove the obsolete example environment setting.

## Non-Scope

No change to dine-in business logic, schema, migration, payment, print contract, cashier UI, public API shape, identity model, M1 freeze/closure records, Production, merge, or deployment.

## Risk Assessment

The intended exposure expands from one trial store to all stores whose persisted classification and control-plane state satisfy the existing gates. The central eligibility function retains the safety gates; tenant/store and Desktop/device checks remain in their existing authorization paths. A misclassified store or control-plane record remains the primary operational risk.

## Production Impact

After the separate Release Gate is approved and deployed, eligible FOOD stores may open new dine-in business. Non-FOOD stores remain isolated. No Production mutation is authorized by this readiness record.

## Runtime / Contract / Provider Impact

Runtime policy impact is limited to removal of one eligibility prerequisite. No schema, migration, payment, printing, provider, or public contract change is in scope.

## Required Review

- Fresh-context ES-ENG-001 independent read-only review.
- Exact-file Scope Guard, `git diff --check`, typecheck, build, focused contract tests, and disposable database integration tests when the required local database is available.
- Final clean-candidate Release Lineage check before any release decision.

## Required Founder Approval

Founder approved implementation within this scope. A separate Founder decision is required for merge/main and Production deploy/full FOOD rollout. Post-release operational observations become corrective-task input; they do not replace the standing acceptance, regression, lineage, Production, and applicable Closure evidence requirements.

## Decision

READY for the bounded implementation package. Release remains separately gated.
