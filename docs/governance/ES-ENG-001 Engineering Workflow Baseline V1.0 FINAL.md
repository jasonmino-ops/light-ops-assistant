# ES-ENG-001 Engineering Workflow Baseline V1.0 FINAL

## Status

| Item | Value |
| --- | --- |
| Document ID | ES-ENG-001 |
| Title | Engineering Workflow Baseline |
| Version | V1.0 |
| Status | FINAL |
| Freeze Status | FINAL FROZEN |
| Approval Authority | Founder |
| Scope | All Development Package and Engineering Package work for E-Shop Store Operating System |

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Purpose

This document defines the standard Engineering Package workflow for E-Shop Store Operating System.

It applies to Runtime, Provider, Supply Runtime, AI Runtime, Contract, Desktop Runtime, Hardware Runtime, architecture packages, acceptance records, freeze records, and implementation evidence.

## Core Principle

No Readiness, No Authorization.

No Authorization, No Engineering Package.

No Evidence, No Review.

No Review, No Acceptance.

No Acceptance, No Merge.

No Merge, No Freeze.

No Freeze, No Next Baseline.

## Engineering Package Lifecycle

Standard lifecycle:

```text
Readiness Review
-> Engineering Authorization
-> Engineering Package Implementation
-> Evidence Pack
-> Claude Review / Required Review
-> Acceptance Record
-> Merge
-> Freeze Record
-> Gate Update
-> Next EP Decision
```

Standard status flow:

```text
DRAFT
-> READY FOR AUTHORIZATION
-> AUTHORIZED
-> IMPLEMENTED
-> REVIEW READY
-> REVIEW PASS
-> ACCEPTED
-> MERGED
-> FROZEN
```

## Readiness Review

Readiness Review determines whether an Engineering Package may start.

Required template:

```markdown
# ES-XXX-READINESS-001 <Name> Readiness Review V1.0

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Goal

## Current State

## Prerequisites

## Scope

## Non-Scope

## Risk Assessment

## Production Impact

## Runtime / Contract / Provider Impact

## Required Review

## Required Founder Approval

## Decision

READY / NOT READY
```

Readiness is mandatory when a package may affect architecture, production paths, state flow, permissions, database schema, hardware, Runtime, Provider, Contract, or AI business execution.

## Engineering Authorization

Engineering Authorization formally permits implementation.

Required template:

```markdown
# ES-XXX-AUTH-001 <Name> Engineering Authorization V1.0

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Authorized Package

## Authorized Branch

## Authorized Starting HEAD

## Allowed Scope

## Prohibited Scope

## Required Outputs

## Required Evidence

## Required Verification

## Review Requirement

## Acceptance Requirement

## Freeze Requirement

## Decision

AUTHORIZED / NOT AUTHORIZED
```

Authorization must define branch, starting HEAD, allowed files/modules, prohibited files/modules, review requirements, and whether 80%-90% implementation is permitted.

## Engineering Package

Implementation Record template:

```markdown
# ES-XXX-EPXX-IMPLEMENTATION-001 <Name> Implementation Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Basic Information

| Item | Value |
| --- | --- |
| Milestone | |
| Engineering Package | |
| Gate | |
| Branch | |
| Formal Starting HEAD | |
| Status | IMPLEMENTED / NOT ACCEPTED / NOT FROZEN |

## Scope

## Module Structure

## Implemented Behavior

## Tests

## Evidence

## Known Limitations

## Excluded Scope

## Risk

## Acceptance Addendum
```

## Engineering Package Independence

Engineering Package must be independently understandable.

An EP must allow a reviewer to understand its goal, scope, implementation, Evidence, Acceptance, and Freeze without reading another EP Implementation Record.

EPs may reference prior work only through formal frozen assets:

- Freeze Record
- Acceptance Record
- Architecture Baseline
- ADR
- Evidence Pack
- main HEAD / merge commit

EPs must not depend on implicit conversation context, undocumented decisions, or unstated historical assumptions.

## No Scope Creep

Once an Engineering Package is authorized, its scope is frozen.

During implementation, scope must not expand because something is convenient, simple, adjacent, or easy to change together.

New requirements must enter a new Engineering Package.

Any exception requires renewed Readiness Review and Engineering Authorization.

## Evidence Pack

Evidence Pack supports Review, Acceptance, and Freeze.

Required evidence directory pattern:

```text
docs/<domain>/<ep-id>-review-evidence/
```

Required evidence zip pattern:

```text
<EP-ID>-<Short-Name>-Review-Evidence-Pack-<HEAD-short>-final.zip
```

Required files:

```text
REVIEW-MANIFEST.md
CHECKSUMS.md
BUILD-CI-EVIDENCE.md
COMMIT-SCOPE-AUDIT.md
SCOPE-BOUNDARY-AUDIT.md
TEST-COVERAGE-MATRIX.md
KNOWN-RISKS.md
REPOSITORY-OVERVIEW.md
```

Runtime and Provider packages should additionally include module responsibility, dependency direction, lifecycle, ownership, supervision, diagnostics, conformance vectors, and boundary evidence.

## Claude Review

Claude Review is required for architecture-sensitive packages.

Required review request template:

```markdown
# Claude Review Request

## Review Target

## Branch

## HEAD

## Scope

## Non-Scope

## Architecture Questions

## Risk Questions

## Evidence Pack

## Required Output

1. PASS / FAIL
2. Blocking Issues
3. Non-Blocking Issues
4. Boundary Violations
5. Missing Evidence
6. Architecture Risks
7. Acceptance Recommendation
```

Claude Review is mandatory for:

- New Runtime
- New Provider
- Contract upgrade
- Runtime lifecycle model
- Provider ownership / supervision / diagnostics
- Assignment / Command / Scanner / Display Runtime
- Supply Runtime core state flow
- AI Runtime decision flow
- Permission, security, or isolation model
- Production-critical API
- Freeze candidate

