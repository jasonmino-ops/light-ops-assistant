# ES-MB-DP-001 Milestone B Development Package V1.0 FINAL

> [!IMPORTANT] ECCP Printing Capability V1.1 Reference（2026-08-11）
> 本文批准范围、历史 Gate 与工程证据保持不变。涉及 Printer Contract、Printer Executor、Provider、Windows Queue、Driver、Port、Setup 或 Discovery 的内容，当前按 Runtime Consumer、Transport Adapter 或 Transport Infrastructure 解释；不得据本文把 Printing business semantics、Profile、Layout 或 Rendering 下放到 Runtime/Adapter。当前权威分类见 Canonical Vault `ECCP Printing Capability Baseline V1.1 FINAL FROZEN`；Repository 入口：`docs/governance/printing/PRINTING_CAPABILITY_V1_1_INDEX.md`。当前动作：**UPDATE REFERENCE ONLY**。

VERSION: V1.0
STATUS: APPROVED
FREEZE STATUS: FINAL FROZEN
APPROVAL AUTHORITY: Founder
FOUNDER APPROVAL DATE: 2026-07-14

## 1. Final Approval Summary

This document formally approves the Milestone B engineering scope, sequence, gates, and architecture decisions for E-Shop Store Operating System.

This approval does not authorize direct development on `main`. Formal engineering start, branch creation, Contract directory creation, and Windows Provider repository initialization require a separate Milestone B Engineering Start Authorization.

Pinned pre-approval repository HEAD:

`52b8f944c3f9ae33d2e10340a12e0d9ce280ab87`

Approved source package:

- `ES-MB-DP-001 Milestone B Development Package V1.0-RC2`
- `ES-MB-ADR-001 V1.0-RC2`
- `ES-MB-ADR-002 V1.0-RC2`
- `ES-MB-ADR-003 V1.0-RC2`
- `ES-MB-HW-READINESS-001 V1.0-RC2`

## 2. Approved Workstreams

The following Workstreams are approved:

- WS-1 — Desktop Runtime / HRT Logic Core
- WS-2 — Windows Provider
- WS-3 — Legacy Adapter & Cutover
- WS-4 — Packaging, Release & Operations

WS-4 remains an independent Workstream. Installation, signing, upgrade, rollback, version compatibility, diagnostics, release, and clean-machine acceptance are independent delivery responsibilities, not WS-2 miscellaneous work.

## 3. Approved Gates

| Gate | Name | Current status |
| --- | --- | --- |
| MB-0 | Package Approval | PASS |
| MB-1 | Contract Ready | NOT STARTED |
| MB-2 | Runtime Core Ready | NOT STARTED |
| MB-3 | Windows Hardware Ready | BLOCKED |
| MB-4 | Device Vertical Slice Accepted | NOT STARTED |
| MB-4P | Printer Vertical Slice Accepted | NOT STARTED |
| MB-4S | Scanner Vertical Slice Accepted | NOT STARTED |
| MB-4D | Customer Display Vertical Slice Accepted | NOT STARTED |
| MB-5 | Legacy Cutover Accepted | NOT STARTED |
| MB-6 | Packaging & Release Accepted | NOT STARTED |
| MB-7 | Final Freeze | NOT STARTED |

MB-3 remains BLOCKED. Development Package approval does not approve hardware readiness.

## 4. Approved ADR References

- ADR-01: Windows Named Pipe + Versioned JSON Schema Frames. Status: ACCEPTED / CLOSED / FINAL.
- ADR-02: Runtime-Initiated Authoritative Handshake. Status: ACCEPTED / CLOSED / FINAL.
- ADR-03: Independently Installed Windows User-Session Background Process for Milestone B RC1. Status: ACCEPTED FOR MILESTONE B RC1 / CLOSED / FINAL / RE-EVALUATION REQUIRED AFTER REAL-DEVICE ACCEPTANCE.

## 5. Contract SoT

Approved Contract SoT:

| Field | Value |
| --- | --- |
| Repository | `jasonmino-ops/light-ops-assistant` |
| Path | `packages/hrt-contract/` |

Principles:

- Main repository is the Milestone B initial Contract SoT.
- Contract is not a Desktop Runtime internal implementation detail.
- Runtime, Provider, Simulator, Contract Tests, and future Platform Providers consume the Contract.
- Windows Provider consumes a fixed version package, schema artifact, or formal release mechanism.
- Runtime and Provider must not reference each other's implementation.
- Provider repository must not copy Contract and evolve it independently.
- Contract changes must be traceable.
- Contract SoT must not migrate without a new ADR and founder approval.

This approval does not create `packages/hrt-contract/`.

## 6. Approved Development Sequence

1. Package Final Approval.
2. ADR-01 to ADR-03 Closure.
3. Contract SoT Establishment.
4. Contract Definition.
5. Contract Fixtures / Contract Tests.
6. HRT Logic Core Skeleton.
7. Provider Simulator.
8. Runtime-Simulator Integration.
9. Windows Provider Repository Initialization.
10. Provider Host Skeleton.
11. Runtime-Provider Handshake.
12. Printer Vertical Slice.
13. Scanner Vertical Slice.
14. Customer Display Vertical Slice.
15. Legacy Cutover.
16. Packaging / Signing / Release.
17. Windows Real-Device Acceptance.
18. Final Freeze.

