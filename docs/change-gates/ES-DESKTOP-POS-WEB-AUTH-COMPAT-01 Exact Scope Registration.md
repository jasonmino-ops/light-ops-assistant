# ES-DESKTOP-POS-WEB-AUTH-COMPAT-01 — Exact Scope Registration

## Authorization

Founder approved the independent External Web Compatibility correction under the frozen D1-D7 decisions. P1A remains FIELD VERIFIED, FINAL FROZEN, and CLOSED. This registration does not reopen P1A and does not authorize P1B, deployment, FIELD, a new API, schema, migration, Desktop IPC, preload token injection, Activation changes, Computer Client changes, RC9, or Printing changes.

The approved task uses the existing `PRE_COMMIT_CONTENT_SHA256` mechanism from current `origin/main` `0934b1b8ac09d0780ee7775c254778dc83c3f8c3` on the exact feature branch `codex/es-desktop-pos-web-auth-compat-01`. The registration must be byte-identical on the feature branch and trusted `origin/main`; no wildcard, directory grant, bypass, authorized-commit shortcut, or Guard/config change is permitted.

## Exact protected bytes

- `app/cashier/page.tsx` — `a0c3bb2736f77874b2a682256ad19af6e1a7f6b0861a5181d9a91bdec048d4e9`
- `tests/desktop-pos-web-auth-compat.test.ts` — `b73f2c7ff72a12f34c8e7bf8031948f95e479485f93a24917eda8e9925ed2c35`
- `tests/es-tray-device-print-contract.test.ts` — `1fad70a416c904627feab6a20393699843a90b37359d8cc31961f096d61f5753`

The print-contract test authorization is limited to replacing its exact protected Cashier SHA-256 assertion with the reviewed Product Candidate value `a0c3bb2736f77874b2a682256ad19af6e1a7f6b0861a5181d9a91bdec048d4e9`. It does not authorize any RC9, Printing, print-contract behavior, or assertion-strength change.

The separately Founder-approved `scripts/test/manifests/root-integration-tests.json` change is limited to `expectedCount: 12 → 13` and one `LOCAL_RUNTIME_BROWSER` registration for the new focused test. It is test-governance metadata, not a protected business/test implementation grant, and its reviewed content SHA-256 is `fee548ad6234a4bbd0a5e5195a4f5fea755eaaa741fedb73365a0992cf9939e4`.

## Accepted behavior

- `/desktop/pos`, `from=desktop`, and the existing `deviceAuth=1` entry use the existing Browser POS QR authorization flow.
- Every entry starts with the existing Cashier access probe; neither Desktop context nor a local token is an authorization flag.
- A valid POS token becomes usable after the access probe succeeds.
- An explicit server `401` or `403` clears a stale local POS token and permits the existing authorization flow to run again.
- A network/fetch rejection with a cached token preserves the existing offline-tolerance behavior and does not classify the token as invalid.
- Existing QR approval continues to call `savePosDeviceToken()` and subsequent starts do not repeat authorization.
- Browser OWNER/STAFF, Browser POS token, and Computer Client launch-ticket behavior remain unchanged.

## Validation and lifecycle

The focused runtime suite passed 14 cases and the existing Computer Client launch route suite passed 26 cases before registration. The root test-manifest audit is exact at 74 CORE + 13 INTEGRATION = 87 discovered tests. Independent pre-alignment review passed after the manifest registration decision.

This ACTIVE record permits only the exact reviewed bytes to pass Scope Guard. It does not authorize feature merge or Production deployment. The exception must remain fail-closed and must be closed only after a separately Founder-authorized feature merge.
