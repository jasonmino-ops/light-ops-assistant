# Provider Health Separation Evidence

| Layer | Representation |
| --- | --- |
| Provider health | `HrtProviderHealthModel.lastSnapshot.providerHealth` |
| Device health | per-device `health` copied from provider health snapshot |
| Lifecycle state | `HrtProviderLifecycle.state()` |
| Supervision state | `HrtProviderSupervision.state()` |
| Runtime aggregate health | `HrtLogicCore.runtimeHealth()` |

## Findings

- Provider READY does not force device ONLINE. Tests use provider READY with device OFFLINE.
- Provider disconnect does not rewrite all devices to FAILED.
- Stale health is rejected when providerInstanceId does not match authoritative ownership.
- Health source instance is included in health view as `sourceProviderInstanceId`.
- Device health is not overwritten by Provider Runtime beyond accepting the snapshot source.
