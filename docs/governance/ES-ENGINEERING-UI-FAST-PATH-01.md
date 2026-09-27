# ES-ENGINEERING-UI-FAST-PATH-01 UI Fast Path / Risk-Proportional Validation Governance V1.0

## Status

| Item | Value |
| --- | --- |
| Document ID | ES-ENGINEERING-UI-FAST-PATH-01 |
| Title | UI Fast Path / Risk-Proportional Validation Governance |
| Version | V1.0 |
| Status | ADDITIVE GOVERNANCE SUCCESSOR |
| Approval Authority | Founder |
| Task Level | L3 governance change |
| Effective Condition | This document is merged into `origin/main`. |

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline
- ES-ENGINEERING-RISK-BASED-DELIVERY-01 Risk-Based Development / Milestone FIELD Governance Addendum

This document is subordinate to all listed authorities. It adds a proportional validation profile for qualifying UI-only changes; it does not rewrite, waive, or weaken governance, security, release, FIELD, Freeze, or Closure requirements. Operational application is through the E-Shop Founder-Gated Agent Development Workflow V1.0 and `AGENTS.md`; those operational references do not become higher-level authority.

## 1. Core Rule

```text
Governance by path,
validation by actual risk,
FIELD by real-world impact.
```

- File path determines the governance discipline and protected-path requirements.
- The actual code change determines validation strength.
- Real-world operational impact determines independent FIELD strength.

These are separate decisions. A low-risk visual change in a protected path still requires the path's exact authorization. A change that is visually small but changes a critical lifecycle is not a UI Fast Path change.

## 2. UI Fast Path Definition

`UI-only + no core logic change` may enter the UI Fast Path when the implementation is presentation-only and preserves existing business behavior and lifecycle semantics.

Typical qualifying changes include:

- CSS, layout, spacing, and visual hierarchy;
- copy and text presentation;
- show/hide and collapse/expand presentation;
- information architecture and existing-entry reorganization;
- presentation-only conditional rendering;
- composition changes that continue to reuse existing handlers, state, components, APIs, and persistence.

The change must not alter the meaning, ordering, authorization, persistence, side effects, or lifecycle of the underlying operation.

The UI Fast Path is a validation profile, not a new task level and not a permission to bypass governance.

## 3. Governance Remains Mandatory

`UI Fast Path != Governance Bypass`.

The following remain mandatory whenever applicable:

- forbidden-path and Scope Guard requirements;
- Founder Gate and task-specific exact authorization;
- sealed or immutable candidate and exact content hash;
- independent review;
- Release Lineage Gate;
- applicable security, compatibility, build, regression, release, FIELD, Freeze, and Closure requirements.

Path protection is not reduced because the implementation is presentation-only. Existing stricter governance always wins.

## 4. Proportional Validation

For a genuinely presentation-only change, validation should use existing capabilities in proportion to actual risk. The default priority is:

1. Existing automated regression relevant to the changed surface.
2. TypeScript and build checks applicable to the repository and change.
3. Scope and Release Lineage gates.
4. Immutable/sealed candidate and exact hash where the path or authorization requires it.
5. Independent review where required by task level or existing governance.
6. Existing low-cost visual environment when legally available and authorized.
7. Aggregated visual/runtime/FIELD acceptance at the applicable milestone or pilot.

Presentation-only status does not, by itself, require a separate installer, Production deployment, standalone FIELD round, new database, local database repair, authentication bypass, seed tenant, Preview infrastructure, or Runtime/test environment.

This rule does not remove any validation explicitly required by a protected path, exact authorization, Founder Gate, release record, or higher-risk behavior.

## 5. Visual Acceptance and Existing Environments

The preferred experience for a UI Fast Path change is a low-cost, fast visual check after implementation using an already available and authorized environment, such as:

- existing Preview;
- existing development environment;
- existing candidate environment; or
- existing safe local environment.

If such an environment exists without additional infrastructure work, Founder visual acceptance may occur before merge or release according to the applicable task gate.

This task does not authorize creation, repair, or expansion of validation infrastructure. Do not create a new Preview environment, database, authentication bypass, seed environment, Runtime, or deployment automation solely for one low-risk UI change.

If no low-cost legal visual environment is available, visual acceptance may be recorded as `DEFERRED` and accumulated into the nearest appropriate Desktop milestone, Product milestone, or pilot candidate after the required automated validation has passed. This deferral does not permit a Production, FIELD, Freeze, or Closure claim that has not otherwise been authorized and evidenced.

## 6. FIELD Aggregation

Low-real-world-risk UI/UX changes may accumulate into a designated milestone or pilot for combined visual, runtime, and FIELD acceptance.

