# EP-MB3-06C-M1 Migration Chain Repair Evidence

Date: 2026-07-19

Branch: `feat/ep-mb3-06c-activation-pin-console`

Base commit: `835d40f1261c5674d8b56016165b631b8e712859`

Status: `MIGRATION CHAIN REPAIR COMPLETE`

## Original Failure

A fresh isolated PostgreSQL database failed on full migration replay:

- Command category: `prisma migrate deploy`
- Failed migration: `20260531000000_customer_order_campaign`
- Prisma error code: `P3018`
- PostgreSQL SQLSTATE: `42P01`
- Database message: relation `CustomerOrder` does not exist
- Last successful migration before failure: `20260529000000_campaign_link`
- Failed migration ledger row: `finished_at = NULL`, `applied_steps_count = 0`
- Transaction behavior: the failed migration did not create partial `CustomerOrder` campaign columns or indexes

No production database, Preview database, production secret, device token, activation PIN, or connection string was used.

## Root Cause

Root Cause: `CONFIRMED`

`CustomerOrder` was added to `prisma/schema.prisma` in historical application code, but no formal Prisma migration created the table. Later migration `20260531000000_customer_order_campaign` assumed the table already existed and attempted:

- `ALTER TABLE "CustomerOrder" ADD COLUMN ...`
- `CREATE INDEX ... ON "CustomerOrder"`

This worked only for environments where `CustomerOrder` had already been created by manual SQL or `db push`, but it made empty-database replay impossible.

The follow-up drift check also confirmed older manual-DDL/db-push drift that existed in the current schema but not the migration chain:

- `BindToken`
- `StoreCustomerContact`
- `CustomerTouchLog`
- coupon tables and enums
- `ConversationLog`
- OpsAdmin hardening fields
- tenant tier / store business display fields
- product main image fields
- `SaleRecord.orderNo`
- `DesktopActivationPin.createdByUserId` FK delete behavior

## Historical Deployment Status

Historical migration already deployed: `UNKNOWN`

Evidence shows related docs describe the old TikTok campaign migration as already online, but this local task did not connect to any production or long-lived Preview database. Because deployment status is unknown, the repair did not edit historical migration files or rewrite old checksums.

## Chosen Repair Strategy

Chosen strategy: additive corrective migrations.

1. `20260530000000_create_customer_order_base`
   - Added in the chronological gap after `CampaignLink` and before `20260531000000_customer_order_campaign`.
   - Creates `CustomerOrder` if absent.
   - Adds known no-migration `CustomerOrder` drift columns with guarded `ADD COLUMN IF NOT EXISTS`.
   - Leaves `tableNo` to existing migration `20260531000005_add_customer_order_table_no`.
   - Does not modify the old `20260531000000_customer_order_campaign` checksum.

2. `20260719100000_repair_historical_schema_drift`
   - Formalizes manual-DDL/db-push schema already declared in `schema.prisma`.
   - Uses guarded enum/table/column/index/FK creation where practical.
   - Replaces the 06C merchant creator FK with `ON DELETE SET NULL` to match the current Prisma relation.

Rejected alternatives:

- `migrate resolve --applied`: rejected because it would hide a broken replay chain.
- `db push`: rejected as a production migration substitute.
- Editing `20260531000000_customer_order_campaign`: rejected because historical deployment status is unknown.
- Deleting or squashing all migrations: rejected because a smaller additive repair satisfies both new and existing environment paths.

## New Environment Migration Result

Result: `PASS`

Fresh isolated PostgreSQL database:

1. `prisma migrate status` reported all migrations pending.
2. `prisma migrate deploy` applied all 46 migrations.
3. `prisma migrate status` reported database schema up to date.
4. `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` reported no difference.
5. Repeated `prisma migrate deploy` reported no pending migrations.
6. `tests/migration-chain-smoke.test.ts` passed.

## Existing Environment Upgrade Result

Result: `PASS`

Fixture used:

- Local isolated database with current Prisma schema already present.
- Synthetic `_prisma_migrations` ledger containing the 44 pre-repair migrations and matching file checksums.
- New repair migrations intentionally absent from the ledger.

Upgrade:

