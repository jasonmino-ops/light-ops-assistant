# EP-MB3-06C Activation PIN Issuance Console Evidence

Date: 2026-07-19

Status: READY WITH CONDITIONS

## Readiness Review

Repository baseline:

- Current package branch before implementation: `feat/ep-mb3-07b1-deployment-diagnostics`
- `origin/main`: `15dad1aae9972046258857985469ce13e51349e6`
- Implementation branch: `feat/ep-mb3-06c-activation-pin-console`
- Branch baseline and merge-base: `15dad1aae9972046258857985469ce13e51349e6`
- Workspace before implementation: clean

Search scope covered:

- `DesktopActivationPin`
- `DesktopActivationAudit`
- `DesktopDevice`
- `generate activation pin`
- `issue activation pin`
- `create activation pin`
- `activation PIN`
- `desktop activation`
- `admin activation`
- `ops activation`
- `storeCode`
- `/api/desktop`
- `activate`
- `verify`
- `revoke`

## Existing EP-MB3-06A Capability

Existing models:

- `DesktopDevice`
- `DesktopActivationPin`
- `DesktopActivationAudit`

Existing Cloud APIs:

- `POST /api/desktop/activation-pins`
- `POST /api/desktop/activation-pins/[id]/revoke`
- `POST /api/desktop/activate`
- `POST /api/desktop/auth/verify`
- `GET /api/desktop/device/status`
- `GET /api/desktop/devices`
- `POST /api/desktop/devices/[id]/revoke`

Existing security semantics confirmed:

- PINs are 6 digit numeric strings.
- PIN creation uses CSPRNG `crypto.randomInt(0, 1_000_000)` and `padStart(6, '0')`.
- PINs are stored as HMAC only in `DesktopActivationPin.pinHash`.
- Device tokens are stored as HMAC only in `DesktopDevice.tokenHash`.
- PIN and device token secrets are separate.
- Activation consumes a PIN and returns a raw device token once.
- Device verify/status do not authorize by `storeCode`.
- All `/api/desktop/*` responses use `Cache-Control: no-store, max-age=0`.
- Subscription policy allows `TRIAL` and `ACTIVE`, blocks `EXPIRED` and `CANCELLED`.
- Existing activation tests cover lockout, expiry, single-use, token rotation, revoke, and cross-store installation conflicts.

## Gap Confirmed

The repository already had a merchant OWNER PIN creation API, but no ops/admin console where internal operators can select a store by `storeCode`, inspect store/subscription state, generate a new one-time PIN, and copy it for Windows Desktop field activation.

The existing merchant API was not sufficient for this field run because the requested operational path requires an ops/admin-only entry point and must not rely on ordinary merchant users.

## Implementation

Added a minimal internal console:

- Page: `/ops/desktop-activation`
- API: `GET /api/ops/desktop-activation?storeCode=<STORE_CODE>`
- API: `POST /api/ops/desktop-activation`

Refactored the existing 06A PIN issuance logic into:

- `lib/desktop-activation/pin-issuance.ts`

Both the existing merchant route and the new ops route call this shared service. The service owns:

- CSPRNG PIN creation
- HMAC hash creation
- 24 hour expiry
- single active PIN invalidation
- subscription enforcement
- `PIN_CREATED` audit writes
- `PIN_CREATE_DENIED` audit writes
- conflict mapping to `CONFLICT_RETRY_REQUIRED`

## Authorization Boundary

The ops API requires:

- a valid ops session from `checkOpsAuthContext(req)`
- role rank `OPS_ADMIN` or higher via `hasOpsRole(ops.role, 'OPS_ADMIN')`

Rejected:

- unauthenticated callers
- merchant OWNER callers
- STAFF callers
- `BD` ops role callers
- malformed `storeCode`
- nonexistent stores
- inactive tenants
- inactive stores
- stores without an active OWNER user for the required `DesktopActivationPin.createdByUserId` foreign key

No public anonymous PIN-generation endpoint was added.

## PIN Security Semantics

The console:

