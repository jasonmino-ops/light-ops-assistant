# ES-MB-ADR-003 Provider Packaging Upgrade Supervision V1.0 FINAL

STATUS: ACCEPTED FOR MILESTONE B RC1 / CLOSED / FINAL / RE-EVALUATION REQUIRED AFTER REAL-DEVICE ACCEPTANCE
FINAL DECISION: Independently Installed Windows User-Session Background Process
APPROVAL AUTHORITY: Founder
APPROVAL DATE: 2026-07-14

## 1. Process Model

For Milestone B RC1, Windows Provider shall be an independently installed Windows user-session background process.

This choice is scoped to Milestone B RC1 and must be re-evaluated after real-device acceptance.

## 2. Installation Model

- Provider is independently installed.
- Independent installation does not mean independent entry.
- Desktop Runtime remains the only orchestrator.
- Store Applications must not call Provider directly.
- Provider may be independently versioned.
- Runtime and Provider are constrained by compatibility matrix.

## 3. Single Instance

- One formal Provider instance is allowed per Windows user session.
- Multi-instance conflict handling is mandatory.
- Provider must not accept business hardware commands before Runtime handshake.

## 4. Supervision

- Runtime may supervise Provider process health.
- Crash restart is allowed.
- Restart backoff is mandatory.
- Maximum restart count is mandatory.
- Infinite restart loop is prohibited.

## 5. Restart Policy

On crash or disconnect:

- Provider must not accept new business commands without Runtime connection and handshake.
- In-flight command disconnect behavior must follow frozen Command Outcome and Side-Effect Boundary.
- Restart attempts must be logged.

## 6. Update Ownership

- Provider must not self-update.
- Update ownership belongs to installer / release mechanism.
- Runtime must not bypass signing and installation boundaries to replace Provider binary.

## 7. Rollback

Rollback must be owned by release mechanism and documented in release manifest. Rollback must not corrupt Runtime, Cloud data, or Legacy fallback state.

## 8. Signing

Production support requires signed installer/artifact. Unsigned builds are limited to controlled development/test machines.

## 9. Compatibility Matrix

Runtime and Provider versions must be accepted through compatibility matrix and ADR-02 handshake.

## 10. Logs, Config, and Diagnostics

Provider logs, config, and diagnostics paths must be explicit. Support bundle must include installed version, running instance ID, process status, crash count, restart count, log path, config path, last handshake, and compatibility status.

## 11. Uninstall

Provider uninstall must not damage Desktop Runtime or Cloud data.

## 12. Re-evaluation Trigger

After real-device acceptance, re-evaluate:

- Windows Service.
- User-session process.
- Runtime-managed child process.
- Hybrid supervision mode.

Re-evaluation must consider device access, stability, permissions, install complexity, supportability, and recovery.

## 13. Closure Record

| Field | Value |
| --- | --- |
| Closure status | CLOSED |
| Decision | Independently Installed Windows User-Session Background Process |
| Scope | Milestone B RC1 |
| Authority | Founder |
| Date | 2026-07-14 |
| Re-evaluation | Required after real-device acceptance |

## 14. Reopening Conditions

Reopen only if:

- Real-device acceptance proves user-session model unsuitable.
- Windows Service or hybrid mode becomes required.
- Signing/install/update ownership must change.
- Founder explicitly orders ADR reopening.
