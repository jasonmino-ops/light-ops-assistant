# Option D Candidate durable evidence — normalized Candidate run

- Task: `ES-DESKTOP-CANONICAL-PRINT-WIRING-01`
- Candidate SHA: `a5e1ec4e9c19f85fae4db58745f50d665c831e56`
- Pre-Option-D baseline SHA: `f5cec5c8cb7acc96d199493d9336438dd4ca2327`
- Date/time: `2026-09-19 Asia/Phnom_Penh`
- Environment: Node `v24.14.0`; isolated PostgreSQL `127.0.0.1:65432/light_ops_test`; Candidate production-server condition `http://127.0.0.1:3100`; secrets omitted.
- Command family: repository root integration command `npm run test:integration` with the repository-required local database flags, local test secrets, and Candidate runtime URLs. No Production connection and no migration.
- Original raw summary: `test-results/test-evidence/root-lanes/20260919T162649Z-a5e1ec4e9c19/integration/summary.json`; SHA-256 `1ba5cd2dc18e3ff80136de05d2af3f3dd8faf8426f7fec5a077fbb1b21e9cbc6`.
- Original raw log: `test-results/test-evidence/root-lanes/20260919T162649Z-a5e1ec4e9c19/integration/root-integration-suite.log`; SHA-256 `c0f609fc470b4d43ecc878e465303bdbf7beae6eec0f2f6e4881409b47aca0a3`.

Result: `11/14` passed; the registered KTF-20260912-03 remained present; two non-pass cases were baseline-equivalent.

## KTF-20260912-01 — historical flake, current run green

- File: `tests/browser-print-readiness.test.ts`
- Case: `unstable layout reaches the bounded timeout without printing`
- Candidate output/result: `PASS`, all `18/18` cases.
- Baseline output/result: `PASS`, all `18/18` cases.
- Classification: historical timing flake; current Candidate causation `NO`; retain OPEN because the source flake mechanism and durable historical logs are not resolved.
- Evidence artifact: this committed excerpt; hash is recorded in `manifest.sha256.json`.

## KTF-20260912-02 — current browser harness recurrence

- File: `tests/dashboard-print-settings-mobile.test.ts`
- Case: `main`, waiting for `getByRole('button', { name: /门店配置/ })`.
- Candidate output/result: `locator.waitFor: Timeout 20000ms exceeded`.
- Classification: environment/test-harness recurrence; Candidate causation `NO` after exact baseline comparison.
- Evidence artifact: this committed excerpt; original Candidate raw log hash is recorded in the manifest.

## KTF-20260912-03 — request-scope harness debt

- File: `tests/desktop-pos-write-fallback-runtime.test.ts`
- Case: `testAuthorizedRegressionPaths` / `authorized order status update must remain available`.
- Candidate output/result: `Error: after was called outside a request scope` / `next-dynamic-api-wrong-context`, from `app/api/cashier/orders/[id]/route.ts:65`.
- Classification: existing test-harness debt; Candidate causation `NO` after exact baseline comparison. Candidate changes `app/api/cashier/sales/route.ts`, so runtime checks remain required when Cashier route semantics change.
- Evidence artifact: this committed excerpt; original Candidate raw log hash is recorded in the manifest.

## KTF-20260912-07 — fixed-date fixture recurrence

- File: `tests/subscription-expiry-reminder.test.ts`
- Case: `testReminderApiIsolation`, OWNER `displayState` expected `REMIND`.
- Candidate output/result: assertion returned `EXPIRED` instead of `REMIND`.
- Classification: fixed-date test fixture drift; Candidate causation `NO` after exact baseline comparison.
- Evidence artifact: this committed excerpt; direct-run evidence hash is recorded in the manifest.

No case was classified as a Candidate runtime regression.
