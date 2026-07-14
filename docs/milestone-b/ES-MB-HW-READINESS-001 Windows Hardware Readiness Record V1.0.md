# ES-MB-HW-READINESS-001 Windows Hardware Readiness Record V1.0

DOCUMENT STATUS: ACTIVE CONTROL RECORD
GATE STATUS: BLOCKED

## 1. Governance Status

This record is now part of formal Milestone B governance. It is not a PASS record.

MB-3 STATUS: BLOCKED.

Reasons:

- Windows test machine not verified.
- Three device parameter sets not verified.
- Driver, queue, COM, and VID/PID not fully confirmed.
- Real-device acceptance owner not assigned.
- Signing owner and release owner not assigned.

Owner placeholders:

- Current owner: Founder / Project Owner — Pending Delegation.
- Windows test machine owner must be assigned before MB-3.
- Three hardware acceptance owners must be assigned before MB-3.
- Signing owner must be assigned before MB-6.
- Release owner must be assigned before MB-6.

## 2. MB-3 Rule

Before MB-3 passes:

- Do not finalize real Printer Executor.
- Do not finalize real Scanner Event Source.
- Do not finalize real Customer Display Executor.
- Do not claim support for specific hardware models.
- Do not claim Windows Hardware Runtime is production-ready.
- Do not release formal Provider.

MB-3 does not block Contract documentation, HRT skeleton, simulator, fake adapters, Provider Host skeleton, handshake, logging, diagnostics skeleton, process lifecycle, or installer skeleton.

## 3. Test Machine Readiness

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
| Test machine owner | Founder / Project Owner — Pending Delegation |

## 4. Printer Readiness

| Item | Status |
| --- | --- |
| Exact model | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| VID/PID | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Printer queue | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver version | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Driver installer | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Installer hash | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Redistribution license | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Windows print test | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cut behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Offline behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| No paper behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cover open behavior | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Cash-drawer port | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Printer readiness owner | Founder / Project Owner — Pending Delegation |

## 5. Scanner Readiness

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
| Scanner readiness owner | Founder / Project Owner — Pending Delegation |

## 6. Customer Display Readiness

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
| Customer display readiness owner | Founder / Project Owner — Pending Delegation |

## 7. Release Readiness

| Item | Status |
| --- | --- |
| Signing certificate owner | Founder / Project Owner — Pending Delegation |
| Certificate storage | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| CI signing | NOT VERIFIED — REQUIRES WINDOWS MACHINE |
| Installer technology | Governed by ADR-03 |
| Update channel | Founder / Project Owner — Pending Delegation |
| Release owner | Founder / Project Owner — Pending Delegation |
| Artifact owner | Founder / Project Owner — Pending Delegation |
| Rollback owner | Founder / Project Owner — Pending Delegation |
| Acceptance owner | Founder / Project Owner — Pending Delegation |

## 8. PASS / FAIL / BLOCKED Criteria

PASS requires verified machine, device, driver, release, and owner facts or explicit founder waiver with recorded risk.

FAIL applies when required hardware, driver, installer, or process model cannot satisfy Milestone B requirements.

BLOCKED applies while required facts or owners remain unknown.

Current state: BLOCKED.
