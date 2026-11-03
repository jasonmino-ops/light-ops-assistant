# ES-DIAMOND-V3-PRINT-FROZEN-SUCCESSOR-01

## Scope and authority

This successor binds the print guards to the exact historical M4 and retail source bytes recorded below. It has no effect until the Founder-approved exact-path record is active in trusted main and the reviewed successor is integrated through the authorized workflow.

- Product Candidate: `37fda6f75d013f5957c20191c509fd588c6d4ed5`.
- Its exact parent and reviewed main baseline: `012b619a154f52cba96a9391936f02854de11fc9`.
- Historical G1 reference: `5a2c4dcb30debd75fa2c89a3e165b0ba634502b8`.
- Authorities: Founder-Gated Workflow V1 §§3.4, 5, 6.2, AGENTS.md §§8–10, ES-ENG-001 Founder Approval, and ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 Design Freeze V1.4 §§4, 6 (ESC-1), 7.

## Exact test changes

| Path | Successor change |
| --- | --- |
| `tests/v2-invariance-service-regions.test.cjs` | Reseal one type-only gap and five M4 function regions. All 16 region digests and line counts, all 16 gaps, header, tail, 17 ordered top-level functions and four enqueue predicates remain enforced. |
| `tests/v2-invariance-extension-points.test.cjs` | Reseal the exact relay auth digest and require the exact device-channel opt-in line in order. Keep the other two whole-file digests, all 27 historical predicates and producer non-dispatch assertions. |
| `tests/v3-reprint-recovery.test.ts` | Reseal exactly Cashier and Records. |
| `tests/es-tray-device-print-contract.test.ts` | Reseal the same Cashier digest in the second CORE guard. The original test fails on both the parent and Candidate. It represents the same retail drift and adds a fourth failing file. |

The original freeze documents, KTF registry, historical exceptions, runner, manifests, I-1 golden, product files and negative test cases remain intact. Each updated fingerprint is a single exact value. Any byte drift within a fingerprinted region or blob continues to fail. The enqueue extension and non-dispatch producer retain their existing predicate checks.

## Historical authorization and content

| Protected path | Approved content SHA-256 | First drift and provenance |
| --- | --- | --- |
| `lib/es-tray-relay/service.ts` | `271125bc69512d71d10a4c53e5e387d89cd4d9723aeb8583d7f5fc02444aaf17` | `eb35d587389d7a977a328876aced227ee849147a` added the type-only gap and four changed regions. `1660b36b13f3eb21419e1b9e4781b7f70b549d93` added the fifth region difference and supplied the exact current bytes. M4 reseal `7caa2a1bc0c7a1a430785ac7cde3d3bf2018a451`. |
| `lib/es-tray-relay/auth.ts` | `9659a161f4c1426c066bf6027bc288d1c77d0ce986ce94196f4f18b9d842a24d` | Exact current bytes from `fdb1981fa966437cb4c103907de3c10750722258`, M4 grant `f1e134190ef69473e7880ab02d6e5d5bc32f7fab`. Historical G1 expected `9080daf8b5c30e608829e859bbdaea85dc155e9d3e7a47cee364752728aabf5f`. |
| `app/cashier/page.tsx` | `f9bbafc2ef156d0ad49b31f3003a607a2a05ca69dd334f65c950082942a1b683` | Exact current bytes from `d8eef5e86526b7a8f25720d1b5fc5685e4ad5028`, merged at `18b36e7f0adea48cf36c9bd70b6de28e76c86b03`, sealed in `acc6d11e89cd6f511347fe698e1d17814770db4c`. |
| `app/records/page.tsx` | `ea5d384ef42d51668e4641a2f6be5e0dfd17f0a8c6f407f420bc9390b9ed664a` | Same retail source, merge and seal. |

`M4-DESKTOP-PRINT-CHILD-IDENTITY-26` is recorded in `docs/change-gates/exceptions/ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01.json`. It admits the provisioned child on the relay device channel and retains normal management/claim rejection and parent/store/tenant checks. The current service also rechecks parent/credential expiry under the authorization locks. `ES-RETAIL-MULTI-UNIT-01` is recorded in `docs/change-gates/exceptions/ES-RETAIL-MULTI-UNIT-01.json`. Its Cashier and Records changes cover sale-unit selection, price and presentation. These grants establish source provenance for all four exact blobs.

## Migration risk

**MIGRATION REPLAY FAIL.** An empty loopback PostgreSQL 18.3 database failed Prisma migration replay at `20260531000000_customer_order_campaign`, `P3018` / `42P01`, because `CustomerOrder` did not exist. Tests run against a separate database initialized from current Prisma schema provide runtime evidence. Migration-chain validation and release assessment remain separate work. This successor has no schema or migration change and provides no Production migration authorization.
