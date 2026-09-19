# Option D durable evidence — exact pre-Option-D baseline comparison

- Task: `ES-DESKTOP-CANONICAL-PRINT-WIRING-01`
- Candidate SHA: `a5e1ec4e9c19f85fae4db58745f50d665c831e56`
- Baseline SHA: `f5cec5c8cb7acc96d199493d9336438dd4ca2327`
- Date/time: `2026-09-19 Asia/Phnom_Penh`
- Comparison rule: same test, same repository conditions, corresponding built local server or isolated database; no Candidate bytes were changed during comparison.

## KTF-20260912-01

- File/case: `tests/browser-print-readiness.test.ts` / `unstable layout reaches the bounded timeout without printing`.
- Candidate result: `PASS`, `18/18`.
- Baseline result: `PASS`, `18/18`.
- Classification: current run baseline-equivalent; historical flake remains OPEN because its source mechanism is unchanged.
- Candidate/baseline evidence: this committed normalized comparison excerpt; hash in `manifest.sha256.json`.
- Command: `npx tsx tests/browser-print-readiness.test.ts`.

## KTF-20260912-02

- File/case: `tests/dashboard-print-settings-mobile.test.ts` / `main`, waiting for `/门店配置/`.
- Candidate result: `locator.waitFor: Timeout 20000ms exceeded`, `getByRole('button', { name: /门店配置/ })`, Candidate server `http://127.0.0.1:3100`.
- Baseline result: identical `locator.waitFor: Timeout 20000ms exceeded`, same locator, baseline server `http://127.0.0.1:3101`.
- Classification: B — baseline-equivalent browser harness/environment debt; Candidate causation `NO`.
- Candidate raw evidence hash: `c0f609fc470b4d43ecc878e465303bdbf7beae6eec0f2f6e4881409b47aca0a3`.
- Baseline evidence artifact: this committed normalized comparison excerpt; hash in `manifest.sha256.json`.
- Command: `DASHBOARD_UI_BASE_URL=http://127.0.0.1:<candidate-or-baseline-port> npx tsx tests/dashboard-print-settings-mobile.test.ts`.

## KTF-20260912-03

- File/case: `tests/desktop-pos-write-fallback-runtime.test.ts` / `testAuthorizedRegressionPaths` / `authorized order status update must remain available`.
- Candidate result: `after was called outside a request scope` / `next-dynamic-api-wrong-context`, `app/api/cashier/orders/[id]/route.ts:65`.
- Baseline result: identical error, route location, and test path under the isolated database condition.
- Classification: C — existing Next.js request-scope harness debt; Candidate causation `NO`.
- Candidate raw evidence hash: `c0f609fc470b4d43ecc878e465303bdbf7beae6eec0f2f6e4881409b47aca0a3`.
- Baseline evidence artifact: this committed normalized comparison excerpt; hash in `manifest.sha256.json`.
- Command: `DATABASE_URL=postgresql://postgres@127.0.0.1:65432/light_ops_test?schema=public AUTH_SECRET=<redacted> CASHIER_SECURITY_TEST_DATABASE=1 npx tsx tests/desktop-pos-write-fallback-runtime.test.ts`.

## KTF-20260912-07

- File/case: `tests/subscription-expiry-reminder.test.ts` / `testReminderApiIsolation`.
- Candidate result: assertion `expected REMIND`, actual `EXPIRED`.
- Baseline result: identical assertion and output.
- Classification: fixed-date fixture drift; Candidate causation `NO`.
- Candidate/baseline evidence artifact: this committed normalized comparison excerpt; hash in `manifest.sha256.json`.
- Command: `npx tsx tests/subscription-expiry-reminder.test.ts`.

The comparison is durable as committed normalized evidence; temporary runner paths are not required for later review.
