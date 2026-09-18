# ES-DESKTOP-UX-01 / P2 — Milestone FIELD Acceptance Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline
- E-Shop Founder-Gated Agent Development Workflow V1.0
- ES-ENGINEERING-RISK-BASED-DELIVERY-01 Risk-Based Development / Milestone FIELD Governance Addendum

## Basic Information

- Task: `ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION`
- Risk class: `L2`
- Source Accepted SHA: `db56bb9035afd74c28d26df42a7f7de89843bbce`
- Milestone target: `P3-B Desktop Pilot`
- Record purpose: record supplied V727 evidence without changing P2 implementation.

## Acceptance Decision

This record evaluates the P2 milestone gate. It does not accept a release, grant Production authorization, or reopen P2 implementation.

## Accepted Scope

Only the P2 Desktop visibility/preservation observations listed below and their milestone evidence classification.

## Explicit Non-Scope

No Cashier business logic, Offline/Sync semantics, Browser business change, P1A/P1B implementation, Printing, schema, migration, API, packaging, deployment, or final freeze.

## Evidence

FIELD machine: `V727 / PC-20260119FZUI`.

After the authorized Production Web deployment `dpl_DsBcjaHxdn96UAT8dirtSt18D7kk` sourced from `origin/main@4d177a8b507aaa8bdccb0abf8677df71fcbe789b`, Founder reopened the existing Desktop without reinstall, cache clearing, or configuration change and observed:

| P2 gate | Result |
| --- | --- |
| Desktop hides `安装到电脑` | `PASS` |
| Desktop hides `打开顾客屏` | `PASS` |
| Desktop hides technical product-cache detail | `PASS` |
| Language remains available | `PASS` |
| Management Center remains available | `PASS` by existing P2 acceptance/FIELD evidence |
| Exit fullscreen remains available | `PASS` |
| Network/offline status remains visible | `PASS` |
| Pending offline count remains visible | `PASS` (`0` shown) |
| Mino Pet Shop / `ST169E7000` restore | `PASS` |
| Employee Cashier directly usable | `PASS` |
| Real order | `PASS` |

The Founder-provided photographs are the FIELD evidence for the Desktop observations. Automated/source evidence also records Browser preservation, and `/cashier` plus `/desktop/pos` returned HTTP 200 in Production.

## Gate decision

The frozen Roadmap requires one real Desktop smoke and one real Browser smoke for P2. No separate Founder-confirmed Browser visual smoke is present in the supplied closure evidence. Automated Browser coverage, source review, and HTTP 200 responses do not replace that requirement.

- Implementation: `COMPLETE`
- Source Acceptance: `PASS`
- Desktop FIELD observations: `PASS`
- Browser real-machine smoke: `PENDING`
- P2 Milestone FIELD: `HOLD`
- P2 FIELD VERIFIED: `NO`
- P2 FINAL FROZEN: `NO`
- P2 CLOSED: `NO`

Required follow-up is a small authenticated Browser smoke on the approved machine, including the preserved `打开顾客屏` path and fallback. No code, packaging, or Production change is required by this record.

## Level 0 Compliance

No historical P1A/P1B evidence is reinterpreted. `SOURCE ACCEPTED` is not treated as `FIELD VERIFIED`, release, Freeze, or Closure.

## Acceptance Conditions

P2 can be accepted at this milestone only after the frozen Roadmap's real Browser smoke is recorded in addition to the supplied Desktop evidence.

## Result

`HOLD` — the exact missing evidence is recorded above.

## Merge

This evidence record does not authorize a merge, Production action, or next Phase.

## Boundary preservation

P1A and P1B implementation bytes are unchanged. P1B dual-display FIELD remains deferred. Printing source and business semantics are unchanged.
