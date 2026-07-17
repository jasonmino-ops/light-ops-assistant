# EP-MB3-06B Desktop Activation Runtime Evidence Pack

## Baseline

- Repository: `/Users/jason/light-ops-assistant`
- Base branch: `main`
- Baseline commit: `c134b989a51d27cdc3daae7a7a3c4231baa43415`
- Freeze tag: `ep-mb3-06a-cloud-desktop-activation-v1.0-final`
- Freeze tag dereference: `c134b989a51d27cdc3daae7a7a3c4231baa43415`
- Engineering branch: `feat/ep-mb3-06b-desktop-activation-runtime`

## Commits

Final implementation commit chain:

- `6153ba5ee27f313ee8c37b7b7368afb2320e97f7` - `feat(desktop): add activation runtime domain`
- `e729076b21e531750f1ec246d1f3fb11cf0b6e33` - `feat(desktop): gate formal runtime behind activation`
- `4a56a2eb6691fd38f6908939278b1a07a394776f` - `ci(desktop): verify activation packaging security`
- `a4e4a3452423f2236241d54fbc2b517463e1df4b` - `ci(desktop): fix Windows activation test file selection`
- `ee5eef4670c6e96697e6db0ab5e7898c41fb3d14` - `ci(desktop): harden Windows safeStorage smoke diagnostics`
- `97c9e2118f54b1d07ebeee3aa9cde7968aabb8c8` - `fix(desktop): correct packaged activation asset paths`

## Independent Review Condition Closure

- Independent Review Result: `CONDITIONAL PASS`
- Blocking findings: `NONE`
- Architecture gates: `PASS`
- Security gates: `PASS`
- Windows Release Integrity condition: `CLOSED`

Review gate status:

- Activation Gate: `PASS`
- Main-only token boundary: `PASS`
- safeStorage credential integrity: `PASS`
- Cloud Contract: `PASS`
- Recovery paths: `PASS`
- Frozen Boundary: `PASS`
- Windows Release Gate: `PASS`

## Changed Files

Activation runtime and credential security:

- `/Users/jason/light-ops-assistant/desktop/src/main/activation/activationTypes.ts`
- `/Users/jason/light-ops-assistant/desktop/src/main/activation/credentialStore.ts`
- `/Users/jason/light-ops-assistant/desktop/src/main/activation/activationApiClient.ts`
- `/Users/jason/light-ops-assistant/desktop/src/main/activation/activationRuntime.ts`
- `/Users/jason/light-ops-assistant/desktop/src/main/activation/activationWindowController.ts`
- `/Users/jason/light-ops-assistant/desktop/src/main/activation/activationIpc.ts`
- `/Users/jason/light-ops-assistant/desktop/src/preload/activationPreload.ts`
- `/Users/jason/light-ops-assistant/desktop/src/renderer/activation/index.html`
- `/Users/jason/light-ops-assistant/desktop/src/renderer/activation/activationRenderer.ts`
- `/Users/jason/light-ops-assistant/desktop/src/renderer/activation/activation.css`

Startup gate and recovery path guard:

- `/Users/jason/light-ops-assistant/desktop/src/main/main.ts`
- `/Users/jason/light-ops-assistant/desktop/src/main/windowManager.ts`

Build, package, CI, and tests:

- `/Users/jason/light-ops-assistant/desktop/package.json`
- `/Users/jason/light-ops-assistant/desktop/scripts/clean-dist.mjs`
- `/Users/jason/light-ops-assistant/desktop/scripts/copy-activation-assets.mjs`
- `/Users/jason/light-ops-assistant/desktop/scripts/verify-activation-assets.mjs`
- `/Users/jason/light-ops-assistant/desktop/tests/activation-state-machine.test.ts`
- `/Users/jason/light-ops-assistant/desktop/tests/activation-credential-store.test.ts`
- `/Users/jason/light-ops-assistant/desktop/tests/activation-api-client.test.ts`
- `/Users/jason/light-ops-assistant/desktop/tests/activation-ipc.test.ts`
- `/Users/jason/light-ops-assistant/desktop/tests/activation-gate.test.ts`
- `/Users/jason/light-ops-assistant/desktop/tests/activation-static-security.test.ts`
- `/Users/jason/light-ops-assistant/desktop/tests/smoke/safeStorage-smoke.cjs`
- `/Users/jason/light-ops-assistant/.github/workflows/desktop-windows-build.yml`

