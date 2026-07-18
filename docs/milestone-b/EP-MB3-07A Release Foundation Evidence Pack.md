# EP-MB3-07A Release Foundation Evidence Pack

Date: 2026-07-18

Package: EP-MB3-07A — Release Channel & Update Safety

Phase: Phase 1 — Versioned Release Foundation

Status: PHASE 1 CONDITION CLOSURE PASS

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
- pilot.2 remediation change set — strict release asset allowlist after pilot.1 Release QA failure

## 2. Phase 1 Scope

Implemented:

- Desktop version advanced from `0.1.0` to `0.2.0-pilot.2`
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
- pilot workflow stages and publishes only the explicit formal asset allowlist
- `builder-debug.yml` and arbitrary extra files are rejected as published release assets

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

Desktop version: `0.2.0-pilot.2`

Release channel: `pilot`

Default runtime channel: `stable`

Distribution class: `unsigned-internal`

Signing status: `unsigned-internal`

Pilot tag format: `desktop-v${version}`

Pilot remediation tag for the next dry run: `desktop-v0.2.0-pilot.2`

Stable tag format: `desktop-v0.2.0`

Installer filename: `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe`

Pilot update metadata name: `latest.yml`

Release asset rule: publish exactly the six formal allowlisted project assets. The electron-builder diagnostic file `builder-debug.yml` is not a formal release asset and must not be uploaded to GitHub Release, included in `SHA256SUMS.txt`, or included in provenance.

## 4. Release Assets

The Windows build workflow produces and uploads:

- `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe`
- `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`
- `release-provenance-0.2.0-pilot.2.json`
- `release-notes-0.2.0-pilot.2.md`

Release asset rules:

- installer name must include the Desktop version
- update metadata is the allowlisted `latest.yml` asset currently produced by electron-builder
- provenance and SHA manifest must include the installer, blockmap, metadata, notes, and provenance file
- duplicate release asset filenames are rejected
- published project assets must exactly equal the explicit allowlist
- GitHub-generated source archives are ignored by the project asset verifier
- `builder-debug.yml` is diagnostic build output only and is rejected if present in published project assets

## 5. GitHub Workflow

Existing workflow preserved:

- Path: `.github/workflows/desktop-windows-build.yml`
- Trigger: push to `main` / `feat/**`, workflow dispatch
- Release behavior: no GitHub Release creation
- Publishing behavior: `npx electron-builder --win --x64 --publish never`
- Added evidence generation: release foundation policy, provenance, SHA manifest
- Artifact upload: installer, blockmap, `latest.yml`, SHA manifest, provenance, release notes

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
- Asset upload behavior: stages `pilot-release-bundle` from explicit filenames, then uploads only the allowlisted files
- GitHub Release creation behavior: passes exact file paths to `gh release create`; no broad `*.yml` release upload is permitted

Default branch workflow visibility at initial implementation time:

- GitHub API listed active default-branch workflows: `cloud-ci`, `desktop-windows-build`, `EP-MB3-06B Windows Diagnostic`
- `desktop-release-pilot.yml` is new on the feature branch and is not active on default branch until merged
- Result at that time: real `workflow_dispatch` pilot prerelease dry run could not be claimed complete before workflow activation on default branch
- Follow-up state: workflow-only main enablement occurred and pilot.1 protected dry run executed

Pilot.1 Release QA result:

- Tag: `desktop-v0.2.0-pilot.1`
- Commit: `ba3160b7215a34b89c7dbe177ed29e3098d9a9e0`
- Result: FAIL
- Reason: GitHub Release contained unexpected `builder-debug.yml`
- Decision: keep pilot.1 Release and tag untouched as failed QA evidence; do not add `builder-debug.yml` to SHA manifest or provenance

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
- missing allowlisted assets fail verification
- unexpected published assets fail verification
- `builder-debug.yml` fails verification if present in published project assets
- signed-commercial claims are rejected in Phase 1

Remote Release verification:

- The pilot workflow downloads the created GitHub Release assets after upload and re-runs `release-foundation.mjs verify`
- pilot.1 remote verification failed due unexpected `builder-debug.yml`
- pilot.2 remote verification passed with the strict six-asset allowlist

## 7. Local Validation

Local validation completed on 2026-07-18 before pilot.2 remediation:

- root `npm run build`: PASS
- desktop `npm run typecheck`: PASS
- desktop `npx vitest run tests/release-foundation.test.ts --reporter=verbose`: PASS, 6 tests
- desktop `npm test`: PASS, 19 files / 143 tests
- desktop `npm run compile`: PASS
- desktop `npm run release:foundation:policy`: PASS
- local mac-arm64 `npm run pack:dir`: PASS during Phase 1 implementation
- `node scripts/verify-activation-assets.mjs dist`: PASS during Phase 1 implementation