The default is not:

```text
every UI change
-> one installer
-> one Production deployment
-> one standalone FIELD round
```

The milestone record must retain the participating commits, scope, validation evidence, dependencies, and any deferred visual or FIELD evidence. Hard runtime dependencies remain fail-closed, and aggregated acceptance must not represent unverified behavior as verified.

## 7. Immutable Candidate First

For a protected-path UI-only change, the preferred sequence is:

```text
sealed candidate
-> exact hash
-> Scope / Release Lineage
-> tests / CI
-> required review
-> immutable feature candidate
-> visual acceptance at the authorized gate
```

Visual acceptance may be a pre-merge gate or a milestone acceptance gate when the actual risk, authorization, and existing governance permit that choice. It is not automatically a pre-commit blocker.

An immutable candidate does not imply Released, FIELD Visible, FIELD Verified, Frozen, or Closed.

## 8. Status Vocabulary

Engineering reports must distinguish the following states:

```text
IMPLEMENTED
RELEASED
FIELD VISIBLE
FIELD VERIFIED
```

At minimum, reports should state:

```text
IMPLEMENTED ON MAIN: YES / NO
RELEASED TO PRODUCTION: YES / NO
VISIBLE ON FIELD MACHINE: YES / NO / NOT CHECKED
VISUAL ACCEPTANCE: PASS / FAIL / DEFERRED / NOT REQUIRED
FIELD VERIFIED: YES / NO / DEFERRED / NOT REQUIRED
```

The meanings are distinct:

- `IMPLEMENTED ON MAIN` means the implementation commit is in `origin/main`.
- `RELEASED TO PRODUCTION` means the relevant Production deployment contains the implementation.
- `VISIBLE ON FIELD MACHINE` is an observation about a named real machine and does not by itself prove formal acceptance.
- `FIELD VERIFIED` requires the real-device or real-environment evidence required by the applicable governance.

Merge to main must not be described as Production delivery. Production delivery must not automatically be described as FIELD VERIFIED. `CLOSED` or `IMPLEMENTATION CLOSED` must not implicitly claim any of these states; existing Closure definitions remain authoritative.

## 9. Automatic Exit Conditions

Any task that appears visual but actually touches one of the following immediately exits the UI Fast Path:

- business logic;
- order state machine;
- payment semantics;
- authorization or security;
- API contract;
- database, schema, or migration;
- persistence semantics;
- Printing effect boundary or Printing lifecycle;
- Runtime lifecycle;
- Customer Display protocol or lifecycle;
- QZ or Runtime adapter;
- Installer or update mechanism; or
- irreversible external side effects.

After exit, classify and validate the task by actual impact under the applicable L2, L3, Release, and FIELD governance. The task must not retain Fast Path treatment merely because its requested outcome is described as UI.

## 10. Relationship to Existing Risk Levels

Qualifying presentation-only changes are commonly L1 implementation work when they do not trigger a higher-level rule. The path, actual diff, protected capability, and external impact remain decisive.

This document does not change the Founder-Gated Workflow's L1/L2/L3 definitions. A task with multiple characteristics uses the highest applicable level. Governance changes themselves remain governed as governance work and do not become L1 because the policy concerns UI.

## 11. Precedence and Conflict Handling

This document is additive. It does not override or lower:

- ES-GOV-001;
- ES-ENG-001;
- the Founder-Gated Agent Development Workflow;
- `AGENTS.md`;
- Scope Guard;
- Release Lineage Gate;
- Founder exact authorization;
- security, release, Freeze, FIELD, or Closure constraints.

When rules appear to conflict, the higher-level rule, the more specific protected-path authorization, and the stricter security or release constraint take precedence. The conflict must be reported rather than resolved by silently applying the Fast Path.

## 12. Scope and Non-Scope

This governance document covers proportional validation for qualifying UI-only and presentation-only changes.

It does not authorize or implement:

- product implementation, product code, or UI changes;
- Desktop, Cashier, Printing, Runtime, Payment, Database, API, or Installer work;
- `vercel.json`, Vercel configuration, deployment policy, Preview automation, or deployment;
- Scope Guard, Release Lineage, delivery-classification, CI, or other automation changes;
- authentication bypass, seed data, new infrastructure, or environment repair; or
- the separate `ES-RELEASE-SELECTIVE-LINEAGE-GOVERNANCE-01` task.

## 13. Change Control

Further changes to this rule require a new governed governance task. No product implementation, merge to main, Production deployment, Installer build, FIELD claim, Freeze, or Closure is authorized by this document alone.
