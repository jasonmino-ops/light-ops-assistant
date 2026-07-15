# EP-MB2-02 Build and CI Evidence

Date: 2026-07-15

## Local Verification

`npm --prefix packages/hrt-contract ci`

- Result: PASS

`npm --prefix packages/hrt-contract run build`

- Result: PASS

`npx tsx tests/hrt-contract.test.ts`

- Result: PASS
- Output: `hrt contract tests passed`

`npm --prefix packages/hrt-provider-simulator test`

- Result: PASS

`npm --prefix packages/hrt-provider-simulator run typecheck`

- Result: PASS

`npm --prefix desktop run typecheck`

- Result: PASS

`npm --prefix desktop test`

- Result: PASS
- Test files: 10 passed
- Tests: 92 passed

`npm --prefix desktop run compile`

- Result: PASS

`npm run build`

- Result: PASS
- Root build routes generated: 133 static pages

## Conformance Vectors

- Vector file: `packages/hrt-provider-simulator/fixtures/device-runtime-vectors.json`
- Vector count: 19
- Executed vectors: 19
- Result: PASS

## Windows CI

Workflow:

```text
.github/workflows/desktop-windows-build.yml
```

Run ID: PENDING_PUSH_VERIFICATION

Status: PENDING_PUSH_VERIFICATION

Required checks:

- Contract dependencies: PENDING
- Contract build: PENDING
- Desktop dependencies: PENDING
- Typecheck: PENDING
- Unit tests: PENDING
- Compile main & preload: PENDING
- Electron Builder: PENDING
- Artifact Upload: PENDING

## Vercel Preview

Status: PENDING_PUSH_VERIFICATION

Preview URL: PENDING_PUSH_VERIFICATION
