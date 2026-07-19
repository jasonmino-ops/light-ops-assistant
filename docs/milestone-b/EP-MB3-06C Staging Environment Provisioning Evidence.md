# EP-MB3-06C Staging Environment Provisioning Evidence

Date: 2026-07-20

## Execution Result

`PASS`

The deterministic staging bootstrap and runtime-fixture cleanup package is
complete. The exact feature-branch Preview is deployed and verified against
the isolated `eshop-staging` project. No activation PIN was generated.

## Repository Baseline

- Repository: `light-ops-assistant`
- Branch: `feat/ep-mb3-06c-activation-pin-console`
- Required starting commit: `de87f5929b119773a0c7b6b019e802cf6039eca9`
- Starting local/remote divergence: `0 / 0`
- Starting workspace: only this untracked Evidence draft
- Deployment commit: `94b678f55595d5daefdacf7bf938126f16f44b71`
- No branch switch, merge, tag, release, or Production deployment occurred.

## Authorized Scope

- Supabase write target: `eshop-staging` only
- Vercel write target: Preview environment for the exact feature branch only
- Production Supabase: not written
- Production Vercel variables: not modified
- Staging project fingerprint: `c18c04531444`
- Production project fingerprint: `b20e57acf733`
- Project fingerprints are distinct.

## Cleanup Failure Root Cause

The failing cleanup was `/private/tmp/ep-mb3-06c-e2-clean-runtime-fixtures.ts`,
launched by `/private/tmp/ep-mb3-06c-e2-tests.mjs` after
`tests/desktop-activation-runtime.test.ts` completed.

- Test command: local `tsx` execution of the runtime test
- Cleanup command: local `tsx` execution of the temporary cleanup entrypoint
- Cleanup exit code: `1`
- Failure stage: entrypoint transform, before execution or SQL
- Root cause: the temporary file was outside the repository package context;
  `tsx` transformed it as CommonJS, where its top-level `await` was unsupported.
- Correct `DATABASE_URL` and `DIRECT_URL` were inherited.
- The target fingerprint matched `eshop-staging`.
- FK delete order was never reached.
- Fixture IDs were not missing.
- Prisma disconnect was not reached.
- This was not a shell/spawn cross-platform failure.
- The runtime assertions succeeded, then the separate cleanup failed.
- No row was deleted by the failed subprocess.
- Residuals were identifiable by the fixed `rt-success tenant ` and
  `rt-concurrent tenant ` marker prefixes.

## Fixture Ownership Gate

Fixture Ownership: `PROVEN`

Ownership was established before deletion using:

1. Marker prefixes hard-coded by the runtime test.
2. Dependent rows selected through the marked tenant IDs and FK chain.
3. A database that was empty before the failed runtime-test run.
4. Unrelated baseline counts of zero for tenant, store, user, OpsAdmin,
   CustomerOrder, and SaleRecord rows.

No row contents or personal fields were read into the evidence.

## Residual Rows Before Cleanup

| Table | Count |
| --- | ---: |
| `Tenant` | 2 |
| `Store` | 3 |
| `User` | 2 |
| `UserStoreRole` | 2 |
| `TenantSubscription` | 2 |
| `SubscriptionEvent` | 0 |
| `DesktopActivationPin` | 4 |
| `DesktopActivationAudit` | 10 |
| `DesktopDevice` | 2 |
| `CustomerOrder` | 0 |
| `Product` | 0 |

## Deterministic Cleanup Implementation

- The runtime test records every created tenant ID immediately after creation.
- Its `finally` block uses the same Prisma client and one transaction.
- Deletes run in FK-safe order: audit, PIN, device, subscription event,
  subscription, user-store role, customer order, product, store, user, tenant.
- Cleanup asserts every tracked tenant is absent before disconnecting Prisma.
- No subprocess is used by the runtime test.
- A separate staging-only residual cleanup command exists for historical rows.
- The command requires `STAGING_PREVIEW_MAINTENANCE=1`, rejects Vercel
  Production, validates the Supabase endpoint and staging fingerprint, accepts
  no arbitrary SQL, and targets only the two fixed runtime marker prefixes.
- No truncate, schema drop, `db push`, `migrate resolve`, or unknown-row delete
  was used.

## Residual Rows After Cleanup

All eleven table counts above were `0`. Independent read-only inventory after
cleanup and again after tests confirmed:

- Runtime fixture residuals: `ZERO`
- Unrelated baseline counts: unchanged
- Post-deployment activation PIN count: `0`

## Test Closure

The following 15 tests passed against `eshop-staging` using ephemeral,
non-persisted test secrets:

1. Migration-chain smoke
2. Desktop activation runtime DB test
3. Desktop activation PIN-console API test
4. Desktop activation concurrency static test
5. Desktop activation crypto test
6. Desktop activation PIN-console static test
7. Desktop activation security static test
8. Desktop activation subscription test
9. Staging cleanup/bootstrap static test
10. Customer-display adapter test
11. Customer-display cart-sync static test
12. Customer-display realtime-channel test
13. Customer landing journey static test
14. Subscription lifecycle test
15. Telegram start-parameter test

