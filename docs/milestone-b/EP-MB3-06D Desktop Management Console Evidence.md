# EP-MB3-06D Desktop Management Console Evidence

Date: 2026-07-20

Status: REVIEW CLOSURE PASS

## Independent Review Closure

- Reviewed implementation commit: `904eb7bc91adbedb5a648f9b3c2807cb48714f39`
- Independent review result: `CONDITIONAL PASS`
- P0: NONE
- Closure package: `EP-MB3-06D-C1`
- Closure baseline: local and origin at reviewed commit, divergence `0 / 0`, clean worktree.
- P1-1 real database runtime/integration coverage: CLOSED.
- P2-1 FK-backed OpsAdmin guard for PIN issuance: CLOSED.
- P2-2 duplicate Heartbeat/Verification terminology: CLOSED.
- P2-3 derived verification audit labeling: CLOSED.
- P2-4 revocation error messaging: CLOSED.
- P2-5 state-specific PIN blocking reason: CLOSED.

## Repository Baseline

- Repository: `/Users/jason/light-ops-assistant`
- Branch: `feat/ep-mb3-06c-activation-pin-console`
- Starting HEAD: `2738d6b0d774b194214cc10d6a3f4a1272119457`
- Starting worktree: clean
- Production, Staging, Preview variables, databases, deployments, migrations, and protection settings were not accessed or changed.

## Productized Routes

- `/ops` contains the normal `Desktop` menu entry.
- `/ops/desktop` redirects to `/ops/desktop/activation`.
- `/ops/desktop/activation` provides store discovery and one-time PIN issuance.
- `/ops/desktop/devices` provides device discovery and reason-gated revocation.
- `/ops/desktop/audit` provides a safe audit timeline.
- `/ops/desktop/runtime` provides fleet/runtime health.
- Legacy `/ops/desktop-activation` redirects to the normal Activation route and is no longer required knowledge.

## Management Read Model

The existing Desktop activation, verification, merchant device, token, subscription, and runtime APIs were not modified. A separate Ops-only management adapter was added because the existing device endpoint is merchant OWNER scoped and there was no cross-tenant Ops read model.

`GET /api/ops/desktop-management` supports:

- `view=activation` (and compatibility alias `view=stores`): store code/name/tenant search, pagination, subscription, desktop counts, activation state, current PIN state, latest verification, runtime target, and Desktop target.
- `view=devices`: search, status filtering, pagination, short device reference, activation and latest verification timestamps, subscription, and revocation capability.
- `view=audit`: search, event filtering, pagination, and safe operator-facing labels.
- `view=runtime`: runtime/client target, fleet status counts, and latest verification.

`POST /api/ops/desktop-management/devices/[id]/revoke` is an Ops-only revocation adapter. The URL value is an eight-character device reference, resolved server-side with ambiguity rejection. It requires an enabled FK-backed OpsAdmin identity and writes the existing Desktop revocation state and audit model in one transaction.

## Permission And Security

- UI and management APIs permit only `OPS_ADMIN` and `SUPER_ADMIN`.
- Merchant OWNER, STAFF, BD, unauthenticated, and disabled OpsAdmin access remains rejected.
- The management response does not expose device token, bearer token, PIN history, PIN hash, installation hash, connection string, metadata, secret, or full device ID.
- PIN generation calls `/api/ops/desktop-activation`; the route now requires a signed, versioned, ACTIVE, unlocked, FK-backed OpsAdmin identity before calling the unchanged PIN issuance service.
- Legacy `_ops_admin` and `OPS_USER_IDS` synthetic identities retain the existing read-only management policy but are rejected from PIN issuance and revocation with `OPS_ADMIN_IDENTITY_REQUIRED`.
- PIN plaintext exists only in component state after a successful issuance response.
- PIN display is one-time, copy is explicit, and close clears the value from state.
- No browser storage, server log, audit metadata, or repository evidence stores the PIN.
- Subscription-blocked stores cannot generate a PIN and provide a link to the existing subscription management page.
- Device revocation requires an explicit confirmation and a reason of 3 to 500 characters.

## Real Database Test Matrix

The test database was a fresh, isolated PostgreSQL cluster under `/private/tmp`. Prisma deployed all 46 historical migrations from an empty database. Migration status was current and drift was `NONE`. Prisma was not mocked.

Management GET coverage for Activation, Devices, Audit, and Runtime:

- unauthenticated and merchant OWNER rejected;
- OPS_ADMIN and SUPER_ADMIN accepted;
- disabled, stale-session, and locked OpsAdmin rejected;
- legacy synthetic identity accepted under the existing read-only policy;
- no-store headers on success and failure;
- store/tenant/device mapping, search, pagination, status filters, and page-size cap;
- unknown Desktop/Windows telemetry remains `null` / `NOT_REPORTED`;
- no PIN hash, token, token hash, installation hash, metadata, cookie, secret fixture value, or full device ID in responses.

