# Readiness Facts

## Repository Baseline

- Repository: `/Users/jason/light-ops-assistant`
- Start branch: `main`
- Start main HEAD: `070e6c3d9bfc7162e1fe6f25f621c92d5a69207b`
- Formal requested HEAD: `070e6c3d9bfc7162e1fe6f25f621c92d5a69207b`
- Match: yes
- Start worktree: not clean. Pre-existing untracked paths included `docs/.review-workspace/`, `docs/milestone-b/EP-MB2-01-Provider-Runtime-Review-Evidence-Pack-57e8d21.zip`, `docs/strategy-whitepaper-v1/`, `runtime/`, `tmp/`, and `zz-test-delete.txt`.

## Provider Runtime Facts

- Core model: `HrtProviderSession` in `desktop/src/main/hrt/providerSession.ts`.
- Provider ID: `providerId`, validated against `HRT_PROVIDER_COMPATIBILITY_MATRIX.providerId`.
- Provider state: `HrtProviderLifecycle` with registry session fields `connectionState`, `handshakeState`, `lifecycleState`, and `ownershipValid`.
- Provider capability: `supportedCapabilities` and `capabilityDescriptors` on provider registration/session.
- Registry/query entry: `HrtProviderRegistry.activeSession()`, `staleSessions()`, `rejectedSessions()`, `lastHandshake()`, `lastRejection()`.
- Lifecycle: `HrtProviderLifecycle`, driven by `HrtProviderRegistry.register()`, `disconnectActive()`, and `shutdownActive()`.
- Public interface consumed by Command Runtime: active provider session read model and capability list.
- Tests: `desktop/tests/provider-runtime.test.ts`.
- Error model: structured registration decisions plus thrown errors in `HrtLogicCore`.

## Device Runtime Facts

- Core model: `RegisteredHrtDevice` in `desktop/src/main/hrt/deviceRegistry.ts`.
- Device ID: provider-local `device.deviceId` plus runtime physical ID `physicalDeviceId`.
- Device type: `HrtDeviceKind`.
- Device capability: `HrtCapability[]`.
- Device state: registration, assignment, ownership, stale, and health state fields.
- Registry/query entry: `HrtDeviceRuntime.registry.get()`, `getByProviderLocalDeviceId()`, `listByCapability()`, and `evaluateCommand()`.
- Device-provider relation: `providerId` and `providerInstanceId` on `RegisteredHrtDevice`.
- Public interface consumed by Command Runtime: `evaluateCommand()` and registry read access.
- Tests: `desktop/tests/device-runtime.test.ts`.
- Error model: `HrtDeviceCommandGateResult` with explicit reject reasons.

## Engineering Facts

- Runtime project/module: `desktop/src/main/hrt`.
- Language/framework: TypeScript, Electron main process runtime.
- Test framework: Vitest in `desktop/tests`.
- Naming: `Hrt*` class/type prefix.
- Error handling: structured return objects at lower-level gates, thrown errors in legacy orchestration.
- Dependency injection: constructor-provided ports/services.
- Persistence: in-memory runtime state only.
- Architecture tests: desktop security/static tests and HRT provider/device runtime tests.
