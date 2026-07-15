# Architecture

## Module Structure

- `desktop/src/main/hrt/commandRuntimeTypes.ts`: Command contract, result, failure taxonomy, dispatch request, executor port.
- `desktop/src/main/hrt/commandLifecycle.ts`: command lifecycle state machine.
- `desktop/src/main/hrt/commandRuntime.ts`: validation, device resolution, provider eligibility, lifecycle coordination, dispatch normalization, idempotency.
- `desktop/src/main/hrt/fakeCommandExecutor.ts`: fake executor for test/contract verification only.
- `desktop/tests/command-runtime.test.ts`: Command Runtime coverage.

## Dependency Direction

`HrtCommandRuntime` depends on:

- `HrtDeviceRuntime` for device facts and command eligibility.
- `HrtProviderRegistry` for provider session and capability facts.
- `HrtCommandExecutorPort` as an abstract dispatch boundary.
- optional `HrtAuditEmitter` for structured result observability.

`HrtCommandRuntime` does not depend on:

- Windows APIs.
- USB/HID/Serial/COM.
- IPC protocols.
- concrete provider process implementations.
- database persistence.

## Runtime Flow

1. Caller creates or provides a `HrtRuntimeCommandEnvelope`.
2. Runtime moves lifecycle from `CREATED` to `VALIDATING`.
3. Runtime validates envelope, command type, payload, required capability, deadline, timeout, and idempotency.
4. Runtime resolves target through `HrtDeviceRuntime.evaluateCommand()` and device registry reads.
5. Runtime resolves provider through `HrtProviderRegistry.activeSession()`.
6. Runtime enters `ACCEPTED`, `DISPATCH_READY`, then calls `HrtCommandExecutorPort`.
7. Fake or future real executor returns structured execution result.
8. Runtime normalizes success, rejection, failure, timeout, or cancellation into `HrtRuntimeCommandResult`.

## Fake Executor Placement

`HrtFakeCommandExecutor` is in the HRT runtime module only to verify the dispatch contract. It is not a production provider, not a Windows provider, and not a hardware executor.
