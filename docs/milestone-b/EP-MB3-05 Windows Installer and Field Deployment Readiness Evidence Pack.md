# EP-MB3-05 Windows Installer and Field Deployment Readiness Evidence Pack

## 17.1 Result

READY FOR INDEPENDENT REVIEW

This pack records implementation evidence only. It does not claim Founder Acceptance, final freeze, or real-store installation acceptance.

Architecture Review status: CONDITIONAL PASS.

Founder Verification status: BLOCKED — ARTIFACT CONTENT NOT VERIFIED. GitHub Actions run metadata and artifact metadata are visible, but this environment cannot download artifact `8383458452` without GitHub authentication; internal files, installer SHA-256, build manifest contents, packaged Provider resources, and secret scan are not independently verified.

## 17.2 Git Integrity

Desktop repository: `/Users/jason/light-ops-assistant`

- Branch: `feat/ep-mb3-04-desktop-display-assignment`
- Implementation commit: `ba65f714e53d5822916e1c70144476d230c44ceb`
- origin/main: `cf9b44faa172769ef46945d24a8208bdbb003713`
- merge-base with origin/main: `cf9b44faa172769ef46945d24a8208bdbb003713`
- Remote branch sync before docs commit: local ahead by 1 commit
- Workspace before docs commit: clean except release outputs ignored by `desktop/.gitignore`
- Current installer-related commit: `ba65f714e53d5822916e1c70144476d230c44ceb`

Provider repository: `/Users/jason/eshop-windows-provider`

- Branch: `feat/ep-mb3-03b-real-receipt-payload`
- HEAD: `c5cc86b35fa185aac795d0e141de549858b81f8b`
- origin/main: `b9dbdbf761288c72262fcc93cad81f591a876a78`
- merge-base with origin/main: `b9dbdbf761288c72262fcc93cad81f591a876a78`
- Remote branch sync: `0 0` against `origin/feat/ep-mb3-03b-real-receipt-payload`
- Workspace: no source changes from this EP

Changed files:

- `.github/workflows/desktop-windows-build.yml`
- `package.json`
- `package-lock.json`
- `desktop/.gitignore`
- `desktop/electron-builder.yml`
- `desktop/package.json`
- `desktop/package-lock.json`
- `desktop/scripts/generate-icon.cjs`
- `desktop/scripts/prepare-provider.cjs`
- `desktop/scripts/release-windows.cjs`
- `desktop/scripts/verify-installer-artifacts.cjs`
- `desktop/src/main/appPaths.ts`
- `desktop/src/main/main.ts`
- `desktop/src/main/provider/providerProcess.ts`
- `desktop/tests/installer-readiness.test.ts`
- `desktop/tests/provider-transport.test.ts`

Diff stats for implementation commit: 15 files changed, 327 insertions, 37 deletions.

## 17.3 Architecture

- Installer framework: `electron-builder` with NSIS.
- Windows target: x64 NSIS installer.
- Installer filename: `E-Shop-Store-OS-Setup-1.0.0-x64.exe`.
- appId: `com.eshop.desktop`.
- productName: `E-Shop Store OS`.
- Publisher string: `E-Shop (店小二)` from package author/copyright metadata; no code-signing certificate configured.
- Install mode: per-user (`perMachine: false`), NSIS assisted install (`oneClick: false`), user may change install directory.
- Start menu shortcut: `E-Shop Store OS`.
- Desktop shortcut: enabled.
- Provider bundle location: Electron resources under `resources/eshop-windows-provider`.
- Provider source pin in CI: `c5cc86b35fa185aac795d0e141de549858b81f8b`.
- Provider lifecycle: Desktop obtains single instance lock, starts one child Provider process, connects over the scoped Named Pipe, and stops Provider on explicit app quit.
- Startup mechanism: Desktop-supervised Provider child process only; this EP does not add Windows Service, scheduled task, or Provider auto-start.
- Config path: Electron user data path is explicitly pinned to `%APPDATA%/eshop-desktop`.
- Desktop log path: `%APPDATA%/eshop-desktop/logs/eshop-desktop.log`.
- Provider log path: `%APPDATA%/eshop-windows-provider/logs` by Provider default unless overridden.
- Upgrade strategy: preserve `%APPDATA%/eshop-desktop` via stable userData path and `deleteAppDataOnUninstall: false`.
- Uninstall strategy: remove program files/shortcuts; retain user config by default for reinstall recovery.
- Code signing status: unsigned. SmartScreen warning is expected.
- Auto-update: not implemented in this EP.
- Employee login/PIN/shift/lock screen: not implemented in this EP.

