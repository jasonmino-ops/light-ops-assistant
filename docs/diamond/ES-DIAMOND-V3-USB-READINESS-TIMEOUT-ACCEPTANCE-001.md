# ES-DIAMOND-V3-USB-READINESS-TIMEOUT-01 exact Founder Acceptance

SEALED DRAFT. Scope is only Diamond, DESKTOP-N39GSA4 and the existing USB002 FRONT queue. Approval covers exact protected main merge, limited CORE/ESC-2 registration, installation of the complete internally built HKLM successor, and FIELD verification through the existing queue. Install only with idle cash register, verified graceful exit, backed up profile, intact ledger/outbox, confirmed rollback and exact SHA. Restore the existing USB revision and valid ownership only through the product. On qualified failure the only rollback is the exact previous full HKLM installer. No automatic replay of previously acknowledged, expired or unknown jobs. No repeat RAW ticket, configuration widening, cloud release, database change, or other store. Original and fresh result sets stay on record. Founder signs personally in the matching PR Conversation before cutoff.

```json
{
  "task": "ES-DIAMOND-V3-USB-READINESS-TIMEOUT-01",
  "status": "SEALED_DRAFT_NOT_ACTIVE",
  "trustedMain": "ca399bcdd0bd9fb8f1ce4304bd2d79c39154f82a",
  "cloudReleaseUnchanged": "4337c61d7ad0eab564e5591229d70074652869d8",
  "productTree": "62212ad5ab5d8df347d43922633a684c4efacb7f",
  "installerSourceTree": "286bd852d23577dd91622e35fc5426439871822d",
  "installedSource": "fb1826d709f528eb83a8e04e16b8e410c5054ec0",
  "storeCode": "ST883DC00C",
  "host": "DESKTOP-N39GSA4",
  "role": "FRONT",
  "queue": "E-Shop Diamond FRONT USB",
  "port": "USB002",
  "sourcePaths": {
    "desktop/src/main/printing/windowsUsbPrintBoundary.ts": "3ceac60d976808e61c8d684416010090dbc6abaab4dfd85aad3b52a2527c829d",
    "desktop/tests/windows-usb-front.test.ts": "1146587b6d2f55218f24c618c65fc01c4fbb27de0c5341b2ead94a4fa3dc3591"
  },
  "governancePaths": [
    "docs/freezes/ES-DIAMOND-V3-USB-READINESS-TIMEOUT-01.md",
    "docs/change-gates/ES-DIAMOND-V3-USB-READINESS-TIMEOUT-01 CORE Admission Disposition.md",
    "docs/diamond/ES-DIAMOND-V3-USB-READINESS-TIMEOUT-ACCEPTANCE-001.md"
  ],
  "installerVersion": "0.2.0-pilot.2",
  "proof": {
    "payloadFiles": 162,
    "outerChanges": [
      "E-Shop Desktop.exe",
      "resources/app.asar"
    ],
    "innerChanges": [
      "dist/main/printing/windowsUsbPrintBoundary.js"
    ],
    "installedBaselineAsarSha256": "c9f4e01742ab7d261d5541fdfd51c363babd8e254a2daaf799aa1b1af322734b",
    "candidateAsarSha256": "eb563543e39cb2cf837d803f045ffc5dd50278646bfc6de3c60b0254befbfe91",
    "installerSha256": "275c5d87ce1a4912b5b8b309834f98953219b369642a41ab8015a49ae715b994",
    "installerSource": "ad4db0f476a574e7c60def0cca4fbfd624af181d",
    "product": "0e8d4d0a50ef6a47718896aae09e472668044d2f",
    "rollbackInstallerSha256": "4644f91e2aad10a26355487a0530d60d73518799d11b49125390f1235e7d0f54",
    "actualNSISPayloadMatchesBuilt": true,
    "compiledJsChangeOnlyOneBudgetLiteral": true,
    "unchangedProviderFiles": 88,
    "embeddedUninstallerUnchanged": true,
    "publisher": "unsigned-internal first-party",
    "scope": "HKLM/allusers successor on existing Diamond installation"
  },
  "proofSha256": "f35551475be871fd9f3bdd184fead0f50c26bbe2a957ca7f8e5168cc58e1dc68",
  "claudeReviewSha256": "9016505339e174cf50e8464db371b17c53eea49a8c4d93165f0d7abf7167623f",
  "deadlineExclusive": "2026-11-08T00:00:00Z",
  "dispositionSha256": "fa82f678c8d50664001205dc7f6d0144a352d3df1cec6fdf6c1bcdc1e61f62a1",
  "freezeSha256": "3d5198c3506492a6eeb082d23ecd87a422b18dde6896942b9c74a1108382531b",
  "core": {
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
  "reviewedPrefixSha256": "adf540213b0ea8316188aaf637113e824d69c28e548a46d07ba66a1e14767a7f",
  "reviewedPrefixBytes": 5356
}
```
