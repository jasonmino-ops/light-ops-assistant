# ES-ENGINEERING-RISK-BASED-DELIVERY-01 Risk-Based Development / Milestone FIELD Governance Addendum V1.0

## Status

| Item | Value |
| --- | --- |
| Document ID | ES-ENGINEERING-RISK-BASED-DELIVERY-01 |
| Version | V1.0 |
| Status | ADDITIVE GOVERNANCE SUCCESSOR |
| Approval Authority | Founder |
| Task Level | L3 governance change |
| Effective Condition | This Addendum is merged into `origin/main`. |

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

This Addendum is subordinate to Level 0. It does not rewrite, replace, or weaken the FINAL Founder-Gated Workflow, Release Lineage Gate, Scope Guard, exact authorization, historical FIELD semantics, or historical Freeze semantics.

## Purpose

This Addendum introduces risk-appropriate development and Milestone FIELD without lowering quality, security, lineage, review, release, or Production requirements.

```text
Continuous Development
-> Automated Gates
-> Source Acceptance
-> Milestone Integration
-> Integrated Candidate
-> Risk-appropriate FIELD
-> Release / Freeze
```

`SOURCE ACCEPTED` is not `FIELD VERIFIED`, `RELEASE CANDIDATE`, `PRODUCTION READY`, `FINAL FROZEN`, or `CLOSED`.

## Risk Model

### L1 — Low risk

Presentation-only or low blast-radius changes such as UI visibility, copy, non-business layout, diagnostics presentation, and non-runtime documentation/evidence.

L1 still requires the existing branch/worktree, lineage, Scope Guard, and relevant automated checks. A protected path remains protected and requires its exact authorization. A task that triggers an existing higher-level rule is executed at that higher level.

L1 does not require a standalone Windows installer, Provider staging, V727 transfer, installation, or FIELD when the behavior is covered by a designated Milestone.

### L2 — Medium risk

Bounded business behavior, management workflows, non-critical APIs, and business UI behavior.

L2 requires unit/integration/regression tests, typecheck/build, relevant security checks, Scope/Lineage, and independent review. It may accumulate to a designated Milestone when no unresolved hard dependency exists and all unverified behavior is registered as FIELD debt.

Critical transaction state, payment finalization, security/authorization boundaries, destructive persistence, critical data integrity, hardware, and Runtime dependencies upgrade the work to L3.

### L3 — High risk

Installer and release foundation, Electron Runtime, Display/Hardware Runtime, Printing, Provider, Activation, Authorization, credentials/security boundaries, payment finalization, offline recovery, destructive migration, critical data integrity, rollback-sensitive infrastructure, and Production/release mechanisms.

L3 retains:

```text
IMPLEMENT -> STRONG AUTOMATED GATES -> INDEPENDENT REVIEW
-> CONTROLLED CANDIDATE -> REAL FIELD -> ACCEPTANCE
```

Milestone accumulation must not represent unverified L3 behavior as verified. A Founder-approved risk deferral may record debt, but cannot authorize a related release or Production claim before the debt is cleared.

## Acceptance States

### SOURCE ACCEPTED

`SOURCE ACCEPTED` means the exact source change has passed:

- implementation complete;
- automated acceptance PASS;
- required independent review PASS;
- Scope Guard PASS;
- Release Lineage PASS;
- no unresolved blocker;
- exact FIELD status and debt, if any, recorded; and
- designated Milestone recorded.

Source Acceptance permits authorized Milestone integration. It does not permit release, Production deployment, FIELD claim, Freeze, or Closure.

The existing ES-ENG-001 `ACCEPTED` status remains the formal Acceptance Record status. This Addendum does not silently redefine it; the new state must be labelled explicitly as `SOURCE ACCEPTED`.

### INTEGRATED MILESTONE

An `INTEGRATED MILESTONE` contains only Source Accepted changes with a complete manifest of commits, scopes, reviews, dependencies, and FIELD debt. It is not a release until it passes the Release Candidate gate.

### RELEASE CANDIDATE

`RELEASE CANDIDATE` retains the existing complete Release Foundation, packaging, provenance, artifact, SHA, required FIELD, acceptance, and Founder release requirements.

## FIELD Debt

FIELD debt is a minimal, explicit record of behavior not yet verified on the required real device or environment. The machine-readable register is:

`docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json`

Required fields are:

```text
task, riskClass, unverifiedBehavior, deferralReason,
requiredEnvironmentOrHardware, mustClearBefore, status, evidenceReference
```

Debt is never PASS, cannot roll indefinitely, and must be cleared before a related commercial claim, Release, or Freeze. Debt with no runtime dependency does not block unrelated L1/L2 work.

## Dependency Rule

Dependencies are classified as:

- `HARD`: downstream behavior relies on the unverified upstream behavior;
- `SOFT`: sequencing or product preference without runtime dependency; and
- `NO_RUNTIME`: no technical dependency.

The default Roadmap order remains authoritative. A downstream L1/L2 task may proceed after Source Acceptance when its dependency is not HARD, all debt is registered, and no unresolved blocker exists. HARD dependencies fail closed.

No Founder Gate is removed for Milestone promotion, L3 FIELD, Production, release, or Freeze.

## Release Foundation Modes

The existing `policy` command remains the strict `RELEASE_CANDIDATE` mode. It continues to validate every frozen boundary, release asset, provenance, Provider/artifact requirement, and fail-closed condition.

The `source-policy` command is the separate `SOURCE_ACCEPTANCE` mode. It verifies:

- exact registered task and source commit;
- clean trusted baseline and Production lineage;
- exact authorized successor boundary and protected-path hash;
- no unauthorized frozen-boundary changes; and
- complete FIELD debt and Milestone target.

It intentionally does not create or validate an installer and cannot produce a FIELD or Production result.

Unknown, unregistered, hash-mismatched, non-descendant, or cross-boundary source changes fail closed.

## Roadmap Compatibility

The FINAL Roadmap default order remains unchanged. Phase progression may use risk, Source Acceptance, dependency class, unresolved blockers, FIELD debt, and the designated Milestone instead of mechanically requiring every upstream task to have an independent installer/FIELD cycle.

The first Desktop designated Milestone is:

```text
P2 Source Accepted -> P3-B Desktop Pilot Integrated Candidate -> Windows FIELD
```

P1B dual-display FIELD debt remains deferred and does not block the single-screen P3-B Desktop Pilot. It must be cleared before any dual-display commercial claim, dual-display Production acceptance, or P1B FINAL FROZEN decision.

## Compatibility and Historical Protection

This Addendum applies only after it is effective and to explicitly migrated active tasks. It does not reinterpret or weaken historical P1A/P1B evidence, `FIELD VERIFIED`, `FINAL FROZEN`, or `CLOSED` records.

Production remains subject to trusted lineage, Release Lineage, Release Foundation, tests/build/security, required FIELD, acceptance, rollback discipline, and Founder Production Gate. `SOURCE ACCEPTED` is never Production authorization.

## Change Control

This Addendum is an additive successor. Further changes require a new governed governance task. No P3-B implementation, Production deployment, release promotion, or final freeze is authorized by this Addendum.