## 17.4 Build Evidence

Desktop:

- `npm run typecheck`: PASS
- `npm run compile`: PASS
- `npm test`: PASS, 17 files / 141 tests
- `npm run build` at repo root: PASS

Provider:

- `npm run type-check`: PASS
- `npm run build`: PASS
- `npm test`: PASS after sandbox escalation for Vitest cache write, 7 files passed / 1 skipped, 31 passed / 5 skipped
- `npm run helper:publish`: FAIL locally, `dotnet: command not found`

Installer:

- `npm run release:windows`: PASS locally on macOS cross-build.
- `npm run verify:installer`: FAIL locally because `helper/win-x64/eshop-print-helper.exe` is missing from the staged Provider artifact. This is expected on this macOS machine because .NET SDK is not installed and helper publish is skipped outside Windows. Windows CI is configured to run `helper:publish` before packaging.

Windows CI:

- Workflow: `desktop-windows-build`
- Run: `#38`, `29517656371`
- Head commit: `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`
- Result: PASS
- Provider pinned commit check: PASS, `c5cc86b35fa185aac795d0e141de549858b81f8b`
- Provider tests: PASS
- Desktop typecheck: PASS
- Desktop unit tests: PASS
- Desktop compile: PASS
- Windows installer build: PASS
- Staged Provider artifact check: PASS
- Provider supervision pipe integration: PASS
- Provider `command.request` real receipt dry-run: PASS
- Electron runtime Provider smoke with spaces: PASS
- No surviving Provider process check: PASS
- Packaged Provider resource check: PASS
- Installer artifact verification: PASS
- Artifact upload: PASS

## 17.5 Artifact Evidence

Local artifact generated after implementation commit:

- Filename: `E-Shop-Store-OS-Setup-1.0.0-x64.exe`
- Version: `1.0.0`
- Size: `82180821` bytes, approximately `78M`
- SHA-256: `9ad7a0ab80474bdb7285158043b5486667ec6dc53bf2d07d3175d2dd3d164815`
- Desktop commit in manifest: `ba65f714e53d5822916e1c70144476d230c44ceb`
- Provider commit in manifest: `c5cc86b35fa185aac795d0e141de549858b81f8b`
- Build manifest: `desktop/release/build-manifest.json`
- SHA file: `desktop/release/SHA256SUMS.txt`
- CI artifact name configured: `eshop-store-os-windows-installer`
- CI run: PASS, `#38` / `29517656371`

LOCAL INCOMPLETE BUILD — NOT RELEASE CANDIDATE.

Important limitation: this local macOS-built installer is not field-ready because the static verifier found the Provider print helper missing. Do not reuse this local hash as the formal release candidate hash.

Windows CI artifact generated after final blocking fix:

- Workflow: `desktop-windows-build`
- Run: `#38`, `29517656371`
- Head commit: `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`
- Artifact name: `eshop-store-os-windows-installer`
- Artifact id: `8383458452`
- Artifact archive size reported by GitHub: `131786466` bytes
- Uploaded file set configured by workflow: `E-Shop-Store-OS-Setup-1.0.0-x64.exe`, `*.blockmap`, `SHA256SUMS.txt`, `build-manifest.json`, `artifact-list.json`
- Local download result: FAIL, GitHub artifact archive download returned `401 Requires authentication` from this environment.
- Independent content verification result: BLOCKED — ARTIFACT CONTENT NOT VERIFIED.
- Required access condition to complete verification: a GitHub-authenticated artifact download token/session with permission to download Actions artifact `8383458452`, or a locally supplied copy of the exact artifact archive from run `29517656371`.

## 17.5B CI Artifact Integrity Verification

Verification date: 2026-07-17

Requested target:

- Workflow: `desktop-windows-build`
- Run id: `29517656371`
- Artifact name: `eshop-store-os-windows-installer`
- Artifact id: `8383458452`

