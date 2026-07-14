# ES-MB-ADR-003 Provider Packaging Upgrade Supervision V1.0-RC2

Status: RECOMMENDED FOR MILESTONE B RC1 APPROVAL / FOUNDER PRINCIPLE DECISION RECORDED / RE-EVALUATE AFTER REAL-DEVICE ACCEPTANCE / NOT YET CLOSED

Title: Windows Provider Packaging, Upgrade, Rollback, and Process Supervision

## 1. Context

Milestone B requires a Windows Provider lifecycle model. The founder principle decision recorded for RC2 is independently installed Windows user-session background process for Milestone B RC1, with re-evaluation after real-device acceptance.

## 2. Problem

Provider must be installed, started, supervised, updated, rolled back, logged, diagnosed, and uninstalled without becoming an independent hardware entry point.

## 3. Decision Drivers

- Provider independent installation.
- Desktop Runtime remains authoritative orchestrator.
- Store Applications never call Provider.
- Runtime and Provider independent versions.
- Compatibility matrix.
- Signing and installer trust.
- Crash recovery without infinite restart loop.
- Real hardware may force later re-evaluation.

## 4. Options Considered

- Windows Service.
- User-session background process.
- Runtime-managed child process.
- Hybrid supervision mode.
- Installer-managed startup only.

## 5. Recommended Decision

For Milestone B RC1, use independently installed Windows user-session background process.

Mandatory rules:

- Independent installation does not mean independent entry.
- Desktop Runtime remains the only orchestrator.
- Provider must not be called by Store Applications.
- Provider may be independently versioned.
- Runtime and Provider are bound by compatibility matrix.
- Provider must not self-update.
- Update ownership belongs to installer/release mechanism.
- Runtime may supervise Provider but must not bypass install/signing boundaries to replace binaries.
- Same Windows user session allows only one formal Provider instance.
- Multi-instance conflict handling is mandatory.

## 6. Startup and Supervision

Startup ownership must define:

- Login startup behavior.
- Desktop Runtime startup behavior.
- Installer startup behavior.

Supervision must define:

- Crash detection.
- Restart backoff.
- Maximum restart count.
- No infinite restart loop.
- Manual recovery path.
- Logging of restart attempts.

Provider may be restarted under supervision, but Provider must not accept business hardware commands before Runtime handshake is complete.

## 7. Disconnected Behavior

- If Provider loses Runtime connection, it must not accept new business commands.
- In-flight command disconnection must follow frozen Command Outcome and Side-Effect Boundary.
- Provider crash must degrade hardware path without corrupting Cloud or Desktop Runtime data.

## 8. Install, Update, Rollback, Uninstall

Requirements:

- Signed installer before formal production support.
- SmartScreen handling documented.
- Artifact checksum.
- Release manifest.
- Independent Provider version.
- Runtime/Provider compatibility matrix.
- Rollback owner.
- Uninstall must not damage Desktop Runtime or Cloud data.
- Provider logs, config, and diagnostics paths must be explicit.

## 9. Re-evaluation Trigger

The RC1 user-session process choice does not permanently exclude:

- Windows Service.
- User-session process.
- Runtime-managed child process.
- Hybrid supervision mode.

After real-device acceptance, process model must be re-evaluated against device access, stability, permissions, install complexity, supportability, and recovery.

## 10. Security Impact

- Installer must protect binary and trust material paths.
- Runtime must verify Provider instance by handshake.
- Provider must not expose a second local application API.
- Signed artifacts are required for production support.

## 11. Operations Impact

- Support bundle must include installed version, running instance ID, process status, crash count, restart count, log path, config path, last handshake, and compatibility status.
- Release SOP must cover install, update, rollback, uninstall, and clean-machine test.

## 12. Testing Impact

Required tests:

- Single instance enforcement.
- Multi-instance conflict.
- Startup after login.
- Startup after Runtime launch.
- Provider crash restart with backoff.
- Maximum restart limit.
- Runtime disconnect behavior.
- In-flight command disconnect behavior.
- Upgrade.
- Rollback.
- Uninstall.
- Clean-machine install.
- Unsigned dev build limited to test machine.

## 13. Migration Impact

Legacy remains available until installed Provider completes Runtime handshake, compatibility check, and device vertical slice acceptance.

## 14. Open Questions

- Final installer technology.
- Signing certificate owner.
- Release channel and artifact storage.
- Whether real-device acceptance requires Service or hybrid mode later.

## 15. Closure Conditions

- RC1 process model approved.
- Startup ownership approved.
- Single-instance rule approved.
- Supervision and restart limit approved.
- Update ownership approved.
- Compatibility matrix approved.
- Signing and installer path approved.
- Rollback and uninstall rules approved.
- Re-evaluation trigger approved.

## 16. Approval Record

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| Founder | TBD | PRINCIPLE DECISION RECORDED / NOT CLOSED | TBD | User-session background process for Milestone B RC1 |
| CTO | TBD | NOT CLOSED | TBD | Closure required before lifecycle implementation |