## Architecture

The Electron main process now has a pre-gate and post-gate split:

1. Pre-gate: single instance, lifecycle handlers, logger, `loadConfig`, `installationId`, `CredentialStore`, `safeStorage`, local Activation Window, activation IPC, and Cloud activation/verify calls.
2. Post-gate: `createDefaultHardwareManager`, formal `registerIpcHandlers`, employee window, customer window, `watchDisplays`, `WindowsProviderSupervisor`, and formal tray.

`ActivationRuntime` is the only authorization state source. `WindowManager` has a single formal runtime guard hook to prevent accidental formal window creation from second-instance, tray, display recovery, customer recovery, or future direct calls.

## Activation State Machine

Implemented public states include:

- `BOOTING`
- `UNACTIVATED`
- `ACTIVATING`
- `VERIFYING`
- `AUTHORIZED_STARTING`
- `AUTHORIZED_RUNNING`
- `NETWORK_ERROR`
- `INVALID_PIN`
- `PIN_LOCKED`
- `PIN_EXPIRED`
- `PIN_ALREADY_USED`
- `STORE_NOT_FOUND`
- `TENANT_INACTIVE`
- `STORE_INACTIVE`
- `SUBSCRIPTION_BLOCKED`
- `INSTALLATION_BOUND_TO_OTHER_STORE`
- `SAFE_STORAGE_UNAVAILABLE`
- `CREDENTIAL_CORRUPTED`
- `DEVICE_REVOKED`
- `TOKEN_EXPIRED`
- `REACTIVATION_REQUIRED`
- `SERVER_ERROR`
- `QUITTING`

Public renderer DTOs exclude `deviceToken`, PIN, Authorization, installationId, and ciphertext.

## Credential Design

Credential files live under `app.getPath('userData')/activation/`:

- `installation.json`
- `metadata.json`
- `credential.json`

`installationId` is generated by `crypto.randomUUID()` and is not derived from hardware. `credential.json` stores only Electron `safeStorage` ciphertext. `metadata.json` is UX metadata only and is not used as authorization. Missing or corrupt metadata with an existing credential fails closed as inconsistent local activation state.

Writes use same-directory temp files and rename. Windows rename receives bounded retry. If metadata write fails after credential replacement, the credential is quarantined to prevent a partial local activation from being verified on next startup.

## Token Security Evidence

- Token exists only in main process temporary memory and encrypted `safeStorage` ciphertext.
- Token is not exposed through activation preload or renderer.
- Token is not stored in `localStorage` or `sessionStorage`.
- Token is not placed in URL or query string.
- Token, PIN, Authorization, raw request, raw response, and ciphertext are not logged by activation modules.
- `safeStorage` unavailable state does not call Cloud activate and does not start formal runtime.

Evidence:

- `desktop/tests/activation-static-security.test.ts`
- `desktop/tests/activation-credential-store.test.ts`
- `desktop/tests/activation-state-machine.test.ts`

## Cloud Contract Diff

No changes were made to:

- `/Users/jason/light-ops-assistant/docs/milestone-b/EP-MB3-06A-CLOUD-DESKTOP-ACTIVATION-API-CONTRACT.md`
- `/Users/jason/light-ops-assistant/app/api/desktop/activate/route.ts`
- `/Users/jason/light-ops-assistant/app/api/desktop/auth/verify/route.ts`
- `/Users/jason/light-ops-assistant/app/api/desktop/device/status/route.ts`

The Desktop client calls only:

- `POST /api/desktop/activate`
- `POST /api/desktop/auth/verify`

`GET /api/desktop/device/status` is not used for startup.

## Runtime Core Diff

No changes were made to `/Users/jason/light-ops-assistant/desktop/src/main/hrt/*`.

## Provider Diff

No Provider repository changes were made. Windows CI remains pinned to Provider commit:

- `7785be145d5259991038d17839d322e2694e338c`

Existing Provider integrity and no-survivor checks are preserved in `.github/workflows/desktop-windows-build.yml`.

