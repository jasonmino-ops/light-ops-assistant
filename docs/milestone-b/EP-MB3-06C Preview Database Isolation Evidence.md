# EP-MB3-06C-E1 Preview Database Isolation Evidence

Date: 2026-07-20

Branch: `feat/ep-mb3-06c-activation-pin-console`

Reviewed commit: `34956c62c719075ceed0f45c7e3617a3fc912e01`

Status: `CONFIGURATION PLAN COMPLETE - PROVISIONING NOT STARTED`

## Executive Result

Environment Investigation Result: `CONDITIONAL PASS`

The repository, Cloud CI, and Vercel deployment baselines are known. The current
Vercel Preview environment is not safe for database preflight or activation
testing because it inherits database, auth, and ops settings that are shared with
Production.

This package defines a safe target architecture and executable configuration
sequence. It did not create a database, change a Vercel variable, connect to a
database, run a migration, create an OpsAdmin, generate a PIN, or alter
Production.

## Repository And Deployment Baseline

Repository: `/Users/jason/light-ops-assistant`

Verified:

- Branch: `feat/ep-mb3-06c-activation-pin-console`
- Local HEAD: `34956c62c719075ceed0f45c7e3617a3fc912e01`
- Origin branch HEAD: `34956c62c719075ceed0f45c7e3617a3fc912e01`
- Local/origin divergence: `0 / 0`
- Workspace before this evidence document: clean
- Vercel project: `light-ops-assistant`
- Target-commit Preview deployment: `READY`
- Current Production deployment: `READY`, commit `15dad1aae9972046258857985469ce13e51349e6`
- Remote Cloud CI run `29695675277`: `PASS`

The target-commit deployment is a Vercel Preview deployment and has no
branch-specific environment-variable overrides.

## Current Vercel Environment Scope

Only variable names, scopes, and age categories were inspected. No encrypted
value was pulled or displayed.

The Vercel CLI exposes the record's `created` age in this listing, not a
separate last-updated timestamp. The table therefore reports record-age
categories; exact last-update time is `UNKNOWN` from the available read-only
metadata.

| Variable | Development | Preview | Production | Feature-branch override | Current result | Age category |
| --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | present | present | present | absent | one shared record across all scopes | older than 90 days |
| `DIRECT_URL` | absent | present | present | absent | one shared Preview/Production record | older than 90 days |
| `DESKTOP_ACTIVATION_PIN_SECRET` | absent | absent | absent | absent | not configured | absent |
| `DESKTOP_DEVICE_TOKEN_SECRET` | absent | absent | absent | absent | not configured | absent |
| `AUTH_SECRET` | present | present | present | absent | one shared record across all scopes | older than 90 days |
| `OPS_USER_IDS` | absent | absent | absent | absent | not configured | absent |
| `OPS_USERNAME` | present | present | present | absent | one shared record across all scopes | older than 90 days |
| `OPS_PASSWORD` | present | present | present | absent | one shared record across all scopes | older than 90 days |
| `OPS_AUTO_SEED` | absent | present | present | absent | one shared Preview/Production record | 60-90 days |
| `SUPABASE_URL` | absent | present | present | absent | one shared Preview/Production record | 60-90 days |
| `SUPABASE_SERVICE_ROLE_KEY` | absent | present | present | absent | one shared Preview/Production record | 60-90 days |

The shared Vercel entry for each database URL is sufficient evidence that the
current Preview deployment does not have an independent database connection.
There was no reason to retrieve either secret value merely to compare them.

The shared Supabase service-role configuration is also a material isolation
risk: changing only the PostgreSQL URLs would still leave Preview code capable
of reaching Production Storage through server-side upload paths.

## Original Isolation Failure

Current Production/Preview separation: `FAIL`

Blocking conditions:

- Preview and Production share `DATABASE_URL`.
- Preview and Production share `DIRECT_URL`.
- Preview and Production share `AUTH_SECRET`.
- Preview and Production share legacy ops bootstrap credentials.
- Preview and Production share Supabase service-role access.
- The feature branch has no variable override.
- Both desktop activation secrets are missing.

Consequences:

