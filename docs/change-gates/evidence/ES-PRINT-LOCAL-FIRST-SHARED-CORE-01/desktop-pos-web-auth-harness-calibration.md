# Desktop POS Browser Auth Harness Calibration

- Task: `ES-PRINT-LOCAL-FIRST-SHARED-CORE-01`
- Calibration timestamp (UTC): `2026-09-23T16:39:26Z`
- Pre-correction HEAD: `96398d76a1752668b9f7561d421c64ad716dfe8a`
- Scope: test-only correction in `tests/desktop-pos-web-auth-compat.test.ts`
- Product source changed: `NO`
- Runtime: isolated local Next.js production server at `http://127.0.0.1:3100`
- Production access or mutation: `NO`
- Node.js: `v24.14.0`
- Playwright: `1.61.0`
- Chrome: `153.0.8010.53`

## Root cause and correction

The Browser offline-tolerance case reached the normal `/cashier` UI after the mocked network rejection, retained the cached POS token, and did not start device authorization. The harness then waited for `销售记录`, which belongs to the Desktop POS sidebar and is not a readiness condition for the normal Browser cashier.

The correction adds a Browser-specific readiness wait for the visible `完成销售` cashier control. The existing Playwright network rejection remains unchanged, and the case now also asserts that the access probe was attempted exactly once. The cached-token and no-authorization-start assertions remain unchanged.

## Focused stability result

Command shape:

```text
DESKTOP_POS_AUTH_RUNTIME_BASE_URL=http://127.0.0.1:3100 \
DESKTOP_POS_AUTH_CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome \
npx tsx tests/desktop-pos-web-auth-compat.test.ts
```

- Corrected preflight: `14/14 PASS`
- Consecutive calibration runs: `30/30 PASS`
- Cases executed across calibration: `420/420 PASS`
- Timeout recurrence: `0`
- New failure: `0`

This evidence calibrates only the deterministic Browser test harness. It does not claim a product behavior change or create a known-failure exception.
