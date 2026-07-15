# ES-MB2-EP02-IMPLEMENTATION-001 Device Runtime Implementation Record

Status: IMPLEMENTED FOR MB-2B REVIEW / REVIEW READY / NOT ACCEPTED / NOT MERGED / NOT FROZEN

Date: 2026-07-15

Package: EP-MB2-02 Device Runtime

## Governance Inheritance

This implementation follows the frozen Milestone B governance and engineering baseline:

- ES-CONST-001
- ES-STRAT-001
- ES-ENG-001
- ES-GOV-001

No Acceptance, Merge, or Freeze action is recorded here. This package waits for Claude Desktop Architecture Review.

## Formal Starting HEAD

Formal main HEAD:

```text
1a703947a37c8c63b44dbb0ceefdeca5af222ca0
```

Known base implementation commit:

```text
3ce3d295adc58e5d0a7219e2e007560541dd1fde
```

## Branch

```text
mb2/ep02-device-runtime
```

## Final Implementation HEAD

Final closure HEAD is recorded in the EP-MB2-02 final response after commit and push. This record belongs to that closure state.

## Scope

Implemented in Desktop Runtime:

- Physical Device Identity
- Device Registry
- Device Slot Reference
- Assignment Runtime
- Device Ownership
- Device Health view
- Device Command Eligibility
- Device Runtime Facade
- Simulator Device Runtime conformance vectors
- Executable Device Runtime vector tests

## Explicit Non-Scope

Not implemented:

- Command Runtime
- Command Lifecycle
- Scanner Router
- Customer Display Snapshot Store
- Printer Executor
- Scanner Event Source
- Customer Display Executor
- Windows Provider
- Named Pipe
- Driver
- VID / PID
- COM
- Printer Queue
- real hardware integration

No Legacy, Cashier, POS, business flow, database, Prisma, or migration code was changed.

## Module Structure

Runtime modules:

- `desktop/src/main/hrt/deviceIdentity.ts`
- `desktop/src/main/hrt/deviceSlot.ts`
- `desktop/src/main/hrt/deviceAssignment.ts`
- `desktop/src/main/hrt/deviceOwnership.ts`
- `desktop/src/main/hrt/deviceHealth.ts`
- `desktop/src/main/hrt/deviceCommandGate.ts`
- `desktop/src/main/hrt/deviceRuntime.ts`
- `desktop/src/main/hrt/deviceRegistry.ts`

Integration modules:

- `desktop/src/main/hrt/hrtLogicCore.ts`
- `desktop/src/main/hrt/index.ts`

Test/vector modules:

- `desktop/tests/device-runtime.test.ts`
- `desktop/tests/hrt-logic-core.test.ts`
- `desktop/tests/provider-runtime.test.ts`
- `packages/hrt-provider-simulator/fixtures/device-runtime-vectors.json`
- `packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json`

## Physical Device Identity

Physical identity is derived from provider id, provider instance id, device kind, and provider-local device id.

The Runtime rejects invalid physical identity where the device id is empty. It also rejects unsupported device kinds such as `SCALE`.

The implementation does not introduce VID, PID, COM, driver, or OS queue facts.

## Device Slot Reference

Cloud remains the sole source of truth for Device Slot Definition.

Device Runtime only accepts `HrtDeviceSlotReference` as a local runtime reference:

- slot id
- store id
- terminal id
- expected device kind
- required capabilities
- revision

Device Runtime does not redefine Cloud Slot.

## Assignment Runtime

Assignment Runtime supports:

- accepted assignment;
- unknown slot rejection;
- unknown device rejection;
- kind mismatch rejection;
- capability mismatch rejection;
- conflicting slot assignment rejection;
- conflicting device assignment rejection;
- stale provider assignment protection.

Assignments are runtime-only and are not persisted to the database.

## Device Registry

Device Registry tracks registered physical devices and lookup indexes.

It exposes separate dimensions:

- registration state;
- assignment state;
- ownership state;
- health state and health view.

## Device Ownership

Device Ownership is provider-instance-bound.

When a provider instance is invalidated, related devices are marked stale and stale inputs are rejected before command eligibility can proceed.

## State Separation

Registration, Assignment, Ownership, and Health remain separate dimensions.

No combined `DeviceState` was introduced.

## Device Health

Health is modeled as a separate view:

- current health;
- source provider instance id;
- last update timestamp;
- stale marker.

Provider health remains separate from device health.

## Command Eligibility Gate

Command Eligibility only determines whether a command is eligible.

It does not:

- dispatch;
- retry;
- queue;
- time out;
- execute;
- manage command lifecycle.

## Printer / Scanner / Customer Display

Printer:

