# EP-MB3-06D Desktop Management Console Evidence

Date: 2026-07-20

Status: PASS

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

- `view=stores`: store code/name/tenant search, pagination, subscription, desktop counts, activation state, current PIN state, latest verification, runtime target, and Desktop target.
- `view=devices`: search, status filtering, pagination, short device reference, activation/heartbeat/verification timestamps, subscription, and revocation capability.
- `view=audit`: search, event filtering, pagination, and safe operator-facing labels.
- `view=runtime`: runtime/client target, fleet status counts, and latest verification.

`POST /api/ops/desktop-management/devices/[id]/revoke` is an Ops-only revocation adapter. The URL value is an eight-character device reference, resolved server-side with ambiguity rejection. It requires an enabled FK-backed OpsAdmin identity and writes the existing Desktop revocation state and audit model in one transaction.

## Permission And Security

- UI and management APIs permit only `OPS_ADMIN` and `SUPER_ADMIN`.
- Merchant OWNER, STAFF, BD, unauthenticated, and disabled OpsAdmin access remains rejected.
- The management response does not expose device token, bearer token, PIN history, PIN hash, installation hash, connection string, metadata, secret, or full device ID.
- PIN generation calls the existing `/api/ops/desktop-activation` backend.
- PIN plaintext exists only in component state after a successful issuance response.
- PIN display is one-time, copy is explicit, and close clears the value from state.
- No browser storage, server log, audit metadata, or repository evidence stores the PIN.
- Subscription-blocked stores cannot generate a PIN and provide a link to the existing subscription management page.
- Device revocation requires an explicit confirmation and a reason of 3 to 500 characters.

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
- `SMOKE_BASE_URL=http://localhost:3100 npx playwright test tests/ops-desktop-management-ui.spec.ts --project=chromium --reporter=list` (`3 passed`)

The Playwright suite is local-only and mocks Ops authentication, store/device/audit/runtime data, PIN issuance, and revocation. The fake PIN is test fixture data and was never sent to an external environment.

## Scope Confirmation

- Activation backend rewrite: NONE
- Existing Activation API modification: NONE
- Prisma schema modification: NONE
- Migration added or modified: NONE
- Device token modification: NONE
- Activation Runtime modification: NONE
- Subscription logic modification: NONE
- Deployment, seed, migration, or variable change: NONE
- Real PIN issuance or device revocation: NONE
- Production access: NONE

## Known Data Limits

- The current schema does not store operator-friendly device name, per-device Desktop version, or Windows version. The console derives `Desktop <short reference>` and reports missing version telemetry as `未上报`; it does not invent values.
- `lastSeenAt` is the existing credential-verification timestamp and is presented as both Last Heartbeat and Last Verification.
- OFFLINE is derived when no verification exists or the latest verification is more than 24 hours old.
- The current audit schema does not persist every successful verification as an audit row. The timeline derives the latest verification event per device from `lastSeenAt`.

## Result

EP-MB3-06D productization acceptance: PASS.

Ready for Founder acceptance: YES.

