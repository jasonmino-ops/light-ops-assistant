# EP-MB3-06E Desktop Entry Integration Evidence

Date: 2026-07-20

Repository branch: `feat/ep-mb3-06c-activation-pin-console`

Baseline: `df1963a1040d747a4cf2289afbb4c9d254763b3c`

## Result

**PASS**

The existing Mini App `更多` menu now presents `Desktop` as its first item and
opens the existing Activation view directly. No Device Center landing page or
additional device category was introduced.

## Navigation

Founder workflow:

`更多` -> `Desktop` -> `Activation` -> `Generate Activation PIN`

- The menu target is `/ops/desktop/activation`.
- `/ops/desktop` continues to redirect directly to Activation.
- The existing `/ops/desktop-activation` compatibility route is unchanged.
- The visible Desktop tabs are ordered `Activation`, `Devices`, `Runtime`,
  `Audit`.
- Existing `/ops/desktop/*` browser, debugging, and fallback routes remain
  available.

## Reuse Boundary

The integration reuses the existing 06D implementation:

- `DesktopShell` and the four existing page components;
- Desktop management UI primitives, types, status mapping, and error mapping;
- `GET /api/ops/desktop-management`;
- `POST /api/ops/desktop-activation`;
- the existing device revoke adapter;
- existing no-store, Ops authentication, FK-backed identity, role, origin, and
  session-version enforcement;
- existing database integration coverage.

No backend route or business service was copied or rewritten.

## Mobile And Browser Verification

The local Playwright suite used intercepted local API responses and did not
connect to a remote environment.

- Telegram WebApp context at 390 x 844: `更多` shows Desktop first and opens
  Activation directly.
- Activation: Generate button is visible; existing one-time clear behavior
  remains covered with local route mocks.
- Devices: existing revoke reason and confirmation behavior passes with local
  route mocks.
- Runtime and Audit: both remain reachable and readable.
- 390 px horizontal overflow: none.
- Ordinary Chromium navigation: PASS.

No real PIN was generated, read, printed, logged, or recorded.

## Verification Results

- Ops/Desktop static regression: PASS.
- TypeScript (`npx tsc --noEmit`): PASS.
- Playwright Chromium: 4/4 PASS.
- Production build (`npm run build`): PASS.
- Built routes include `/ops`, `/ops/desktop`, and all four existing Desktop
  module routes.

## Changed Files

- `app/ops/page.tsx`
- `app/ops/desktop/_components/DesktopShell.tsx`
- `tests/ops-desktop-management-static.test.ts`
- `tests/ops-desktop-management-ui.spec.ts`
- `docs/milestone-b/EP-MB3-06E Desktop Entry Integration Evidence.md`

## Safety Statement

- No Device Center, Android, Printer, Scanner, or IoT UI was added.
- No authentication, origin guard, session, Desktop Runtime, Device Token,
  subscription, PIN issuance, or revoke backend behavior changed.
- No schema or migration changed.
- No migration, seed, deployment, real PIN issuance, or Windows activation was
  run.
- Production was not connected, queried, deployed, migrated, seeded, or
  changed.

## Remaining Risk

This commit has local static, browser, type, and build evidence. Remote Cloud CI
for the new commit and an independent code review remain pending. Founder field
acceptance remains a separate controlled Staging activity.

## Recommendation

**READY FOR INDEPENDENT REVIEW: YES**
