# ES-DIAMOND-V3-EXPIRE-TIMEOUT-COMPENSATION-01 — proposed frozen successor

Status: **SEALED DRAFT — NOT ACTIVE**. No formal frozen exception, main merge, release, deployment or FIELD authorization is granted by this file. Founder authorized implementation/test/review, and preparation of this exact successor only. Formal exception requires a separate exact-content Founder Approval under ES-ENG-001 and Workflow V1 §6.1–6.2.

This additive successor records the reviewed EXPIRE10s/OR-CAS preservation and two dedicated exact-case compensation actions. It does not overwrite the historical Founder grant, old freeze records, roles, Owner/Lease/Fence, receipt/TTL, no-claim/no-UNKNOWN, audit atomicity, idempotency or ordinary independent two-OPS_ADMIN rules. New REVIEW is append-only, single-success-use, and requires fresh Windows evidence/current installation; no task writes or automatic FINALIZE/printing. Only the matching separately confirmed new EXPIRE may atomically terminalize the exact three jobs and audit. Exact replay only returns the recorded result. Unknown outcome requires read-only audit verification first.

Exact business scope: tenant `cmvulpn2e000006jvsqrt3y2n`; Store `ST883DC00C` / `cmvulpn8r000106jvpo58kye4`; Device `cmvyx1jes000208l14t5vf9ur`; original ACTIVE SUPER_ADMIN `cmnko00l2000004juew5h2djr`. Only jobs `cmw0jlsme000v08kzgyiybcqg`, `cmw0k7dgw001c08kz5xirfxzv`, `cmw0kwwta001v08jv6q6rl2f4`. Dedicated actions `FOUNDER_REVIEW_DIAMOND_TIMEOUT_COMPENSATION` and `FOUNDER_EXPIRE_DIAMOND_TIMEOUT_COMPENSATION`, on the existing authenticated POST only. No other case/role/store/device/job or mutable authorization input is admitted.

## Exact compiled policy (not client input)

```json
{
  "admissionId": "ES-DIAMOND-V3-EXPIRE-TIMEOUT-COMPENSATION-01",
  "tenantId": "cmvulpn2e000006jvsqrt3y2n",
  "founderId": "cmnko00l2000004juew5h2djr",
  "originalReviewId": "cmw53mwgf000108i4xv786pi5",
  "originalRequestId": "5937c41d-ccdb-487c-82bd-645d07f38d9f",
  "originalReviewedAt": "2026-11-06T14:58:00.428Z",
  "originalBindingSha256": "baf365e585371d3daa3a60c6e98abf0e395bed4f743fb234e727a0dce5dcefd6",
  "failedRequestId": "a890b5c7-ee21-4458-99cc-8abdc978fd80",
  "failureLogId": "85xn9-1793977117530-8f1feb2fca13",
  "failureLogSha256": "10e59f70b711a885a538f55332b4c12f964ff39d950c81a02de9737eb837c54f",
  "stateVersion": 696,
  "ownerEpoch": 1,
  "releasedAt": "2026-11-03T11:42:48.649Z",
  "releasedBatchId": "cmw0mbrad001h07l61ak5u0yy",
  "notBefore": "2026-11-06T15:02:50.681Z",
  "expiresAt": "2026-11-08T00:00:00.000Z"
}
```

Original binding uses a deterministic public semantic projection plus protected original/current installation HMAC equality; it does NOT claim to recompute the full predecessor JSONB payload SHA. Failure proof is source-pinned real request/log evidence, never a caller-provided failure flag or fabricated audit. Windows ledger/outbox truth remains authenticated Founder attestation with separately inspected trusted capture; no server-side proof of physical output is claimed. No Production HMAC/Installation Secret/credentials are present.

## Exact content and delivery bindings

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

All byte changes, source/ref/parent/tree/failure identity drift, new aggregate failures, missing raw evidence, later baseline repair or deadline expiry invalidate a future limited approval. No automatic regrant or deadline extension. Current authorization cannot be reused for another store/device/job/fence/Founder. All old successful REVIEW audits remain untouched and the old one-use rule continues to reject renewal.

The corresponding CORE disposition is a separate **unapproved draft**; no assertion, KTF, manifest, frozen test or registry was modified. A prior UX disposition is explicitly inapplicable to this V3 contract. Required independent L3 result and its exact JSON digest are recorded in the case evidence manifest after completion; a code PASS alone is not frozen or release approval.

Production is unchanged. Fresh main merge and actual selective validation/required App check, then exact Production and real recovery execution authorization, remain separate. Current local source commits are not yet in origin/main; no AUTHORIZED_SELECTIVE_RELEASE or FIELD/CLOSED claim. Policy expires at the exact bound above even if the code is deployed later.