Pilot.2 remediation validation:

- desktop `npm run release:foundation:policy`: PASS
- desktop `npx vitest run tests/release-foundation.test.ts --reporter=verbose`: PASS, 8 tests
- desktop `npm run typecheck`: PASS
- desktop `npm test`: PASS, 19 files / 145 tests
- desktop `npm run compile`: PASS
- root `npm run build`: PASS

Local limitations:

- Local machine can validate mac-arm64 dir packaging only
- Real Windows installer, blockmap, packaged Provider resource, and Windows artifact upload require Windows GitHub Actions

## 8. Windows CI

Final branch CI run before pilot.2 remediation:

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

Release URL: `https://github.com/jasonmino-ops/light-ops-assistant/releases/tag/desktop-v0.2.0-pilot.1`

Tag: `desktop-v0.2.0-pilot.1`

Prerelease: yes

Workflow run: protected pilot prerelease dry run executed

Assets: uploaded to GitHub Release

Result: FAIL

Failure:

- Required assets, SHA manifest, and provenance passed
- GitHub Release contained unexpected `builder-debug.yml`
- `builder-debug.yml` was not listed in `SHA256SUMS.txt`
- `builder-debug.yml` was not listed in provenance
- `builder-debug.yml` contained CI runner paths and was classified as diagnostic build output, not formal distribution asset

Remediation:

- Existing pilot.1 Release and tag remain untouched as historical failed QA evidence
- Next dry run version: `0.2.0-pilot.2`
- Next dry run tag: `desktop-v0.2.0-pilot.2`
- Publish path now uses a strict allowlisted bundle and exact `gh release create` file arguments

No stable release was created.

No commercial-ready Release was created.

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

Phase 1 review conditions:

- NONE

Closed Phase 1 conditions:

- feature branch pilot.2 remediation committed and pushed
- main workflow-only pilot release file updated with the strict allowlist
- unsigned internal `0.2.0-pilot.2` prerelease dry run executed through the protected workflow
- GitHub Release remote asset allowlist verification passed
- GitHub Release remote asset SHA verification passed
- GitHub Release provenance verification passed

Required before signed/store/commercial readiness:

- signing certificate route selected
- signing certificate/KYC complete
- signing secrets injected into protected GitHub Environment
- Authenticode verification Gate implemented and passed
- signed commercial build classified as `signed-commercial`

## 13. Recommendation

Phase 1 pilot.2 condition closure is ready for Phase 1 Acceptance Review.

It does not claim store pilot readiness, commercial readiness, signed distribution readiness, or Phase 2 readiness.

READY FOR EP-MB3-07A PHASE 1 REVIEW: YES

## 14. Final Condition Closure

Independent Review Result: CONDITIONAL PASS

Phase 1 Condition Closure: PASS

Remaining Phase 1 Review Conditions: NONE

Ready for Phase 1 Acceptance Review: YES

This section closes EP-MB3-07A Phase 1 review conditions only. It does not claim store pilot readiness, commercial readiness, signed distribution readiness, or any Phase 2 work.

### M1 Closure

Original issue:

- The pilot workflow originally allowed direct GitHub expression interpolation in PowerShell context for the version input.
- M1 replaced that with `INPUT_VERSION` environment-variable indirection before PowerShell reads the value.

Security fix commit: `ba3160b7215a34b89c7dbe177ed29e3098d9a9e0`

Status: CLOSED

### GitHub Environment Evidence

Environment: `pilot-release`

Required reviewer: `jasonmino-ops`

Prevent self-review: OFF

Administrator bypass: OFF

Deployment branches/tags: No restriction

Secrets: NONE

Variables: NONE

Status: CLOSED

### Workflow-Only Main Enablement

Initial enablement commit: `7d12efbe15a8e10155b33a3b2ce005864528a77f`

Pilot.2 allowlist workflow update commit: `9d7e13e34a4df14f4cc4cdf6b969a16a3c42bce1`

Governance notes:

- Full Phase 1 implementation was not merged by these commits.
- Only `.github/workflows/desktop-release-pilot.yml` entered `main`.
- No production runtime behavior changed.

### pilot.1 History

Tag: `desktop-v0.2.0-pilot.1`

Commit: `ba3160b7215a34b89c7dbe177ed29e3098d9a9e0`

Workflow run: `29638879620`

Pipeline: PASS

Release QA: FAIL

Reason: unexpected `builder-debug.yml` was present in the GitHub Release and was not covered by `SHA256SUMS.txt` or release provenance.

Historical Release retained: YES

### pilot.2 Final Release Evidence

Tag: `desktop-v0.2.0-pilot.2`

Commit: `833917a8c4e51f37b5893bb911d23d9ac2a056e8`

