# EP-MB3-07A Phase 1 Release Foundation Final Freeze Record

## 1. Document Identity

Engineering Package: EP-MB3-07A — Release Channel & Update Safety

Phase: Phase 1 — Versioned Release Foundation

Final Status: FINAL FROZEN

Freeze Date: 2026-07-18

Repository: `jasonmino-ops/light-ops-assistant`

Frozen Branch: `main`

Merged Main Commit: `1cbd5ece702790a920ebfe926feca28b09cbe475`

Accepted Feature HEAD: `440dd327bfcd31b88d4c517a952c4ac5bdb0d72e`

Original Baseline: `38cd64bef7665be3e2b47f04216e20f7d5e136f4`

Previous Freeze Tag: `ep-mb3-06b-desktop-activation-runtime-v1.0-final`

Planned Freeze Tag: `ep-mb3-07a-phase1-release-foundation-v1.0-final`

Freeze Documentation Commit: `e0190e893ae5742b76143a0abb0f7804ec4b826e`

Final Frozen Main HEAD: ESTABLISHED BY ANNOTATED FREEZE TAG AND REMOTE VERIFICATION

Final Frozen Main HEAD Evidence: See final freeze execution result and annotated tag `ep-mb3-07a-phase1-release-foundation-v1.0-final`

Freeze Tag Target Policy: The annotated freeze tag must point to the metadata commit created after the freeze documentation commit.

The metadata commit SHA cannot be embedded in its own committed tree. The authoritative final frozen main HEAD is therefore established by:

1. local HEAD after metadata commit;
2. origin/main after push;
3. annotated freeze tag peeled commit;
4. remote tag peeled commit;
5. final freeze execution evidence.

## 2. Frozen Scope

The following Phase 1 scope is formally frozen:

- Desktop version identity
- versioned installer naming
- pilot/stable tag conventions
- GitHub Release foundation
- protected pilot workflow
- pilot-release Environment approval
- unsigned-internal classification
- prerelease-only pilot release
- no automatic stable release
- explicit project asset allowlist
- SHA256SUMS
- release provenance
- release notes
- remote Release asset verification
- pilot.1 historical failure retention
- pilot.2 final successful remediation
- workflow security hardening
- Existing Windows CI regression preservation
- frozen architectural boundaries

## 3. Accepted but Limited Status

Distribution Class: unsigned-internal

Commercial Ready: NO

Store Pilot Ready: NO

Signed Distribution: NO

Updater Runtime: NOT INCLUDED

Stable Release Workflow: NOT INCLUDED

Automatic Rollback: NOT INCLUDED

Store Trial Qualification: NOT INCLUDED

## 4. pilot.1 Historical Evidence

Tag: `desktop-v0.2.0-pilot.1`

Commit: `ba3160b7215a34b89c7dbe177ed29e3098d9a9e0`

Workflow Run: `29638879620`

Pipeline: PASS

Release QA: FAIL

Reason: unexpected `builder-debug.yml` not covered by manifest/provenance

Historical Release retained: YES

Assets unmodified: YES

## 5. pilot.2 Frozen Release Evidence

Tag: `desktop-v0.2.0-pilot.2`

Commit: `833917a8c4e51f37b5893bb911d23d9ac2a056e8`

Workflow: `desktop-release-pilot`

Workflow Run: `29640800444`

Environment Approval: PASS

Pipeline: PASS

Release QA: PASS

Prerelease: YES

Latest: NO

Distribution: unsigned-internal

Channel: pilot

Unexpected Assets: NONE

builder-debug.yml: ABSENT

Remote SHA Verification: PASS

Provenance Verification: PASS

## 6. Frozen Release Assets

