# Diamond USB readiness timeout exact CORE disposition

SEALED DRAFT. CORE 103 executed / 101 PASS / 2 FAIL / BLOCKED. The cashier historical allowlist rejects only the two approved product paths at line 283; three named governance paths may appear only at that same admission boundary. The baseline customer-order-recovery fixture returns 503 where line 152 expects 200. Original results are retained. The exact HKLM Desktop suite passed 423, failed 0 and skipped 1. Main Desktop suite passed 384, failed 2 and skipped 1; the two identical Foundation failures are reproduced on trusted main, outside these product paths. No test is modified to admit this candidate. Only exact results and SHA binding may be admitted after the required signature and trusted main integration.

```json
{
  "candidateCounts": {
    "expected": 103,
    "collected": 103,
    "executed": 103,
    "passed": 101,
    "failed": 2,
    "knownFailures": 0,
    "newFailures": 2,
    "recoveredFailures": 1,
    "knownEnvironmentBlocked": 0,
    "skipped": 0,
    "uncollected": 0,
    "environmentFailures": 0
  },
  "overallStatus": "BLOCKED",
  "summarySha256": "7a56257705125e1e70c7c4c703fcd2276fe4d190e773946fd8f6db05836d4731",
  "rawLogSha256": "6b5c662f242f7427b450d74407bd4ffbc2e90ea6c0209db0bfc9466c58a989b1",
  "testedSource": "0e8d4d0a50ef6a47718896aae09e472668044d2f",
  "trustedMain": "ca399bcdd0bd9fb8f1ce4304bd2d79c39154f82a",
  "candidateCashierPaths": [
    "desktop/src/main/printing/windowsUsbPrintBoundary.ts",
    "desktop/tests/windows-usb-front.test.ts"
  ],
  "postMergeExpected": "The same bounded failures or a subset, with no unexplained path, new failure, skipped CORE check or changed frozen test.",
  "unchangedTestSha256": {
    "tests/cashier-realtime-integration.test.ts": "4a76962e28336391d30810d4476d2bad3b94eb09c0496a1649b13d0cd4757dc3",
    "tests/customer-order-recovery.test.ts": "4cf808927f334f9480fb55e7baa41dcbf8c7451c3849d51bd4ce848ee3354142",
    "desktop/tests/release-foundation.test.ts": "e03f85ac27899971939606505d488f831d651d3da95a0885d3f0ddc0dcb3f366"
  },
  "desktopMainFailures": [
    "accepts only the exact authorized frozen-boundary successor bytes",
    "keeps desktop/package.json as the unique Desktop version source"
  ],
  "desktopMainFailureEvidenceSha256": "557883d05ec7ea40f9cfa420a233dc259be382106ba69c1e51c470643dfb2e04",
  "desktopMainBaselineEvidenceSha256": "c459440f55abc6ad70ffce249713fb2a54410818d3cba9ad9f951dc51d05442e",
  "desktopExactHklmEvidenceSha256": "39e68aaf6d355345528350d9392e32117248d5175066c6babd16beb9274daa37"
}
```


## Founder Approval — limited registration PR #39

The sealed draft above is retained verbatim. This append-only record registers the exact repository OWNER approval. It becomes operative after verified main integration.

```json
{
  "status": "FOUNDER_APPROVED_LIMITED_REGISTRATION_PENDING_MAIN_INTEGRATION",
  "authority": "Workflow V1 \u00a76.2 / ES-ENG-001 / Design Freeze V1.4 ESC-2",
  "acceptanceSha256": "adf540213b0ea8316188aaf637113e824d69c28e548a46d07ba66a1e14767a7f",
  "commentId": 6707022958,
  "author": "jasonmino-ops",
  "ownerId": 268623006,
  "commentUrl": "https://github.com/jasonmino-ops/light-ops-assistant/pull/39#issuecomment-6707022958",
  "signedAt": "2026-11-07T12:36:08Z",
  "commentSha256": "28ed4b0daf7ea84c2b563cc195ad8eb04faaa22a38b5fb38f5edb0ef3a7d866c",
  "sealedHead": "6d94d36d72b290641537b1c9f6bedb885d886312",
  "product": "0e8d4d0a50ef6a47718896aae09e472668044d2f",
  "installerSource": "ad4db0f476a574e7c60def0cca4fbfd624af181d",
  "installerSha256": "275c5d87ce1a4912b5b8b309834f98953219b369642a41ab8015a49ae715b994",
  "rollbackInstallerSha256": "4644f91e2aad10a26355487a0530d60d73518799d11b49125390f1235e7d0f54",
  "deadlineExclusive": "2026-11-08T00:00:00Z",
  "conditions": "Normal main integration and post-merge verification; original CORE BLOCKED retained; host and physical FIELD gates apply. Cloud release unchanged.",
  "reviewedPrefixSha256": "fa82f678c8d50664001205dc7f6d0144a352d3df1cec6fdf6c1bcdc1e61f62a1",
  "reviewedPrefixBytes": 2581
}
```