Metadata verification:

- CI run result: PASS, completed successfully.
- Run commit: `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`.
- Current Desktop HEAD at verification time: `22ec4ca9e2e24599659d4702c7818a40a6198bae`.
- Run commit equals current Desktop HEAD: FAIL.
- Provider pinned commit: PASS by workflow checkout pin and `Verify exact Provider commit` step, `c5cc86b35fa185aac795d0e141de549858b81f8b`.
- Artifact exists: PASS.
- Artifact archive size reported by GitHub: `131786466` bytes.
- Artifact download: FAIL, `401 Requires authentication`.

Content verification:

- `E-Shop-Store-OS-Setup-1.0.0-x64.exe`: NOT VERIFIED.
- `SHA256SUMS.txt`: NOT VERIFIED.
- `build-manifest.json`: NOT VERIFIED.
- `artifact-list.json`: NOT VERIFIED.
- Installer SHA-256 recomputation: NOT VERIFIED.
- SHA-256 comparison against `SHA256SUMS.txt`: NOT VERIFIED.
- Build manifest desktop version: NOT VERIFIED.
- Build manifest desktop commit: NOT VERIFIED.
- Build manifest provider version: NOT VERIFIED.
- Build manifest provider commit: NOT VERIFIED.
- Build manifest release channel: NOT VERIFIED.
- Packaged `resources/eshop-windows-provider/dist/index.js`: NOT VERIFIED.
- Packaged `resources/eshop-windows-provider/helper/win-x64/eshop-print-helper.exe`: NOT VERIFIED.
- `verify:installer` run step: PASS.
- `.env` scan: NOT VERIFIED.
- token scan: NOT VERIFIED.
- secret scan: NOT VERIFIED.
- private key scan: NOT VERIFIED.
- test credential scan: NOT VERIFIED.
- Old local artifact hash `9ad7a0ab80474bdb7285158043b5486667ec6dc53bf2d07d3175d2dd3d164815` marked `LOCAL INCOMPLETE BUILD — NOT RELEASE CANDIDATE`: PASS.

Verification conclusion:

BLOCKED — ARTIFACT CONTENT NOT VERIFIED.

This artifact cannot be advanced to `READY FOR FOUNDER VERIFICATION` from this environment because the artifact archive could not be downloaded and independently inspected.

## 17.5A Windows CI Step Ordering Fix

Independent review found blocker B2: Provider integration steps were resolving `ep-mb3-provider/artifacts/eshop-windows-provider/dist/index.js` before the workflow had generated `artifacts/`.

Fix commits:

- `c64f8cf7cb627cd2cf8c412518b5e9507b1a2009`: CI ordering fix, staged/packaged artifact hard checks, upload list cleanup.
- `86fac1bc3578794c7cfddee5d304b6c314fe0552`: cross-platform installer readiness unit test path fix.
- `ad04de864b1e350cff87fe0a12b22650d9ad2fdc`: CI diagnostic output for release build failures.
- `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`: Windows `npm`/`npx` child process shell fix.

Chosen approach: Scheme B. `npm run release:windows` remains the single Provider prepare flow. The workflow now runs the release build before Provider supervision, command dry-run, and Electron smoke. Those checks reuse the staged artifact at `desktop/build/provider/eshop-windows-provider`.

Hard checks before integration:

- Provider checkout commit equals `c5cc86b35fa185aac795d0e141de549858b81f8b`
- `desktop/build/provider/eshop-windows-provider/dist/index.js` exists
- `desktop/build/provider/eshop-windows-provider/package.json` exists
- `desktop/build/provider/eshop-windows-provider/provider-manifest.json` exists
- `desktop/build/provider/eshop-windows-provider/helper/win-x64/eshop-print-helper.exe` exists
- `desktop/build/provider/provider-build-metadata.json` exists and records the expected Provider commit

Hard checks after installer build:

- `release/win-unpacked/resources/eshop-windows-provider/dist/index.js` exists
- `release/win-unpacked/resources/eshop-windows-provider/provider-manifest.json` exists
- `release/win-unpacked/resources/eshop-windows-provider/helper/win-x64/eshop-print-helper.exe` exists
- `release/win-unpacked/resources/build-manifest.json` exists
- `release/E-Shop-Store-OS-Setup-1.0.0-x64.exe` exists
- `release/SHA256SUMS.txt` exists
- `npm run verify:installer` must PASS

