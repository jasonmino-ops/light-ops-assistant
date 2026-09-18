# ES-ENGINEERING-RISK-BASED-DELIVERY-01 Web/Shell Delivery Classification Clarification V1.0

## Status

| Item | Value |
| --- | --- |
| Document ID | ES-ENGINEERING-RISK-BASED-DELIVERY-01-WEB-SHELL-DELIVERY-CLARIFICATION |
| Version | V1.0 |
| Status | ADDITIVE GOVERNANCE SUCCESSOR |
| Task Level | L3 governance change |
| Effective Condition | Merged into `origin/main` |

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline
- ES-ENGINEERING-RISK-BASED-DELIVERY-01 Risk-Based Development / Milestone FIELD Governance Addendum V1.0

This clarification is additive. It does not weaken Scope Guard, Release Lineage, Release Foundation, Independent Review, Production Gate, FIELD, Freeze, Closure, or historical evidence.

## Delivery Classification

Classify the changed delivery boundary before selecting packaging and FIELD work:

| Class | Source boundary | Default delivery path |
| --- | --- | --- |
| `WEB` | Web source only (`app/**` and related Web tests/docs); no Desktop Shell bytes | Source Acceptance -> trusted integration -> Web Production deployment -> Browser and remote-Web smoke |
| `DESKTOP_SHELL` | `desktop/src/main/**`, `desktop/src/preload/**`, Electron IPC, native display/fullscreen, local runtime, Provider, builder, installer, or Windows integration | Source Acceptance -> controlled Desktop Candidate -> packaging -> installer -> Windows FIELD |
| `MIXED` | Both Web and Desktop Shell boundaries | Record and verify both Web identity and Desktop Shell identity; use the stricter applicable gates |

For a Desktop Shell that uses `BrowserWindow.loadURL()` to load remote Web content, a `WEB`-only change does not by itself require Desktop repackaging, Provider staging, NSIS generation, or V727 reinstall. This changes delivery classification only; it does not grant Production deployment or FIELD authorization.

## Milestone Identity

Remote-Web Desktop evidence must identify the actual runtime pair:

- Desktop Shell: Candidate SHA, shell version, installer SHA-256 when applicable;
- Web: Production deployment ID and deployed Web source SHA.

Installer identity alone is insufficient to establish the Web version used by a remote-Web Desktop.

## Gate Preservation

`WEB`, `DESKTOP_SHELL`, and `MIXED` are machine-readable delivery classes. Risk level still controls the gates. L3 Desktop Shell behavior retains controlled candidate and real Windows FIELD requirements. Production still requires trusted lineage, required tests/build/security, deployment evidence, rollback discipline, and Founder Production Gate.
