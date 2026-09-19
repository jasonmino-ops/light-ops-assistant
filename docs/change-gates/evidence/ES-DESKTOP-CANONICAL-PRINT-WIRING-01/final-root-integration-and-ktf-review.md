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

- Durable normalized Candidate evidence: `candidate-root-integration-normalized.md`
- Durable Candidate-vs-baseline comparison: `baseline-comparison-normalized.md`
- Durable artifact manifest: `manifest.sha256.json`
- The original ignored run artifacts remain source references only; their hashes are recorded in the durable manifest.
- Original summary SHA-256: `1ba5cd2dc18e3ff80136de05d2af3f3dd8faf8426f7fec5a077fbb1b21e9cbc6`
- Original raw log SHA-256: `c0f609fc470b4d43ecc878e465303bdbf7beae6eec0f2f6e4881409b47aca0a3`

Result: 11/14 passed; one registered KTF; two non-pass cases were not present in the active KTF registry, and the exact pre-Option-D baseline rerun showed the same outputs for both.

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
- Recalibration: the old “Cashier path untouched” containment premise is invalid because this Candidate legitimately changes `app/api/cashier/sales/route.ts`. The failing direct-call Next.js request-scope harness remains baseline-equivalent; the Candidate route changes did not create the harness failure. Runtime behavior must continue to be checked whenever Cashier route semantics change. No product fix is authorized here.
- Review deadline: `2026-09-26`

### KTF-20260912-01

- Candidate reproducible: NO; `tests/browser-print-readiness.test.ts` passed all 18 cases
- Baseline reproducible: NO; the same 18 cases passed
- Candidate-related: NO
- Classification: historical timing flake; current Candidate causation NO, but the source flake mechanism remains unchanged
- Status: OPEN / flaky-test-harness quarantine; current green runs do not convert the historical flake into a permanent PASS
- Review deadline: `2026-09-26`

### KTF-20260912-02

- Candidate reproducible: YES; dashboard browser harness timed out waiting for `/门店配置/`
- Baseline-equivalent: YES; the same locator and 20-second timeout occurred under the baseline server condition
- Candidate-related: NO
- Current disposition: OPEN / recurrence observed; the historical `DEV_ROLE=OWNER` environment-only pass does not erase the current recurrence
- Review deadline: `2026-09-26`

### KTF-20260912-07

- Candidate reproducible: YES; `tests/subscription-expiry-reminder.test.ts` returned `EXPIRED` where the fixture expects `REMIND`
- Baseline reproducible: YES; identical assertion and output
- Candidate-related: NO
- Classification remains valid: YES; fixed-date fixture drift
- Status: OPEN / RETAIN
- Review deadline: `2026-09-26`

## Final disposition

- Candidate-caused new failures: NO
- Product bytes changed: NO
- Migration applied: NO
- Production change: NO
- FIELD: NO
- Non-blocking review observations F3–F7 remain deferred.
- KTF-20260912-02 is not silently retained as “已修”: recurrence is recorded as the current dashboard timeout shape, with Candidate causation NO and a dated review deadline.
- The focused docs/evidence review must verify the KTF dispositions and durable artifacts before declaring final Candidate readiness.