- `PRINT_RECEIPT` requires `PRINTER` + `printer.receipt`.
- `OPEN_ATTACHED_CASH_DRAWER` requires `PRINTER` + `printer.cash_drawer_pulse`.

Scanner:

- modeled as an active-event-capable device;
- this package only validates source ownership and scope reference eligibility;
- no Scanner Router and no cart/business flow trigger is implemented.

Customer Display:

- this package validates assignment and target reference eligibility;
- no Snapshot Store and no display executor is implemented.

## Cash Drawer Attached Action

Cash drawer remains a printer attached action.

No fourth formal Device Runtime kind was added for cash drawer.

## Scale Isolation

Scale is not part of Milestone B Device Runtime.

`SCALE` is rejected by formal Device Runtime validation as unsupported.

## HMF Placeholder Treatment

`desktop/src/main/hardware/hardwareManager.ts` still contains Milestone A placeholders for `cash-drawer` and `scale`.

This package does not modify HMF placeholders and does not depend on them. They remain historical Milestone A placeholders, not formal Device Runtime kinds.

## Simulator Scenarios

Provider Runtime vectors remain in:

```text
packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json
```

Device Runtime vectors are split into:

```text
packages/hrt-provider-simulator/fixtures/device-runtime-vectors.json
```

## Device Runtime Conformance Vectors

Device Runtime vectors cover 19 scenarios:

1. physical identity valid
2. physical identity invalid
3. slot reference valid
4. assignment accepted
5. assignment unknown slot
6. assignment unknown device
7. kind mismatch
8. capability mismatch
9. conflicting slot assignment
10. conflicting device assignment
11. stale provider ownership
12. unassigned command rejection
13. eligible printer command
14. scanner source ownership
15. scanner wrong scope
16. display target valid
17. display wrong scope
18. attached cash drawer action
19. unsupported scale

The vectors are executable through `desktop/tests/device-runtime.test.ts`; each vector reads input, calls Device Runtime methods, asserts expected decision/code, and checks expected state changes where applicable.

## Tests

Required local verification was executed:

- `npm --prefix packages/hrt-contract ci`
- `npm --prefix packages/hrt-contract run build`
- `npx tsx tests/hrt-contract.test.ts`
- `npm --prefix packages/hrt-provider-simulator test`
- `npm --prefix packages/hrt-provider-simulator run typecheck`
- `npm --prefix desktop run typecheck`
- `npm --prefix desktop test`
- `npm --prefix desktop run compile`
- `npm run build`

Final CI and Preview verification are recorded in the Evidence Pack after push.

## Known Risks

- This is still simulator/runtime-model validation only.
- No real Windows hardware path is validated in this package.
- Windows CI and Vercel Preview must be reviewed before Acceptance.
- Scanner source eligibility exists only as a source/target reference check, not as Scanner Event Source.

## MB-2B Suggested Status

Suggested status:

```text
IMPLEMENTED FOR MB-2B REVIEW
REVIEW READY
NOT ACCEPTED
NOT MERGED
NOT FROZEN
```

## MB-2 / MB-3 Status

MB-2 remains:

```text
IN PROGRESS
```

MB-3 remains:

```text
BLOCKED
```

## Process Deviation

An Obsidian development log was written although the original authorization did not permit Obsidian synchronization.

Vault path:

```text
/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/开发日志/2026-07-15 EP-MB2-02 Device Runtime Assignment Gate.md
```

No repository runtime or production impact was identified.

This closure does not delete, modify, or re-sync that Obsidian file.

## Acceptance Addendum

Date: 2026-07-15

Independent Review:

```text
PASS
```

Risk:

```text
LOW
```

Score:

```text
93/100
```

Accepted Implementation HEAD:

```text
08bd792deff3e6f83719cbad9a1da2ab81815a18
```

Evidence Pack:

```text
docs/milestone-b/EP-MB2-02-Device-Runtime-Review-Evidence-Pack-08bd792-final.zip
```

Evidence MD5:

```text
d449a81b97eb500cbdfbff1f6f153f3a
```

Evidence SHA-256:

```text
45df3e594c36c2bd8501e110bd5f7b3c3619831ee10a787eb1168d5896764980
```

Acceptance Record:

```text
docs/milestone-b/ES-MB2-ACCEPTANCE-002 Device Runtime Acceptance Record V1.0.md
```

Founder Approval Record:

```text
docs/milestone-b/ES-MB2-APPROVAL-002 Device Runtime Founder Approval Record V1.0.md
```

MB-2B:

```text
PASS
```

Merge:

```text
AUTHORIZED
```

MB-2:

```text
IN PROGRESS
```

MB-3:

```text
BLOCKED
```

Obsidian process deviation:

```text
ACKNOWLEDGED
```
