# EP-MB3-06A Blocking Fixes

## Independent Review Result

Claude Desktop Independent Architecture / Security Review result: FAIL. Ready for acceptance: NO.

Reviewed commit: `8bfa470a7d2a8cccca6d20823d75c6c581b81ca4`

## Findings Closed

- C-1 audit activation blocker: `tokenHashVersion` metadata triggered the sensitive key pattern and rolled back successful activation. Fixed by using `credentialVersion` metadata mapped to `DesktopDevice.tokenVersion`, while preserving sensitive key rejection.
- Token version semantics: `tokenHashVersion` remains fixed hash algorithm/key-format version. New `tokenVersion` tracks credential rotation.
- INTERNAL_ERROR: all seven 06A routes use `withDesktopApiError` for safe catch-all error responses.
- PIN P2002: concurrent active PIN creation conflicts map to `CONFLICT_RETRY_REQUIRED` with HTTP 409.
- Response minimization: verify/status/list responses return public identity fields only and no longer expose diagnostic/internal fields.
- Runtime activation test: added `tests/desktop-activation-runtime.test.ts`.
- Real DB concurrency: runtime test uses real PostgreSQL and concurrent service calls.
- Cloud CI: added `.github/workflows/cloud-ci.yml` with PostgreSQL service.

## Fix Diff Summary

- Schema: added `DesktopDevice.tokenVersion`.
- Migration: added `20260717110000_add_desktop_device_token_version`.
- Runtime: replaced audit `tokenHashVersion` metadata with `credentialVersion`.
- Runtime: same-store reactivation increments `tokenVersion`, not `tokenHashVersion`.
- Runtime: added route wrapper and minimal response serializers.
- Tests: added real DB activation/concurrency test and updated static coverage.

## Known Non-Blocking Observations Retained

- Full historical `prisma migrate deploy` is blocked by pre-existing migration drift before 06A migrations.
- Runtime DB tests and Cloud CI use temporary PostgreSQL plus `prisma db push --force-reset` to validate the current schema without changing historical migrations.
- Timing-safe compare for PIN/token hashes remains an observation item.
- Device revoke still locks by id before tenant filter, as noted by review.
