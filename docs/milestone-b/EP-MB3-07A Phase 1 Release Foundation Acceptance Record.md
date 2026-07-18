# EP-MB3-07A Phase 1 Release Foundation Acceptance Record

## 1. Document Identity

Engineering Package: EP-MB3-07A — Release Channel & Update Safety

Phase: Phase 1 — Versioned Release Foundation

Status: ACCEPTED

Acceptance Date: 2026-07-18

Repository: `jasonmino-ops/light-ops-assistant`

Acceptance Branch: `feat/ep-mb3-07a-release-foundation`

Acceptance Reviewed HEAD: `4522ed5566853261bd4df11142c87a7afa2a79e2`

Baseline: `38cd64bef7665be3e2b47f04216e20f7d5e136f4`

Previous freeze tag: `ep-mb3-06b-desktop-activation-runtime-v1.0-final`

## 2. Accepted Scope

- Desktop unique version source: accepted.
- Versioned installer filename: accepted.
- Pilot / stable tag rules: accepted.
- GitHub Releases publishing foundation: accepted.
- Protected pilot release workflow: accepted.
- `pilot-release` Environment approval: accepted.
- `unsigned-internal` distribution classification: accepted.
- Prerelease-only pilot publishing: accepted.
- No push-triggered stable release: accepted.
- Explicit Release asset allowlist: accepted.
- `SHA256SUMS.txt`: accepted.
- Release provenance: accepted.
- Release notes: accepted.
- Remote Release asset download QA: accepted.
- pilot.1 failure evidence retained: accepted.
- pilot.2 remediation PASS: accepted.
- Existing Windows CI regression preserved: accepted.
- Frozen Boundary preserved: accepted.

## 3. Explicit Out of Scope

The following items are not accepted in Phase 1:

- updater runtime
- electron-updater integration
- UpdateService
- renderer update UI
- checkout safety
- Provider update shutdown
- `quitAndInstall`
- automatic rollback
- signed commercial release
- stable release workflow
- Store Trial
- Native Printer
- Local-first POS

## 4. Acceptance Gates

| Gate | Result |
| --- | --- |
| Engineering Scope Complete | PASS |
| Architecture Boundary Preserved | PASS |
| Version Identity Complete | PASS |
| Release Governance Complete | PASS |
| Workflow Security Complete | PASS |
| Pilot Release Complete | PASS |
| Remote Artifact Integrity Complete | PASS |
| Provenance Complete | PASS |
| Historical Failure Evidence Preserved | PASS |
| Existing CI Regression Preserved | PASS |
| Evidence Pack Complete | PASS |
| Remaining Conditions Closed | PASS |

## 5. pilot.1 Historical Evidence

Tag: `desktop-v0.2.0-pilot.1`

Commit: `ba3160b7215a34b89c7dbe177ed29e3098d9a9e0`

Workflow run: `29638879620`

Pipeline: PASS

Release QA: FAIL

Reason: unexpected `builder-debug.yml` not covered by manifest/provenance.

Historical Release retained: YES

Tag retained: YES

Assets unmodified: YES

## 6. pilot.2 Final Evidence

Tag: `desktop-v0.2.0-pilot.2`

Commit: `833917a8c4e51f37b5893bb911d23d9ac2a056e8`

Workflow: `desktop-release-pilot`

Run ID: `29640800444`

Pipeline: PASS

Environment approval: PASS

Prerelease: YES

Latest: NO

Distribution: `unsigned-internal`

Channel: `pilot`

Commercial Ready: NO

Store Pilot Ready: NO

Unexpected assets: NONE

`builder-debug.yml`: ABSENT

Remote SHA verification: PASS

Provenance verification: PASS

## 7. Release Assets

| Asset | Byte size | SHA-256 |
| --- | ---: | --- |
| `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe` | 81808981 | `84219b0da0b80f925878c5b9b9542e8e07db0c55f790f616e653c1395938be19` |
| `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe.blockmap` | 86096 | `9bf18ce12fa1f0e8ec29103a9ab1e3e67930e77502500ffcb7edbdf5d548183e` |
| `latest.yml` | 380 | `7634b9f333f0b3325203fc42c27f3984be40e2626aed6aadd5be6223fb03167b` |
| `SHA256SUMS.txt` | 497 | `ca11c78de50ea2289ee50ccad5222d8ae411309f6364265b12fa24f8e9bcfa4c` |
| `release-provenance-0.2.0-pilot.2.json` | 1655 | `e08d88d47281b49ba364b10aefe1a54411e00809e0c5c34da445f333e590ba0c` |
| `release-notes-0.2.0-pilot.2.md` | 237 | `f3feea7ae280f183dc33ced9ce2889346c51c3d1409de45b6c023d7e21eb21ea` |

## 8. Provenance Acceptance

