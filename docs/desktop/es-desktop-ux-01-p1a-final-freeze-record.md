# ES-DESKTOP-UX-01 P1A — Fullscreen Foundation Final Freeze Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Basic Information

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-UX-01 / P1A — Fullscreen Foundation` |
| Status | `FINAL FROZEN / CLOSED` |
| Freeze Date | `2026-09-16` |
| Exact FIELD Candidate | `65eb082e19683658ceda29254d5454a920bb208d` |
| Founder-confirmed Installer SHA-256 | `5fb9d37f2a44c316c1957ffb0855b2dba682da4d8103eb5aba11eff495c766ab` |
| Acceptance Evidence Commit | `4c4cc2fedf8e6197827c18421a580b45db981e32` |
| P1A Merge Commit | `15bfe4aaf3ea1be48ff1a7b1c5d06aca9ca731c1` |
| Release-asset Hygiene Commit | `0845ee3396a3a2f020a79827916d115d25d7df58` |
| Main Desktop CI | `35086646307` — `PASS` |
| Target Machine | `V727 / PC-20260119FZUI` |
| FIELD Record | `docs/store-validation/es-desktop-ux-01-p1a-v727-field-verification-record.md` |
| Production Evidence | `5de2b3932981a988d5185e2a1ee4b83e3e0c35fa` — `READY`; read-only, no Production change |

## Freeze Decision

```text
P1A FIELD VERIFIED = YES
P1A ACCEPTANCE      = ACCEPTED
P1A MERGE           = PASS
MAIN DESKTOP CI     = PASS
P1A FINAL FROZEN    = YES
P1A CLOSED          = YES
P1B STARTED         = NO
```

P1A is frozen only for the accepted Fullscreen Foundation scope and the minimum prerequisites proven necessary to execute its real Windows FIELD. No later Desktop phase is authorized by this record.

## Frozen Scope

- Electron main process remains the sole automatic-fullscreen owner.
- Authorized Desktop startup restores the verified store and enters native employee-window fullscreen.
- Fullscreen physical bounds do not replace the saved normal-window preference.
- Exiting fullscreen restores the saved normal-window size and position.
- `ESHOP_DESKTOP_DISABLE_AUTO_FULLSCREEN=1` remains a process-local temporary opt-out.
- The installed Desktop uses its official current-user Windows login auto-start registration.
- Activation renderer boot, credential persistence, installer upgrade lifecycle, and verified store launch-context prerequisites remain as accepted.

The following are outside this freeze: P1B, Web POS authorization compatibility, cashier business behavior, API, schema, migration, RC9, Printing Core, Provider/HRT changes, Cloud business logic, and P2 through P8.

## Frozen Artifacts

| Artifact | SHA-256 |
| --- | --- |
| `desktop/electron-builder.yml` | `461c6f62407dfb991ce5938eb1fa023f49fa5a9a4531175af21194911eed160e` |
| `desktop/build/installer.nsh` | `161e75a6d868e0c4af47c4ed98a5a274c85d41fca157629d448a6893c339ce9e` |
| `desktop/src/main/config.ts` | `ee77070297c3cc35a251ed658ccf1f4518a618c0b3b5063c46b6330733ab006a` |
| `desktop/src/main/main.ts` | `4a358f02be1000ee56467a3d03d32a229f0e9fba26175576a8818a698f488dc6` |
| `desktop/src/main/windowManager.ts` | `cc4896d55ed3692b05f62be3ffa7a0fb281e57e9245a7d6ea3c6f6146484f41d` |
| `desktop/tests/fullscreen-foundation.test.ts` | `29967d7c865eedf49776c19764992b173b9a75b6bc60a937927c0a2fbace0fc9` |
| `desktop/tests/windows-autostart-installer.test.ts` | `0b18d855780bb72a2a5e29a6b3bafd5f90e0f95bdb28d49c2cfaff755ae045e6` |
| `desktop/tests/activation-renderer-boot.test.ts` | `bcc3aee97c1d685bb2b31b92304383a4c7b1fd055c2669d0a1cdb2fba0e238d3` |
| `desktop/tests/windows-installer-upgrade-lifecycle.test.ts` | `dbec062d74837879342f3545d7b22b4258c704c446428bd0cd9091793aaf8d2e` |
| `desktop/tests/activation-launch-context.test.ts` | `b08d06f59ead028bad039d90170f4bdb727a9d6a51b4c3d6f25191c147149405` |

These hashes record the accepted bytes at the freeze baseline. Future changes require a separately authorized successor-change review; this record is not a blanket prohibition on later governed Desktop work.

## Evidence Integrity

| Gate | Result |
| --- | --- |
| Founder FIELD on V727 | `PASS` |
| Windows login auto-start and cold start | `PASS` |
| Activation credential and Mino Pet Shop / `ST169E7000` restore | `PASS` |
| Exact store-scoped Desktop POS route | `PASS` |
| Automatic native fullscreen | `PASS` |
| Temporary opt-out | `PASS` |
| Normal bounds persistence and fullscreen-exit restore | `PASS` |
| Browser fallback | `PASS` |
| Existing RC9 FRONT + KITCHEN physical-print regression | `PASS`; P1A-caused regression `NO` |
| Acceptance | `ACCEPTED` in `4c4cc2fedf8e6197827c18421a580b45db981e32` |
| Merge | `PASS` at `15bfe4aaf3ea1be48ff1a7b1c5d06aca9ca731c1` |
| Exact Candidate ancestry | `PASS` — `65eb082e19683658ceda29254d5454a920bb208d` is an ancestor of the merge |
| Main Desktop CI | `PASS` — run `35086646307`, job `104762917005`, head `0845ee3396a3a2f020a79827916d115d25d7df58` |
| Provider checkout | `PASS` — `jasonmino-ops/eshop-windows-provider@7785be145d5259991038d17839d322e2694e338c` |
| Provider package/provenance | `PASS` |
| TypeScript, Desktop full suite, static security, compile | `PASS` |
| Windows NSIS package and packaged resources | `PASS` |
| Strict release asset verification and manifest generation | `PASS` |
| Installer artifact upload | `PASS` — artifact `10442512015`, archive digest `sha256:35804da74d9b3d7324805c2be28cd041401418cb93a64faead1a68e35aeac819` |
| Release Foundation default policy | `PASS` |
| Scope Guard | `PASS`; no exception |
| Release Lineage Gate | `PASS` — Production `5de2b3932981a988d5185e2a1ee4b83e3e0c35fa` is an ancestor of `origin/main@0845ee3396a3a2f020a79827916d115d25d7df58` |

The release-asset hygiene correction is exact: Electron Builder 25.1.8 can emit diagnostic `builder-debug.yml` into `desktop/release` when its debug logger is enabled. The Main Desktop workflow removes only that exact diagnostic filename before strict manifest verification. The release allowlist, hashes, provenance, manifest generation, packaged Provider validation, and failure semantics remain unchanged and fail closed.

## Deferred Findings

- Bundled HRT Provider can log missing `@eshop/hrt-contract`.
- Desktop exit can log `Object has been destroyed`.
- `ES-DESKTOP-POS-WEB-AUTH-COMPAT-01` remains a separate Web compatibility follow-up required before P3-B Desktop Pilot.

These items are recorded and deferred. They do not alter the accepted P1A FIELD result and are not fixed by this closure.

## Governance Freeze Check

| Requirement | Status |
| --- | --- |
| Actual FIELD evidence | `PASS` |
| Acceptance before Merge | `PASS` |
| Candidate and Acceptance included in Merge | `PASS` |
| Main Desktop CI with no skipped mandatory gate | `PASS` |
| Strict release asset set and provenance | `PASS` |
| Production lineage read-only verification | `PASS` |
| Production change | `NO` |
| P1B started | `NO` |

## Result

```text
P1A FIELD VERIFIED = YES
P1A FINAL FROZEN    = YES
P1A CLOSED          = YES
REMAINING BLOCKER   = NONE
NEXT AUTHORIZED STEP = NONE
```

This record stops at P1A closure. It does not authorize P1B or any other implementation task.
