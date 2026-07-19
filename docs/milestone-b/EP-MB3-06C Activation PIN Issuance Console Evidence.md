# EP-MB3-06C Activation PIN Issuance Console Evidence

Date: 2026-07-19

Status: CONDITION CLOSURE COMPLETE

## Readiness Review

Repository baseline:

- Reviewed branch: `feat/ep-mb3-06c-activation-pin-console`
- Required starting HEAD: `d9e3a77a74d29f0f2fd88f122cb19f421eadfb3c`
- Required origin: `d9e3a77a74d29f0f2fd88f122cb19f421eadfb3c`
- Sync before closure: `0 / 0`
- Workspace before closure: clean

Independent Chief Architect result:

- `CONDITIONAL PASS`

Conditions closed in this package:

- P1-1 operator audit attribution
- P2-1 merchant audit metadata regression
- P2-3 replacement confirmation
- DB runtime verification on isolated local test DB

Deferred:

- Ops CSRF / Origin hardening is deferred to an independent security package because it is an existing ops API global pattern, not a regression introduced by this package.

## Founder Schema Decision

Founder / CTO approved a minimal database migration.

The metadata-only workaround was rejected because operator identity must be a typed, queryable source of truth instead of being stored only in JSON.

Formal model:

- Merchant-issued PIN:
  - `DesktopActivationPin.createdByUserId = merchant User.id`
  - `DesktopActivationPin.createdByOpsAdminId = null`
  - `DesktopActivationAudit.actorUserId = merchant User.id`
  - `DesktopActivationAudit.actorOpsAdminId = null`
- Ops-issued PIN:
  - `DesktopActivationPin.createdByUserId = null`
  - `DesktopActivationPin.createdByOpsAdminId = OpsAdmin.id`
  - `DesktopActivationAudit.actorUserId = null`
  - `DesktopActivationAudit.actorOpsAdminId = OpsAdmin.id`

## Existing Schema Findings

Confirmed from current repository schema before migration:

- `DesktopActivationPin.createdByUserId` used the merchant User relation.
- Prior relation name was `DesktopActivationPinCreatedBy`.
- `DesktopActivationPin.createdByUserId` was non-nullable.
- `DesktopActivationAudit.actorUserId` was already nullable.
- Nullable `actorUserId` is the existing system actor semantic for system/unauthenticated activation audit events.
- `OpsAdmin.id` is `String @id @default(cuid())`.
- `OpsAdmin` and merchant `User` are independent models.
- Existing historical PIN rows have merchant `createdByUserId` and remain compatible.

## Explicit Actor Model Migration

Migration:

- `20260719090000_model_activation_pin_ops_attribution`

Migration SQL summary:

- Add nullable `DesktopActivationPin.createdByOpsAdminId`.
- Add nullable `DesktopActivationAudit.actorOpsAdminId`.
- Drop `NOT NULL` from `DesktopActivationPin.createdByUserId`.
- Add `DesktopActivationPin_createdByOpsAdminId_idx`.
- Add `DesktopActivationAudit_actorOpsAdminId_idx`.
- Add FK `DesktopActivationPin.createdByOpsAdminId -> OpsAdmin.id ON DELETE SET NULL ON UPDATE CASCADE`.
- Add FK `DesktopActivationAudit.actorOpsAdminId -> OpsAdmin.id ON DELETE SET NULL ON UPDATE CASCADE`.
- Add `DesktopActivationPin_exactly_one_creator_check`:
  - exactly one of `createdByUserId` or `createdByOpsAdminId` must be present.

Data compatibility:

- Existing merchant PIN rows keep `createdByUserId`.
- New ops column defaults to null.
- Existing rows satisfy the new CHECK.
- No PIN data, PIN hash, device token, HMAC, TTL, activeSlot, or subscription policy is changed.

Rollback strategy:

- Stop writes to PIN issuance endpoints.
- Drop CHECK, FKs, and indexes.
- Drop `actorOpsAdminId` and `createdByOpsAdminId`.
- Restore `createdByUserId NOT NULL` only after confirming no ops-issued rows remain or after remapping by an approved business decision.

