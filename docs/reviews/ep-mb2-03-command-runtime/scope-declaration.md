# Scope Declaration

## In Scope Completed

- Command domain contract in `HrtRuntimeCommandEnvelope`.
- Structured command result and failure taxonomy.
- Command envelope, type, payload, target, device, provider, deadline, timeout, and idempotency validation.
- Target resolution through `HrtDeviceRuntime`.
- Provider eligibility through `HrtProviderRegistry.activeSession()`.
- Command lifecycle state machine with transition history and terminal-state protection.
- `HrtCommandRuntime` orchestration service.
- `HrtCommandExecutorPort` dispatch boundary.
- `HrtFakeCommandExecutor` for tests and contract verification only.
- Minimal in-memory command/idempotency store.
- Minimal audit-ready observability fields in command results.

## Out of Scope Preserved

- Windows Provider Repository.
- Real hardware executor.
- Printer, cash drawer, customer display, USB, HID, Serial, COM, driver, SDK, or Windows Spooler execution.
- Real IPC selection or implementation.
- Provider process management, supervision changes, watchdog, or crash recovery.
- Production queue, database command persistence, migrations, Redis, message broker, and dead-letter queue.
- POS, Telegram, customer H5, cashier, menu, records, or sales API integration.

## Deferred to MB-3

- Real executor implementation.
- Real Windows Provider Repository initialization.
- Real IPC and provider process boundary.
- Real hardware command execution and true device acceptance.

## Scope Exception

None. Existing Provider Runtime and Device Runtime public read/query boundaries were sufficient.
