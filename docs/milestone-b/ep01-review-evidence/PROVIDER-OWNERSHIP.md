# Provider Ownership Evidence

Ownership gates implemented:

- command result
- scanner event
- display snapshot / response
- health snapshot
- device registration generic subject

## Proof Points

- New instance replacement invalidates old instance ownership.
- Stale command result is rejected by `checkCommandResult` and tested by `replaces a restarted provider instance...`.
- Stale health is rejected by `refreshHealth()` and tested by `keeps provider health separate...`.
- Scanner/display/device registration gates are present as ownership subject checks, but full routers/assignment are deferred.
- Ownership invalidation emits `HRT_PROVIDER_OWNERSHIP_INVALIDATED`.
- Device Assignment Runtime is not implemented; ownership is provider-instance level only.
