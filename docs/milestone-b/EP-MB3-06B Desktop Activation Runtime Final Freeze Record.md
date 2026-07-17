# EP-MB3-06B Desktop Activation Runtime Final Freeze Record

## Document Identity

- Engineering Package: `EP-MB3-06B - Desktop Activation Runtime`
- Final Status: `FINAL FROZEN`
- Freeze Date: `2026-07-18`
- Repository: `jasonmino-ops/light-ops-assistant`
- Main Branch: `main`
- Merge Commit: `ef3357f1b9bdafe1e541a37bd6fb1f1ce708801a`
- Acceptance Record Commit: `0a6d73faa7f6087e949b172d652311d9094f9a29`
- Baseline: `c134b989a51d27cdc3daae7a7a3c4231baa43415`
- Final Freeze Commit: assigned by the freeze document commit and recorded in the final execution report.
- Freeze Tag: assigned after tag creation and recorded in the final execution report.

## Final Accepted Scope

The following EP-MB3-06B capabilities are final frozen:

- Local activation window.
- `storeCode` plus six-digit PIN activation.
- Cloud activation API integration.
- Installation identity.
- `safeStorage` encrypted credential.
- Main-process-only token boundary.
- Startup verify/status gate.
- Employee/customer window activation gate.
- Provider activation gate.
- Revoked, expired, and blocked recovery.
- Local reset.
- Second-instance and tray guards.
- Windows packaged activation preload and renderer.
- Windows installer and manifest.
- Main-branch artifact verification.

## Formal Status Chain

- Engineering Implementation: `PASS`
- Independent Architecture Review: `CONDITIONAL PASS`
- Condition Closure: `PASS`
- Final Acceptance Review: `PASS`
- Acceptance Decision: `ACCEPTED`
- Merge: `PASS`
- Main Windows CI: `PASS`
- Main Artifact Integrity: `PASS`
- Final Freeze: `APPROVED`

## Commit Chain

Feature implementation chain:

- `6153ba5ee27f313ee8c37b7b7368afb2320e97f7` - `feat(desktop): add activation runtime domain`
- `e729076b21e531750f1ec246d1f3fb11cf0b6e33` - `feat(desktop): gate formal runtime behind activation`
- `4a56a2eb6691fd38f6908939278b1a07a394776f` - `ci(desktop): verify activation packaging security`
- `a4e4a3452423f2236241d54fbc2b517463e1df4b` - `ci(desktop): fix Windows activation test file selection`
- `ee5eef4670c6e96697e6db0ab5e7898c41fb3d14` - `ci(desktop): harden Windows safeStorage smoke diagnostics`
- `97c9e2118f54b1d07ebeee3aa9cde7968aabb8c8` - `fix(desktop): correct packaged activation asset paths`
- `7c27503a26a0c70fde820049c925bc5eedf56e7f` - `docs(desktop): close EP-MB3-06B review conditions`
- `0a6d73faa7f6087e949b172d652311d9094f9a29` - `docs(desktop): accept EP-MB3-06B activation runtime`

Merge commit:

- `ef3357f1b9bdafe1e541a37bd6fb1f1ce708801a` - `merge: accept EP-MB3-06B desktop activation runtime`

- Feature implementation chain: `linear`
- Merge strategy: `--no-ff`
- Merge conflicts: `NONE`

## Main Windows CI Evidence

- Workflow: `desktop-windows-build`
- Run ID: `29604559957`
- Run URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29604559957`
- Branch: `main`
- Head SHA: `ef3357f1b9bdafe1e541a37bd6fb1f1ce708801a`
- Conclusion: `success`

Critical steps:

- Activation focused tests: `PASS`
- Full desktop tests: `PASS`
- Compile: `PASS`
- Static security: `PASS`
- Windows safeStorage smoke: `PASS`
- Provider supervision: `PASS`
- Provider named-pipe smoke: `PASS`
- Provider no-survivor: `PASS`
- NSIS package: `PASS`
- Packaged activation assets: `PASS`
- Provider packaged resources: `PASS`
- Manifest generation: `PASS`
- Artifact upload: `PASS`

## Main Artifact Integrity

- Artifact ID: `8416362274`
- Artifact name: `eshop-desktop-windows-installer`
- Archive size: `81888256` bytes
- Installer: `E-Shop-Desktop-Setup-0.1.0.exe`
- Installer size: `81808712` bytes
- Manifest: `SHA256SUMS.txt`
- Manifest size: `290` bytes
- Calculated SHA-256: `90786ded16df6228af7407aad7dd58635be27060bc68afb83cf95fe708a104fc`
- OpenSSL SHA-256: `90786ded16df6228af7407aad7dd58635be27060bc68afb83cf95fe708a104fc`
- Manifest SHA-256: `90786DED16DF6228AF7407AAD7DD58635BE27060BC68AFB83CF95FE708A104FC`
- Integrity result: `PASS`

Evidence notes:

- Artifact belongs to main run `29604559957`.
- Feature branch artifact was not used as a substitute.
- Archive size matches GitHub metadata.
- Installer SHA matches the manifest exactly after case normalization.

## Security Freeze

The following security boundaries are final frozen:

- Token only in Electron main.
- Renderer cannot access token.
- No token in URL.
- No token in `localStorage`.
- No token in logs.
- No plaintext fallback.
- No Node crypto fallback replacing `safeStorage`.
- No `storeCode` fallback authorization.
- No legacy POS token migration.
- No offline authorization.
- No SQLite credential store.

## Upgrade And Uninstall Semantics

- `deleteAppDataOnUninstall: false`

Frozen V1 semantics:

- Normal upgrade preserves installation identity.
- Normal upgrade preserves encrypted credential.
- Uninstall/reinstall may preserve activation identity.
- Manual app-data deletion creates a new installation identity.
- Local reset clears only local activation state.
- Local reset does not call Cloud revoke.
- Cloud revoke remains OWNER/admin controlled.

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

`WindowManager` only contains the accepted activation gate enforcement.

## Accepted Limitations

The following are accepted non-blocking limitations:

- No offline activation.
- No legacy token migration.
- Local reset does not revoke Cloud device.
- Uninstall behavior follows retained app data.
- Real activation requires Cloud connectivity and valid credentials.
- Local-first Desktop POS is not part of 06B.

- Remaining Technical Blockers: `NONE`

## Freeze Decision

- Final Freeze Decision: `APPROVED`
- Engineering Package Status: `FINAL FROZEN`
- Ready for Next Engineering Package: `YES`