## WindowManager Regression

Guarded recovery paths:

- `createEmployeeWindow`
- `focusEmployeeWindow`
- `ensureCustomerWindow`
- `createCustomerWindow`
- `watchDisplays`
- `display-added`
- `display-removed`
- `display-metrics-changed`
- `scheduleCustomerRecovery`
- `toggleCustomerWindow`

Evidence:

- `desktop/tests/activation-gate.test.ts`
- Existing `desktop/tests/recovery-backoff.test.ts`
- Existing `desktop/tests/cart-sync-service.test.ts`

## Tests

Local verification completed:

- `cd /Users/jason/light-ops-assistant/desktop && rm -rf dist release`
- `cd /Users/jason/light-ops-assistant/desktop && npm ci`
- `cd /Users/jason/light-ops-assistant/desktop && npm run typecheck`
- `cd /Users/jason/light-ops-assistant/desktop && npx vitest run tests/activation-*.test.ts`
- `cd /Users/jason/light-ops-assistant/desktop && npm test`
- `cd /Users/jason/light-ops-assistant/desktop && npm run compile`
- `cd /Users/jason/light-ops-assistant/desktop && node scripts/verify-activation-assets.mjs dist`
- `cd /Users/jason/light-ops-assistant/desktop && npm run pack:dir`
- `cd /Users/jason/light-ops-assistant/desktop && node scripts/verify-activation-assets.mjs asar "release/mac-arm64/E-Shop Desktop.app/Contents/Resources/app.asar"`
- `cd /Users/jason/light-ops-assistant && npm run build`

Cloud 06A regression completed:

- `npx tsx tests/desktop-activation-crypto.test.ts`
- `npx tsx tests/desktop-activation-security-static.test.ts`
- `npx tsx tests/desktop-activation-concurrency-static.test.ts`
- `npx tsx tests/desktop-activation-subscription.test.ts`

Cloud 06A real database regression:

- `npx tsx tests/desktop-activation-runtime.test.ts`
- Gate: `DESKTOP_ACTIVATION_TEST_DATABASE=1`
- Result: `PASS`
- Environment: embedded PostgreSQL independent review environment.

## Windows CI Run

Workflow: `desktop-windows-build`

- Run ID: `29602321675`
- URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29602321675`
- Branch: `feat/ep-mb3-06b-desktop-activation-runtime`
- Head SHA: `97c9e2118f54b1d07ebeee3aa9cde7968aabb8c8`
- Conclusion: `success`

Critical steps:

- Activation focused tests: `PASS`
- Full desktop tests: `PASS`
- Compile: `PASS`
- Static security scan: `PASS`
- Windows real Electron safeStorage smoke: `PASS`
- Provider supervision: `PASS`
- Provider named-pipe smoke: `PASS`
- Provider no-survivor: `PASS`
- NSIS package: `PASS`
- Packaged activation assets: `PASS`
- Packaged activation preload: `PASS`
- Provider packaged resources: `PASS`
- Manifest generation: `PASS`
- Artifact upload: `PASS`

## Windows safeStorage Smoke

Real Electron `safeStorage` smoke evidence from the Windows hosted runner:

- `PHASE=SCRIPT_START`
- `PHASE=APP_READY`
- `ENCRYPTION_AVAILABLE=true`
- `PHASE=ENCRYPT_OK`
- `PHASE=DECRYPT_OK`
- `PHASE=ROUNDTRIP_OK`
- `RESULT=PASS`
- `Electron exit code=0`

The Windows smoke validates a real Electron safeStorage encrypt/decrypt round-trip. No Node crypto fallback, plaintext fallback, sensitive token output, PIN output, Authorization output, raw request output, raw response output, or ciphertext output is accepted by this gate.

## Windows Installer Artifact

- Artifact ID: `8415529883`
- Artifact name: `eshop-desktop-windows-installer`
- Artifact URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29602321675/artifacts/8415529883`
- Archive size: `81888239` bytes
- Installer: `E-Shop-Desktop-Setup-0.1.0.exe`
- Installer size: `81808710` bytes
- Installer SHA-256: `75833819cfb9f0e593fc7d2e22aa6ece273e6e1fc5f510fc673f745497c93698`
- Manifest: `SHA256SUMS.txt`
- Manifest verification: `PASS`

