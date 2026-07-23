# EP-ID-POLICY-01 — Transaction Authorization Convergence Evidence Pack

Status: **IMPLEMENTED / READY FOR INDEPENDENT REVIEW** — not a Production approval, release approval, or FINAL freeze.

## Scope and baseline

| Item | Value |
| --- | --- |
| Repository | `light-ops-assistant` |
| Isolated worktree | `/private/tmp/light-ops-assistant-ep-id-policy-01` |
| Branch | `feat/ep-id-policy-01-transaction-auth-convergence` |
| Required baseline | `953d21d1c89a1386c35d91a9c0f34acf05320a64` |
| Baseline reference | `origin/feat/ep-br-pos-auth-01` |
| Implementation commit | `5df7b05082fa4fc922f9ceb7c1fae68681c51cae` |

This package changes transaction authorization only. It does not alter product-entry pages, Telegram login, `/relogin`, QR or authorization-link flows, historical bind routes, the Desktop activation flow, payment provider behaviour, or Browser/Desktop token formats as a shared credential.

## Implemented authorization model

`lib/transaction-authorization.ts` is the server-side entry point for the in-scope transaction operations. Its result is an explicit principal, never a synthetic account:

| Principal | Source | Granted only when |
| --- | --- | --- |
| `OWNER` / `STAFF` | `auth-session` | tenant and active store membership checks pass; existing route-level rules still apply |
| `BROWSER_POS_DEVICE` | `pos-device-v1` | signed token, matching header device ID, server `BrowserPosDevice` is ACTIVE, store matches, token hash matches, token is unexpired, and scope allows the operation |
| `DESKTOP_POS_DEVICE` | `edt_v1` | trusted Bearer credential is validated by existing Desktop activation logic; device, store, tenant, and subscription are active; Desktop has a valid activation owner |

The canonical authorization context carries actor type and ID, legacy operator ID, store, device type and ID, scopes, source, and authorization owner. Device activity now writes the actual actor to `SaleRecord`, `PaymentIntent`, `MemberBalanceLedger`, and `CustomerOrder`; legacy `operatorUserId` remains only for existing required foreign keys.

The policy does not inspect `storeCode`, `x-lightops-client`, URL origin, referer, user agent, renderer claims, or local storage as proof of authority. `storeCode` is resolved to the canonical Store only after it is used as request context.

## Transaction surface

All 13 identified money/order/member write routes call `authorizeTransaction`.

| Write route | Operation | Allowed principal class |
| --- | --- | --- |
| `POST /api/sales` | `SALE_WRITE` | personnel session only |
| `POST /api/orders/[orderNo]/checkout` | `ORDER_CHECKOUT` | personnel session only |
| `POST /api/orders/[orderNo]/cancel` | `ORDER_CANCEL` | personnel session only |
| `POST /api/payments/[paymentId]/confirm` | `PAYMENT_CONFIRM` | personnel session only |
| `POST /api/payments/[paymentId]/cancel` | `PAYMENT_CANCEL` | personnel session only |
| `PATCH /api/customer-orders/[id]` | `CUSTOMER_ORDER_UPDATE` | personnel session only |
| `POST /api/cashier/sales` | `POS_SALE_CREATE` | personnel, Browser POS, Desktop POS |
| `POST /api/cashier/member-balance-pay` | `POS_MEMBER_BALANCE_PAY` | personnel, Browser POS, Desktop POS |
| `POST /api/cashier/offline-sync` | `POS_OFFLINE_SYNC` | personnel, Browser POS, Desktop POS |
| `PATCH /api/cashier/orders/[id]` | `POS_ORDER_UPDATE` | personnel, Browser POS, Desktop POS |
| `POST /api/members/[id]/adjust` | `MEMBER_BALANCE_ADJUST` | personnel; existing OWNER rule remains |
| `POST /api/members/[id]/recharge` | `MEMBER_BALANCE_RECHARGE` | personnel; existing OWNER rule remains |
| `POST /api/members/import/confirm` | `MEMBER_IMPORT_CONFIRM` | personnel; existing OWNER rule remains |

The three prior Desktop/POS read fallbacks are also policy-bound: `GET /api/cashier/orders`, `GET /api/cashier/sale-records/[id]/receipt`, and `GET /api/records`. They use `POS_ORDERS_READ`, `POS_RECEIPT_READ`, and `POS_RECORDS_READ` respectively. They no longer manufacture an OWNER context or produce an authorization context reusable by a write route.

## Browser POS Device lifecycle

`BrowserPosDevice` is a server record keyed by a non-reversible HMAC token hash. It stores one active device slot per `(storeId, browserDeviceId)`, `ACTIVE` / `REVOKED` / `EXPIRED` status, issue/expiry/last-seen timestamps, scopes, issuer/revoker, and no raw credential.

`lib/browser-pos-device.ts` validates every Browser request against this record. Issue, verification, failure, legacy registration, and revocation create best-effort `OperationLog` records without raw token material. `POST /api/cashier/browser-devices/[id]/revoke` is OWNER-only and immediately blocks writes.

