# ES-DESKTOP-INSTALLER-UPGRADE-LIFECYCLE-FIX-01 Candidate Evidence

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Candidate Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-INSTALLER-UPGRADE-LIFECYCLE-FIX-01` |
| Risk | `L3` — FINAL FROZEN NSIS installer boundary |
| Successor review | `PASS` / `AUTHORIZED INSTALLER UPGRADE LIFECYCLE SUCCESSOR CHANGE` |
| Review commit | `05f472628fbd953daf158934c243b6bdb7c5f3ea` |
| Implementation commit | `942f4c7c650deec28da9db659da4c29e539dce99` |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| Direct predecessor Candidate | `5c899f7bd17bca59ec35afb1a15de34fff0a2826` |
| Production change | `NO` |
| V727 installation / FIELD | `NOT PERFORMED` |
| Activation Boot Fix FIELD | `STILL BLOCKED` |
| P1A FIELD | `NOT VERIFIED` |
| P1B | `NOT STARTED` |

The commit containing this evidence record is the proposed local successor Candidate. It is not an Acceptance, Merge, Freeze, installer publication, Production deployment, V727 installation, or FIELD claim.

## Implemented Scope

| File | Change |
| --- | --- |
| `desktop/build/installer.nsh` | Replace the default process-kill path with exact executable detection and fail-closed safe-exit instructions; add install/uninstall hooks, `$TEMP` handoff, and matching-icon CRC protection while preserving HKCU auto-start hooks |
| `desktop/scripts/verify-nsis-installer.mjs` | Read-only structural verifier for one unsigned outer NSIS installer and exactly one embedded uninstaller, including both CRC32 values and optional SHA manifest binding |
| `desktop/tests/windows-installer-upgrade-lifecycle.test.ts` | Verify exact detection, no force kill, hook order, `$TEMP`, icon protection, HKCU/AppData preservation, and CRC corruption rejection |
| `docs/desktop/es-desktop-installer-upgrade-lifecycle-fix-01-successor-change-review.md` | Frozen-boundary authorization and historical pattern review |
| `docs/desktop/es-desktop-installer-upgrade-lifecycle-fix-01-candidate-evidence.md` | This Candidate evidence |

`desktop/electron-builder.yml` already loads `build/installer.nsh` through the supported include hook and is unchanged.

## Upgrade Lifecycle Contract

1. `nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"` checks the exact E-Shop Desktop executable name.
2. Result `0` stops with instructions to exit through the existing tray path; result `603` is the only accepted absence; other results stop fail-closed.
3. The custom include contains no executable `tasklist`, `find.exe`, `taskkill`, `_KillProcess`, `ExecWait`, `CloseWindow`, or `SendMessage` instruction.
4. `customInit` applies the check before installer work. `customUnInit` applies it to ordinary and silent prior-version uninstall and then changes the working directory to `$TEMP`.
5. electron-builder's existing `uninstallOldVersion` then copies the prior uninstaller to its private temporary directory and executes the ordinary `/S /KEEP_APP_DATA --updated` handoff.
6. Installer and uninstaller icons are required to match, preventing electron-builder's icon patch from invalidating the embedded uninstaller CRC.

No custom deletion or replacement algorithm, second installer path, force-kill fallback, service, scheduled task, or Runtime IPC is introduced.

## Preserved Contracts

- The existing HKCU Run value remains one fixed name and one quoted executable path. `customInstall` still overwrites that one value; `customUnInstall` still deletes that exact value.
- `deleteAppDataOnUninstall: false` remains unchanged. The custom include does not remove AppData or pass `--delete-app-data`.
- Manual launch, single-instance handling, Activation guard, safeStorage, credential and installation identity semantics, P1A fullscreen, renderer boot fix, Electron security, Provider/HRT, and RC9/Printing are unchanged.
- Runtime integrity hashes remain:
  - `desktop/src/main/config.ts`: `ee77070297c3cc35a251ed658ccf1f4518a618c0b3b5063c46b6330733ab006a`
  - `desktop/src/main/windowManager.ts`: `bce8c03ea97ec3537815e18ec7339145528bce264da190e72b55146c3c9f698e`
  - `desktop/src/renderer/activation/activationRenderer.ts`: `4f94751c11b8e1630fa38445b10c8b9ed6b2dbaf085a3eed1bb17f3b3e75932e`
  - `desktop/src/main/activation/credentialStore.ts`: `ec17988d4aab3112eaf76bd5fe6d21162e2c77f673b422e5f662cea24d84de0a`

## Validation Evidence

| Validation | Result |
| --- | --- |
| Frozen-boundary successor review | `PASS` |
| Focused lifecycle + existing auto-start tests | `PASS` — 2 files / 13 tests |
| TypeScript | `PASS` |
| Desktop full suite | `PASS` — 23 files / 167 tests |
| Static Electron security | `PASS` — 16/16 |
| Compile | `PASS` |
| Activation dist assets | `PASS` |
| Windows x64 NSIS package | `PASS` — unsigned internal pilot only |
| Packaged Activation assets | `PASS` |
| Packaged Provider resource | `PASS` |
| Outer installer NSIS CRC32 | `PASS` — read-only verifier |
| Embedded uninstaller NSIS CRC32 | `PASS` — exactly one embedded uninstaller |
| Release Foundation policy | `PASS` — all 12 frozen groups |
| Scope Guard | `PASS`; Scope exception `NO` |
| Release Lineage | `PASS` — Production/main `822cbef...` |

Package evidence:

- installer: `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe`
- size: `81,887,947` bytes
- exact SHA-256 and both CRC32 values: generated from the final committed Candidate and bound by the local `SHA256SUMS.txt` / release provenance validation reported at handoff
- electron-builder: `25.1.8`
- Electron: `33.4.11`
- outer NSIS: unsigned x86 PE, installer flag `0`, CRC32 validated
- embedded uninstaller: unsigned x86 PE, uninstaller flag `1`, CRC32 validated

The first sandboxed package attempt was blocked by Wine socket permissions. The same unchanged command was rerun with the required local process permission and completed successfully. This was an environment restriction, not a waived package failure.

## Boundary Audit

- Scope Guard and Release Foundation remain separate and both pass.
- No Release Foundation group, path, invariant, hash, failure condition, exception, bypass, or allowlist is changed.
- `desktop/electron-builder.yml` diff: `0`.
- Desktop Runtime / Activation / P1A implementation diff: `0`.
- Web diff: `0`.
- API diff: `0`.
- DB diff: `0`.
- Printing / RC9 diff: `0`.
- Provider / HRT diff: `0`.
- P1B diff: `0`.
- Production code/data/deployment change: `NO`.

## Independent Review Gate

A fresh-context independent reviewer must inspect the exact committed Candidate, source diff, successor review, RC9 reuse boundary, focused tests, NSIS package integrity results, preserved Runtime hashes, governance gates, and package evidence. The Candidate cannot enter V727 until that review returns `PASS` with no blocking issue.

## Candidate Stop State

If Independent Review passes, the maximum allowed status is:

```text
DESKTOP INSTALLER UPGRADE LIFECYCLE
CANDIDATE READY FOR V727 FIELD
```

V727 installation, predecessor upgrade, Activation Boot Fix FIELD, Baseline Provisioning, P1A FIELD, P1B, Production deployment, and Desktop release publication remain separately gated and were not performed.
