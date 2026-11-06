# ES-DIAMOND-V3-EXPIRE-TIMEOUT-RECOVERY-01 CORE Admission Disposition — proposed

Status: **SEALED DRAFT — NOT ACTIVE — NOT A WAIVER**. Founder approval of implementation is not approval of this frozen/core exception. No assertion/test/KTF/manifest/registry changes. This draft prepares an exact decision under ES-ENG-001 Founder Approval “Exception to a frozen baseline” and Workflow V1 §6.1–6.2. The earlier Ops UX disposition supplies a process precedent only, expressly excludes V3, and is not inherited.

Exact business scope: tenant `cmvulpn2e000006jvsqrt3y2n`; Store `ST883DC00C` / `cmvulpn8r000106jvpo58kye4`; Device `cmvyx1jes000208l14t5vf9ur`; original ACTIVE SUPER_ADMIN `cmnko00l2000004juew5h2djr`. Only jobs `cmw0jlsme000v08kzgyiybcqg`, `cmw0k7dgw001c08kz5xirfxzv`, `cmw0kwwta001v08jv6q6rl2f4`. Dedicated actions `FOUNDER_REVIEW_DIAMOND_TIMEOUT_COMPENSATION` and `FOUNDER_EXPIRE_DIAMOND_TIMEOUT_COMPENSATION`, on the existing authenticated POST only. No other case/role/store/device/job or mutable authorization input is admitted.

## Immutable test truth

CORE: **103 collected /103 executed /101 PASS /2 FAIL /0 SKIP /BLOCKED**, runner newFailures2 against its own historical KTF. Targeted real PostgreSQL/contract tests142 PASS/0 FAIL/0 SKIP, TypeScript/Build/Scope PASS; production-parent tree142 and Build PASS. Raw failures remain failures. No unexecuted domain/integration/FIELD work is labeled PASS.

1. tests/cashier-realtime-integration.test.ts — “Diamond trusted main may differ only by exact registrations and approved baseline fixes”. Trusted main baseline PASS, this candidate FAIL. Triggered by new recovery-service/test content entering the old exact Diamond boundary; a **candidate-specific admission failure**, not an inherited baseline waiver or proof of cashier execution correctness. The complete actual/expected rejected-path assertion and frozen source digest are bound below. Admit only this exact two-product-path candidate if separately approved; no general allowlist expansion or admission of any extra product paths.
2. tests/customer-order-recovery.test.ts — four assertions: three HTTP503 vs200 and retry backlog999 vs1; existing test fails to stub eshopTrayPrintJob.findUnique in unchanged lib/customer-order-fulfillment.ts:374. Same failures reproduced on clean c104 main in the same isolated synthetic connection environment. This attributes a baseline fixture failure; it does not waive Production database health or another failure producing the same HTTP status. Existing helper/route/test bytes remain unchanged; raw baseline logs and full current assertion section are preserved.

## Exact candidate and evidence

```json
{
  "candidateSha": "b558dcd197f166936610b5c7c140c0acb5f55a86",
  "productPathSha256": {
    "app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts": "7fbcf5ce177e482668f34fc3fe00cbc752c8dff0ba26c387f089b4111fd28113",
    "tests/v3-print-control-plane-service.test.ts": "7c4c8fc250ea1488fc8066da89839061c5d761b55060370052fdfa9d95e174e3"
  },
  "releaseSha": "1427131e94aba6a19c52dee61f531fec2c9213b3",
  "releaseTree": "178bfec6bb55616c7f0c02e16422f413c6149e0d",
  "productionParent": "9e717439569c0485c703367b668b31ed8a7505e6",
  "trustedMain": "c1041533abca99657edc09c2e69e2c18d9df13d5",
  "frozenTest": {
    "path": "tests/cashier-realtime-integration.test.ts",
    "sha256": "4a76962e28336391d30810d4476d2bad3b94eb09c0496a1649b13d0cd4757dc3",
    "modified": false
  },
  "coreManifestSha256": "be7b3d97d93f63ff6a09ee807621614a43f78b810a2ca0270050bd1e78d8d4a2",
  "rawCoreSummarySha256": "074b7101dec38b76ac985a0542d6a965b2ab4e831174e8c27b7e4d6b22ebd967",
  "rawCoreLogSha256": "39063cfdf5c3647a1a98b254997a6954eda67b5c3c97c932fa19e8e23050b8eb",
  "rawFailureSections": {
    "CORE-FAIL-cashier-realtime-integration.test.log": "9f65cb4bf40ff0b12ecb99605a95338b19b064b928f19c193e0b2c04c77eeb8f",
    "CORE-FAIL-customer-order-recovery.test.log": "6a699936b47e0776969ebefc022ac92ade2909ccccbb688401cc3682b5751347"
  },
  "deadlineExclusive": "2026-11-08T00:00:00.000Z"
}
```

## Proposed bounded effect — ONLY AFTER EXACT APPROVAL