| Asset | Byte Size | SHA-256 |
| --- | ---: | --- |
| `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe` | 81808981 | `84219b0da0b80f925878c5b9b9542e8e07db0c55f790f616e653c1395938be19` |
| `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe.blockmap` | 86096 | `9bf18ce12fa1f0e8ec29103a9ab1e3e67930e77502500ffcb7edbdf5d548183e` |
| `latest.yml` | 380 | `7634b9f333f0b3325203fc42c27f3984be40e2626aed6aadd5be6223fb03167b` |
| `SHA256SUMS.txt` | 497 | `ca11c78de50ea2289ee50ccad5222d8ae411309f6364265b12fa24f8e9bcfa4c` |
| `release-provenance-0.2.0-pilot.2.json` | 1655 | `e08d88d47281b49ba364b10aefe1a54411e00809e0c5c34da445f333e590ba0c` |
| `release-notes-0.2.0-pilot.2.md` | 237 | `f3feea7ae280f183dc33ced9ce2889346c51c3d1409de45b6c023d7e21eb21ea` |

## 7. Provenance Freeze

desktopVersion: `0.2.0-pilot.2`

releaseChannel: `pilot`

defaultRuntimeChannel: `stable`

distributionClass: `unsigned-internal`

signingStatus: `unsigned-internal`

gitCommitSha: `833917a8c4e51f37b5893bb911d23d9ac2a056e8`

gitTag: `desktop-v0.2.0-pilot.2`

workflowName: `desktop-release-pilot`

workflowRunId: `29640800444`

baselineFreezeTag: `ep-mb3-06b-desktop-activation-runtime-v1.0-final`

Sensitive Data: NONE

Private Paths: NONE

## 8. Acceptance and Merge Chain

Acceptance reviewed HEAD: `4522ed5566853261bd4df11142c87a7afa2a79e2`

Acceptance commit: `440dd327bfcd31b88d4c517a952c4ac5bdb0d72e`

Merge commit: `1cbd5ece702790a920ebfe926feca28b09cbe475`

Merge strategy: `--no-ff`

Merge parent 1: `9d7e13e34a4df14f4cc4cdf6b969a16a3c42bce1`

Merge parent 2: `440dd327bfcd31b88d4c517a952c4ac5bdb0d72e`

Merge tree equals accepted feature tree: YES

## 9. Regression Evidence

Windows CI Run: `29629191977`

Result: PASS

Post-Merge Verification:

- npm ci: PASS
- typecheck: PASS
- tests: PASS — 145 passed
- compile: PASS
- release foundation focused validation: PASS

## 10. Governance Freeze

Environment: `pilot-release`

Required Reviewer: `jasonmino-ops`

Prevent Self Review: OFF

Administrator Bypass: OFF

Deployment Restriction: No restriction

Trigger: `workflow_dispatch` only

Top/build permission: `contents: read`

Publish permission: `contents: write`

Push-triggered Release: NO

Stable Auto Release: NO

## 11. Security Freeze

Workflow expression injection: CLOSED

Direct `inputs.version` in PowerShell body: ABSENT

Invoke-Expression / iex: ABSENT

Broad release asset glob: ABSENT

Unexpected public asset: ABSENT in pilot.2

signed-commercial claim: ABSENT

Secret/token leakage: NONE

Private path leakage: NONE

Ordinary CI publish permission: NONE

## 12. Frozen Boundary

06A Cloud Activation Contract: PRESERVED

ActivationRuntime: PRESERVED

CredentialStore: PRESERVED

Main startup gate: PRESERVED

WindowManager: PRESERVED

Provider: PRESERVED

Provider Contract: PRESERVED

Runtime Core: PRESERVED

Prisma: PRESERVED

Payment: PRESERVED

Printer: PRESERVED

Scanner: PRESERVED

cashier/customer/mobile flows: PRESERVED

## 13. Non-Frozen Future Work

The following remain future Engineering Package work:

- code signing
- signed-commercial distribution
- stable release workflow
- updater runtime
- update UI
- install coordination
- checkout safety
- Provider shutdown before update
- rollback
- Store Deployment
- Store Trial
- Local-first Desktop POS

## 14. Final Freeze Decision

Final Freeze Decision: APPROVED

Final Status: FINAL FROZEN

Remaining Phase 1 Blockers: NONE

Phase 1 Scope Reopen Policy: Requires a new Engineering Package or formal reopen decision
