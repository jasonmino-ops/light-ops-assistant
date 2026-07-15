# Dependency Direction Report

## Observed Import Relations

- `desktop/src/main/hrt/providerRegistry.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/providerRegistry.ts` imports `./providerLifecycle`
- `desktop/src/main/hrt/providerRegistry.ts` imports `./providerSession`
- `desktop/src/main/hrt/providerRegistry.ts` imports `./runtimeDiagnostics`
- `desktop/src/main/hrt/providerOwnership.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/providerOwnership.ts` imports `./runtimeDiagnostics`
- `desktop/src/main/hrt/healthEngine.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/healthEngine.ts` imports `./deviceRegistry`
- `desktop/src/main/hrt/healthEngine.ts` imports `./providerClient`
- `desktop/src/main/hrt/commandRouter.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/commandRouter.ts` imports `./auditEmitter`
- `desktop/src/main/hrt/commandRouter.ts` imports `./providerClient`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./auditEmitter`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./commandRouter`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./deviceRegistry`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./healthEngine`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./providerHealth`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./providerLifecycle`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./providerOwnership`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./providerRegistry`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./providerClient`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./providerSupervision`
- `desktop/src/main/hrt/hrtLogicCore.ts` imports `./runtimeDiagnostics`
- `desktop/src/main/hrt/deviceRegistry.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/providerSession.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/providerSession.ts` imports `./providerLifecycle`
- `desktop/src/main/hrt/providerHealth.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/runtimeDiagnostics.ts` imports `@eshop/hrt-contract`
- `desktop/src/main/hrt/runtimeDiagnostics.ts` imports `./providerLifecycle`
- `desktop/src/main/hrt/providerClient.ts` imports `@eshop/hrt-contract`
- `packages/hrt-contract/src/fixtures/frames.ts` imports `../types`
- `packages/hrt-contract/src/validators/frameValidator.ts` imports `../types`
- `packages/hrt-provider-simulator/src/index.ts` imports `@eshop/hrt-contract`
- `desktop/tests/cart-sync-service.test.ts` imports `vitest`
- `desktop/tests/cart-sync-service.test.ts` imports `../src/main/cartSyncService`
- `desktop/tests/cart-sync-service.test.ts` imports `../src/shared/cartSnapshot`
- `desktop/tests/cart-snapshot.test.ts` imports `vitest`
- `desktop/tests/cart-snapshot.test.ts` imports `../src/shared/cartSnapshot`
- `desktop/tests/ipc-whitelist.test.ts` imports `vitest`
- `desktop/tests/ipc-whitelist.test.ts` imports `../src/shared/ipcChannels`
- `desktop/tests/employee-fullscreen-ipc.test.ts` imports `vitest`
- `desktop/tests/employee-fullscreen-ipc.test.ts` imports `../src/shared/ipcChannels`
- `desktop/tests/employee-fullscreen-ipc.test.ts` imports `../src/main/ipcRouter`
- `desktop/tests/employee-fullscreen-ipc.test.ts` imports `electron`
- `desktop/tests/employee-fullscreen-ipc.test.ts` imports `../src/main/windowManager`
- `desktop/tests/provider-runtime.test.ts` imports `vitest`
- `desktop/tests/provider-runtime.test.ts` imports `@eshop/hrt-contract`
- `desktop/tests/provider-runtime.test.ts` imports `../src/main/hrt`
- `desktop/tests/provider-runtime.test.ts` imports `../src/main/hrt/providerClient`
- `desktop/tests/provider-runtime.test.ts` imports `../../packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json`
- `desktop/tests/config.test.ts` imports `vitest`
- `desktop/tests/config.test.ts` imports `../src/main/config`
- `desktop/tests/hrt-logic-core.test.ts` imports `vitest`
- `desktop/tests/hrt-logic-core.test.ts` imports `@eshop/hrt-contract`
- `desktop/tests/hrt-logic-core.test.ts` imports `../src/main/hrt`
- `desktop/tests/hrt-logic-core.test.ts` imports `../src/main/hrt/providerClient`
- `desktop/tests/static-security.test.ts` imports `vitest`
- `desktop/tests/static-security.test.ts` imports `node:fs`
- `desktop/tests/static-security.test.ts` imports `node:path`
- `desktop/tests/static-security.test.ts` imports `../src/shared/ipcChannels`
- `desktop/tests/recovery-backoff.test.ts` imports `vitest`
- `desktop/tests/recovery-backoff.test.ts` imports `../src/shared/backoff`
- `tests/hrt-contract.test.ts` imports `node:assert/strict`
- `tests/hrt-contract.test.ts` imports `@eshop/hrt-contract`
- `tests/hrt-contract.test.ts` imports `../packages/hrt-provider-simulator/src`

## Forbidden Direction Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Contract -> Desktop | PASS | Contract files import only local files/types. |
| Contract -> Simulator | PASS | No simulator import in `packages/hrt-contract/src`. |
| Simulator -> Desktop | PASS | Simulator imports `@eshop/hrt-contract`, no `desktop/` import. |
| Desktop -> Simulator | PASS | HRT runtime imports Contract only; simulator appears only in tests/vector path. |
| HRT -> Cashier | PASS | No cashier import in `desktop/src/main/hrt`. |
| HRT -> POS | PASS | No POS import in `desktop/src/main/hrt`. |
| HRT -> Web Serial | PASS | No Web Serial import in `desktop/src/main/hrt`. |
| HRT -> Cloud Print | PASS | No cloud print import in `desktop/src/main/hrt`. |
| HRT -> Database | PASS | No DB import in `desktop/src/main/hrt`. |
| HRT -> Prisma | PASS | No Prisma import in `desktop/src/main/hrt`. |
| HRT -> Electron renderer | PASS | No renderer import in `desktop/src/main/hrt`. |

Allowed directions observed:

- Desktop HRT -> Contract
- Simulator -> Contract
- Tests -> Desktop HRT / Simulator / Contract