Lock risk:

- Low to medium. The migration alters `DesktopActivationPin` and `DesktopActivationAudit`, adds two nullable columns, two indexes, two FKs, and one CHECK.
- Existing table size is expected small for the pilot phase.

Production estimated impact:

- Short DDL lock on activation tables.
- No row rewrite for nullable column add.
- CHECK validation scans existing `DesktopActivationPin` rows.

## P1-1 Operator Attribution Closure

Closed.

Shared issuance input now explicitly carries:

- `createdByUserId`
- `createdByOpsAdminId`
- `actorUserId`
- `actorOpsAdminId`

Merchant route passes only merchant User fields.

Ops route passes only verified server-side ops session fields:

- `createdByOpsAdminId = auth.ops.userId`
- `actorOpsAdminId = auth.ops.userId`
- `operatorRole = auth.ops.role`
- `issuanceSource = OPS_CONSOLE`

The client body accepts only business input (`storeCode`). Client-supplied actor/operator fields are ignored.

## P2-1 Frozen Metadata Regression Closure

Closed.

Shared issuance service now only includes optional metadata keys when actual values exist.

Merchant `PIN_CREATED` metadata remains:

- `expiresAt`
- `accessState`
- `status`

Merchant audit metadata no longer gains null `reason`, `eventVersion`, `operatorRole`, or `issuanceSource`.

## P2-3 Replacement Confirmation Closure

Closed.

When `GET /api/ops/desktop-activation` reports `activePin.hasValidPin = true`, the page shows an inline confirmation before POST:

- Title: `确认生成新的激活 PIN？`
- Body: `当前门店已有有效 PIN。继续后，旧 PIN 将立即失效。`
- Actions: `取消`, `确认生成`

Behavior verified statically:

- No native browser `confirm`.
- No POST before confirmation.
- Cancel hides confirmation without changing state.
- Confirmation uses existing `issuing` guard to prevent duplicate submit.
- No valid active PIN keeps direct generation behavior.

## DB Runtime Test Environment

Category:

- Local ephemeral PostgreSQL cluster under `/private/tmp`
- Dedicated isolated local database
- Test-only desktop activation secrets
- `DESKTOP_ACTIVATION_TEST_DATABASE=1`

Not used:

- Production database
- Production secrets
- Production tenant/store
- Real production PIN

## Migration Verification

Full historical `prisma migrate deploy` from an empty DB failed before this package at old migration `20260531000000_customer_order_campaign` because that historical migration references `CustomerOrder` before it exists in the replay chain.

Safe equivalent migration verification was completed:

1. Exported the reviewed `d9e3a77` schema to a temp file.
2. Applied that schema to a fresh isolated local DB with `prisma db push`.
3. Inserted a pre-migration merchant PIN fixture with non-null `createdByUserId`.
4. Applied `20260719090000_model_activation_pin_ops_attribution/migration.sql`.
5. Verified historical PIN compatibility.
6. Ran DB runtime tests against the migrated DB.

Results:

- Migration SQL: PASS
- Historical merchant PIN compatibility: PASS
- CHECK constraint exists: PASS
- FKs exist: PASS
- Indexes exist: PASS
- Cleanup result: PASS, active PIN count `0`

## DB Runtime Tests

`tests/desktop-activation-pin-console-api.test.ts`: PASS

Covered:

- Migration catalog objects.
- Historical merchant PIN row remains valid.
- Merchant issuance writes `createdByUserId` and `actorUserId`.
- Merchant issuance leaves `createdByOpsAdminId` and `actorOpsAdminId` null.
- Ops issuance writes `createdByOpsAdminId` and `actorOpsAdminId`.
- Ops issuance leaves merchant actor fields null.
- CHECK rejects both creators null.
- CHECK rejects both creators present.
- Disabled OpsAdmin session rejected.
- TRIAL issuance succeeds.
- ACTIVE issuance succeeds.
- EXPIRED issuance blocked.
- CANCELLED issuance blocked.
- DB stores no raw PIN.
- New PIN revokes old PIN.
- Concurrent issuance leaves exactly one active PIN.
- `PIN_CREATED` audit.
- `PIN_CREATE_DENIED` audit.
- Unauthenticated rejected.
- Merchant OWNER rejected from ops API.
- STAFF rejected from ops API.
- BD rejected.
- no-store on success, 403, 404, and 503 paths.
- Ops-issued PIN can be consumed by `/api/desktop/activate`.
- Used PIN cannot be reused.
- Merchant API regression.
- Controlled rollback path leaves no audit or PIN rows.
- Audit metadata has no null regression fields.
- Audit metadata contains no PIN, PIN hash, token, secret, session token, or request body.

