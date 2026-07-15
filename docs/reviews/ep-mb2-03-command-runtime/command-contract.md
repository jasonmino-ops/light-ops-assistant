# Command Contract

## Envelope

`HrtRuntimeCommandEnvelope` contains:

- `commandId`
- `commandType`
- `target`
- `requiredCapability`
- `payload`
- `metadata`
- `source`
- `correlationId`
- `createdAt`
- `deadlineAt`
- `timeoutMs`
- `idempotencyKey`

## Target

Target is an existing `HrtDeviceRef`. The runtime does not introduce Windows device names, USB paths, serial ports, vendor handles, or a second device registry.

## Capability

Capability is explicit and separate from target. The runtime validates that the required capability matches the command type and is supported by both Device Runtime and Provider Runtime facts.

## Payload

Payload is a JSON object boundary. Command Runtime does not define receipt templates, print payload business semantics, or hardware-specific payloads.

## Metadata

Metadata is optional and does not carry core routing semantics.

## Lifecycle

Lifecycle is managed only through `HrtRuntimeCommandLifecycle`, with terminal-state protection.

## Result

`HrtRuntimeCommandResult` includes status, failure code/category/message, timestamp, provider/device context, correlation ID, optional output, effect boundary, final lifecycle state, and transition history.

## Failure Taxonomy

Implemented failure codes:

- `INVALID_COMMAND`
- `INVALID_PAYLOAD`
- `TARGET_NOT_FOUND`
- `DEVICE_UNAVAILABLE`
- `CAPABILITY_UNSUPPORTED`
- `PROVIDER_NOT_FOUND`
- `PROVIDER_UNAVAILABLE`
- `DISPATCH_REJECTED`
- `EXECUTION_TIMEOUT`
- `EXECUTION_FAILED`
- `INVALID_STATE_TRANSITION`
- `INTERNAL_RUNTIME_ERROR`
- `COMMAND_CANCELLED`