- Preview database migration is prohibited.
- Preview database preflight is prohibited.
- Real test PIN generation is prohibited.
- Windows full activation is prohibited.
- The existing Preview deployment must not be used as a database-isolated test
  environment.

## Provider And Current Connection Convention

Database provider: `Supabase PostgreSQL`

Evidence:

- Vercel contains Supabase URL and service-role variable names.
- `prisma.config.ts` documents a split runtime/migration connection model.
- `lib/prisma.ts` uses Prisma 7, `@prisma/adapter-pg`, and a bounded `pg.Pool`.

Current repository convention:

- `DATABASE_URL`: serverless application runtime connection.
- `DIRECT_URL`: migration and administrative session connection.
- Prisma migration commands must override `DATABASE_URL` with `DIRECT_URL`
  because Prisma 7 reads the configured datasource URL from `DATABASE_URL`.

Supabase documents transaction-mode pooler port `6543` for serverless traffic
and direct PostgreSQL port `5432` for migrations and native tooling. Direct
connectivity is IPv6 unless the project has the relevant IPv4 capability. If
the trusted migration runner cannot reach the direct endpoint, a documented
session-mode pooler on port `5432` is the only acceptable fallback; transaction
mode is not acceptable for migration operations.

Official references:

- [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase project compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute)

Preview Connection Model: `BLOCKED` until independent credentials exist and
direct endpoint reachability is verified.

## Architecture Options

### Option A - New Supabase Project

Decision: `RECOMMENDED`

Create a new, empty Supabase project in the same organization, with its own
project identity, PostgreSQL instance, database password, pool URL, direct URL,
API URL, service-role key, and lifecycle.

Advantages:

- Strongest and easiest-to-audit Production boundary.
- Empty-database migration chain is deterministic.
- No shared ledger, schema, table prefix, tenant namespace, or customer data.
- No automatic branch merge path to Production.
- Clear credential revocation and project-destruction boundary.

Cost level: `LOW TO MEDIUM`.

Supabase currently bills each additional project for compute usage. The
published Micro compute reference is approximately USD 10 per full month,
excluding organization plan and other usage. Actual cost must be confirmed in
the organization's billing page before creation.

### Option B - New PostgreSQL Instance At Another Provider

Decision: `VALID BUT NOT MINIMAL`

This can provide full isolation, but it adds provider onboarding, networking,
TLS, backup, monitoring, and compatibility work without solving a requirement
that Supabase cannot already satisfy.

### Option C - Supabase Persistent Branch

Decision: `ACCEPTABLE FALLBACK`

Supabase documents branches as separate, data-less environments with their own
database instance and credentials. A persistent branch is suitable for QA and
does not auto-delete on pull-request closure.

It is not the primary recommendation here because it remains coupled to the
Production project's branching and deployment lifecycle. This repository uses
Prisma migration history rather than a Supabase-native migration workflow, and
Production migration application must stay an explicit Founder-controlled
operation.

If Option C is selected, require a persistent, data-less branch, unique
credentials, no Production seed, no automatic Production migration on merge,
and an explicit deletion date.

Official references:

