# ES-DESKTOP-UX-01 / P3-B — V727 Desktop Pilot FIELD Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline
- E-Shop Founder-Gated Agent Development Workflow V1.0
- ES-ENGINEERING-RISK-BASED-DELIVERY-01 Risk-Based Development / Milestone FIELD Governance Addendum

## Basic Information

- FIELD machine: `V727 / PC-20260119FZUI`
- Shell version: `0.2.0-pilot.2`
- Candidate SHA: `9c78dbf6e715182e74a411e1951918a8fe060274`
- Installer SHA-256: `8d6d540db011f604c280dad1f8ae7ca09799072d46883930c94b9b93998893c2`
- Production Web deployment: `dpl_DsBcjaHxdn96UAT8dirtSt18D7kk`
- Production Web source: `origin/main@4d177a8b507aaa8bdccb0abf8677df71fcbe789b`

## Acceptance Decision

This record evaluates the supplied single-display P3-B pilot facts. It does not authorize P4-1, 4-0, Production, Freeze, or Closure.

## Accepted Scope

Only the V727 single-display pilot observations and the combined Web/Shell identity stated here.

## Explicit Non-Scope

No P3-B implementation change, P1A/P1B reopen, dual-display claim, Printing change, packaging change, deployment, P4-1, or 4-0 design decision.

## Supplied FIELD facts

- Installer transfer and source/SMB/Windows-local hashes: `PASS`.
- Installation and Desktop launch: `PASS`.
- Activation/store/POS restore and Employee Cashier usability: `PASS`.
- P2 Desktop simplified controls: `PASS` after the authorized Web deployment, without reinstall or cache clearing.
- Real order: `PASS`.
- P1A regression: `PASS`.
- P1B single-display regression: `PASS`.
- P1B dual-display FIELD: `DEFERRED / HARDWARE UNAVAILABLE`.
- Printing source: unchanged; no Printing claim is made by this record.

## Frozen P3-B Exit Gate

The FINAL Roadmap defines P3-B as a real pilot, not only a functional smoke. Exit requires a sufficient round of real observation covering actual operators, shift/operator switching, owner cashier use, sensitive actions, temporary owner approvals, the observation checklist, and absence of unresolved blocking defects. The Founder must declare `Pilot Evidence Sufficient = YES` before the next Design Gate.

The supplied evidence proves the single-display functional observations above, but does not include the complete observation set or the Founder declaration. Browser fallback was not recorded as a new authenticated visual smoke in this closure packet.

- P3-B functional FIELD observations: `PASS`
- P3-B Pilot FIELD: `HOLD`
- P3-B FIELD VERIFIED: `NO`
- P3-B Acceptance Ready: `NO`
- `Pilot Evidence Sufficient`: `NOT DECLARED`
- P4-1 / 4-0: `NOT STARTED`
- Final Freeze: `NO`

This is a conservative evidence classification, not a defect finding. It does not reopen P1A/P1B/P2 implementation and does not require a new Candidate.

## Level 0 Compliance

P1A remains closed; P1B implementation remains frozen; P1B dual-display remains deferred. No automated result is substituted for real FIELD evidence.

## Acceptance Conditions

P3-B acceptance requires the complete frozen observation set and Founder declaration `Pilot Evidence Sufficient = YES`.

## Result

`HOLD` — functional single-display facts are recorded, but the formal Pilot Exit Gate is incomplete.

## Merge

This record does not authorize a merge, Production action, P4-1, or final Freeze.