- returns the raw PIN only in the successful POST response
- does not return PIN from GET
- does not write PIN to URL
- does not write PIN to `localStorage`
- does not write PIN to `sessionStorage`
- does not log PIN with `console`
- does not return device token, token hash, PIN hash, installation hash, or internal stack
- clears the displayed PIN when store context changes
- loses displayed PIN on refresh by relying only on in-memory React state
- performs copy only on explicit button click

Database behavior:

- `DesktopActivationPin.pinHash` stores HMAC only.
- New PIN issuance revokes any existing active PIN for the target store.
- The unique active slot remains `@@unique([storeId, activeSlot])`.

## Subscription Enforcement

The shared issue service calls `resolveDesktopSubscriptionAccess`.

Allowed:

- `TRIAL`
- `ACTIVE`

Blocked:

- `EXPIRED`
- `CANCELLED`
- unknown states

The GET status route reads subscription state without lazy-migration side effects. PIN generation still uses the frozen 06A subscription access helper.

## Audit Evidence

Successful ops issuance writes:

- `DesktopActivationAudit.eventType = PIN_CREATED`
- `result = SUCCESS`
- `reasonCode = OPS_ISSUED`
- metadata allowlist only:
  - `expiresAt`
  - `accessState`
  - `status`
  - `reason = OPS_CONSOLE`
  - `eventVersion = EP-MB3-06C`

Blocked subscription writes:

- `DesktopActivationAudit.eventType = PIN_CREATE_DENIED`
- `result = DENIED`
- `reasonCode = SUBSCRIPTION_BLOCKED`

No raw PIN is written to audit metadata.

Note: the frozen schema requires `DesktopActivationPin.createdByUserId` to reference a merchant `User`, while ops sessions use `OpsAdmin`. To avoid a database schema change, ops issuance uses the target store's active OWNER user as the required PIN creator foreign key and marks the action with `OPS_ISSUED` / `OPS_CONSOLE` in activation audit.

## No-Store / Logging Review

Confirmed:

- ops API uses `noStoreJson` / `apiError`
- responses include `Cache-Control: no-store, max-age=0`
- shared issuance service does not call `console`
- shared issuance service does not write `OperationLog`
- frontend does not call `console`
- frontend does not use browser persistent storage

## Tests

Passed:

- `npx tsc --noEmit`
- `npx tsx tests/desktop-activation-pin-console-static.test.ts`
- `npx tsx tests/desktop-activation-security-static.test.ts`
- `npx tsx tests/desktop-activation-crypto.test.ts`
- `npx tsx tests/desktop-activation-subscription.test.ts`
- `npx tsx tests/desktop-activation-concurrency-static.test.ts`
- `npm run build`

Added:

- `tests/desktop-activation-pin-console-static.test.ts`
- `tests/desktop-activation-pin-console-api.test.ts`

Not executed in this environment:

- `npx tsx tests/desktop-activation-pin-console-api.test.ts`
- `npx tsx tests/desktop-activation-runtime.test.ts`

Reason:

- current shell does not set `DESKTOP_ACTIVATION_TEST_DATABASE=1`
- database tests intentionally fail closed without an explicit test database switch

## Build

`npm run build`: PASS

Next.js route table includes:

- `/ops/desktop-activation`
- `/api/ops/desktop-activation`

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

Risk level: medium-low

Reason:

- Changes are limited to Desktop activation issuance and ops UI.
- No database schema change.
- No Windows Desktop runtime change.
- No cashier, customer H5, invite, QR code, records, products, auth, order status, or sale write-flow changes.

Residual risks:

- Database-level API test was added but not executed because no explicit test database switch is present.
- Ops audit actor cannot directly reference `OpsAdmin` without changing the frozen schema.
- Full Windows activation remains pending.

## Recommendation

READY TO GENERATE A REAL TEST PIN: YES

READY FOR WINDOWS FULL ACTIVATION TEST: NO

READY FOR EP-MB3-06C ACCEPTANCE: NO

READY FOR EP-MB3-07B1 ACCEPTANCE: NO
