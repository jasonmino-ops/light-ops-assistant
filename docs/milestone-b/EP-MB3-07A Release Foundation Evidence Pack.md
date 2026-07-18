# EP-MB3-07A Release Foundation Evidence Pack

Date: 2026-07-18

Package: EP-MB3-07A — Release Channel & Update Safety

Phase: Phase 1 — Versioned Release Foundation

Status: IMPLEMENTED WITH CONDITIONS

This evidence pack records the Phase 1 implementation only. It does not claim EP-MB3-07A Acceptance, Final Freeze, store pilot readiness, signed distribution readiness, or commercial release readiness.

## 1. Baseline

Repository: `/Users/jason/light-ops-assistant`

Starting branch: `main`

Starting HEAD / origin/main: `38cd64bef7665be3e2b47f04216e20f7d5e136f4`

Freeze tag: `ep-mb3-06b-desktop-activation-runtime-v1.0-final`

Freeze tag target verified: `38cd64bef7665be3e2b47f04216e20f7d5e136f4`

Feature branch: `feat/ep-mb3-07a-release-foundation`

Implementation commits:

- `660155f250278d09d018bb051790aada9c573660` — `build(desktop): establish versioned release foundation`
- `a3c70eba9e3112ab018d30b7daf0e96ab33d9c43` — `fix(desktop): verify actual release metadata asset`
- `f26643db834118542d299e1d78d79cd0c8983956` — `fix(desktop): publish actual update metadata asset`

## 2. Phase 1 Scope

Implemented:

- Desktop version advanced from `0.1.0` to `0.2.0-pilot.1`
- `desktop/package.json` remains the Desktop version source
- NSIS installer filename remains versioned as `E-Shop-Desktop-Setup-${version}.${ext}`
- GitHub publish provider metadata added for update metadata generation
- ordinary Windows CI remains non-publishing with `--publish never`
- release foundation policy/provenance/SHA verification script added
- release foundation Vitest coverage added
- manual pilot release workflow skeleton added
- unsigned internal pilot distribution classification enforced
- provenance manifest and SHA manifest generation defined
- GitHub Release upload path includes remote asset re-verification in the pilot workflow
- workflows publish the actual builder `*.yml` metadata asset instead of hard-coding `pilot.yml`

Not implemented in Phase 1:

- UpdateService
- electron-updater runtime
- renderer update UI
- checkout safety IPC
- Provider shutdown integration
- `quitAndInstall`
- automatic rollback
- signing certificate integration
- Authenticode commercial Gate
- Store Trial
- Native Printer
- Local-first POS

## 3. Release Foundation

Version source: `desktop/package.json`

Desktop version: `0.2.0-pilot.1`

Release channel: `pilot`

Default runtime channel: `stable`

Distribution class: `unsigned-internal`

Signing status: `unsigned-internal`

Pilot tag format: `desktop-v${version}`

Pilot tag for this phase: `desktop-v0.2.0-pilot.1`

Stable tag format: `desktop-v0.2.0`

Installer filename: `E-Shop-Desktop-Setup-0.2.0-pilot.1.exe`

Policy-inferred pilot metadata name: `pilot.yml`

Actual update metadata rule: hash, upload, and publish the single actual builder `*.yml` file produced in the release directory. This protects the workflow from electron-builder metadata filename differences when `--publish never` is used.

## 4. Release Assets

The Windows build workflow produces and uploads:

- `E-Shop-Desktop-Setup-0.2.0-pilot.1.exe`
- `E-Shop-Desktop-Setup-0.2.0-pilot.1.exe.blockmap`
- one actual builder `*.yml` update metadata file
- `SHA256SUMS.txt`
- `release-provenance-0.2.0-pilot.1.json`
- `release-notes-0.2.0-pilot.1.md`

Release asset rules:

- installer name must include the Desktop version
- metadata is selected from actual release output, not guessed by workflow asset paths
- provenance and SHA manifest must include the installer, blockmap, metadata, notes, and provenance file
- duplicate release asset filenames are rejected

## 5. GitHub Workflow

Existing workflow preserved:

- Path: `.github/workflows/desktop-windows-build.yml`
- Trigger: push to `main` / `feat/**`, workflow dispatch
- Release behavior: no GitHub Release creation
- Publishing behavior: `npx electron-builder --win --x64 --publish never`
- Added evidence generation: release foundation policy, provenance, SHA manifest
- Artifact upload: installer, blockmap, actual `*.yml`, SHA manifest, provenance, release notes

New pilot workflow:

- Path: `.github/workflows/desktop-release-pilot.yml`
- Trigger: `workflow_dispatch`
- Environment: `pilot-release`
- Build job permission: `contents: read`
- Release job permission: `contents: write`
- Release type: GitHub prerelease
- Stable protection: no push trigger; no stable release automation
- Signing behavior: unsigned internal only; no commercial signing claim
- Remote verification: downloads created release assets and re-runs `release-foundation.mjs verify`

Default branch workflow visibility at implementation time:

- GitHub API listed active default-branch workflows: `cloud-ci`, `desktop-windows-build`, `EP-MB3-06B Windows Diagnostic`
- `desktop-release-pilot.yml` is new on the feature branch and is not active on default branch until merged
- Result: real `workflow_dispatch` pilot prerelease dry run cannot be claimed complete before workflow activation on default branch

## 6. Artifact Integrity

Implemented mechanism:

- `desktop/scripts/release-foundation.mjs write`
- `desktop/scripts/release-foundation.mjs verify`
- `desktop/scripts/release-foundation.mjs policy`

