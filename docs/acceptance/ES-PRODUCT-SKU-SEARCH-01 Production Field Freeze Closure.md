# ES-PRODUCT-SKU-SEARCH-01 Production Field, Final Freeze and Closure Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline
- E-Shop Founder-Gated Agent Development Workflow V1.0

## 1. Closure status

| Gate | Status | Bound identity |
| --- | --- | --- |
| FIELD VERIFIED | **YES** | Founder-confirmed real-device Production acceptance for the SKU search path |
| FINAL FROZEN | **YES** | Production runtime SHA `23bd6bc55142bfb523f5b9beea53f35e306a4740` |
| CLOSED | **YES** | Runtime change is in `origin/main` and in READY Production; this record is documentation-only |

This closure is bounded to the Product SKU Search change. It does not reopen or alter the historical E-RA product-import task, and it does not claim that code deployment itself modified merchant data.

## 2. Product and acceptance identity

- Task: `ES-PRODUCT-SKU-SEARCH`
- Store under acceptance: E-RA Store, `ST7D04EB66`
- Acceptance input: `ERA1015`
- Expected selected Product ID: `cmul5rohm007k04le4e83fwxr`
- Acceptance result: Founder confirmed the real-device Production acceptance passed on 2026-09-30.
- Required semantic boundary: SKU search is independent from barcode search; tenant isolation and `ACTIVE` eligibility remain enforced.

The FIELD result is recorded from the Founder’s explicit real-device Production confirmation. No additional device identity, screenshot, session token, or personal data is inferred or reproduced here.

## 3. Production and release lineage

- Production SHA: `23bd6bc55142bfb523f5b9beea53f35e306a4740`
- Production state: `READY`
- Production deployment URL: `https://light-ops-assistant-35t75k5kc-sunxiaojian0910-2556s-projects.vercel.app`
- Release ref: `origin/release` at `23bd6bc55142bfb523f5b9beea53f35e306a4740`
- Trusted main at closure preparation: `origin/main` `11406c5a1469d9ca069dd098d70b990068ef1391`
- Normal release candidate parents: Production base `38b649fec76d0b55accd1fc1582ca043fff8aba8` and approved main `11406c5a1469d9ca069dd098d70b990068ef1391`

Release evidence:

- `scripts/check-selective-release.sh --mode normal`: PASS
- Candidate tree equality with approved main: PASS
- `scripts/check-release-lineage.sh 23bd6bc55142bfb523f5b9beea53f35e306a4740`: CONTENT_SUBSET provenance PASS because the normal release merge is not an ancestor of `origin/main`; the normal-release validator separately proves exact tree equality.
- Production commit and READY state were re-read after release and matched the candidate exactly.

## 4. Review and regression evidence

- Independent review of the Cashier freeze evidence repair: PASS; only the two authorized test assertions changed, and no Cashier product bytes changed.
- `tests/product-sku-search.test.ts`: PASS, including SKU, name, barcode, tenant/status, and product-position coverage.
- `tests/es-tray-device-print-contract.test.ts`: PASS, 35/35 cases.
- `tests/v3-reprint-recovery.test.ts`: PASS, 22/22 cases.
- `tests/cashier-realtime-integration.test.ts`: PASS.
- TypeScript check: PASS.
- Production build: PASS.
- CORE: 88/89 passed; one pre-registered KTF remains, `new=0`, overall status PASS.

The CORE KTF is retained as known governance evidence and is not silently reclassified or hidden by this closure.

## 5. Frozen scope and data boundary

Reviewed feature scope frozen by this record:

- `app/sale/page.tsx`
- `app/products/page.tsx`
- `lib/product-search.ts`
- `tests/product-sku-search.test.ts`
- `scripts/test/manifests/root-core-tests.json`

The Production release also contains the separately authorized Cashier freeze-evidence assertion refresh and the already-closed SKU search scope record. No further runtime change is authorized by this record.

Data and infrastructure boundary:

- No E-RA Product row was modified.
- No import, re-import, backfill, migration, or barcode overwrite was performed.
- The previously verified 229 E-RA SKU values remain unchanged.
- No GitHub protection rule, deployment setting, secret, or production database state was changed.

## 6. Closure disposition

The SKU search runtime change is accepted, frozen, and closed at the exact Production SHA above. Future changes to SKU search, barcode semantics, tenant scope, or the E-RA product-import flow require a new scoped Founder authorization and a new review/release lineage.

This record itself is documentation-only. It does not trigger another deployment and does not authorize any merchant-data operation.
