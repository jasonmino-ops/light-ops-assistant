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

Run ID: 29410891681

Status: PASS

Required checks:

- Contract dependencies: PASS
- Contract build: PASS
- Desktop dependencies: PASS
- Typecheck: PASS
- Unit tests: PASS
- Compile main & preload: PASS
- Electron Builder: PASS
- Artifact Upload: PASS

## Vercel Preview

Status: READY

Preview URL: `https://light-ops-assistant-bzyp8s4r7-sunxiaojian0910-2556s-projects.vercel.app`

Preview commit:

```text
08bd792deff3e6f83719cbad9a1da2ab81815a18
```
