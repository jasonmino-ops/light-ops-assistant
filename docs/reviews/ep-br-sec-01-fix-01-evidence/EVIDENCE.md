# EP-BR-SEC-01-FIX-01 Runtime Evidence

## Scope and isolation

- UTC test window: `2026-07-21T17:36:42Z` through cleanup recorded below.
- PostgreSQL: `18.3 (Homebrew)`.
- Prisma CLI / Client: `7.6.0` (full output: [`00-prisma-version.log`](00-prisma-version.log)).
- Temporary database: `light_ops_sec_fix_01_runtime` on `127.0.0.1:55433`, under a new local-only PostgreSQL data directory.
- The temporary connection string and password were held only in a mode-600 file below `/private/tmp`; they are neither in this evidence pack nor Git.
- Initial database check: the temporary instance listened only on `127.0.0.1`; `Tenant`, `Store`, `SaleRecord`, `PaymentIntent`, `Member`, `MemberBalanceLedger`, `OfflineSaleSyncMap`, and `CustomerOrder` all had zero rows. See [`04-before-runtime-state.log`](04-before-runtime-state.log).

## A. Transaction-security verification environment

`prisma db push` synchronized the current `prisma/schema.prisma` into this isolated temporary database, then the real route handlers and Prisma client were exercised. This is valid evidence of the current code's database behaviour only; it is not evidence that the migration history can bootstrap an empty database.

1. A first `npx prisma migrate deploy` was run against the empty temporary database. It exited `1` at `2026-07-21T17:36:50Z`; its complete output is [`01-migrate-deploy.log`](01-migrate-deploy.log).
2. The failure is `P3018 / 42P01` at migration `20260531000000_customer_order_campaign`: the migration attempts `ALTER TABLE "CustomerOrder"` while that relation does not exist. No migration was changed, skipped, resolved, or marked complete.
3. The first attempt with the obsolete Prisma option `--skip-generate` exited `1` without schema change; it is retained verbatim as [`02-db-push.log`](02-db-push.log). The actual supported `npx prisma db push` then exited `0` at `2026-07-21T17:37:17Z`; full output: [`03-db-push.log`](03-db-push.log).
4. The pre- and post-test state logs show no real data existed, and the runtime fixture cleanup left the listed business tables at zero rows: [`04-before-runtime-state.log`](04-before-runtime-state.log), [`06-after-runtime-state.log`](06-after-runtime-state.log).

## B. Migration integrity is a separate defect

`prisma migrate deploy` cannot currently complete from an empty database. This is an independent bootstrap defect, registered for follow-up as **EP-DB-MIGRATION-01 — Empty Database Bootstrap Repair**. This fix neither repairs the migration history nor claims that it is healthy. Passing the transaction-security runtime suite does not change that conclusion.

## Runtime commands and results

All commands sourced only the non-repository temporary environment file or used direct local `psql` credentials; the repository `.env` and `/Users/jason/light-ops-assistant/.env` were not used for this verification.

| UTC start | Command | Exit | Complete output |
| --- | --- | ---: | --- |
| 2026-07-21T17:36:42Z | `npx prisma --version` | 0 | [`00-prisma-version.log`](00-prisma-version.log) |
| 2026-07-21T17:36:50Z | `npx prisma migrate deploy` | 1 (expected recorded bootstrap failure) | [`01-migrate-deploy.log`](01-migrate-deploy.log) |
| 2026-07-21T17:37:03Z | `npx prisma db push --skip-generate` | 1 (unsupported Prisma 7.6.0 option; no change) | [`02-db-push.log`](02-db-push.log) |
| 2026-07-21T17:37:17Z | `npx prisma db push` | 0 | [`03-db-push.log`](03-db-push.log) |
| 2026-07-21T17:37:35Z | local `psql` isolation and zero-row query | 0 | [`04-before-runtime-state.log`](04-before-runtime-state.log) |
| 2026-07-21T17:37:47Z | `CASHIER_SECURITY_TEST_DATABASE=1 npx tsx tests/desktop-pos-write-fallback-runtime.test.ts` | 0 | [`05-route-db-security-runtime.log`](05-route-db-security-runtime.log) |
| 2026-07-21T17:38:11Z | local `psql` post-test state query | 0 | [`06-after-runtime-state.log`](06-after-runtime-state.log) |
| 2026-07-21T17:38:24Z | `npx tsx tests/browser-transaction-security.test.ts` | 0 | [`07-browser-transaction-security.log`](07-browser-transaction-security.log) |
| 2026-07-21T17:38:32Z | `npx tsc --noEmit` | 0 | [`08-typescript.log`](08-typescript.log) |
| 2026-07-21T17:38:40Z | `npm run build` | 0 | [`09-build.log`](09-build.log) |
| 2026-07-21T17:40:23Z | `git diff --check` | 0 | [`11-diff-check.log`](11-diff-check.log) |
| 2026-07-21T17:40:31Z | `pg_ctl stop`, port no-listener check, exact temporary directory removal | 0 | [`10-temporary-postgres-teardown.log`](10-temporary-postgres-teardown.log) |