- [Supabase branching](https://supabase.com/docs/guides/deployment/branching)
- [Supabase branch isolation](https://supabase.com/docs/guides/deployment/branching/working-with-branches)
- [Supabase branching cost](https://supabase.com/docs/guides/platform/manage-your-usage/branching)

## Recommended Target Architecture

Production remains unchanged:

- Existing Production Supabase project.
- Existing Production pool URL and direct URL.
- Existing Production auth and integration secrets.
- Existing Production ledger and customer data.

Preview receives:

- New empty Supabase project.
- Preview-only transaction pool URL for Vercel runtime.
- Preview-only direct/session URL for Prisma migrations.
- Preview-only Supabase URL and service-role key.
- Preview-only auth secret.
- Separate Preview activation PIN HMAC secret.
- Separate Preview device-token HMAC secret.
- FK-backed test OpsAdmin.
- Synthetic tenants, stores, subscriptions, and devices only.

The following are expressly rejected:

- A test schema inside Production.
- Tenant-only separation inside Production.
- Table prefixes inside Production.
- A Production backup restored with customer data.
- Production credentials reused in Preview.

## Pool URL Strategy

`DATABASE_URL` must point only to the new Preview project.

Required properties:

- Supabase transaction-mode pooler suitable for Vercel serverless traffic.
- Port/mode verified as transaction pooling.
- Provider-required TLS enabled, normally `sslmode=require`.
- Project identity confirmed different from Production without recording the
  hostname or credential.
- `lib/prisma.ts` retains its current per-process pool cap of two connections.
- No URL is printed in build output, CI output, evidence, screenshots, or chat.

## Direct URL Strategy

`DIRECT_URL` must point only to the new Preview project.

Required properties:

- True direct PostgreSQL session on port `5432` when the trusted runner has
  compatible network connectivity.
- Provider-required TLS enabled.
- Never routed through transaction pooling.
- Used only from an approved migration workstation or protected migration job.
- Stored as a Preview-sensitive variable and in the approved secret manager.
- Never used by browser code or exposed through a `NEXT_PUBLIC_` variable.

Migration command convention:

```bash
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
```

No real URL should appear in shell history, process logs, or evidence. Load it
from the approved secret source in the trusted execution environment.

## Preview Secret Strategy

Generate independent, cryptographically random values in the approved password
manager or secret manager. Do not derive them from Production or reuse the
literal CI test values committed in the workflow.

Preview-only secrets:

- `DESKTOP_ACTIVATION_PIN_SECRET`: independent HMAC secret.
- `DESKTOP_DEVICE_TOKEN_SECRET`: different independent HMAC secret.
- `AUTH_SECRET`: independent session-signing secret.
- `OPS_PASSWORD`: temporary or test-only bootstrap credential.
- `SUPABASE_SERVICE_ROLE_KEY`: key belonging only to the Preview project.

Each HMAC/session secret should have at least 32 bytes of random entropy. Values
must not be placed on command lines, committed files, tickets, evidence, build
logs, screenshots, or chat.

Rotation rules:

- Rotate all Preview secrets when the Preview project is recreated.
- Rotate immediately after suspected exposure.
- Treat device-token secret rotation as invalidating existing test devices.
- Treat auth-secret rotation as invalidating Preview sessions.
- Never rotate a Production secret as part of Preview teardown.

## Preview OpsAdmin Strategy

Current result: `NOT READY`

The Preview database does not yet exist, so there is no FK-backed Preview
OpsAdmin to validate.

Required identity:

- Real row in `OpsAdmin`.
- Role `OPS_ADMIN` or `SUPER_ADMIN`.
- Status `ACTIVE`.
- `lockedUntil` null or in the past.
- Session `userId` exactly equal to `OpsAdmin.id`.
- Session `opsRole` exactly equal to the row role.
- Session version exactly equal to `OpsAdmin.sessionVersion`.
- No `_ops_admin` identity and no `OPS_USER_IDS` whitelist substitution.

Minimal bootstrap path using existing code:

1. Configure branch-specific, test-only `OPS_USERNAME`, `OPS_PASSWORD`, and
   `OPS_AUTO_SEED=true` after the Preview schema exists.
2. Redeploy Preview and perform one controlled ops login.
3. Verify a real `SUPER_ADMIN` row was created and the returned session is
   FK-backed.
4. Set the branch-specific `OPS_AUTO_SEED=false`.
5. Rotate the environment bootstrap password to an inert random value while
   retaining the actual test login credential only in the approved password
   manager.
6. Redeploy and verify the FK-backed session again.

This plan avoids changing Production bootstrap variables. A future dedicated
admin-provisioning command is preferable, but is outside this package.

## Synthetic Test Data Plan

Use deterministic, non-personal identifiers so cleanup is auditable:

| Entity | Fixed test identifier |
| --- | --- |
| Tenant | `preview-e1-tenant` |
| Store | `preview-e1-store` |
| Store code | `PREV06C` |
| Owner | `preview-e1-owner` |
| OpsAdmin | `preview-e1-ops-admin` or database-generated ID recorded securely |
| Subscription | tenant `preview-e1-tenant`, status `ACTIVE` |
| Windows installation | `preview-e1-windows-device-01` |

Allowed data:

- Synthetic names and IDs.
- Synthetic subscription dates.
- Synthetic device installation identifier.
- Generated test PIN used only during the live activation session.

Prohibited data:

- Production tenant, store, user, customer, order, or sale rows.
- Real phone numbers or messaging identities.
- Production tokens, PINs, device identifiers, or passwords.
- Production backups unless a separately approved anonymization program exists.

Evidence may record test entity IDs and counts, but never the PIN, raw device
token, secret, session cookie, password, or connection string.

## Provisioning Steps

These steps require an authorized infrastructure operator. They were not
executed in this package.

1. Confirm budget, organization, region, owner, and deletion date.
2. Create a new empty Supabase project; do not restore or clone Production data.
3. Restrict project membership to the deployment operator and independent
   reviewer.
4. Store the project identity and credentials only in the approved secret
   manager.
5. Collect the transaction-pool URL, direct URL, API URL, and service-role key.
6. Confirm the project identity differs from Production using redacted
   fingerprints; do not print either identifier.
7. Verify direct endpoint reachability from the trusted migration runner.
8. Verify TLS and connection modes without running DDL.
9. Confirm the database has no application tables and no Prisma ledger.
10. Record the retention and teardown owner before migration begins.

Cost control:

- Start with the smallest supported compute size.
- Review the provider's upcoming invoice immediately after provisioning.
- Set a calendar expiration for the environment.
- Delete the project after the evidence-retention window.

## Vercel Configuration Steps

Use Vercel's dashboard for the first configuration so overlapping scopes are
visible. Do not force-edit the existing shared records in this package.

Add sensitive Preview variables restricted to Git branch
`feat/ep-mb3-06c-activation-pin-console`:

- `DATABASE_URL`
- `DIRECT_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DESKTOP_ACTIVATION_PIN_SECRET`
- `DESKTOP_DEVICE_TOKEN_SECRET`
- `AUTH_SECRET`
- `OPS_USERNAME`
- `OPS_PASSWORD`
- `OPS_AUTO_SEED`
- `TENANT_ID`
- `DEFAULT_STORE_CODE`

Recommended verification sequence:

1. Capture a name/scope-only Production inventory before changes.
2. Add branch-specific Preview overrides without changing Production values.
3. Run `vercel env ls preview feat/ep-mb3-06c-activation-pin-console` and verify
   every required variable appears; do not pull values.
4. Confirm the generic shared Production records remain unchanged.
5. Do not redeploy until the independent database migration is complete.
6. Redeploy only the feature-branch Preview.
7. Inspect the new deployment metadata and verify branch and commit.
8. Verify runtime database identity using a redacted server-side health signal,
   never by returning a hostname or connection string.
9. Confirm build and function logs contain no variable values.

For an authorized operator using the CLI interactively, use the branch-specific
form below and enter each value only at the secure prompt:

```bash
vercel env add VARIABLE_NAME preview feat/ep-mb3-06c-activation-pin-console --sensitive
```

Do not use `--value`, command substitution, environment dumps, or piped secret
files in shared terminal history.

The broader Preview environment still shares Telegram, printer, AI, payment,
and other integration settings. Those integrations must be disabled or assigned
test credentials before broad Preview QA. They are not required for the 06C
database isolation gate.

## Migration Initialization Plan

Run only after independent database and branch overrides are confirmed.

1. Read-only empty-database check: no application tables and no
   `_prisma_migrations` ledger.
2. Load `DIRECT_URL` and test secrets from the approved secret source.
3. Run `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy`.
4. Run `DATABASE_URL="$DIRECT_URL" npx prisma migrate status`.
5. Run drift check:

   ```bash
   DATABASE_URL="$DIRECT_URL" npx prisma migrate diff \
     --from-config-datasource \
     --to-schema prisma/schema.prisma \
     --exit-code
   ```

6. Repeat `migrate deploy` and require a no-op result.
7. Run `tests/migration-chain-smoke.test.ts` with the explicit database guard
   and Preview-only activation secrets.
8. Bootstrap and verify the FK-backed Preview OpsAdmin.
9. Create the fixed synthetic tenant, store, owner, and active subscription.
10. Run `tests/desktop-activation-runtime.test.ts` and
    `tests/desktop-activation-pin-console-api.test.ts` with their explicit test
    database guard.
11. Run the full read-only Preview preflight: ledger summary, CustomerOrder
    shape, indexes, foreign keys, checks, drift, counts, and PostgreSQL version.
12. Classify the post-migration database as `B. MIGRATION-CLEAN` only if status,
    drift, constraints, and repeated deploy all pass.
13. Redeploy the feature-branch Preview and verify the FK-backed ops login.
14. Generate one live test PIN without recording it.
15. Perform Windows activation and confirm PIN single-use behavior.

`prisma db push`, `prisma migrate dev`, `prisma migrate resolve`, and manual
ledger registration are prohibited.

## Cleanup And Teardown Plan

Per-test cleanup:

1. Revoke any active test PIN and clear its active slot.
2. Revoke the test DesktopDevice and invalidate its device token.
3. Delete synthetic activation audits, PINs, devices, subscription events,
   subscription, user-store roles, store, users, tenant, and test OpsAdmin in
   dependency-safe order.
4. Verify zero active PINs and zero active devices for the fixed test IDs.
5. Record counts only; do not record PIN or token material.

Environment teardown:

1. Set `OPS_AUTO_SEED=false` and revoke Preview sessions.
2. Rotate/revoke Preview database, auth, activation, device, and service-role
   credentials.
3. Disable access to the Preview deployment and remove branch aliases.
4. Delete or retire immutable Preview deployments that contain the old
   environment snapshot.
5. Remove branch-specific Vercel variables only after no Preview deployment can
   fall back to the generic Production-shared values.
6. Delete the Preview Supabase project after the evidence-retention window.
7. Verify Production variables, deployment, database, ledger, and data were not
   changed.

Retention recommendation:

- Delete synthetic runtime rows immediately after each test cycle.
- Keep the isolated environment through acceptance plus seven calendar days for
  reproducibility.
- Extend retention only with an owner and a new deletion date.
- Keep no backup containing PINs, tokens, passwords, or customer data.

Backup recommendation:

- Git migrations are the schema source of truth.
- No backup is required before first migration into an empty Preview database.
- For a long-lived Preview project, use provider daily backups when available;
  otherwise maintain a controlled logical backup containing synthetic data only.
- Never restore a Production backup into Preview.
- Supabase documents that project deletion also deletes provider-held backups,
  so deletion is irreversible.

Official reference:

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)

## Security Review

Result: `BLOCKED UNTIL PROVISIONED`

Required controls:

- Separate project, ledger, schema, database credentials, and service-role key.
- Preview-only auth, PIN HMAC, and device-token HMAC secrets.
- TLS required for pool and direct connections.
- Direct credentials restricted to migration operators.
- No secret in `NEXT_PUBLIC_*`, repository files, logs, evidence, or chat.
- FK-backed OpsAdmin session; no `_ops_admin` and no `OPS_USER_IDS` substitution.
- Synthetic data only.
- No automatic Production migration, merge, tag, release, or PIN generation.
- No branch-variable removal while a Preview deployment could fall back to the
  current Production-shared records.

Production untouched confirmation for this package:

- Production Vercel variables: not modified.
- Production database: not connected.
- Production migration ledger: not queried or modified.
- Production data: not read or copied.
- Production secrets: not pulled, printed, or rotated.
- Preview variables: not modified.
- Database provisioning: not performed.
- Migration/PIN/Windows activation: not performed.

## Readiness

Preview Database Isolation Ready: `NO`

Preview Connection Model: `BLOCKED`

Preview Ops Identity: `NOT READY`

Preview Migration Ready: `NO`

Real Test PIN Ready: `NO`

Ready To Provision Preview Database: `YES`, after Founder/infra-owner approval
of provider cost, region, access list, and deletion date.

Final recommendation:

- READY TO PROVISION PREVIEW DATABASE: `YES`
- READY FOR PREVIEW MIGRATION: `NO`
- READY TO GENERATE REAL TEST PIN: `NO`
- READY FOR WINDOWS FULL ACTIVATION: `NO`
