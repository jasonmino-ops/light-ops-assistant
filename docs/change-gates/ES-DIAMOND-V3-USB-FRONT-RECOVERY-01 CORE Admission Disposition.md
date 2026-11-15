# ES-DIAMOND-V3-USB-FRONT-RECOVERY-01 CORE Admission Disposition — SEALED DRAFT

Pending exact Founder approval and trusted-main registration. CORE recorded 103 executed / 101 PASS / 2 FAIL / BLOCKED. No test was removed, bypassed, or rewritten. No prior case approval transfers.

The candidate cashier test fails only at assertBoundary line 283. Its frozen allowlist rejects the exact nine product paths. The clean baseline passes this test. This is candidate-triggered admission failure, separate from a product regression. The customer-order fixture fails the same assertion on clean main. The candidate and baseline preserve their original output. Two Desktop Foundation policy assertions also fail unchanged on main and are absent on the exact installed HKLM projection, which recorded 421 PASS / 0 FAIL / 1 SKIP.

The proposed bounded disposition covers only the identified failure signatures and exact approved product paths, plus the four precise governance paths in this PR if admitted by the same historical boundary assertion. The allowed registration delta is append-only evidence of the genuine repository-owner signature. A fresh post-merge run must match only the stated failures and authorized scope; other failures block. The disposition is not CORE PASS. Proposed cutoff is 2026-11-08T00:00:00Z. No automatic extension.

