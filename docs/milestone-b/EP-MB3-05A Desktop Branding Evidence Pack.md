# EP-MB3-05A Desktop Branding Evidence Pack

This evidence pack records the implementation evidence for EP-MB3-05A Desktop Branding & Official Application Icon.

It does not declare a release, merge, or freeze.

## 1. Baseline

- Desktop baseline: `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`
- Provider baseline: `c5cc86b35fa185aac795d0e141de549858b81f8b`
- Package: EP-MB3-05A

## 2. Branch

- Branch: `feat/ep-mb3-05a-desktop-branding`
- Created from: `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`

## 3. Final HEAD

- Initial implementation HEAD before commit: `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`
- Final committed HEAD: pending first implementation commit

## 4. origin/main

- `origin/main`: `cf9b44faa172769ef46945d24a8208bdbb003713`

## 5. Merge-base

- `merge-base HEAD origin/main`: `cf9b44faa172769ef46945d24a8208bdbb003713`
- `merge-base HEAD 135d8364209ec0513ef2c4bd61ff91db18cf3f3d`: `135d8364209ec0513ef2c4bd61ff91db18cf3f3d`

## 6. Changed Files

- `.github/workflows/desktop-windows-build.yml`
- `desktop/.gitignore`
- `desktop/assets/branding/eshop-official-avatar-640.png`
- `desktop/electron-builder.yml`
- `desktop/package.json`
- `desktop/scripts/generate-icon.cjs`
- `desktop/scripts/release-windows.cjs`
- `desktop/scripts/verify-branding.cjs`
- `desktop/scripts/verify-installer-artifacts.cjs`
- `desktop/tests/branding-icon.test.ts`
- `docs/milestone-b/EP-MB3-05A Desktop Branding Evidence Pack.md`

## 7. Founder Source Asset Path

- `desktop/assets/branding/eshop-official-avatar-640.png`

## 8. Founder Source Asset Dimensions

- Format: PNG
- Dimensions: 640 x 640
- Bit depth: 8-bit
- Color type: RGB
- Interlace: none

## 9. Founder Source SHA-256

- `24f3af20f4c0556d782963db9983c10faff20d4758d57d8014bd5ea13704a70e`

## 10. ICO Generation Method

- Script: `desktop/scripts/generate-icon.cjs`
- Input: `desktop/assets/branding/eshop-official-avatar-640.png`
- Output:
  - `desktop/build/icon.ico`
  - `desktop/build/installer-icon.ico`
  - `desktop/build/uninstaller-icon.ico`
- Dependency profile: Node built-ins only (`fs`, `path`, `crypto`, `zlib`)
- PNG handling: validates PNG signature, IHDR dimensions, bit depth, color type, non-interlace, then inflates IDAT and applies PNG row filters.
- Resizing: deterministic bilinear RGBA resize from the unchanged Founder source.
- ICO encoding: Windows ICO directory with uncompressed 32-bit BGRA DIB entries and zero AND masks.
- The script does not overwrite the Founder source PNG.

## 11. Embedded ICO Size Lists

All generated ICO files contain:

- 16 x 16
- 24 x 24
- 32 x 32
- 48 x 48
- 64 x 64
- 128 x 128
- 256 x 256

Verification command:

```bash
npm run generate:icon
npm run verify:branding
```

Verification result:

- `icon.ico`: valid, 7 entries, 32-bit
- `installer-icon.ico`: valid, 7 entries, 32-bit
- `uninstaller-icon.ico`: valid, 7 entries, 32-bit
- ICO SHA-256: `77a373cb209e944f5f36e51eadcf1656c4876b83288dc8ef26257ee09ef5b153`

## 12. electron-builder Configuration

- Config file: `desktop/electron-builder.yml`
- `productName`: `E-Shop Store OS`
- `appId`: `com.eshop.desktop`
- `directories.output`: `release-ep-mb3-05a`
- `directories.buildResources`: `build`
- `win.icon`: `build/icon.ico`
- `win.artifactName`: `E-Shop-Store-OS-Setup-${version}-EP-MB3-05A-${arch}.${ext}`
- `extraResources` build manifest source: `release-ep-mb3-05a/build-manifest.json`

## 13. NSIS Configuration

- `oneClick`: `false`
- `perMachine`: `false`
- `allowToChangeInstallationDirectory`: `true`
- `createDesktopShortcut`: `true`
- `createStartMenuShortcut`: `true`
- `shortcutName`: `E-Shop Store OS`
- `installerIcon`: `build/installer-icon.ico`
- `uninstallerIcon`: `build/uninstaller-icon.ico`
- `deleteAppDataOnUninstall`: `false`
- No `installerHeaderIcon`
- No custom NSIS include/script/macro
- No code signing

## 14. Product Metadata

- Package name: `eshop-desktop`
- Version: `1.0.0`
- ProductName: `E-Shop Store OS`
- FileDescription source: `desktop/package.json` description
- Company/product display source: `desktop/package.json` author, `E-Shop (店小二)`
- Copyright: `Copyright © 2026 E-Shop (店小二)`
- PublisherName: not configured
- Microsoft Verified Publisher: not claimed

## 15. BrowserWindow Modification

- `desktop/src/main/windowManager.ts`: not modified
- Employee window icon inheritance: expected from packaged EXE icon
- Customer window: unchanged and remains `skipTaskbar: true`

## 16. Taskbar / Alt+Tab Inheritance Judgment

The employee window should inherit from the packaged Windows EXE icon because no explicit BrowserWindow icon is configured. This must be verified on a Windows machine after installing the 05A artifact.

## 17. Tray Out of Scope

