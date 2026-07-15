# EP-MB2-02 Commit Scope Audit

## Intended Scope

Allowed scope:

- Desktop HRT Device Runtime modules;
- Device Runtime tests;
- Provider simulator fixture split;
- EP-MB2-02 implementation/evidence documentation;
- exact `tsconfig.json` exclusion for evidence source copy.

## Runtime Files

- `desktop/src/main/hrt/deviceAssignment.ts`
- `desktop/src/main/hrt/deviceCommandGate.ts`
- `desktop/src/main/hrt/deviceHealth.ts`
- `desktop/src/main/hrt/deviceIdentity.ts`
- `desktop/src/main/hrt/deviceOwnership.ts`
- `desktop/src/main/hrt/deviceRegistry.ts`
- `desktop/src/main/hrt/deviceRuntime.ts`
- `desktop/src/main/hrt/deviceSlot.ts`
- `desktop/src/main/hrt/hrtLogicCore.ts`
- `desktop/src/main/hrt/index.ts`

## Test and Vector Files

- `desktop/tests/device-runtime.test.ts`
- `desktop/tests/hrt-logic-core.test.ts`
- `desktop/tests/provider-runtime.test.ts`
- `packages/hrt-provider-simulator/fixtures/device-runtime-vectors.json`
- `packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json`

## Documentation and Evidence

- `docs/milestone-b/ES-MB2-EP02-IMPLEMENTATION-001 Device Runtime Implementation Record.md`
- `docs/milestone-b/ep02-review-evidence/`
- `tsconfig.json`

## Explicitly Excluded

No intended changes under:

- `app/`
- `app/api/`
- `lib/`
- `prisma/`
- `desktop/src/main/hardware/`
- Legacy browser/device paths