```json
{
  "scope": {
    "taskId": "ES-DIAMOND-V3-USB-FRONT-RECOVERY-01",
    "status": "SEALED_DRAFT_NOT_ACTIVE",
    "deadlineExclusive": "2026-11-08T00:00:00Z",
    "product": "83ed568e9b76da9b07218457696d26ae03e7e4f6",
    "productTree": "0ebd4ec9ad1a1c3644d9e5f224f8765ae284bc6f",
    "installerSource": "fb1826d709f528eb83a8e04e16b8e410c5054ec0",
    "installerSourceTree": "cf8b88c33b1e96cda4b6e4617392946dadd67fc8",
    "installedParent": "d5deca5510132f98ea15eef9aca6d04aaae02e01",
    "trustedMain": "7c23816fdd17e4a04a08930ebe7e9b1782e498b8",
    "production": "4337c61d7ad0eab564e5591229d70074652869d8",
    "deltaSha256": "a3f2509e90501af9c64462cb1f3729f3a06fdc085f26906c9ea08a55e0779fd7",
    "productPaths": {
      "desktop/src/main/printing/endpointReadiness.ts": "53b35001d091849ff1508963005b52fe305f19b11358fc6746d84edd920fe02c",
      "desktop/src/main/printing/executionLedger.ts": "ee57fba08617f27a97c486581a195dfca2e7c7e66a4c36f779cbcaac977ca889",
      "desktop/src/main/printing/localEndpointAuthority.ts": "8ee0471d2a31b15326553f4c913a4e9640dc395b49122bdbfe81b89a6f1199a0",
      "desktop/src/main/printing/sharedPrintingCore.ts": "a81987d60c5989b5ea3d86180876bbcc62bff41380520847561a98e4bde24e39",
      "desktop/src/main/printing/v3PrintingRuntime.ts": "d16ae02e2b4724a6e926f9b150ffdee56bc3c8dcd31fa2d27901f8a0ab451ba4",
      "desktop/src/main/printing/windowsUsbEndpoint.ts": "16e135f34c51757f4acb1b9f3038f61e0dc024952444dc6de2bd79f8414d7c4b",
      "desktop/src/main/printing/windowsUsbPrintBoundary.ts": "d570ca3e6e314c7c649cd592e511637cdb794007c7b27bff79074a0ff50441d5",
      "desktop/src/main/printing/windowsUsbSpoolerScript.ts": "c6f6160d53758f9761b2256fc457c12afd151913cb47eb762a1450b3cc2e0a7a",
      "desktop/tests/windows-usb-front.test.ts": "4083787ce864170b66a94c40e063041f6ed2967e9c5ddcace2df8fa88d0784d5"
    },
    "governancePaths": [
      "docs/freezes/ES-DIAMOND-V3-USB-FRONT-RECOVERY-01.md",
      "docs/change-gates/ES-DIAMOND-V3-USB-FRONT-RECOVERY-01 CORE Admission Disposition.md",
      "docs/diamond/ES-DIAMOND-V3-USB-FRONT-ACCEPTANCE-001.md",
      "docs/diamond/es-diamond-v3-usb-front-recovery-01/FIELD-RELEASE-MANIFEST.json"
    ],
    "installerSha256": "4644f91e2aad10a26355487a0530d60d73518799d11b49125390f1235e7d0f54",
    "asarSha256": "c9f4e01742ab7d261d5541fdfd51c363babd8e254a2daaf799aa1b1af322734b",
    "version": "0.2.0-pilot.2",
    "installerScope": "HKLM/allusers",
    "rollbackInstallerSha256": "088e996ff7730fc292cfc9e812ae1769926cfbf5f527506398a540cc38f28ab7",
    "rawWorkerSha256": "4d8d683f2c4e28e116e20f9b23a21c7a61c1178cb053aa329a3abb43839a848c",
    "rawPaper": "PENDING_HUMAN_FIELD_CONFIRMATION",
    "rawSpoolerJobId": 3,
    "rawReceiptMarker": "FIELD 83ed568e - NO SALE",
    "rawEvidenceSha256": "45cefd7735f8312b7165cb5632de858c2e3a17468bee2084183331d343a6f87e",
    "claudeCodeResultSha256": "40f74aed55deff31fa6cd747f57efe74b19ca4fa1b69fbceb7b83d87f85a5d81",
    "installerEvidenceSha256": "d7db7f3c7814bfba0adbfe087b21f346aafd4b5a92d08acbe7473ad413377fb1",
    "store": "ST883DC00C",
    "device": "cmvyx1jes000208l14t5vf9ur",
    "host": "DESKTOP-N39GSA4",
    "queue": "E-Shop Diamond FRONT USB",
    "port": "USB002",
    "deviceInstanceSha256": "ff3bdd97d851ffe43a52f1f4758396a71e97b0a8c4a8d246e13785d668eef5cb"
  },
  "core": {
    "candidateCore": {
      "counts": {
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
      "summarySha256": "e4902cf35675ad58baa95f12efc9c665678a5b6ddd878007add523ed214299cc",
      "rawLogSha256": "5b73a227574c9c0bf67fc3d426c299970a57569566dc33dc56e3ab87157b50dd"
    },
    "baselineCore": {
      "counts": {
        "expected": 103,
        "collected": 103,
        "executed": 103,
        "passed": 102,
        "failed": 1,
        "knownFailures": 0,
        "newFailures": 1,
        "recoveredFailures": 1,
        "knownEnvironmentBlocked": 0,
        "skipped": 0,
        "uncollected": 0,
        "environmentFailures": 0
      },
      "overallStatus": "BLOCKED",
      "summarySha256": "a856200ca6aef07990a341dda6807c69c952daa3cb2ae8d406889888525c63fa",
      "rawLogSha256": "1b5f6135814bf42a7d807bb7e9a96dafc38a83bc32b8d856deeb0af495abfcbd"
    }
  },
  "attribution": [
    {
      "test": "tests/cashier-realtime-integration.test.ts",
      "kind": "EXACT_PATH_ADMISSION_FAIL",
      "assertion": "assertBoundary line 283 filters the candidate paths against the frozen allowlist",
      "candidateOnlyPaths": [
        "desktop/src/main/printing/endpointReadiness.ts",
        "desktop/src/main/printing/executionLedger.ts",
        "desktop/src/main/printing/localEndpointAuthority.ts",
        "desktop/src/main/printing/sharedPrintingCore.ts",
        "desktop/src/main/printing/v3PrintingRuntime.ts",
        "desktop/src/main/printing/windowsUsbEndpoint.ts",
        "desktop/src/main/printing/windowsUsbPrintBoundary.ts",
        "desktop/src/main/printing/windowsUsbSpoolerScript.ts",
        "desktop/tests/windows-usb-front.test.ts"
      ],
      "baseline": "PASS",
      "action": "Founder-approved, SHA-bound limited disposition before relying on this result. Preserve original failure."
    },
    {
      "test": "tests/customer-order-recovery.test.ts",
      "kind": "BASELINE_FAIL",
      "assertion": "line 152 expects 200, got 503",
      "baseline": "FAIL_SAME_ASSERTION",
      "action": "Use formal scoped baseline disposition. Preserve original failure."
    }
  ],
  "unchangedTestSha256": {
    "tests/cashier-realtime-integration.test.ts": "4a76962e28336391d30810d4476d2bad3b94eb09c0496a1649b13d0cd4757dc3",
    "tests/customer-order-recovery.test.ts": "4cf808927f334f9480fb55e7baa41dcbf8c7451c3849d51bd4ce848ee3354142",
    "desktop/tests/release-foundation.test.ts": "e03f85ac27899971939606505d488f831d651d3da95a0885d3f0ddc0dcb3f366"
  }
}
```


