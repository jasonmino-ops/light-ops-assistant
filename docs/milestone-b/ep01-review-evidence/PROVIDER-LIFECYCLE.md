# Provider Lifecycle Evidence

## States

- `NEW`
- `CONNECTING`
- `REGISTERED`
- `HANDSHAKING`
- `READY`
- `DEGRADED`
- `DISCONNECTED`
- `REJECTED`
- `SHUTTING_DOWN`
- `STOPPED`

## Legal Transitions

| From | Allowed To |
| --- | --- |
| `NEW` | `CONNECTING`, `REGISTERED`, `REJECTED`, `STOPPED` |
| `CONNECTING` | `REGISTERED`, `DISCONNECTED`, `REJECTED`, `STOPPED` |
| `REGISTERED` | `HANDSHAKING`, `REJECTED`, `DISCONNECTED`, `STOPPED` |
| `HANDSHAKING` | `READY`, `REJECTED`, `DISCONNECTED`, `STOPPED` |
| `READY` | `DEGRADED`, `DISCONNECTED`, `SHUTTING_DOWN`, `STOPPED` |
| `DEGRADED` | `READY`, `DISCONNECTED`, `SHUTTING_DOWN`, `STOPPED` |
| `DISCONNECTED` | `CONNECTING`, `REGISTERED`, `REJECTED`, `STOPPED` |
| `REJECTED` | `CONNECTING`, `REGISTERED`, `STOPPED` |
| `SHUTTING_DOWN` | `STOPPED` |
| `STOPPED` | `CONNECTING` |

Legal transition count: `33`.

## Illegal Transitions

`HrtProviderLifecycle.transitionTo()` throws when the target state is the current state or is not in the allowed transition set. Runtime composition records `HRT_PROVIDER_ILLEGAL_TRANSITION` through `HrtRuntimeDiagnostics`.

## Transition Owner

Runtime owns all transitions through `HrtProviderLifecycle` as composed by `HrtLogicCore` and `HrtProviderRegistry`.

## READY Authorization Conditions

`READY` is reached after provider registration, contract version check, provider identity gate, compatibility evaluation, required capability check, and Runtime handshake acceptance.

## Direct Questions

1. Provider self READY path: No direct provider-owned path was found.
2. READY Runtime authorization: Yes, READY is authorized by Runtime registry/lifecycle flow.
3. Compatibility/capability failure READY possibility: No. Rejected incompatible registration is not assigned active ownership.
4. Illegal transition rejection: Yes, throws and emits diagnostics in Runtime composition.
5. Lifecycle and supervision mixed: No. Lifecycle and supervision are separate modules.

## Disconnect / Shutdown / STOPPED

- Disconnect invalidates ownership, moves lifecycle to `DISCONNECTED`, and triggers supervision backoff.
- Shutdown invalidates ownership and moves toward `STOPPED`.
- `STOPPED` is terminal except manual/new connect transition to `CONNECTING` is allowed by state table.