Workflow: `desktop-release-pilot`

Workflow run: `29640800444`

Pipeline: PASS

Environment approval: PASS

Prerelease: YES

Latest: NO

Distribution: `unsigned-internal`

Channel: `pilot`

Commercial Ready: NO

Store Pilot Ready: NO

Release asset allowlist: PASS

Unexpected assets: NONE

`builder-debug.yml`: ABSENT

Remote SHA verification: PASS

Provenance verification: PASS

### Release Assets

| Asset | Byte size | SHA-256 |
| --- | ---: | --- |
| `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe` | 81808981 | `84219b0da0b80f925878c5b9b9542e8e07db0c55f790f616e653c1395938be19` |
| `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe.blockmap` | 86096 | `9bf18ce12fa1f0e8ec29103a9ab1e3e67930e77502500ffcb7edbdf5d548183e` |
| `latest.yml` | 380 | `7634b9f333f0b3325203fc42c27f3984be40e2626aed6aadd5be6223fb03167b` |
| `SHA256SUMS.txt` | 497 | not self-hashed by project manifest |
| `release-provenance-0.2.0-pilot.2.json` | 1655 | `e08d88d47281b49ba364b10aefe1a54411e00809e0c5c34da445f333e590ba0c` |
| `release-notes-0.2.0-pilot.2.md` | 237 | `f3feea7ae280f183dc33ced9ce2889346c51c3d1409de45b6c023d7e21eb21ea` |

Installer SHA cross-check:

- `shasum -a 256`: `84219b0da0b80f925878c5b9b9542e8e07db0c55f790f616e653c1395938be19`
- `SHA256SUMS.txt`: `84219b0da0b80f925878c5b9b9542e8e07db0c55f790f616e653c1395938be19`
- `openssl dgst -sha256`: `84219b0da0b80f925878c5b9b9542e8e07db0c55f790f616e653c1395938be19`

All installer SHA values match.

### Provenance QA

Required fields present:

- `schemaVersion`
- `packageName`
- `desktopVersion`
- `releaseChannel`
- `defaultRuntimeChannel`
- `distributionClass`
- `signingStatus`
- `gitCommitSha`
- `gitTag`
- `workflowName`
- `workflowRunId`
- `buildTimestamp`
- `nodeVersion`
- `electronVersion`
- `electronBuilderVersion`
- `artifactFilenames`
- `artifacts`
- `providerPinnedCommit`
- `baselineFreezeTag`

Verified values:

- `schemaVersion`: `ep-mb3-07a.release-provenance.v1`
- `packageName`: `eshop-desktop`
- `desktopVersion`: `0.2.0-pilot.2`
- `releaseChannel`: `pilot`
- `defaultRuntimeChannel`: `stable`
- `distributionClass`: `unsigned-internal`
- `signingStatus`: `unsigned-internal`
- `gitCommitSha`: `833917a8c4e51f37b5893bb911d23d9ac2a056e8`
- `gitTag`: `desktop-v0.2.0-pilot.2`
- `workflowName`: `desktop-release-pilot`
- `workflowRunId`: `29640800444`
- `buildTimestamp`: `2026-07-18T10:25:13.2941827Z`
- `nodeVersion`: `v22.23.1`
- `electronVersion`: `33.4.11`
- `electronBuilderVersion`: `25.1.8`
- `providerPinnedCommit`: `7785be145d5259991038d17839d322e2694e338c`
- `baselineFreezeTag`: `ep-mb3-06b-desktop-activation-runtime-v1.0-final`

Sensitive data scan:

- token: ABSENT
- GitHub secret: ABSENT
- certificate password: ABSENT
- activation credential: ABSENT
- signed-commercial claim: ABSENT
- store-pilot-ready claim: ABSENT

Path scan:

- local absolute path: ABSENT
- CI runner private path: ABSENT

Result: PASS

### Condition Closure Matrix

| Condition | Result |
| --- | --- |
| Version Identity Gate | CLOSED |
| Release Channel Gate | CLOSED |
| Workflow Permission Gate | CLOSED |
| Distribution Classification Gate | CLOSED |
| Provenance Gate | CLOSED |
| Local Artifact Integrity Gate | CLOSED |
| Remote Release Artifact Integrity Gate | CLOSED |
| Existing Windows CI Regression Gate | CLOSED |
| Frozen Boundary Gate | CLOSED |
| GitHub Environment Gate | CLOSED |
| Pilot Prerelease Dry Run Gate | CLOSED |
| M1 workflow expression injection | CLOSED |
| pilot.1 unexpected `builder-debug.yml` | CLOSED BY pilot.2 strict allowlist |

Final pilot.1 classification: Historical Release QA FAIL

Final pilot.2 classification: Final Phase 1 Release QA PASS
