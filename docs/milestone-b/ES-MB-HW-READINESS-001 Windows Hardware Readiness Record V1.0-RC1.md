# ES-MB-HW-READINESS-001 Windows Hardware Readiness Record V1.0-RC1

Status: DRAFT FOR FOUNDER REVIEW / NOT APPROVED / NOT FROZEN

Purpose: define the Windows Hardware Readiness Gate for Milestone B without inventing machine or device facts.

## 1. Control

| Field | Value |
| --- | --- |
| Document ID | ES-MB-HW-READINESS-001 |
| Version | V1.0-RC1 |
| Status | DRAFT FOR FOUNDER REVIEW / NOT APPROVED / NOT FROZEN |
| Owner | WS-2 Owner / Verifier |
| Source | Gate C6, ES-MB-DP-001 RC1 |

## 2. Gate Rule

Before WS-2 may finalize real device Executors or claim Windows hardware support:

- Windows test machine must be identified.
- Printer, scanner, and customer display exact models must be identified.
- VID/PID and driver facts must be recorded where applicable.
- Printer queue and serial COM facts must be recorded.
- Permission and installation conditions must be recorded.
- Driver redistribution status must be known.
- Real-device acceptance owner must be assigned.

Until this gate is satisfied:

- Do not finalize real Executor behavior.
- Do not claim real-device support.
- Do not complete WS-2 acceptance.
- Do not release formal Provider.

## 3. Windows Test Machine

| Item | Status |
| --- | --- |
| Machine model | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| CPU architecture | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Windows edition | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Windows build | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Admin rights | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Dedicated test machine | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Can reboot | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Can install drivers | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Browser version | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Firewall policy | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Antivirus policy | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Self-hosted runner eligibility | NOT VERIFIED — REQUIRES WINDOWS MACHINE |

## 4. Xprinter 80mm USB Printer

Known facts:

- Candidate model: Xprinter XP-N160II.
- Connection: USB.
- Local ignored driver package exists in current workspace.
- Existing setup kit says real driver binary must not be committed to Git.

| Item | Status |
| --- | --- |
| Exact model | Xprinter XP-N160II — DOCUMENTED, must verify on device label |
| VID/PID | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Windows printer queue name | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver name | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver version | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver package path | Local ignored package observed; formal package path NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver package hash | Historical hash exists in SV-04A; must reverify before WS-2 |
| Paper-out observable | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Offline observable | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cover-open observable | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cut support | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cash drawer connector | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver redistribution license | NOT VERIFIED — REQUIRES WINDOWS MACHINE / LEGAL CONFIRMATION |
| Windows test page | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Provider test receipt | NOT VERIFIED — REQUIRES WINDOWS MACHINE |

## 5. USB Keyboard-Wedge Scanner

| Item | Status |
| --- | --- |
| Exact model | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| VID/PID | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| HID type | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Appends Enter suffix | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Configuration method | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Keyboard layout | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Continuous scan behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Requires driver | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Device-level identity available | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Duplicate prevention test | NOT VERIFIED — REQUIRES WINDOWS MACHINE |

## 6. USB Customer Display

Known Legacy facts:

- Current legacy Web Serial path has used COM3 / 2400 in historical validation.
- Milestone B must not assume that value without current Windows machine verification.

| Item | Status |
| --- | --- |
| Exact model | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| VID/PID | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| COM port | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver name | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver version | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver package | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| USB serial chip | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Baud rate | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Data bits | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Parity | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Stop bits | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Character encoding | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Command set | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Display digits | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Currency/decimal behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Clear command | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Unplug recovery | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| COM port drift | NOT VERIFIED — REQUIRES WINDOWS MACHINE |

## 7. Installer, Signing, and Permission Readiness

| Item | Status |
| --- | --- |
| Provider installer technology | Pending ADR-03 |
| Runtime installer status | Existing Electron NSIS CI, unsigned |
| Provider signing certificate | NOT VERIFIED — REQUIRES FOUNDER/OPS DECISION |
| CI signing secret storage | NOT VERIFIED — REQUIRES FOUNDER/OPS DECISION |
| SmartScreen mitigation | NOT VERIFIED — REQUIRES SIGNING DECISION |
| Clean-machine install target | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Upgrade test target | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Uninstall test target | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Rollback artifact storage | NOT VERIFIED — REQUIRES RELEASE DECISION |

## 8. Real-Device Acceptance Conditions

Printer:

- Windows test page prints.
- Provider test receipt prints.
- Sale receipt prints through Runtime -> HRT -> Provider.
- Paper-out/offline/cover-open behavior recorded as formal outcome/UNKNOWN/side-effect state.
- No dual-send with browser print.
- Rollback to browser print is demonstrated.

Scanner:

- Provider receives device event.
- Runtime consumes exactly one event per scan.
- Existing browser scanner path can be disabled or left listening without business double-consumption.
- Continuous scan test passes.
- Wrong layout or missing Enter behavior is recorded.

Customer Display:

- Provider writes amount snapshot.
- Last-Snapshot-Wins is demonstrated.
- Scope isolation is demonstrated.
- Expiry and stale replay prevention are demonstrated.
- Unplug/replug behavior is recorded.
- Rollback to Web Serial legacy is demonstrated if still retained.

## 9. Open Readiness Gaps

- Windows test machine not identified in this record.
- Exact scanner and customer display models not verified.
- Printer driver license not verified.
- Signing owner not assigned.
- Self-hosted runner not assigned.
- Real-device owner not assigned.

## 10. Gate Status

Current status: NOT READY FOR WS-2 REAL EXECUTOR FINALIZATION.

This does not block Development Package review. It blocks WS-2 real device Executor finalization, formal Provider release, and any claim of production hardware support.
