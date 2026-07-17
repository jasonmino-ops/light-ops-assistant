# EP-MB3-06A Scope Boundary Audit

## Implemented Scope

- Cloud Desktop activation identity API namespace under `/api/desktop/*`.
- New Prisma models:
  - `DesktopDevice`
  - `DesktopActivationPin`
  - `DesktopActivationAudit`
- HMAC hashing helpers for device token, installation id, activation PIN, and audit request fingerprints.
- Subscription access helper for current subscription status strings.
- Static and unit tests for token/PIN security, subscription mapping, no legacy POS auth import, and concurrency invariants.

## Explicit Non-Goals

No Electron, Desktop UI, Runtime Core, Provider, local SQLite, safeStorage, scanner, printing, dual screen, payment, BindToken, old POS authorization, customer H5, `/desktop` behavior, `/cashier` settlement logic, invite, table QR, or order-state flow was modified.

## Files Modified Outside 06A Namespace

- `prisma/schema.prisma` - required to add the new identity data model.
- `tests/subscription-lifecycle.test.ts` - changed one regex from dotAll `s` flag to `[\s\S]` so `npx tsc --noEmit` passes under the repository ES2017 target. Runtime subscription logic was not changed.

## Forbidden Boundary Checks

- No changes under `desktop/`.
- No changes to `app/cashier`, `app/desktop`, `/menu`, `/m/[storeCode]`, `/invite`, `/table-qrcodes`, `/records`, `/products`, Telegram auth, or order-state routes.
- New `/api/desktop/*` code does not import `lib/desktop-pos-auth.ts`.
- New `/api/desktop/*` code does not call `authorizeDesktopPosRequest` or `allowStoreCodeFallback`.
