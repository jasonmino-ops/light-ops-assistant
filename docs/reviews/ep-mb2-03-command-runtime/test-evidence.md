# Test Evidence

## Commands Executed

- `npm run build` in `packages/hrt-contract`
- `npm run typecheck` in `desktop`
- `npx vitest run tests/command-runtime.test.ts` in `desktop`
- `npm test` in `desktop`
- `npm run compile` in `desktop`
- `npm run build` in repository root

## Results

- Command Runtime target tests: 7 passed, 0 failed.
- Desktop full regression: 11 test files passed, 99 tests passed, 0 failed.
- Provider Runtime regression: included in `desktop/tests/provider-runtime.test.ts`, passed.
- Device Runtime regression: included in `desktop/tests/device-runtime.test.ts`, passed.
- Desktop typecheck: passed.
- Desktop compile: passed.
- HRT contract build: passed.
- Root Next build: passed. Next performed production compile plus lint/type validity checks.

## Lint / Format

- No standalone lint or format script exists in root `package.json` or `desktop/package.json`.
- Root `npm run build` completed Next lint/type validity checks successfully.

## Notes

The local `@eshop/hrt-contract` package must have `dist/` built before desktop tests can resolve the package entry. This pack includes the executed build step.