Artifact upload now includes:

- `E-Shop-Store-OS-Setup-1.0.0-x64.exe`
- `*.blockmap`
- `SHA256SUMS.txt`
- `build-manifest.json`
- `artifact-list.json`

`latest.yml` is no longer listed as a required upload because the current local build evidence did not prove it is generated.

## 17.6 Installation Verification

| Item | Result |
| --- | --- |
| Installer exists | PASS |
| Filename correct | PASS |
| Version correct | PASS |
| SHA-256 generated | PASS |
| Provider JS bundled | PASS |
| Provider print helper bundled | FAIL locally, PASS in Windows CI |
| `app.asar` generated | PASS |
| Icon generated before packaging | PASS |
| Uninstall metadata configured | PASS |
| `.env` in release root | PASS |
| Code signing | NOT EXECUTED |
| Clean Windows install | NOT EXECUTED |
| Start menu launch | NOT EXECUTED |
| Desktop shortcut launch | NOT EXECUTED |
| Single instance | NOT EXECUTED |
| Provider readiness on Windows | NOT EXECUTED |
| Device authorization flow | NOT EXECUTED |
| Employee screen | NOT EXECUTED |
| Customer screen | NOT EXECUTED |
| Dual display assignment | NOT EXECUTED |
| Barcode scan | NOT EXECUTED |
| Cash payment | NOT EXECUTED |
| KHQR page | NOT EXECUTED |
| Print | NOT EXECUTED |
| Reprint | NOT EXECUTED |
| USB customer display | NOT EXECUTED |
| Restart | NOT EXECUTED |
| Windows reboot | NOT EXECUTED |
| Cover upgrade | NOT EXECUTED |
| Config preservation after upgrade | NOT EXECUTED |
| Uninstall | NOT EXECUTED |
| No residual Provider process after uninstall | NOT EXECUTED |

## 17.7 Known Limitations

- Windows code signing certificate is not configured; SmartScreen warning is expected.
- Local machine does not have `dotnet`; local Provider helper publish failed.
- Local macOS static installer verification failed because `eshop-print-helper.exe` is absent.
- Windows CI artifact exists and passed static checks, but this environment could not download the artifact archive without GitHub authentication.
- Clean Windows machine installation has not been executed.
- Cover upgrade has not been executed.
- Uninstall verification has not been executed.
- Physical scanner, printer, cash drawer, dual display, KHQR, and USB customer display hardware verification has not been executed.
- Auto-update is not implemented.
- Employee login, PIN, shift, handover, and lock screen remain future independent Engineering Packages.

## 17.8 Rollback

- Roll back Desktop by installing the previous accepted Desktop installer artifact.
- Roll back Provider by restoring the previous Provider artifact pin in `.github/workflows/desktop-windows-build.yml` and rebuilding the installer.
- Roll back installer packaging by reverting `ba65f714e53d5822916e1c70144476d230c44ceb`.
- User config is retained in `%APPDATA%/eshop-desktop`; reinstall should recover storeCode, display settings, printer preferences, and non-sensitive local preferences.
- If a bad installer is installed, uninstall program files first, confirm no child Provider remains, then install the previous stable installer. Do not delete `%APPDATA%/eshop-desktop` unless the store intentionally wants to reset local authorization/configuration.

## Founder Verification Checklist

1. Install `E-Shop-Store-OS-Setup-1.0.0-x64.exe` on a clean Windows x64 POS machine.
2. Confirm publisher/signing warning matches unsigned status and no false signed claim is shown.
3. Launch from Start Menu.
4. Launch a second copy and confirm single-instance behavior.
5. Complete or confirm existing device authorization.
6. Confirm authorized device enters the cashier page.
7. Confirm Provider reaches ready state and logs startup result.
8. Open employee screen.
9. Open customer screen.
10. Assign dual displays, unplug secondary display, then reconnect it.
11. Scan a product barcode.
12. Complete a cash payment.
13. Open KHQR flow.
14. Print and reprint a receipt.
15. Cover install the next test build and confirm local config is preserved.
16. Uninstall and confirm no Provider process remains.
