# EP-MB3-06A Review Manifest

Status: accepted / ready for merge
Baseline: `cf9b44faa172769ef46945d24a8208bdbb003713`
Branch: `feat/ep-mb3-06a-cloud-desktop-activation`

## Contents

- `../EP-MB3-06A-CLOUD-DESKTOP-ACTIVATION-API-CONTRACT.md` - route contract and security invariants.
- `SCOPE-BOUNDARY-AUDIT.md` - files touched and explicit non-goals.
- `SECURITY-EVIDENCE.md` - token, PIN, audit, and legacy-auth isolation evidence.
- `CONCURRENCY-EVIDENCE.md` - transaction locks, uniqueness, token rotation, and revoke behavior.
- `TEST-RESULTS.md` - local validation commands and results.
- `BLOCKING-FIXES.md` - Claude review fail result, root cause, and targeted blocker fixes.
- `../EP-MB3-06A Cloud Desktop Activation Identity Acceptance Record V1.0.md` - accepted scope, review closure, CI evidence, and compatibility boundary.

## Reviewer Instructions

1. Confirm the changed files are limited to the Cloud API, Prisma schema/migration, desktop activation helpers, tests, and milestone docs.
2. Verify new device-authenticated APIs call `getDesktopDeviceContext` and do not import legacy `lib/desktop-pos-auth.ts`.
3. Verify raw device tokens and raw activation PINs are returned only in one-time responses and are never persisted.
4. Verify all new API responses use the no-store JSON helper.
5. Re-run the test matrix in `TEST-RESULTS.md`.