Compatibility is intentionally lazy: a valid pre-package `pos-device-v1` token is registered on its first valid use only if its original OWNER issuer remains active in the matching tenant/store. It then receives the normal scope set and `legacyMigratedAt`; invalid, expired, cross-store, or issuerless historical tokens are fail-closed. No mass rebind is required for valid pilot devices, while rebind remains the recovery path for invalid/revoked devices.

QR approval and direct OWNER issuance now create this server lifecycle record. A raw token is returned only to the originating browser response and is never stored in `OperationLog` or the new database model. EP-BR-POS-AUTH-01’s existing recovery UI still owns cart/checkout persistence, reauthorization, and manual confirmation; new Browser device errors enter the existing recovery handler.

## Desktop transaction identity

The Desktop renderer has a fixed `eshop:transaction:request` IPC. Its seven operation names are defined in `desktop/src/shared/transactionBridge.ts`; no URL, HTTP method, headers, or external target is accepted from the renderer.

`DesktopTransactionProxy` runs only in Electron main. It reads `edt_v1` from the existing safe-storage `CredentialStore`, maps each operation to one controlled API path and payload shape, applies body/response size and timeout limits, and returns a structured result. The renderer bridge does not expose a credential, Bearer header, generic fetch, or proxy API. Main validates employee role, main frame, and same-origin navigation before dispatch. Invalid/revoked/expired/subscription-blocked Desktop authorization invokes the existing activation verification/recovery path.

Browser requests continue to use Browser POS credentials; Desktop requests use EDT through the main process. They remain independent token families and neither is accepted as OWNER-back-office authority.

## Database migration

Migration: `prisma/migrations/20260723093000_add_browser_pos_device_lifecycle/migration.sql`.

It is additive: it creates `BrowserPosDevice` and its enum/indexes/foreign keys, then adds nullable true-actor audit columns and indexes to existing transaction tables. It deletes or rewrites no existing data.

Deployment order is mandatory:

1. Apply the migration with the direct migration connection.
2. Deploy this application and Desktop build.
3. Pilot valid legacy Browser POS devices; first valid transaction performs controlled registration.

Rollback is application-first: revert application/Desktop code while leaving additive columns/table in place. Do not drop the table or audit columns during an incident rollback; retained rows preserve revocation/audit evidence. An old Browser token cannot safely be made stateful again by schema rollback.

Fresh historical `prisma migrate deploy` was additionally attempted in a disposable database. It stopped at pre-existing migration `20260531000000_customer_order_campaign` because that historical migration references missing `CustomerOrder`; this is not caused by this migration. The new migration itself was applied successfully with `psql` to a schema generated from the exact required baseline SHA, confirming its SQL and dependencies. The historical fresh-install migration chain must be repaired in a separate package before it can be used as a fresh-environment release gate.

## Test evidence

| Check | Result |
| --- | --- |
| Root production build | PASS — `npm run build` |
| Root TypeScript and policy static tests | PASS — 13 routes, weak-signal removal, Browser actor/lifecycle assertions |
| EP-BR-POS-AUTH-01 static recovery regression | PASS |
| Browser transaction security static regression | PASS |
| Desktop activation static security regression | PASS |
| Prisma schema validation | PASS |
| Desktop full suite | PASS — 20 files, 150 tests |
| Desktop TypeScript / compile | PASS |
| Real cashier database regression | PASS in isolated PostgreSQL: valid OWNER/STAFF/Browser paths, weak-signal rejection, revoked/expired/tampered/cross-store Browser rejection, actor audit, zero fixture residue |
| New migration against baseline schema | PASS in isolated PostgreSQL |
| Fresh full historical migration chain | BLOCKED by the pre-existing `20260531000000_customer_order_campaign` defect described above |

The release-foundation unit test now evaluates uncommitted frozen-boundary drift against `HEAD`; the release command itself still defaults to its named historical production freeze tag. This prevents a formal active engineering package from being misclassified as a release attempt while preserving the release Gate.

## Independent-review and pilot checklist

1. Have a reviewer inspect the 13-route operation table and confirm no Device reaches personnel-only routes.
2. Apply the additive migration to a non-production/staging database using the approved direct connection.
3. Verify a pre-existing Browser POS completes a low-value sale and receives `legacyMigratedAt` without a raw token in database/logs.
4. Revoke that Browser device and confirm its next write opens the unchanged EP-BR-POS-AUTH-01 recovery path, preserves cart/checkout state, and does not auto-submit after rebind.
5. Activate an E-Shop Desktop, complete one each of sale, member balance payment, offline sync, order update, and the three read operations. Confirm renderer developer tools cannot read EDT.
6. Revoke/expire/subscription-block the Desktop device and confirm main opens activation recovery; confirm a normal browser with `x-lightops-client` cannot write.
7. Run the existing Windows CI before any pilot. This package neither merges nor authorizes Production deployment.

## Scope confirmations

- No Telegram product entry was redesigned.
- No QR, `/relogin`, authorization link, or historical bind route was deleted.
- Browser and Desktop tokens were not combined or cross-accepted.
- No Production database, deployment, merge, stable release, or FINAL tag was created.