## Founder Approval — Limited Registration (PR #38)

The sealed draft above remains verbatim. The GitHub repository owner approved the exact Acceptance in a separate Conversation comment. The Founder separately confirmed the readable RAW test receipt on site. Formal admission depends on verified main integration and all remaining conditions.

```json
{
  "status": "FOUNDER_APPROVED_LIMITED_REGISTRATION_PENDING_MAIN_INTEGRATION",
  "authority": "Workflow V1 §6.2, ES-ENG-001, Design Freeze V1.4 ESC-2",
  "acceptanceSha256": "04ca17c121455bcbd47eb6914bb45c2b2960c539e94b05904b1a1acc07f3d700",
  "sealedGovernanceHead": "2448dac95590f1eee784eed58ee19ae358fee61e",
  "author": "jasonmino-ops",
  "authorId": 268623006,
  "association": "OWNER",
  "commentId": 6704559701,
  "commentUrl": "https://github.com/jasonmino-ops/light-ops-assistant/pull/38#issuecomment-6704559701",
  "commentCreatedAt": "2026-11-07T08:35:14Z",
  "commentSha256": "c4de78591636b20f93f03e9d02e5bc036fed043eb4b93091c0cee3ea14a30047",
  "deadlineExclusive": "2026-11-08T00:00:00Z",
  "rawPhysicalField": {
    "status": "PASS",
    "witness": "Founder physical FIELD confirmation in the task conversation",
    "jobId": 3,
    "port": "USB002",
    "readableLines": [
      "DIAMOND FRONT USB RAW TEST",
      "FIELD 83ed568e - NO SALE",
      "USB002 - TEST RECEIPT ONLY"
    ],
    "spoolerEvidenceSha256": "45cefd7735f8312b7165cb5632de858c2e3a17468bee2084183331d343a6f87e",
    "scope": "Synthetic standalone RAW receipt only"
  },
  "product": "83ed568e9b76da9b07218457696d26ae03e7e4f6",
  "installerSource": "fb1826d709f528eb83a8e04e16b8e410c5054ec0",
  "installerSha256": "4644f91e2aad10a26355487a0530d60d73518799d11b49125390f1235e7d0f54",
  "rollbackInstallerSha256": "088e996ff7730fc292cfc9e812ae1769926cfbf5f527506398a540cc38f28ab7",
  "core": "103 executed / 101 PASS / 2 FAIL / BLOCKED",
  "conditions": "Only the two precisely recorded failures and the approved paths. Effective upon verified protected main integration. Fresh matching post-merge CORE, host readiness and exact installer checks are required before installation. The cloud release ref is outside scope.",
  "reviewedPrefixSha256": "cd5b65f5e2eae1209897cc452ade7d679f8ba8928cb979777615490204920b8e",
  "reviewedPrefixBytes": 7486
}
```