Local artifact validation note:

- GitHub REST artifact download returned `401` in the local session.
- The artifact was downloaded from the logged-in GitHub Actions artifact page.
- Downloaded archive: `/Users/jason/Downloads/eshop-desktop-windows-installer.zip`
- Local extraction path: `/private/tmp/ep-mb3-06b-packaging-fix-artifact-8415529883`
- Extracted installer SHA-256 matched `SHA256SUMS.txt`.

Extracted artifact contents:

- `E-Shop-Desktop-Setup-0.1.0.exe.blockmap` - `85932` bytes
- `E-Shop-Desktop-Setup-0.1.0.exe` - `81808710` bytes
- `SHA256SUMS.txt` - `290` bytes

## Packaged Activation Asset Path Fix

Root cause closed:

- Original runtime lookup incorrectly resolved activation assets under `dist/main/preload` and `dist/main/renderer`.
- Actual compiled/package assets are under `dist/preload` and `dist/renderer`.

Final fix evidence:

- Runtime asset path corrected.
- Packaged `app.asar` path normalization added.
- Local `dist` activation asset verification: `PASS`
- Local `app.asar` activation asset verification: `PASS`
- Windows packaged activation asset verification: `PASS`

## Packaged Activation Assets

Verified in local `dist` and local packaged `app.asar`:

- `dist/preload/activationPreload.js`
- `dist/renderer/activation/index.html`
- `dist/renderer/activation/activation.css`
- `dist/renderer/activation/activationRenderer.js`

Windows packaged activation asset verification additionally confirms:

- Packaged activation preload exists in `app.asar`.
- Packaged activation renderer HTML exists in `app.asar`.
- Packaged activation renderer CSS exists in `app.asar`.
- Packaged activation renderer JavaScript exists in `app.asar`.

## Database Runtime Regression

- Test gate: `DESKTOP_ACTIVATION_TEST_DATABASE=1`
- Result: `PASS`
- Environment: embedded PostgreSQL
- Scope: independent review environment only.

This confirms the 06A activation runtime regression path in an embedded PostgreSQL review environment. It is not a production database validation and does not imply any production data migration or production database access.

## Upgrade And Uninstall Identity Behavior

- `electron-builder` NSIS keeps `deleteAppDataOnUninstall: false`.
- Normal upgrade preserves `installationId`.
- Normal upgrade preserves encrypted activation credential.
- Default uninstall plus reinstall may keep local activation identity because application data is retained.
- Manual application data removal generates a new `installationId`.
- 06B V1 accepts this compatibility strategy.
- Local reset clears local activation credential and local activation state only.
- Local reset does not call Cloud revoke.
- OWNER Cloud Device revoke remains a Cloud management action.

## Frozen Boundary Proof

- 06A API Contract diff: `0`
- Cloud activation routes diff: `0`
- Prisma diff: `0`
- Runtime Core diff: `0`
- Provider diff: `0`
- Provider Contract diff: `0`
- Printer diff: `0`
- Scanner diff: `0`
- Payment diff: `0`
- Legacy POS auth diff: `0`

`WindowManager` modification is limited to the activation guard for formal runtime entry/recovery paths. No existing dual-screen business semantic change is introduced.

No SQLite, offline startup, offline cashier, cached authorization, grace startup, Cloud Device auto revoke, merchant signup, or OWNER login was implemented.

## Final Condition Status

- Windows CI evidence: `CLOSED`
- Artifact SHA evidence: `CLOSED`
- Database runtime regression: `CLOSED`
- Uninstall identity documentation: `CLOSED`
- All Independent Review conditions: `CLOSED`

## Final Acceptance

- Final Acceptance Readiness Review: `PASS`
- Acceptance Decision: `ACCEPTED`
- Acceptance Reviewed HEAD: `7c27503a26a0c70fde820049c925bc5eedf56e7f`
- Remaining Blockers: `NONE`
- Acceptance Record: `docs/milestone-b/EP-MB3-06B Desktop Activation Runtime Acceptance Record.md`
