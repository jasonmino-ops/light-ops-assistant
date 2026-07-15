# EP-MB2-02 Scope Boundary Audit

## Changed Files

- `desktop/src/main/hrt/deviceAssignment.ts`
- `desktop/src/main/hrt/deviceCommandGate.ts`
- `desktop/src/main/hrt/deviceHealth.ts`
- `desktop/src/main/hrt/deviceIdentity.ts`
- `desktop/src/main/hrt/deviceOwnership.ts`
- `desktop/src/main/hrt/deviceRegistry.ts`
- `desktop/src/main/hrt/deviceRuntime.ts`
- `desktop/src/main/hrt/deviceSlot.ts`
- `desktop/src/main/hrt/hrtLogicCore.ts`
- `desktop/src/main/hrt/index.ts`
- `desktop/tests/device-runtime.test.ts`
- `desktop/tests/hrt-logic-core.test.ts`
- `desktop/tests/provider-runtime.test.ts`
- `packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json`
- `docs/milestone-b/ES-MB2-EP02-IMPLEMENTATION-001 Device Runtime Implementation Record.md`
- `docs/milestone-b/ep02-review-evidence/*`

## Forbidden Areas

No files were changed under:

- `app/cashier`
- `app/desktop/pos`
- `app/sale`
- `app/menu`
- `app/m/[storeCode]`
- `app/records`
- `app/products`
- `app/api`
- `lib`
- `prisma`

## Explicit Non-Implementation

No implementation was added for:

- Command Runtime
- Command Lifecycle
- Scanner Router
- Scanner Event Source
- Customer Display Snapshot Store
- Printer Executor
- Scanner Event Source
- Customer Display Executor
- Windows Provider
- Named Pipe
- Driver
- VID
- PID
- COM
- Printer Queue

## Cash Drawer Boundary

Cash drawer remains a printer attached action.

Eligibility is modeled as:

- command type: `OPEN_ATTACHED_CASH_DRAWER`
- required device kind: `PRINTER`
- required capability: `printer.cash_drawer_pulse`

No fourth device class was introduced.
