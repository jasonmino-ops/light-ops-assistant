# EP-MB3-06A Scope Boundary Audit

## Implemented Scope

- Cloud Desktop activation identity API namespace under `/api/desktop/*`.
- New Prisma models:
  - `DesktopDevice`
  - `DesktopActivationPin`
  - `DesktopActivationAudit`
- HMAC hashing helpers for device token, installation id, activation PIN, and audit request fingerprints.
- Subscription access helper for current subscription status strings.
- Static, unit, and real PostgreSQL runtime tests for token/PIN security, subscription mapping, no legacy POS auth import, activation, audit regression, and concurrency invariants.
- GitHub Actions Cloud CI for the 06A API, desktop activation helpers, Prisma schema, and 06A tests.

## Explicit Non-Goals

No Electron, Desktop UI, Runtime Core, Provider, local SQLite, safeStorage, scanner, printing, dual screen, payment, BindToken, old POS authorization, customer H5, `/desktop` behavior, `/cashier` settlement logic, invite, table QR, or order-state flow was modified.

## Files Modified Outside 06A Namespace

- `.github/workflows/cloud-ci.yml` - required so 06A paths run cloud CI with a temporary PostgreSQL service.
- `prisma/schema.prisma` - required to add `DesktopDevice.tokenVersion`.
- `prisma/migrations/20260717110000_add_desktop_device_token_version/migration.sql` - incremental migration only; the original 06A migration was not rewritten.
- `docs/milestone-b/**` - updated the original 06A evidence pack and API contract.
- `tests/desktop-activation-*.test.ts` - 06A-only tests updated/added for the blocking fixes.

## Forbidden Boundary Checks

- No changes under `desktop/`.
- No changes to `app/cashier`, `app/desktop`, `/menu`, `/m/[storeCode]`, `/invite`, `/table-qrcodes`, `/records`, `/products`, Telegram auth, or order-state routes.
- New `/api/desktop/*` code does not import `lib/desktop-pos-auth.ts`.
- New `/api/desktop/*` code does not call `authorizeDesktopPosRequest` or `allowStoreCodeFallback`.
- No merge from `main` was performed.
- Historical migration drift was documented but not repaired in this scope.
