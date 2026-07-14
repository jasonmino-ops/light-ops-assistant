# ES-MB-ADR-003 Provider Packaging Upgrade Supervision V1.0-RC1

Status: PROPOSED / NOT APPROVED / NOT CLOSED

Title: Windows Provider Packaging, Upgrade, Rollback, and Process Supervision

## 1. Context

ES-MB-GATE-001 maps Provider packaging, install, upgrade, rollback, process guarding, and crash restart into ADR-03. Gate C6 found existing Desktop Windows installer CI, but it is unsigned and does not define Provider lifecycle.

## 2. Problem

Windows Provider must be installable, startable, upgradable, recoverable, diagnosable, and removable without turning into a second Runtime or creating uncontrolled hardware execution.

## 3. Decision Drivers

- USB/HID/Serial/Printer access depends on Windows session and permissions.
- Provider must run reliably during cashier operation.
- Runtime and Provider must have independent versions.
- Signing and SmartScreen risk must be managed.
- Crash recovery must be observable.
- Clean-machine install must be testable.

## 4. Options

| Option | Notes |
| --- | --- |
| Windows Service | Strong lifecycle and recovery, but user-session device access may be harder |
| User-session background process | Better access to user devices, but startup/recovery must be managed carefully |
| Desktop Runtime managed child process | Simple supervision, but risks making Provider non-independent |
| Installer-managed startup | Good deployment control, insufficient runtime health alone |

Technology stack options remain related:

- .NET Worker / Windows Service.
- Node.js independent process.
- Electron child process.
- Other Windows-native host if justified by device APIs.

## 5. Trade-offs

- Windows Service is operationally strong but may struggle with USB/HID/Serial devices attached to interactive sessions.
- User-session process aligns with POS operator context but needs robust startup and crash restart.
- Runtime-managed child process simplifies trust and stdio but weakens independent Provider lifecycle.
- Installer-managed startup is necessary but not sufficient.

## 6. Proposed Decision

Recommended for approval:

- Treat Provider as an independently installed Windows user-session background process for RC1 unless hardware readiness proves service access is required and viable.
- Installer owns installation, update, uninstall, shortcuts/startup registration, logs path, and manifest.
- Desktop Runtime owns live supervision, handshake acceptance, health interpretation, and cutover decisions.
- Provider and Runtime have independent versions with compatibility matrix.
- Provider startup must not expose Store Application API.
- Signing is mandatory before formal production support.
- Unsigned artifacts may be used only for controlled development/test machines.

## 7. Consequences

- Installer and Runtime must coordinate without sharing business ownership.
- Support tooling must report process status, installed version, accepted version, and crash count.
- Clean-machine acceptance becomes a release gate.

## 8. Security Impact

- Installer must set tight file permissions for trust material and logs.
- Startup registration must not allow untrusted path hijacking.
- Signed artifacts reduce SmartScreen and tamper risk.

## 9. Operations Impact

- Operations must own install, upgrade, rollback, uninstall, and support bundle SOP.
- Provider crash must degrade hardware path and preserve Store Application operation.
- Legacy rollback must remain terminal-scoped.

## 10. Testing Impact

- Requires Windows runner for package build.
- Requires clean Windows machine or VM for install/uninstall.
- Requires self-hosted Windows hardware runner for device access.
- Crash restart, forced kill, upgrade, rollback, and uninstall tests are required.

## 11. Migration Impact

- Legacy remains available until Provider install and Runtime handshake are accepted.
- Cutover must not occur on unsigned/unaccepted Provider in production.

## 12. Open Questions

- Final installer technology: NSIS, WiX/MSI, MSIX, or another approved path.
- Whether Provider process is auto-started by login, Runtime, or both with single-instance lock.
- Signing certificate owner and CI secret handling.
- Release channel and rollback artifact storage.

## 13. Closure Conditions

- Startup ownership approved.
- Supervision ownership approved.
- Installer technology approved.
- Signing plan approved.
- Version compatibility and rollback rules approved.
- Clean-machine acceptance checklist approved.

## 14. Approval Record

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Founder | TBD | NOT APPROVED | TBD | Required before WS-2 lifecycle implementation |
| CTO | TBD | NOT CLOSED | TBD | Required before real-device release gate |
