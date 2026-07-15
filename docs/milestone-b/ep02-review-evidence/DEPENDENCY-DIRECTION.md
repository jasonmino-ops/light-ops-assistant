# EP-MB2-02 Dependency Direction

## Direction

Device Runtime depends on:

- `@eshop/hrt-contract` for contract types;
- local HRT runtime support modules;
- `HrtRuntimeDiagnostics`.

Provider Runtime facade depends on Device Runtime only through `HrtLogicCore`.

## No Reverse Ownership

Device Runtime does not own Provider Runtime lifecycle.

Provider Runtime remains responsible for:

- provider registration;
- provider lifecycle;
- provider ownership;
- provider supervision;
- provider health.

## Circular Dependency Audit

No cyclic dependency was identified in the Device Runtime module graph.

The notable direction is:

```text
hrtLogicCore -> deviceRuntime -> deviceRegistry/deviceAssignment/deviceOwnership/deviceCommandGate
```

`deviceCommandGate` imports `RegisteredHrtDevice` as a shape from `deviceRegistry`; it does not instantiate or call Registry.

## Source Copy Boundary

Evidence source is excluded from root TypeScript checks through exact `tsconfig.json` entries:

```text
docs/milestone-b/ep02-review-evidence/source
docs/milestone-b/ep02-review-evidence/source/**
```
