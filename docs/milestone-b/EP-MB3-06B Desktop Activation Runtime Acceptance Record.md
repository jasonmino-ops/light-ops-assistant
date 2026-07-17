# EP-MB3-06B Desktop Activation Runtime Acceptance Record

## Document Identity

- Engineering Package: `EP-MB3-06B - Desktop Activation Runtime`
- Status: `ACCEPTED`
- Acceptance Date: `2026-07-18`
- Repository: `jasonmino-ops/light-ops-assistant`
- Acceptance Branch: `feat/ep-mb3-06b-desktop-activation-runtime`
- Acceptance Reviewed HEAD: `7c27503a26a0c70fde820049c925bc5eedf56e7f`
- Baseline: `c134b989a51d27cdc3daae7a7a3c4231baa43415`
- Acceptance Record Commit: assigned by the document commit; recorded in the final execution report.

## Accepted Scope

The following EP-MB3-06B capabilities are accepted:

- First-launch local activation window.
- `storeCode` plus six-digit PIN activation.
- Cloud activation API integration.
- Installation identity.
- Encrypted credential persistence using Electron `safeStorage`.
- Main-process-only activation credential.
- Startup verify/status gate.
- Employee and customer windows only after activation passes.
- Provider startup only after activation passes.
- Revoked, expired, and blocked recovery paths.
- Local reset behavior.
- Second-instance and tray activation guards.
- Packaged activation preload and renderer assets.
- Windows release packaging and verification.

## Acceptance Gates

- Engineering Scope Complete: `PASS`
- Architecture Boundary Preserved: `PASS`
- Windows Release Evidence Complete: `PASS`
- Security Requirements Satisfied: `PASS`
- Activation Runtime Functional: `PASS`
- Recovery Path Verified: `PASS`
- Main-only Credential Storage Verified: `PASS`
- Frozen Boundary Preserved: `PASS`
- Evidence Pack Complete: `PASS`

## Security Acceptance

- Token retained only inside Electron main process.
- Renderer cannot read activation token.
- Token not placed in URL.
- Token not placed in `localStorage`.
- Token not written to logs.
- No plaintext credential fallback.
- No Node crypto fallback replacing `safeStorage`.
- No legacy POS token migration.
- No `storeCode` fallback authorization.
- No offline authorization mode.
- No SQLite credential store.

## Windows Release Evidence

