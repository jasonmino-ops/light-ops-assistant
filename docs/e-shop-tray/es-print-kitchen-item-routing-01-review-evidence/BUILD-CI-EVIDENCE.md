# ES-PRINT-KITCHEN-ITEM-ROUTING-01 Build and CI Evidence

Date: 2026-09-14

## Governance Registration

- `./scripts/check-release-lineage.sh <production-sha>` in the clean governance worktree: PASS.
- Exception JSON parse and strict `validateException`: PASS.
- `node scripts/guards/check-change-scope.test.js`: 70/70 PASS.
- Governance commit: `942fb4b84ca0dba8e484833c528600a39a03178c`.
- Registration commit ancestor of trusted `origin/main`: YES.
- Main diff from pre-registration SHA: one added exception JSON only.
- Governance worktree: CLEAN.

## Candidate Verification

- Post-sync protected SHA recheck: 4/4 exact.
- Task-scoped Scope Guard over all 21 implementation/test candidate files: PASS.
- `DATABASE_URL=<local-placeholder> npx prisma generate`: PASS; no database connection or migration.
- `DATABASE_URL=<local-placeholder> npx prisma validate`: PASS.
- `npx tsc --noEmit --incremental false`: PASS.
- `npm --prefix e-shop-tray run typecheck`: PASS.
- `npm --prefix e-shop-tray run compile`: PASS.
- `npm run build`: PASS; Next.js 15.5.14 production build generated 179 routes/pages.
- `git diff --check`: PASS.

## Focused Tests

- `npx tsx tests/cashier-network-confirmation.test.ts`: 7 PASS.
- `npx tsx tests/product-recommendation-v01.test.ts`: PASS.
- `npx tsx tests/es-tray-device-print-contract.test.ts`: 35 PASS, including the latest approved Cashier byte hash.
- Local test DB `tests/cashier-network-print-v01.test.ts`: 30/30 PASS.
- Local test DB `tests/network-print-jobs-api.test.ts`: 20/20 PASS.
- Temporary PostgreSQL was stopped normally with `pg_ctl`; no force kill or deletion.

## ROOT CORE

Command: `npm run test:core`

Evidence: `test-results/test-evidence/root-lanes/20260914T095150Z-942fb4b84ca0/`

- Expected / collected / executed: 73 / 73 / 73.
- Passed: 71.
- Known failure: `KTF-20260912-07 tests/subscription-expiry-reminder.test.ts` fixed-date expectation.
- Recovered prior failure: `KTF-20260912-01 tests/browser-print-readiness.test.ts`.
- New runner failure: `tests/cashier-realtime-integration.test.ts`, classified `NOT_IN_ACTIVE_BASELINE`.
- Cause: that historical task test requires `git diff --name-only HEAD` to contain only its own allowlist, so any legitimate uncommitted feature candidate fails it.
- Environment health: PASS.
- Overall runner result: BLOCKED.

No test was modified to hide this result, and no synthetic Git environment was used.

## External CI and Deployments

- GitHub/Vercel feature CI: NOT RUN because feature push is not authorized.
- Preview deploy: NOT RUN / NOT AUTHORIZED.
- Production deploy or migration: NOT RUN / NOT AUTHORIZED.
- Read-only Production deployment check after governance merge: still READY at `a33b44c1c51223009326c4869526f7de6bd4a89d`.
