# MB-3 Entry Contract

Future MB-3 real executor can implement `HrtCommandExecutorPort`.

## Input

The executor receives `HrtCommandDispatchRequest`:

- normalized command envelope
- legacy HRT command payload
- active provider session
- resolved registered device

## Output

The executor returns `HrtCommandExecutorResult`:

- `accepted`
- normalized result status
- effect boundary
- provider instance ID
- optional output
- structured failure with code/category/message

## Required Executor Behavior

- Return dispatch accepted/rejected without relying on string parsing.
- Return success, failure, timeout, and cancellation-compatible status values.
- Preserve `commandId` and `correlationId` through executor-side logging and response correlation.
- Use Provider Runtime identity from the request rather than self-selecting a provider.
- Use Device Runtime identity from the request rather than discovering devices in Command Runtime.
- Report timeouts as `EXECUTION_TIMEOUT`.

## Explicit Non-Decision

MB-2 does not choose Named Pipe, Local HTTP, gRPC, WebSocket, message broker, Windows Service RPC, or any other IPC.
