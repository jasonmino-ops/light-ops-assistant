# ES-DESKTOP-CANONICAL-PRINT-WIRING-01 Final Root-Integration Evidence

## Identity and environment

- Candidate: `a5e1ec4e9c19f85fae4db58745f50d665c831e56`
- Pre-Option-D baseline: `f5cec5c8cb7acc96d199493d9336438dd4ca2327`
- Candidate product bytes: unchanged from sealed Candidate `dd7121b554b41bbddecaa7f0fd6cf3cb3acfa5ff`
- PostgreSQL: isolated local `127.0.0.1:65432/light_ops_test`; no Production connection and no migration applied
- Candidate production-server condition: local built server on `127.0.0.1:3100`
- Baseline production-server condition: local built server on `127.0.0.1:3101`
- Production and RC10 were not touched.

The Candidate root-integration lane was run with the repository-required local database flags, local test secrets, and runtime URLs. Secret values are intentionally omitted from this record.

## Candidate root-integration result

Evidence:

- Summary: `test-results/test-evidence/root-lanes/20260919T162649Z-a5e1ec4e9c19/integration/summary.json`
- Summary SHA-256: `1ba5cd2dc18e3ff80136de05d2af3f3dd8faf8426f7fec5a077fbb1b21e9cbc6`
- Raw log: `test-results/test-evidence/root-lanes/20260919T162649Z-a5e1ec4e9c19/integration/root-integration-suite.log`
- Raw log SHA-256: `c0f609fc470b4d43ecc878e465303bdbf7beae6eec0f2f6e4881409b47aca0a3`

Result: 11/14 passed; one registered KTF; two non-pass cases not present in the active baseline.

### Non-pass case 1

- File: `tests/dashboard-print-settings-mobile.test.ts`
- Case: `main` flow waiting for `getByRole('button', { name: /门店配置/ })`
- Candidate output: `locator.waitFor: Timeout 20000ms exceeded`
- Baseline output under the same production-server condition: identical timeout and locator
- Classification: **B — baseline-equivalent harness/environment debt**
- Candidate-caused regression: NO

### Non-pass case 2

- File: `tests/desktop-pos-web-auth-compat.test.ts`
- Case: `waitForCashier` waiting for `getByRole('button', { name: '销售记录' }).first()`
- Candidate output: `locator.waitFor: Timeout 30000ms exceeded`
- Baseline output under the same production-server condition: identical timeout, helper, and locator
- Classification: **B — baseline-equivalent harness/environment debt**
- Candidate-caused regression: NO

### Non-pass case 3

- File: `tests/desktop-pos-write-fallback-runtime.test.ts`
- Case: `testAuthorizedRegressionPaths` / `authorized order status update must remain available`
- Candidate output: `Error: after was called outside a request scope` (`next-dynamic-api-wrong-context`), from `app/api/cashier/orders/[id]/route.ts:65`
- Baseline output under the same isolated database condition: the same `next-dynamic-api-wrong-context` error at the same route/test path
- Classification: **C — existing registered KTF-20260912-03**
- Candidate-caused regression: NO

No case was classified A or D.

## KTF scheduled reviews

### KTF-20260912-03

- Candidate reproducible: YES
- Baseline-equivalent: YES
- Candidate-related: NO
- Status: OPEN / RETAIN
- Recalibration: the old “Cashier path untouched” containment premise is too broad because this Candidate legitimately changes `app/api/cashier/sales/route.ts`. The failure remains contained because the failing `PATCH` route `app/api/cashier/orders/[id]/route.ts` and the direct-call test harness are unchanged, and the exact failure reproduces on baseline. No product fix is authorized here.

### KTF-20260912-01

- Candidate reproducible: NO; `tests/browser-print-readiness.test.ts` passed all 18 cases
- Baseline reproducible: NO; the same 18 cases passed
- Candidate-related: NO
- Classification remains valid: NO for the current Candidate; the historical timing-flake evidence remains historical
- Status: CLOSE recommendation

### KTF-20260912-07

- Candidate reproducible: YES; `tests/subscription-expiry-reminder.test.ts` returned `EXPIRED` where the fixture expects `REMIND`
- Baseline reproducible: YES; identical assertion and output
- Candidate-related: NO
- Classification remains valid: YES; fixed-date fixture drift
- Status: OPEN / RETAIN

## Final disposition

- Candidate-caused new failures: NO
- Product bytes changed: NO
- Migration applied: NO
- Production change: NO
- FIELD: NO
- Non-blocking review observations F3–F7 remain deferred.
- A fresh-context Independent Review must consume this evidence before declaring final Candidate readiness.