Claude Review is not mandatory for:

- Typo-only documentation fixes
- Small archival updates
- Evidence checksum recording
- Non-behavioral naming clarification
- Drafts that do not enter Acceptance or Freeze

If Claude Review is not required, the package must state why.

## Founder Approval

Founder Approval is mandatory for:

- Milestone entry approval
- Gate promotion
- Production risk increase
- Database schema change
- Permission system change
- Order state flow change
- Payment, finance, settlement, or inventory core path change
- Real hardware Provider entering store trial
- AI Runtime executing real business actions
- Exception to a frozen baseline
- Level 0 Governance evolution

Founder Approval is not mandatory for:

- Implementation inside already authorized scope
- Tests inside already authorized scope
- Evidence Pack generation
- Draft Acceptance Record
- Draft Freeze Record
- Non-production documentation refinement

## Acceptance

Acceptance requires:

- Implementation complete
- Evidence complete
- Required Review PASS
- Build / CI pass
- Scope boundary verified
- Known risks recorded
- Non-scope reaffirmed

Acceptance Record template:

```markdown
# ES-XXX-ACCEPTANCE-001 <Name> Acceptance Record V1.0

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Basic Information

## Acceptance Decision

## Accepted Scope

## Explicit Non-Scope

## Evidence

## Level 0 Compliance

## Acceptance Conditions

## Result
```

Acceptance does not authorize additional development or start the next EP.

## Merge

Merge occurs only after Acceptance.

Recommended command pattern:

```bash
git checkout main
git fetch origin main
git merge --no-ff <ep-branch> -m "merge: accept <ep-id> <short-name>"
git push origin main
```

Merge commit message pattern:

```text
merge: accept <ep-id> <short-name>
```

Merge must record merge commit, main HEAD, origin/main HEAD, CI status, production status when applicable, and git status.

## Freeze

Freeze occurs only after Merge.

Freeze Record template:

```markdown
# ES-XXX-FREEZE-001 <Name> Freeze Record V1.0

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Basic Information

## Freeze Decision

## Frozen Artifacts

## Frozen Scope

## Frozen Boundary

## Evidence Integrity

## Governance Freeze Check

## Result
```

Freeze makes the package a stable baseline. Further changes require a new EP, V2, Addendum, or new governance document as applicable.

## Gate

Gate Record template:

```markdown
# ES-XXX-GATE-001 <Gate Name> Gate Record V1.0

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Gate Definition

## Required Packages

## Required Evidence

## Pass Criteria

## Current Status

## Result

PASS / FAIL / PARTIAL
```

A Gate may be marked PASS only after required packages are Accepted, Merged, and Frozen.

## Branch Naming

Engineering Package branch pattern:

```text
<milestone>/<ep-id>-<short-name>
```

Example:

```text
mb2/ep01-provider-runtime
```

Rules:

- Each EP uses an independent branch.
- Branch starts from the formal starting HEAD.
- No direct implementation work on main.
- A frozen EP branch must not be reused for new development.

## Commit Naming

Commit message pattern:

```text
<type>(<scope>): <summary>
```

Allowed types:

```text
feat
fix
test
docs
build
chore
merge
```

Examples:

```text
feat(hrt): add provider runtime core
test(hrt): add provider runtime conformance coverage
docs(hrt): accept mb2 ep01 provider runtime
docs(hrt): freeze mb2 ep01 provider runtime
merge: accept mb2 ep01 provider runtime
```

Rules:

- One commit must not mix multiple EPs.
- Runtime commits must not hide documentation closure changes.
- Documentation commits must not hide runtime changes.
- Freeze commits must not change implementation behavior.

## Evidence Naming

Evidence directory:

```text
docs/<domain>/<ep-id>-review-evidence/
```

Evidence zip:

```text
<EP-ID>-<Name>-Review-Evidence-Pack-<HEAD-short>-final.zip
```

Acceptance Record:

```text
ES-<DOMAIN>-ACCEPTANCE-<NNN> <Name> Acceptance Record V1.0.md
```

Freeze Record:

```text
ES-<DOMAIN>-FREEZE-<NNN> <Name> Freeze Record V1.0.md
```

Implementation Record:

```text
ES-<DOMAIN>-EP<NN>-IMPLEMENTATION-001 <Name> Implementation Record.md
```

## 80%-90% Engineering Rule

80%-90% implementation is allowed only when:

- Scope is clear.
- Non-scope is clear.
- Production path is not affected.
- Database schema is not changed.
- Permission system is not changed.
- Order state flow is not changed.
- The change is locally verifiable.
- The change is reversible.
- No irreversible external dependency is introduced.
- No real hardware execution is initialized.

Readiness is mandatory before work when:

- A new Runtime is created.
- A new Provider is created.
- Contract changes.
- Real hardware is involved.
- Database schema changes.
- Permissions change.
- Order state changes.
- Payment, settlement, inventory, or finance changes.
- AI starts executing real business actions.
- Production paths are affected.
- Multiple business modules are affected.
- Risk boundary is unclear.

## Final Output Checklist

Every formal Engineering Package completion must output:

- Implementation Record
- Evidence Pack
- Review Result
- Acceptance Record
- Implementation Acceptance Addendum
- Merge Commit
- main HEAD
- Freeze Record
- CI Status
- Production Status when applicable
- Git Status
- Next Step Recommendation

## Final Decision

ES-ENG-001 Engineering Workflow Baseline V1.0 FINAL is FINAL FROZEN.

All future Development Packages and Engineering Packages must follow this workflow unless Level 0 Governance evolves through approved V2, Addendum, or new governance document.