Integrity behavior:

- release filenames must be unique
- installer, blockmap, channel metadata, release notes, and provenance are hashed
- `SHA256SUMS.txt` is generated from release assets
- provenance includes artifact filenames, byte sizes, SHA-256, workflow name, workflow run ID, build timestamp, commit SHA, tag, Electron version, electron-builder version, Provider pinned commit, and freeze tag
- provenance rejects secret-like fields and values
- tampered assets fail verification
- duplicate SHA entries fail verification
- signed-commercial claims are rejected in Phase 1

Remote Release verification:

- The pilot workflow downloads the created GitHub Release assets after upload and re-runs `release-foundation.mjs verify`
- This remote verification has not yet run because the pilot workflow has not yet been activated on default branch

## 7. Local Validation

Local validation completed on 2026-07-18:

- root `npm run build`: PASS
- desktop `npm run typecheck`: PASS
- desktop `npx vitest run tests/release-foundation.test.ts --reporter=verbose`: PASS, 6 tests
- desktop `npm test`: PASS, 19 files / 143 tests
- desktop `npm run compile`: PASS
- desktop `npm run release:foundation:policy`: PASS
- local mac-arm64 `npm run pack:dir`: PASS during Phase 1 implementation
- `node scripts/verify-activation-assets.mjs dist`: PASS during Phase 1 implementation

Local limitations:

- Local machine can validate mac-arm64 dir packaging only
- Real Windows installer, blockmap, packaged Provider resource, and Windows artifact upload require Windows GitHub Actions

## 8. Windows CI

Final branch CI run:

- Workflow: `desktop-windows-build`
- Run ID: `29629191977`
- URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29629191977`
- Event: push
- Head SHA: `f26643db834118542d299e1d78d79cd0c8983956`
- Status: completed
- Conclusion: success
- Job: `build-windows`
- Job URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29629191977/job/88039476596`
- Completed at: `2026-07-18T03:41:21Z`

PASS steps:

- checkout
- Provider repo checkout
- setup-node
- Contract install/build
- Desktop install
- Provider install/build
- exact Provider commit verification
- Desktop typecheck
- activation focused tests
- full unit tests
- compile main/preload
- activation dist asset verification
- static security scans
- release foundation policy
- safeStorage smoke
- Provider supervision pipe integration
- Provider smoke with spaces
- no surviving Provider process
- Windows installer build (NSIS, unsigned)
- packaged activation asset verification
- packaged Provider resource verification
- release foundation manifest generation
- installer artifact upload

Final CI artifact:

- Name: `eshop-desktop-windows-installer`
- Artifact ID: `8424899375`
- Size: `81892606` bytes
- Digest: `sha256:029acda4f13eb98aa629dc95df0d759c16deb5934ebe73ea1c5c8ea042302e7f`
- Expires at: `2026-10-16T03:39:08Z`

Earlier CI attempts:

- Run `29628876803` at `660155f250278d09d018bb051790aada9c573660`: failed at release foundation manifest generation because metadata filename handling was too strict
- Run `29629024516` at `a3c70eba9e3112ab018d30b7daf0e96ab33d9c43`: success; superseded by final run `29629191977`

## 9. GitHub Release Dry Run

Release URL: not created

Tag: `desktop-v0.2.0-pilot.1`

Prerelease: intended, not created

Workflow run: not executed

Assets: not uploaded to GitHub Release

Result: BLOCKED BY EXTERNAL GITHUB CONFIGURATION / WORKFLOW ACTIVATION

Blockers:

- `desktop-release-pilot.yml` is new on feature branch and not active on default branch yet
- `pilot-release` GitHub Environment protection has not been verified
- local `gh` CLI is not installed
- no authenticated local GitHub write token was available for safe manual release dispatch

No stable release was created.

No GitHub Release was created.

No tag was created.

## 10. Frozen Boundary

Verified by `release-foundation.mjs policy` and explicit git diff checks:

- 06A Cloud Activation Contract diff: 0
- ActivationRuntime diff: 0
- CredentialStore diff: 0
- main startup gate diff: 0
- WindowManager diff: 0
- Runtime Core diff: 0
- Provider Contract diff: 0
- Prisma diff: 0
- Payment diff: 0
- Printer diff: 0
- Scanner diff: 0
- cashier/customer/mobile business diff: 0

## 11. Signing

Phase 1 signing status:

- signingStatus: `unsigned-internal`
- distributionClass: `unsigned-internal`

Commercial signing status:

- not implemented
- not verified
- not passed

Signed Distribution Gate remains required before:

- EP-MB3-07A Acceptance
- EP-MB3-07A Final Freeze
- store pilot
- commercial stable release

## 12. Remaining Conditions

Required before Phase 1 full acceptance:

- pilot workflow becomes active on default branch
- GitHub Environment `pilot-release` exists and protection rules are verified
- unsigned internal pilot prerelease dry run executes through the protected workflow
- GitHub Release remote asset SHA verification passes

Required before signed/store/commercial readiness:

- signing certificate route selected
- signing certificate/KYC complete
- signing secrets injected into protected GitHub Environment
- Authenticode verification Gate implemented and passed
- signed commercial build classified as `signed-commercial`

## 13. Recommendation

Phase 1 implementation is ready for engineering review with conditions.

It is not ready for EP-MB3-07A Final Acceptance or Final Freeze until the protected pilot release dry run and Signed Distribution Gate conditions are completed.

READY FOR EP-MB3-07A PHASE 1 REVIEW: YES