Tray icon remains explicitly out of EP-MB3-05A scope.

`desktop/src/main/tray.ts` was not modified.

## 18. installerHeaderIcon Out of Scope

`installerHeaderIcon` remains explicitly out of EP-MB3-05A scope.

No installer header redesign was added.

## 19. Test Results

Local verification on macOS:

- `npm ci`: PASS after running with filesystem permission for npm cache/logs
- `npm run generate:icon`: PASS
- `npm run verify:branding`: PASS
- `npm run typecheck`: PASS
- `npm run compile`: PASS
- `npm test`: PASS, 18 test files, 144 tests
- Provider regression at `c5cc86b35fa185aac795d0e141de549858b81f8b`: PASS, 7 passed, 1 skipped, 31 tests passed, 5 skipped
- `npm run release:windows`: PASS on macOS cross-build, output isolated to `desktop/release-ep-mb3-05a`
- `npm run verify:installer`: PASS locally with non-Windows Provider helper check skipped; Windows CI still enforces helper presence
- Root `npm run build`: PASS

## 20. CI Run ID

- Pending after first push.

## 21. CI Result

- Pending after first push.

## 22. Artifact Name

- CI artifact name: `eshop-store-os-windows-installer-ep-mb3-05a`
- Installer filename: `E-Shop-Store-OS-Setup-1.0.0-EP-MB3-05A-x64.exe`

## 23. Artifact Size

Local macOS cross-build:

- `E-Shop-Store-OS-Setup-1.0.0-EP-MB3-05A-x64.exe`: `82782016` bytes

CI artifact size:

- Pending after Windows CI.

## 24. Artifact SHA-256

Local macOS cross-build:

- `E-Shop-Store-OS-Setup-1.0.0-EP-MB3-05A-x64.exe`: `d594aec6d4cfb221f4a2ecb6a1653c8649cce8201c649e80c12b04b645e8b57c`
- `E-Shop-Store-OS-Setup-1.0.0-EP-MB3-05A-x64.exe.blockmap`: `8adfd6222b6d855f977c7dc43a9cb75202edda512780ef6d742b177be43c2b96`
- `build-manifest.json`: `e45e73cd634fcd4639a80bccc65b8daff551e1db234a080ed5982f0014d90c69`

CI artifact SHA-256:

- Pending after Windows CI.

## 25. Manifest Result

Local `build-manifest.json`:

```json
{
  "product": "E-Shop Store OS",
  "releasePackage": "EP-MB3-05A",
  "desktopVersion": "1.0.0",
  "providerVersion": "0.1.0",
  "desktopCommit": "135d8364209ec0513ef2c4bd61ff91db18cf3f3d",
  "providerCommit": "c5cc86b35fa185aac795d0e141de549858b81f8b",
  "channel": "stable",
  "platform": "win32",
  "arch": "x64"
}
```

After commit, CI manifest must reflect the final pushed implementation commit.

## 26. Old Release Directory Non-write Evidence

- Required legacy directory: `desktop/release`
- 05A output directory: `desktop/release-ep-mb3-05a`
- `desktop/release/E-Shop-Store-OS-Setup-1.0.0-x64.exe` remained present after the 05A build.
- Current local legacy file SHA-256: `9ad7a0ab80474bdb7285158043b5486667ec6dc53bf2d07d3175d2dd3d164815`
- The official old candidate SHA-256 remains recorded as: `c440b24dcec1727b50bb10ba013b74849e50b4068032cd3b3817fe4589dfb0ba`

## 27. Old Candidate Non-overwrite Evidence

- 05A installer filename: `E-Shop-Store-OS-Setup-1.0.0-EP-MB3-05A-x64.exe`
- Old candidate filename: `E-Shop-Store-OS-Setup-1.0.0-x64.exe`
- The names differ.
- The output directories differ.
- The release script removes only `desktop/release-ep-mb3-05a`, not `desktop/release`.

## 28. Provider Non-change Evidence

- Provider repository HEAD before and after local regression: `c5cc86b35fa185aac795d0e141de549858b81f8b`
- Desktop package only stages Provider artifacts under ignored `desktop/build/provider`.
- No Provider source changes are part of this commit.

## 29. Runtime Core Non-change Evidence

No Runtime Core, Device Runtime, Command Runtime, Provider supervision, Named Pipe transport, printer executor, printing payload, Cloud, database, KHQR, cashier business logic, customer H5, employee login, shift, lockscreen, or double-screen behavior files were modified.

Changed files are limited to Desktop branding asset, Desktop packaging scripts/config, CI upload paths, branding tests, `.gitignore`, and this evidence pack.

## 30. Remaining Windows Real-machine Checklist

1. Download CI artifact `eshop-store-os-windows-installer-ep-mb3-05a`.
2. Verify artifact SHA-256 matches CI `SHA256SUMS.txt`.
3. Install `E-Shop-Store-OS-Setup-1.0.0-EP-MB3-05A-x64.exe` on a clean Windows x64 POS machine.
4. Confirm installer icon shows the official Founder visual.
5. Confirm installed EXE icon shows the official Founder visual.
6. Confirm desktop shortcut icon shows the official Founder visual.
7. Confirm Start menu shortcut icon shows the official Founder visual.
8. Confirm uninstall entry icon/display is acceptable.
9. Launch app and confirm employee taskbar icon and Alt+Tab icon inherit correctly.
10. Confirm customer display remains `skipTaskbar` behavior.
11. Confirm Tray icon remains unchanged and is out of scope.
12. Confirm Provider starts and receipt dry-run still passes.
13. Confirm old `E-Shop-Store-OS-Setup-1.0.0-x64.exe` candidate was not replaced.