- Workflow: `desktop-windows-build`
- Run ID: `29602321675`
- Run URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29602321675`
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
- Provider packaged resources: `PASS`
- Manifest generation: `PASS`
- Artifact upload: `PASS`

## Artifact Integrity

- Artifact ID: `8415529883`
- Artifact name: `eshop-desktop-windows-installer`
- Archive size: `81888239` bytes
- Installer: `E-Shop-Desktop-Setup-0.1.0.exe`
- Installer size: `81808710` bytes
- Installer SHA-256: `75833819cfb9f0e593fc7d2e22aa6ece273e6e1fc5f510fc673f745497c93698`
- Manifest: `SHA256SUMS.txt`
- Manifest verification: `PASS`

## Windows safeStorage Evidence

- Electron exit code: `0`
- `PHASE=SCRIPT_START`
- `PHASE=APP_READY`
- `ENCRYPTION_AVAILABLE=true`
- `PHASE=ENCRYPT_OK`
- `PHASE=DECRYPT_OK`
- `PHASE=ROUNDTRIP_OK`
- `RESULT=PASS`

This evidence came from Windows hosted CI. The real Electron `safeStorage` round-trip passed, and no sensitive plaintext was printed.

## Defect Closure

### Windows Focused-Test Selection

- Root cause: PowerShell did not expand the Vitest glob as expected.
- Closure: explicit activation test file list.
- Result: `PASS` on Windows.

### safeStorage Smoke Harness

- Root cause: stdout/exit capture and flush lifecycle were insufficient.
- Closure: flush-safe diagnostics and explicit child exit-code capture.
- Result: `PASS` on Windows.

### Activation Packaged Path

- Root cause: `ActivationWindowController` resolved preload and renderer assets from `dist/main/preload` and `dist/main/renderer` instead of `dist/preload` and `dist/renderer`.
- Additional verifier issue: Windows `asar` paths were separator-sensitive.
- Closure: runtime path corrected and `asar` paths normalized.
- Result: packaged activation asset verification `PASS`.

## Database Regression

- Gate: `DESKTOP_ACTIVATION_TEST_DATABASE=1`
- Result: `PASS`
- Environment: embedded PostgreSQL

This was not a production database test. It is sufficient for this Engineering Package acceptance.

## Upgrade And Uninstall Semantics

- `deleteAppDataOnUninstall: false`

Accepted V1 behavior:

- Normal upgrade retains installation identity.
- Normal upgrade retains encrypted activation credential.
- Uninstall/reinstall may retain app data and activation identity.
- Manual app-data deletion creates a new installation identity.
- Local reset clears local activation state only.
- Local reset does not revoke the Cloud device.
- Cloud device revocation remains an OWNER/admin operation.

## Frozen Boundary

- 06A Cloud Activation API Contract: `unchanged`
- Cloud activation routes: `unchanged`
- Runtime Core: `unchanged`
- Windows Provider: `unchanged`
- Provider Contract: `unchanged`
- Prisma: `unchanged`
- Printer runtime: `unchanged`
- Scanner runtime: `unchanged`
- Payment flows: `unchanged`
- Legacy POS authorization: `unchanged`
- Existing mobile/customer/cashier flows: `unchanged`

`WindowManager` only adds activation gate enforcement and does not change frozen dual-screen responsibilities or business semantics.

## Commit Chain

- `6153ba5ee27f313ee8c37b7b7368afb2320e97f7` - `feat(desktop): add activation runtime domain`
- `e729076b21e531750f1ec246d1f3fb11cf0b6e33` - `feat(desktop): gate formal runtime behind activation`
- `4a56a2eb6691fd38f6908939278b1a07a394776f` - `ci(desktop): verify activation packaging security`
- `a4e4a3452423f2236241d54fbc2b517463e1df4b` - `ci(desktop): fix Windows activation test file selection`
- `ee5eef4670c6e96697e6db0ab5e7898c41fb3d14` - `ci(desktop): harden Windows safeStorage smoke diagnostics`
- `97c9e2118f54b1d07ebeee3aa9cde7968aabb8c8` - `fix(desktop): correct packaged activation asset paths`
- `7c27503a26a0c70fde820049c925bc5eedf56e7f` - `docs(desktop): close EP-MB3-06B review conditions`

- Commit chain is linear.
- Merge commits between baseline and reviewed HEAD: `0`.

## Remaining Known Limitations

Accepted V1 limitations:

- No offline activation.
- No legacy token migration.
- No automatic Cloud revoke on local reset.
- Uninstall/reinstall identity behavior follows retained app data.
- Real Windows store/PIN activation still requires valid Cloud credentials and network.
- No Local-first POS implementation in 06B.

- Acceptance blockers: `NONE`

## Formal Acceptance Decision

- Acceptance Decision: `ACCEPTED`
- Remaining Technical Blockers: `NONE`
- Ready to Merge: `YES`
- Ready for Final Freeze after Merge: `YES`

## Final Freeze Status

- Merge Status: `MERGED`
- Merge Commit: `ef3357f1b9bdafe1e541a37bd6fb1f1ce708801a`
- Main CI: `PASS`
- Main Artifact Integrity: `PASS`
- Main Artifact ID: `8416362274`
- Main Artifact Archive Size: `81888256` bytes
- Main Installer: `E-Shop-Desktop-Setup-0.1.0.exe`
- Main Installer Size: `81808712` bytes
- Main Installer SHA-256: `90786ded16df6228af7407aad7dd58635be27060bc68afb83cf95fe708a104fc`
- Main Manifest: `SHA256SUMS.txt`
- Main Manifest Size: `290` bytes
- Final Freeze Status: `FINAL FROZEN`
- Final Freeze Record: `docs/milestone-b/EP-MB3-06B Desktop Activation Runtime Final Freeze Record.md`
