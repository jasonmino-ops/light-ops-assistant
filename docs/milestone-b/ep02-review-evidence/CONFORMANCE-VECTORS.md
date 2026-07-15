# EP-MB2-02 Conformance Vectors

## Vector Files

Provider Runtime:

```text
packages/hrt-provider-simulator/fixtures/provider-runtime-vectors.json
```

Device Runtime:

```text
packages/hrt-provider-simulator/fixtures/device-runtime-vectors.json
```

## Device Runtime Vector Count

Total vectors: 19

Executed vectors: 19

Execution test:

```text
desktop/tests/device-runtime.test.ts
```

## Device Runtime Vector IDs

- `physical-identity-valid`
- `physical-identity-invalid`
- `slot-reference-valid`
- `assignment-accepted`
- `assignment-unknown-slot`
- `assignment-unknown-device`
- `kind-mismatch`
- `capability-mismatch`
- `conflicting-slot-assignment`
- `conflicting-device-assignment`
- `stale-provider-ownership`
- `unassigned-command-rejection`
- `eligible-printer-command`
- `scanner-source-ownership`
- `scanner-wrong-scope`
- `display-target-valid`
- `display-wrong-scope`
- `attached-cash-drawer-action`
- `unsupported-scale`

## Executability

Each vector includes:

- `id`
- `category`
- `input`
- `expectedDecision`
- `expectedCode`
- `expectedStateChange` where applicable

The test reads vector input and calls Device Runtime methods rather than checking only JSON shape or ordering.