If Founder approves these exact contents, accept ONLY the two enumerated, source/evidence-bound raw failures as a task-specific admission disposition for the exact code/parent/tree and finite window. Do not reclassify CORE as PASS, modify tests/assertions/KTF/manifest, skip tests or reuse a broad bypass. This is not a Scope Guard forbidden-path exception (actual product paths ALLOWED); it is a narrow frozen capability/CORE admission decision. A DRAFT never permits merging or release.

Any extra failed test or changed failure identity/assertion/rejected paths, extra product delta, code/ref/tree/hash drift, new relevant surface overlap outside the reviewed two-file scope, missing independent review/evidence, baseline repair or deadline expiry invalidates the limited decision. A later integration/merge SHA requires recorded byte equality of both product files and exact governance-only delta; no automatic SHA inheritance. New post-merge runs retain raw outcomes and must match the exact failure semantics/source bindings, not merely the number2. No other unsafe behavior or unknown execution is waived.

Requires exact independent L3 technical PASS and formal approval record. Separate main merge/selective-release/Production authorization, fresh candidate-bound required check and real recovery/FIELD requirements remain mandatory. The existing guarded release flow is not bypassed. No Production state writes or prints were used to obtain this evidence.


## FOUNDER APPROVAL — OPERATIVE LIMITED REGISTRATION (2026-11-06)

The preceding sealed draft is retained byte-for-byte as reviewed history. This additive section is the current operative approval record and supersedes only the preceding NOT ACTIVE/preparation-only statements. It does not change the reviewed safety contract, source content, deadline, raw test outcomes or invalidation rules. Founder decision: **APPROVE CONTROLLED MERGE, RELEASE AND RECOVERY**. The exact original text/contents were hash-verified before this append. This is a bounded ES-ENG-001 frozen-baseline exception/CORE disposition, not a general Scope Guard exception or a runtime grant supplied by a caller. Its trusted-main integration condition must be verified before release.

```json
{
  "status": "FOUNDER_APPROVED_LIMITED_SUCCESSOR_AND_CORE_ADMISSION",
  "authority": "ES-DIAMOND-V3-TIMEOUT-COMPENSATION-FINAL-20261106",
  "approvalRecordedAt": "2026-11-06T16:30:56.809Z",
  "founderDecision": "current Founder task instruction: APPROVE CONTROLLED MERGE, RELEASE AND RECOVERY",
  "reviewedBodySha256": "341d1284b727a664785826008931a0b70519e54586d0f8f8f5c3c3a0f4d4fa13",
  "reviewedBodyBytes": 5625,
  "candidateSha": "b558dcd197f166936610b5c7c140c0acb5f55a86",
  "productPathSha256": {
    "app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/service.ts": "7fbcf5ce177e482668f34fc3fe00cbc752c8dff0ba26c387f089b4111fd28113",
    "tests/v3-print-control-plane-service.test.ts": "7c4c8fc250ea1488fc8066da89839061c5d761b55060370052fdfa9d95e174e3"
  },
  "releaseSha": "1427131e94aba6a19c52dee61f531fec2c9213b3",
  "releaseTree": "178bfec6bb55616c7f0c02e16422f413c6149e0d",
  "productionParent": "9e717439569c0485c703367b668b31ed8a7505e6",
  "baseOriginMainSha": "c1041533abca99657edc09c2e69e2c18d9df13d5",
  "includedSourceCommits": [
    "ca7e04ec9d600e568d29258f1e0dc9879c96a72c",
    "b558dcd197f166936610b5c7c140c0acb5f55a86"
  ],
  "deadlineExclusive": "2026-11-08T00:00:00.000Z",
  "codeReviewRawSha256": "bb304d8cde14f1bcff40c5f34c80031e4fdf52d5920c3647276d765fbf79f792",
  "concreteDraftReviewRawSha256": "0295c90805e2468da0ecfa94eaf074210a7c25790e3d7e2d337baef988bfef5f",
  "rawCore": "103 executed /101 PASS /2 FAIL /0 SKIP /BLOCKED",
  "rawCoreSummarySha256": "074b7101dec38b76ac985a0542d6a965b2ab4e831174e8c27b7e4d6b22ebd967",
  "effectiveCondition": "exact registration committed and merged into trusted origin/main; product bytes equal approved candidate; no extra failure or code/ref/tree drift; deadline not expired",
  "permittedEffect": "only the exact frozen successor and the two enumerated raw CORE admission failures are accepted for the approved merge/release; never CORE PASS",
  "noFrozenAssertionKtfManifestRegistryChange": true,
  "integrationBinding": "a later merge SHA is permitted only with recorded source-commit ancestry, exact two product hashes, exact approved registration hashes and governance-only delta; release SHA/tree fixed unless newly validated under this same explicit task authorization",
  "liveRecovery": "only after all published Production and authenticated fresh evidence/fence/identity/job guards pass; no waiver of runtime guards or unknown execution"
}
```

No previous UX/installer disposition is inherited. No tests, assertions, KTF, manifest, registry, identity or state machine are changed by this registration. No new code-level review is claimed or required for unchanged approved product bytes. The present explicit Founder authorization covers the subsequent controlled merge/release/recovery only within these exact bindings and the original deadline; it never bypasses required checks or physical truth.