Rules:

- Do not develop all three real device Executors in parallel.
- Printer vertical slice comes first.
- Each vertical slice must pass independently before moving to the next real device slice.
- MB-3 must pass before real Executor behavior is finalized.

## 7. Architecture Placement

```text
Store Applications
        |
        v
Desktop Runtime
        |
        v
HRT Logic Core
        |
        v
Provider Contract
        |
        v
Windows Provider
        |
        v
Windows / Hardware
```

Desktop Runtime is the authoritative local controller. Windows Provider is Provider Host + Executor only. Store Applications must not call Provider directly.

## 8. Legacy Cutover Controls

Printer:

- Browser print Legacy may remain as rollback path.
- Provider print enablement must not dual-send a command to Legacy and Provider.
- Command owner must be explicit.
- Print side-effect uncertainty must not cause automatic retry.
- UNKNOWN must not be rewritten.
- Rollback must not duplicate receipt printing.

Scanner:

- During double-listen, business consumption source must be exactly one.
- Source arbitration is mandatory.
- No duplicate product lookup.
- No duplicate cart insertion.
- No replay consumption.
- Scanner event must include source, device identity, sequence, and timestamp.

Customer Display:

- Web Serial remains grandfathered fallback only.
- Provider enablement must not double-write.
- Last-Snapshot-Wins, Scope, and Expiry are required.
- Expired snapshots must not replay.
- Provider reconnect must confirm current valid scope before restoring display.

## 9. Security and Trust

Milestone B must implement:

- Named Pipe ACL.
- Runtime identity.
- Provider identity.
- Instance identity.
- Contract version.
- Runtime-initiated handshake.
- Capability negotiation.
- Message validation.
- Maximum frame size.
- Command authorization.
- Replay protection.
- Malformed frame rejection.
- Log redaction.
- Secret storage.
- Diagnostics export controls.
- Rejection of Store Application direct Provider connection.
- Rejection of arbitrary local process Provider calls.

localhost is not automatically trusted.

## 10. Packaging, Release, and Operations

Milestone B must implement:

- Independently installed Provider.
- User-session background process for Milestone B RC1.
- One formal Provider instance per Windows user session.
- Crash restart backoff and maximum restart count.
- Installer-owned installation.
- Release-mechanism-owned update.
- Runtime/Provider compatibility matrix.
- No Provider self-upgrade.
- Signed installer.
- SmartScreen handling.
- Checksum.
- Release manifest.
- Rollback.
- Uninstall.
- Clean-machine acceptance.
- Logs and support bundle.
- Process model re-evaluation after real-device acceptance.

## 11. MB-3 Blocked Notice

MB-3 STATUS: BLOCKED.

Reasons:

- Windows test machine not verified.
- Three device parameter sets not verified.
- Driver, printer queue, COM, VID/PID not fully confirmed.
- Real-device acceptance owner not assigned.
- Signing and release owner not assigned.

Owner placeholders:

- Windows test machine owner: Founder / Project Owner — Pending Delegation. Must be assigned before MB-3.
- Three real-device acceptance owners: Founder / Project Owner — Pending Delegation. Must be assigned before MB-3.
- Signing owner: Founder / Project Owner — Pending Delegation. Must be assigned before MB-6.
- Release owner: Founder / Project Owner — Pending Delegation. Must be assigned before MB-6.

## 12. Development Authorization Boundary

This document authorizes:

- Formal approval and freeze of Milestone B documents.
- Closure of ADR-01 to ADR-03.
- Documentation commit and push.

This document does not authorize:

- Creating `packages/hrt-contract/`.
- Creating schemas.
- Creating Milestone B branches.
- Initializing Windows Provider repository.
- Writing HRT Logic Core.
- Writing Provider code.
- Modifying Legacy.
- Modifying CI.
- Modifying `package.json`.
- Modifying lockfiles.
- Modifying database schema or data.
- Starting device development.

## 13. Branch and Repository Direction

Principle-approved future Provider repository:

`jasonmino-ops/eshop-windows-hardware-provider`

Recommended visibility:

`private`

Principle-approved future branch names:

- `mb/ws1-hrt-logic-core`
- `mb/ws2-windows-provider`
- `mb/ws3-legacy-cutover`
- `mb/ws4-packaging-release`

This document does not initialize the repository or create branches.

## 14. Change Control

After this final approval:

- Any change to approved Workstreams, Gates, Contract SoT, ADR-01, ADR-02, or ADR-03 requires explicit founder approval.
- MB-3 status may change only through Windows Hardware Readiness evidence.
- Implementation work requires Milestone B Engineering Start Authorization.

## 15. Reopening Rule

Reopen this Development Package only if:

- A frozen upstream asset is superseded.
- Contract SoT must move.
- Windows Provider role or process boundary must change.
- A real-device finding invalidates the approved sequence or gates.
- Founder explicitly orders reopening.

Reopening must create a superseding document; this V1.0 remains a historical final baseline.
