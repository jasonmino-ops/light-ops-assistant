# ES-DESKTOP-UX-01 / P3-B — Production Web Delivery-Skew Causality Record

## Finding

The first P3-B FIELD run used a valid Desktop Shell Candidate but displayed the pre-P2 Cashier controls. Read-only causality triage classified:

- P2 implementation causality: `NOT SUPPORTED`
- P3-B packaging causality: `NOT SUPPORTED`
- Production Web version causality: `SUPPORTED`

The Desktop uses Electron `BrowserWindow.loadURL()` and therefore consumes remote Web content. At the first FIELD time, the Shell Candidate and the remote Production Web were different runtime identities: the Shell was new while Production had not yet contained the P2 Source Accepted bytes.

## Corrective evidence

Founder authorized deployment of `origin/main@4d177a8b507aaa8bdccb0abf8677df71fcbe789b` to Production. Deployment `dpl_DsBcjaHxdn96UAT8dirtSt18D7kk` reached `READY` and `elifekh.com` was bound to it. Founder then reopened the existing V727 Desktop without reinstall, cache clear, or configuration change and observed all three P2 Desktop-only visibility changes.

This confirms the correction was a Production Web promotion, not a Desktop packaging defect. No further deployment or installer regeneration is authorized by this record.

## Delivery lesson

For remote-Web Desktop, installer identity alone is insufficient. The accepted runtime identity is the pair:

1. Desktop Shell Candidate/version/installer hash; and
2. Production Web deployment/source SHA.

The additive Web/Shell Delivery Classification clarification records this rule without changing runtime behavior or weakening any Release, Scope, FIELD, or Production gate.