- Runtime cleanup mode: in-process `finally`
- Runtime residuals after tests: `ZERO`
- Typecheck: `PASS`
- Production build: `PASS` (`140/140` pages generated)

## Bootstrap Path

Bootstrap Path: `EXISTING + NEW AUDITED SCRIPT`

- OpsAdmin creation reused the existing `/api/ops/login` first-admin path.
- The new staging script invokes that path in-process, verifies its signed
  session with `checkOpsAuthContext`, and rejects legacy `_ops_admin` identity.
- The script pins the synthetic operator name and fixed fixture identifiers.
- It is idempotent and fails closed on conflicting IDs, store-code ownership,
  real business data, Production scope, or a database fingerprint mismatch.
- The script is manual staging maintenance code; it does not run in application
  runtime and cannot generate activation PINs.
- A second bootstrap run passed, proving idempotency.

## OpsAdmin Identity

Preview Ops Identity: `VALID FK-BACKED`

- Role: `SUPER_ADMIN`
- Status: `ACTIVE`
- Lock state: unlocked
- Session version: valid
- Session user ID: matched the persisted `OpsAdmin.id`
- `_ops_admin`: not used
- `OPS_USER_IDS`: not used
- Production administrator data: not copied

The existing login route attempts an `OperationLog` write with tenant marker
`_ops`. In this freshly migrated staging database that optional log write hits
the existing tenant FK and is swallowed by the existing route. Authentication,
the FK-backed OpsAdmin session, activation audit attribution, and all package
gates pass. Repairing that unrelated legacy login-log behavior requires a
separate package.

## Synthetic Fixtures

Result: `PASS`

| Fixture | Value | Status |
| --- | --- | --- |
| Tenant ID | `preview-e1-tenant` | ACTIVE |
| Store ID | `preview-e1-store` | ACTIVE |
| Store code | `PREV06C` | ACTIVE |
| Owner ID | `preview-e1-owner` | ACTIVE OWNER |
| Subscription | fixed tenant subscription | ACTIVE |

- Real customers: none
- Real phone numbers: none
- Sales, members, and customer orders: zero
- Production tokens: none
- Activation PINs: zero

## OPS_AUTO_SEED Closure

`OPS_AUTO_SEED`: `DISABLED`

- Scope: Preview for `feat/ep-mb3-06c-activation-pin-console` only
- Effective value: `false`, independently re-pulled and verified
- Required exact-branch overrides present: `10`
- Other secret overrides remain Vercel write-only sensitive values.
- Production scope was not targeted.
- Ops authentication and fixture verification passed after disabling auto-seed.

## Final Staging Preflight

Migration classification: `B. MIGRATION-CLEAN`

- Repository migrations: `46`
- Applied migrations: `46`
- Distinct migration ledger rows: `46`
- Unhealthy migration rows: `0`
- `prisma migrate status`: up to date
- Drift: none
- Repeated deploy: no-op
- CustomerOrder required columns: pass
- Required migration indexes: pass
- Activation actor columns: pass
- Activation actor FKs and exactly-one-creator check: pass
- OpsAdmin FK identity: pass
- Synthetic tenant/store/owner/subscription: pass
- Runtime fixture residuals: zero
- PostgreSQL major version: `17`
- TLS: pass

## Preview Deployment

Result: `READY`

- Environment: Preview
- Branch: `feat/ep-mb3-06c-activation-pin-console`
- Commit: `94b678f55595d5daefdacf7bf938126f16f44b71`
- Git deployment state: `READY`
- Exact-branch overrides: loaded
- Database target proof: the deployment returned the staging-only fixed
  `PREV06C` / `preview-e1-tenant` fixture.
- Production fingerprint: not used
- Ops login: pass
- `/ops/desktop-activation`: accessible through authenticated Preview
- `PREV06C` read-only lookup: pass
- API and console cache headers: `no-store`
- Activation issuance endpoint called: no
- Active PIN returned: none
- Post-deployment database activation PIN count: `0`

## Production And Secret Safety

- Production Supabase writes: none
- Production Vercel changes: none
- Production deployment: none
- Secret exposure: `NONE`
- Outstanding rotation: none
- No password, connection string, host, key, token, session cookie, customer
  field, or PIN is recorded in this document.

## Files Changed

- `package.json`
- `scripts/bootstrap-staging-preview.ts`
- `scripts/cleanup-staging-runtime-fixtures.ts`
- `scripts/staging-preview-guard.ts`
- `tests/desktop-activation-runtime.test.ts`
- `tests/staging-bootstrap-static.test.ts`
- `docs/milestone-b/EP-MB3-06C Staging Environment Provisioning Evidence.md`

No application business logic, stable mobile/customer/cashier workflow,
database schema, or migration was changed by E2B.

## Readiness

- Staging isolation complete: `YES`
- Ready for Preview deployment: `YES`
- Ready to generate first staging test PIN: `YES`
- Ready for Windows full activation: `NO`
- Ready for EP-MB3-06C acceptance: `NO`
- PIN generated in this package: `NO`
