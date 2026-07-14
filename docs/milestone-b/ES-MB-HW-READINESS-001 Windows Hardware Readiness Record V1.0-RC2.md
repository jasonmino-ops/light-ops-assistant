# ES-MB-HW-READINESS-001 Windows Hardware Readiness Record V1.0-RC2

Status: DRAFT FOR FINAL FOUNDER REVIEW / NOT APPROVED / NOT FROZEN

MB-3 Status: BLOCKED

Reason: real Windows test machine and device parameters have not been verified.

## 1. Control

| Field | Value |
| --- | --- |
| Document ID | ES-MB-HW-READINESS-001 |
| Version | V1.0-RC2 |
| Status | DRAFT FOR FINAL FOUNDER REVIEW / NOT APPROVED / NOT FROZEN |
| Gate | MB-3 — Windows Hardware Ready |
| Gate state | BLOCKED |
| Owner | WS-2 Owner / Verifier |

## 2. Gate Rule

MB-3 is the hard gate for WS-2 real-device Executor finalization, WS-2 real-device acceptance, formal Provider release, and production hardware support claims.

MB-3 does not block:

- Contract documentation and schema definition.
- HRT Logic Core skeleton.
- Provider repository initialization after package final approval.
- Provider Host skeleton.
- Contract client.
- Handshake.
- Health.
- Logging.
- Diagnostics skeleton.
- Simulator.
- Fake adapters.
- Process lifecycle.
- Installer skeleton.
- Hardware-independent tests.

MB-3 blocks:

- Claiming support for specific Xprinter model.
- Claiming support for specific scanner.
- Claiming support for specific USB customer display.
- Hard-coding unknown VID/PID.
- Hard-coding unknown COM port.
- Guessing customer display serial parameters.
- Guessing printer queue.
- Freezing unverified driver behavior.
- Finalizing real Printer Executor.
- Finalizing real Scanner Event Source.
- Finalizing real Customer Display Executor.
- Completing WS-2 real-device acceptance.
- Releasing formal Provider.
- Claiming Windows Hardware Runtime is production-ready.

## A. Test Machine Readiness

| Item | Status |
| --- | --- |
| Windows version | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Build number | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| CPU | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Architecture | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Administrator rights | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| USB ports available | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Network access | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Firewall policy | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Antivirus policy | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Allows reboot | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Allows driver install | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Allows unsigned dev build install | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Test machine owner | NOT VERIFIED — REQUIRES WINDOWS MACHINE / FOUNDER ASSIGNMENT |

## B. Printer Readiness

Known candidate: Xprinter XP-N160II. This must be verified on physical device label before PASS.

| Item | Status |
| --- | --- |
| Exact model | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| VID/PID | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Printer queue | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver version | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver installer | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Installer hash | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Redistribution license | NOT VERIFIED — REQUIRES WINDOWS MACHINE / LEGAL CONFIRMATION |
| Windows print test | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cut behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Offline behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| No paper behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cover open behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cash-drawer port | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Printer readiness owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |

## C. Scanner Readiness

| Item | Status |
| --- | --- |
| Exact model | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| VID/PID | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| HID type | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Enter suffix | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Keyboard layout | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Scan interval | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Continuous scan | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Reconnect behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver requirement | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Scanner readiness owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |

## D. Customer Display Readiness

| Item | Status |
| --- | --- |
| Exact model | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| VID/PID | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| COM port | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| USB serial chipset | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Baud rate | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Data bits | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Stop bits | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Parity | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Encoding | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Command set | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Display width | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Currency behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Decimal behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Clear command | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Reconnect behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Port drift | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Customer display readiness owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |

## E. Release Readiness

| Item | Status |
| --- | --- |
| Signing certificate owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |
| Certificate storage | NOT VERIFIED — REQUIRES FOUNDER/OPS DECISION |
| CI signing | NOT VERIFIED — REQUIRES FOUNDER/OPS DECISION |
| Installer technology | Pending ADR-03 closure |
| Update channel | NOT VERIFIED — REQUIRES RELEASE DECISION |
| Release owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |
| Artifact owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |
| Rollback owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |
| Acceptance owner | NOT VERIFIED — REQUIRES FOUNDER ASSIGNMENT |

## 3. PASS / FAIL / BLOCKED Criteria

PASS:

- All A through E required facts are verified or explicitly waived by founder with recorded risk.
- Real-device owners are assigned.
- Driver and signing constraints are understood.
- No unknown device parameter is hard-coded.

FAIL:

- Required hardware is unavailable.
- Required driver cannot be installed.
- Device behavior contradicts Contract assumptions.
- Signing or installer path is rejected for Milestone B.

BLOCKED:

- Required facts remain unknown.
- Windows test machine is not available.
- Device owner or acceptance owner is not assigned.
- Device parameters remain NOT VERIFIED.

Current state: BLOCKED.

## 4. Real-Device Acceptance Entry Conditions

Printer:

- Windows print test passes.
- Provider test print passes.
- Offline, no paper, cover open, cut, and side-effect uncertainty are recorded.

Scanner:

- Device event source works.
- Sequence and timestamp are recorded.
- Continuous scan does not duplicate business consumption.

Customer Display:

- Amount display works.
- Clear works.
- Scope, Expiry, reconnect, and port drift behavior are recorded.

Release:

- Installer, signing, release manifest, checksum, rollback, clean-machine install, and uninstall are verified.