- `desktopVersion`: `0.2.0-pilot.2`
- `releaseChannel`: `pilot`
- `defaultRuntimeChannel`: `stable`
- `distributionClass`: `unsigned-internal`
- `signingStatus`: `unsigned-internal`
- `gitCommitSha`: `833917a8c4e51f37b5893bb911d23d9ac2a056e8`
- `gitTag`: `desktop-v0.2.0-pilot.2`
- `workflowName`: `desktop-release-pilot`
- `workflowRunId`: `29640800444`
- `baselineFreezeTag`: `ep-mb3-06b-desktop-activation-runtime-v1.0-final`
- Sensitive values: NONE
- Private paths: NONE

## 9. Existing CI Evidence

Windows CI Run: `29629191977`

Result: PASS

- typecheck: PASS
- full tests: PASS
- activation regression: PASS
- compile: PASS
- safeStorage smoke: PASS
- Provider smoke: PASS
- Provider no-survivor: PASS
- NSIS package: PASS
- activation packaged assets: PASS
- Provider packaged resources: PASS
- SHA/provenance generation: PASS
- artifact upload: PASS

## 10. Workflow Governance

Environment: `pilot-release`

Required reviewer: `jasonmino-ops`

Prevent self-review: OFF

Administrator bypass: OFF

Deployment restriction: No restriction

Workflow trigger: `workflow_dispatch` only

Top/build permissions: `contents: read`

Publish permission: `contents: write`

Push-triggered release: NO

Stable auto release: NO

## 11. Workflow-Only Main Enablement

Initial workflow enablement commit: `7d12efbe15a8e10155b33a3b2ce005864528a77f`

Allowlist update commit: `9d7e13e34a4df14f4cc4cdf6b969a16a3c42bce1`

- Only `.github/workflows/desktop-release-pilot.yml` entered `main`.
- Full Phase 1 implementation is not yet integrated into `main`.
- No runtime behavior changed.
- This was solely to activate protected `workflow_dispatch`.

## 12. Commit Chain

| Commit | Subject |
| --- | --- |
| `660155f250278d09d018bb051790aada9c573660` | `build(desktop): establish versioned release foundation` |
| `a3c70eba9e3112ab018d30b7daf0e96ab33d9c43` | `fix(desktop): verify actual release metadata asset` |
| `f26643db834118542d299e1d78d79cd0c8983956` | `fix(desktop): publish actual update metadata asset` |
| `4a234ce84a519942de25189cd9ea23dd16827732` | `docs(desktop): add ep-mb3-07a phase 1 evidence` |
| `ba3160b7215a34b89c7dbe177ed29e3098d9a9e0` | `fix(ci): prevent pilot workflow input injection` |
| `833917a8c4e51f37b5893bb911d23d9ac2a056e8` | `fix(ci): restrict pilot release assets` |
| `4522ed5566853261bd4df11142c87a7afa2a79e2` | `docs(desktop): close EP-MB3-07A phase 1 conditions` |

Feature chain linear: YES

Merge commits in feature chain: 0

## 13. Security Acceptance

- No expression injection.
- No `Invoke-Expression` / `iex`.
- No broad Release asset glob.
- No unexpected public asset.
- No `signed-commercial` claim.
- No token, secret, or path leakage.
- Ordinary CI cannot publish Release.
- Only protected publish job has write permission.
- Release asset allowlist exact.

## 14. Remaining Limitations

These are non-blocking limitations after Phase 1 acceptance:

- `unsigned-internal` only.
- Not store-pilot ready.
- Not commercial ready.
- No signed distribution.
- No updater runtime.
- No stable release workflow.
- No automatic rollback.
- No Store Trial qualification.

## 15. Formal Acceptance Decision

Acceptance Decision: ACCEPTED

Remaining Technical Blockers: NONE

Ready to Merge: YES

Ready for Final Freeze after Merge: YES

## 16. Final Integration / Freeze

Merge Result: PASS

Merge Commit: `1cbd5ece702790a920ebfe926feca28b09cbe475`

Merge Strategy: `--no-ff`

Main Remote Sync: PASS

Final Freeze Decision: APPROVED

Final Freeze Tag: `ep-mb3-07a-phase1-release-foundation-v1.0-final`

Final Freeze Commit: `e0190e893ae5742b76143a0abb0f7804ec4b826e`

Final Frozen Main HEAD: ESTABLISHED BY ANNOTATED FREEZE TAG AND REMOTE VERIFICATION

Final Frozen Main HEAD Evidence: See final freeze execution result and annotated tag `ep-mb3-07a-phase1-release-foundation-v1.0-final`

Freeze Tag Target Policy: The annotated freeze tag must point to the metadata commit created after the freeze documentation commit.

Final Status: FINAL FROZEN