## Real route and database assertions

[`tests/desktop-pos-write-fallback-runtime.test.ts`](../../../tests/desktop-pos-write-fallback-runtime.test.ts) invokes the actual Next route handler exports with `NextRequest`, real signed sessions/device tokens, and the local Prisma database. It is guarded by `CASHIER_SECURITY_TEST_DATABASE=1` to prevent accidental execution against an unspecified database.

- Public `storeCode` plus `x-lightops-client: desktop-pos`, with no cookie and no `pos-device-v1`, receives `401` or `403` for each of the four write routes. Before/after snapshots prove no `SaleRecord`, `PaymentIntent`, `OfflineSaleSyncMap`, member ledger/balance, order status, or product timestamp mutation.
- KHQR with `manualPaymentConfirmed` absent and explicitly `false` returns `409 MANUAL_PAYMENT_CONFIRMATION_REQUIRED`, with the same no-write snapshot assertion. The present schema has no inventory quantity model or inventory mutation in these paths; product `updatedAt` is included as the applicable product-side no-mutation check.
- A valid `pos-device-v1` is accepted. Tampered, device-ID mismatch, store mismatch, and 181-day-expired tokens are rejected without side effects.
- Regressions that pass: active STAFF CASH sale; OWNER manually-confirmed KHQR sale with `PaymentIntent { status: PAID, paymentMethod: KHQR }`; legal member-balance debit; legal offline sync; legal order status update.
- `pos-device-v1` is a stateless HMAC token. The repository has no server-side revocation model/table/lookup, so revoked-token support and a revoked-token test are intentionally not claimed.

## Temporary-environment teardown

The PostgreSQL instance is stopped after all runtime checks. The teardown log records `pg_ctl stop`, the no-listener check for port `55433`, and removal confirmation for the exact temporary directory; no password is logged. See [`10-temporary-postgres-teardown.log`](10-temporary-postgres-teardown.log).

## Git lock resolution and final checks

The pre-existing `index.lock` was held only by a Virtualization VM read handle; no Git writer or active Git operation marker was present. The unchanged lock blocked a real index write (`git update-index --really-refresh`) with `File exists`, while the pre-lock patch was backed up and SHA-256 recorded in [`14-before-lock-fix-patch.sha256`](14-before-lock-fix-patch.sha256). Under explicit Founder authorization, only that one directory entry was removed with `unlink`; `index` itself and all other Git files were preserved.

Immediately afterwards, `git status` preserved the expected patch range, `git fsck --no-reflogs` exited 0, and `git diff --check` exited 0. The post-lock TypeScript check, existing browser transaction-security test, and production build all exited 0; the latter two used an intentionally non-routable `127.0.0.1` placeholder DATABASE_URL, never Supabase or production. See [`17-post-lock-typescript.log`](17-post-lock-typescript.log), [`18-post-lock-browser-security.log`](18-post-lock-browser-security.log), [`19-post-lock-build.log`](19-post-lock-build.log), and [`20-pre-final-evidence-integrity.log`](20-pre-final-evidence-integrity.log).