`tests/desktop-activation-runtime.test.ts`: PASS on the same isolated DB.

This confirms existing activate/verify/revoke runtime flow still works after the actor schema change.

## No-Store / Logging Review

Confirmed:

- ops API uses `noStoreJson` / `apiError`
- responses include `Cache-Control: no-store, max-age=0`
- shared issuance service does not call `console`
- shared issuance service does not write `OperationLog`
- frontend does not call `console`
- frontend does not use browser persistent storage

## Commands

Passed:

- `npm ci`
- `npx prisma validate`
- `npx prisma generate`
- `npx tsc --noEmit`
- `npx tsx tests/desktop-activation-pin-console-static.test.ts`
- `npx tsx tests/desktop-activation-security-static.test.ts`
- `npx tsx tests/desktop-activation-crypto.test.ts`
- `npx tsx tests/desktop-activation-subscription.test.ts`
- `npx tsx tests/desktop-activation-concurrency-static.test.ts`
- `npx tsx tests/desktop-activation-pin-console-api.test.ts`
- `npx tsx tests/desktop-activation-runtime.test.ts`
- `npx tsx tests/customer-display-adapter.test.ts`
- `npx tsx tests/customer-display-cart-sync-static.test.ts`
- `npx tsx tests/customer-display-realtime-channel.test.ts`
- `npx tsx tests/customer-landing-journey-static.test.ts`
- `npx tsx tests/hrt-contract.test.ts`
- `npx tsx tests/subscription-lifecycle.test.ts`
- `npx tsx tests/telegram-start-param.test.ts`
- `npm run build`

Not run:

- Playwright production smoke, because this package does not deploy production and must not use production DB/secrets.

## Preview Readiness

Preview deployment readiness: YES, with conditions.

Required preview settings:

- Apply migration to a non-production preview DB.
- Configure test-only `DESKTOP_ACTIVATION_PIN_SECRET`.
- Configure test-only `DESKTOP_DEVICE_TOKEN_SECRET`.
- Configure preview ops login with a test `OPS_ADMIN` or `SUPER_ADMIN`.
- Confirm preview does not connect to production DB.
- Confirm `NODE_ENV=production` disables dev header fallback.

## Windows Field Activation

Not completed in this package.

Still pending:

- enter real `storeCode`
- enter generated real 6 digit PIN
- activation API success
- Desktop enters business window
- used PIN cannot be reused
- device token stored by safeStorage
- restart skips activation page
- verify/status succeeds
- device is bound to the correct store
- logs contain no PIN/token
- provider starts only after authorization
- second instance behavior is correct

## Risk

Risk level: medium.

Reason:

- This package includes a minimal schema migration.
- No Windows Desktop runtime change.
- No cashier, customer H5, invite, QR code, records, products, Telegram auth, order status, sale write-flow, PIN HMAC, token format, TTL, activeSlot, or subscription policy change.

Residual risks:

- Old full migration chain still cannot replay from empty DB due to a historical pre-existing migration ordering issue unrelated to this package.
- Ops CSRF / Origin hardening remains deferred.
- Full Windows activation remains pending.

## Recommendation

READY FOR PREVIEW DEPLOYMENT: YES

READY TO GENERATE REAL TEST PIN: YES

READY FOR WINDOWS FULL ACTIVATION: NO

READY FOR EP-MB3-06C ACCEPTANCE: NO

READY FOR EP-MB3-07B1 ACCEPTANCE: NO