Ops revocation coverage:

- successful revocation, reason persistence, FK-backed `actorOpsAdminId`, and one `DEVICE_REVOKED` audit;
- token/hash omitted from response;
- revoked credential rejected by both verify and status endpoints;
- unauthenticated/non-Ops rejection and legacy identity fail-closed;
- 404 missing reference, 409 ambiguous short reference, and invalid reason;
- idempotent repeat does not duplicate audit or overwrite the original reason;
- forged cross-tenant body input cannot alter another tenant's device;
- forced audit insert failure rolls back the device update.

PIN identity coverage:

- valid OPS_ADMIN and SUPER_ADMIN issuance remains successful;
- `_ops_admin` and `OPS_USER_IDS` synthetic identities return stable `403 OPS_ADMIN_IDENTITY_REQUIRED`;
- identity rejection creates no PIN or audit side effect.

## Cloud CI Gate

`.github/workflows/cloud-ci.yml` now triggers for Desktop management/Ops route, UI, helper, and test changes. After PostgreSQL service health and `prisma migrate deploy`, the blocking gate runs domain/static management tests and the real database management API suite. Existing real database PIN console tests now include the OpsAdmin identity guard cases. The workflow contains no `db push`, `migrate resolve`, `|| true`, Staging/Production connection, or secret output.

## UI Acceptance

Founder workflow is available through the normal menu:

1. Sign in to Operations Console.
2. Select `Desktop`, then `Activation`.
3. Search by store code, store name, or tenant.
4. Review subscription and Desktop readiness, then generate one PIN through the existing backend.
5. Select `Devices` to review the activated device and revoke it with a reason.
6. Select `Audit` to review lifecycle events.
7. Select `Runtime` to review fleet state and current runtime/Desktop targets.

Production-mode Playwright visual review passed for desktop Activation, desktop Devices, and 390px mobile Runtime. The mobile navigation remains fully visible and the page has no horizontal overflow.

## Verification

Passed:

- `npm run build`
- `npx tsc --noEmit --incremental false --pretty false`
- `npx tsx tests/desktop-activation-pin-console-static.test.ts`
- `npx tsx tests/ops-desktop-management-domain.test.ts`
- `npx tsx tests/ops-desktop-management-static.test.ts`
- `npx tsx tests/desktop-activation-security-static.test.ts`
- `npx tsx tests/desktop-activation-concurrency-static.test.ts`
- `npx tsx tests/desktop-activation-runtime.test.ts` (isolated PostgreSQL)
- `npx tsx tests/desktop-activation-pin-console-api.test.ts` (isolated PostgreSQL)
- `npx tsx tests/ops-desktop-management-api.test.ts` (isolated PostgreSQL)
- `npx tsx tests/migration-chain-smoke.test.ts` (isolated PostgreSQL)
- subscription, Telegram, customer display, customer landing, HRT contract, and staging bootstrap regressions
- `SMOKE_BASE_URL=http://localhost:3100 npx playwright test tests/ops-desktop-management-ui.spec.ts --project=chromium --reporter=list` (`3 passed`)

The Playwright suite is local-only and mocks Ops authentication, store/device/audit/runtime data, PIN issuance, and revocation. The fake PIN is test fixture data and was never sent to an external environment.

## Scope Confirmation

- Activation backend rewrite: NONE
- Public/merchant Activation API modification: NONE
- Ops PIN endpoint modification: FK-backed identity guard only
- PIN issuance service modification: NONE
- Prisma schema modification: NONE
- Migration added or modified: NONE
- Device token modification: NONE
- Activation Runtime modification: NONE
- Subscription logic modification: NONE
- Deployment, seed, migration, or variable change: NONE
- Real PIN issuance or device revocation: NONE
- Windows activation: NONE
- Production access: NONE

## Known Data Limits

- The current schema does not store operator-friendly device name, per-device Desktop version, or Windows version. The console derives `Desktop <short reference>` and reports missing version telemetry as `未上报`; it does not invent values.
- `lastSeenAt` is the existing credential-verification timestamp and is presented only as Last Verification. Independent heartbeat telemetry remains unavailable.
- OFFLINE is derived when no verification exists or the latest verification is more than 24 hours old.
- The current audit schema does not persist every successful verification as an audit row. The timeline marks the latest event derived from `lastSeenAt` as `Derived from latest verification`.

## Result

EP-MB3-06D productization acceptance: PASS.

Ready for independent re-review: YES.

Ready for Staging deployment: YES, subject to independent re-review approval.

Ready for Founder UI acceptance: YES.

Ready to generate the first Staging PIN: NO.

Ready for Windows full activation: NO.

Ready for EP-MB3-06D final acceptance: NO, pending independent re-review.

Ready for merge: NO.
