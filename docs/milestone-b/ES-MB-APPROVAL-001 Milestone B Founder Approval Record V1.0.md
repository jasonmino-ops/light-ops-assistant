# ES-MB-APPROVAL-001 Milestone B Founder Approval Record V1.0

STATUS: APPROVED / FINAL
APPROVAL DATE: 2026-07-14
APPROVER: Founder

## 1. Approved Objects

- ES-MB-DP-001 Milestone B Development Package V1.0.
- ES-MB-ADR-001 Windows Provider IPC Security Serialization V1.0.
- ES-MB-ADR-002 Provider Registration Handshake Compatibility V1.0.
- ES-MB-ADR-003 Provider Packaging Upgrade Supervision V1.0.
- ES-MB-HW-READINESS-001 Windows Hardware Readiness Record V1.0 as active control record.

## 2. Pinned Pre-Approval Repository HEAD

`52b8f944c3f9ae33d2e10340a12e0d9ce280ab87`

Title:

`docs: freeze milestone b architecture entry gate`

## 3. Development Package Approval

ES-MB-DP-001 is approved and final frozen.

Approved Workstreams:

- WS-1 — Desktop Runtime / HRT Logic Core
- WS-2 — Windows Provider
- WS-3 — Legacy Adapter & Cutover
- WS-4 — Packaging, Release & Operations

## 4. Gate Approval

Approved gates:

- MB-0 — Package Approval
- MB-1 — Contract Ready
- MB-2 — Runtime Core Ready
- MB-3 — Windows Hardware Ready
- MB-4 — Device Vertical Slice Accepted
- MB-4P — Printer Vertical Slice Accepted
- MB-4S — Scanner Vertical Slice Accepted
- MB-4D — Customer Display Vertical Slice Accepted
- MB-5 — Legacy Cutover Accepted
- MB-6 — Packaging & Release Accepted
- MB-7 — Final Freeze

Current gate states:

- MB-0: PASS
- MB-1: NOT STARTED
- MB-2: NOT STARTED
- MB-3: BLOCKED
- MB-4: NOT STARTED
- MB-5: NOT STARTED
- MB-6: NOT STARTED
- MB-7: NOT STARTED

## 5. ADR Closure

ADR-01:

- Decision: Windows Named Pipe + Versioned JSON Schema Frames.
- Status: ACCEPTED / CLOSED / FINAL.

ADR-02:

- Decision: Runtime-Initiated Authoritative Handshake.
- Status: ACCEPTED / CLOSED / FINAL.

ADR-03:

- Decision: Independently Installed Windows User-Session Background Process.
- Status: ACCEPTED FOR MILESTONE B RC1 / CLOSED / FINAL / RE-EVALUATION REQUIRED AFTER REAL-DEVICE ACCEPTANCE.

## 6. Contract SoT Approval

Approved Contract SoT:

- Repository: `jasonmino-ops/light-ops-assistant`
- Path: `packages/hrt-contract/`

This approval does not create the directory or any Contract code.

## 7. Hardware Readiness

MB-3 remains BLOCKED.

Development Package approval does not release MB-3. Windows test machine, device facts, driver facts, owners, signing, and release readiness must be closed through MB-3/MB-6 governance.

## 8. Provider Repository Direction

Principle-approved future repository:

`jasonmino-ops/eshop-windows-hardware-provider`

Recommended visibility:

`private`

This approval record does not initialize that repository.

## 9. Branch Strategy Direction

Principle-approved future branch names:

- `mb/ws1-hrt-logic-core`
- `mb/ws2-windows-provider`
- `mb/ws3-legacy-cutover`
- `mb/ws4-packaging-release`

This approval record does not create any branch.

## 10. Documentation Commit and Push Authorization

Founder authorizes this documentation approval/freeze commit and push.

## 11. Development Authorization Boundary

Business development remains NOT AUTHORIZED.

This approval does not authorize:

- Creating `packages/hrt-contract/`.
- Creating schemas.
- Creating Milestone B branches.
- Initializing Windows Provider repository.
- Writing HRT Logic Core.
- Writing Provider code.
- Modifying Legacy.
- Modifying CI.
- Modifying package or lock files.
- Modifying database.
- Starting device development.

## 12. Next Required Authorization

The next phase requires a separate Milestone B Engineering Start Authorization.
