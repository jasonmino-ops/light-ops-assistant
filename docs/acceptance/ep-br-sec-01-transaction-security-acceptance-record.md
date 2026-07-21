# EP-BR-SEC-01 Transaction Security Acceptance Record

## Decision

**PASS WITH NON-BLOCKING OBSERVATIONS — READY FOR ACCEPTANCE**

Founder / Gate Owner decision: **EP-BR-SEC-01: ACCEPTED — READY TO MERGE**.

Reviewed commit: `2cbb792e435157871b63ed22575bdebdf28f3211`.
Baseline / merge-base: `a469c9f5b95b1214bd0fe32f6e5a0eb56a31c5f2`.

## Accepted security boundary

The following four write endpoints no longer permit `storeCode` fallback:

- `POST /api/cashier/sales`
- `POST /api/cashier/member-balance-pay`
- `POST /api/cashier/offline-sync`
- `PATCH /api/cashier/orders/[id]`

In production, a public `storeCode` plus `x-lightops-client: desktop-pos`, without an account cookie and without `pos-device-v1`, cannot establish write authority. Valid account sessions and valid `pos-device-v1` continue to pass their regression paths.

KHQR requests with absent or false `manualPaymentConfirmed` return `409`; runtime evidence confirms no `SaleRecord`, no PAID `PaymentIntent`, and no member-balance or order side effect. The current schema has no inventory-quantity model, therefore no claim is made that an inventory-deduction risk was closed; that check is not applicable.

Shinhan UI and APIs remain frozen.

## Verification basis

Real route handlers, real Prisma, and an isolated, temporary local PostgreSQL instance passed the security runtime suite. `prisma db push` was used only to establish the current schema for this temporary test environment; it does **not** mean the migration chain is healthy.

The frozen runtime evidence and SHA-256 manifest are in `docs/reviews/ep-br-sec-01-fix-01-evidence/`.

## Non-blocking follow-up items

1. **EP-DB-MIGRATION-01 — Empty Database Bootstrap Repair**.
2. POS device token server-side revocation capability.
3. Closure of the three read-only `storeCode` fallbacks.
4. Shinhan callback signature verification.
5. One-time migration of existing POS devices and monitoring of 403 authorization failures.

None of these items is implemented by this acceptance record.