- `prisma migrate status` showed only:
  - `20260530000000_create_customer_order_base`
  - `20260719100000_repair_historical_schema_drift`
- `prisma migrate deploy` applied both.
- `prisma migrate status` reported up to date.
- Drift check reported no difference.
- Repeated deploy was no-op.

No `migrate resolve`, manual applied marking, production trial run, or ledger deletion was used.

## 06C Migration Verification

Result: `PASS`

Verified after full migration replay:

- `DesktopActivationPin.createdByUserId` is nullable.
- `DesktopActivationPin.createdByOpsAdminId` exists and is nullable.
- `DesktopActivationAudit.actorOpsAdminId` exists and is nullable.
- `DesktopActivationPin_createdByOpsAdminId_fkey` exists.
- `DesktopActivationAudit_actorOpsAdminId_fkey` exists.
- `DesktopActivationPin_createdByUserId_fkey` exists with `ON DELETE SET NULL`.
- `DesktopActivationPin_createdByOpsAdminId_idx` exists.
- `DesktopActivationAudit_actorOpsAdminId_idx` exists.
- `DesktopActivationPin_exactly_one_creator_check` exists.
- Merchant-shaped historical PIN rows remain insertable and valid.
- Ops issuance writes `createdByOpsAdminId` and `actorOpsAdminId`.

Unchanged:

- PIN HMAC
- device token
- TTL
- activeSlot policy
- subscription policy
- activation API contract

## Automated CI Gate

Updated `.github/workflows/cloud-ci.yml`.

The CI gate now uses PostgreSQL service container and runs:

- `npx prisma migrate deploy`
- `npx prisma migrate status`
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
- repeated `npx prisma migrate deploy`
- `npx tsx tests/migration-chain-smoke.test.ts`
- desktop activation DB runtime tests
- desktop activation PIN console DB tests

The previous `prisma db push --force-reset` schema shortcut was removed from the workflow.

## Tests

Passed locally:

- `npm ci`
- `npx prisma validate`
- `npx prisma generate`
- `npx tsc --noEmit`
- `npx tsx tests/migration-chain-smoke.test.ts`
- `npx tsx tests/desktop-activation-pin-console-static.test.ts`
- `npx tsx tests/desktop-activation-security-static.test.ts`
- `npx tsx tests/desktop-activation-crypto.test.ts`
- `npx tsx tests/desktop-activation-subscription.test.ts`
- `npx tsx tests/desktop-activation-concurrency-static.test.ts`
- `npx tsx tests/desktop-activation-runtime.test.ts`
- `npx tsx tests/desktop-activation-pin-console-api.test.ts`
- `npx tsx tests/customer-display-adapter.test.ts`
- `npx tsx tests/customer-display-cart-sync-static.test.ts`
- `npx tsx tests/customer-display-realtime-channel.test.ts`
- `npx tsx tests/customer-landing-journey-static.test.ts`
- `npx tsx tests/hrt-contract.test.ts`
- `npx tsx tests/subscription-lifecycle.test.ts`
- `npx tsx tests/telegram-start-param.test.ts`
- `npm run build`

Notes:

- `npm ci` required local cache permission outside the sandbox because Prisma updates its engine cache.
- Expected CHECK-constraint rejection cases emit Prisma error logs during tests.
- npm audit still reports existing dependency vulnerabilities; this package did not address dependency upgrades.

## Risk

Risk level: `MEDIUM`

Reason:

- The repair adds formal migrations and CI gate coverage for schema history.
- It does not change PIN HMAC, device token, TTL, activeSlot, subscription policy, activation API contract, Desktop, Provider, WindowManager, main branch, tag, or release flow.
- Existing environments with manual schema objects are supported through guarded SQL.
- Real production deployment should still apply via normal migration process, not first-run trial-and-error.

## Readiness

Preview Deployment Readiness: `YES`, with standard non-production migration execution and test secrets.

Real Test PIN Readiness: `YES`, after Preview migration succeeds. Do not print PINs in logs, screenshots, or chat.

Windows Full Activation Readiness: `NO`, pending Windows-side full activation validation.

EP-MB3-06C Acceptance: `NO`, pending Preview/Windows validation.

EP-MB3-07B1 Acceptance: `NO`, not in this package.
