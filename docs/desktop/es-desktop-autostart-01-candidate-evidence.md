# ES-DESKTOP-AUTOSTART-01 Candidate Evidence

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Candidate Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-AUTOSTART-01` |
| Risk | `L3` — frozen installer / NSIS boundary only |
| Successor review | `PASS` / `AUTHORIZED INSTALLER SUCCESSOR CHANGE` |
| Review commit | `72742c61a08b27aa69248792032456b181d98b3f` |
| Implementation commit | `cf2a579e79800fa22be85fc760f004f1ac4efdb8` |
| Focused test follow-up | `1868d819dd7a5fccb44970e4bcbfb0e618c8dd20` |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| P1A successor base | `230182b450f7dd280a6646bc9140d08feec53464` |
| Historical P1A Candidate | `9753a3ab76be072bbd6582608048268bfec66aeb` / byte-exact unchanged |
| Production change | `NO` |
| V727 installation / FIELD | `NOT PERFORMED` |
| P1A FIELD | `NOT VERIFIED` |
| P1B | `NOT STARTED` |

The commit of this evidence record is the proposed local successor Candidate. It is not an Acceptance, Merge, Freeze, installer publication, Production deployment, or FIELD claim.

## Implemented Scope

| File | Change |
| --- | --- |
| `desktop/electron-builder.yml` | Explicitly load the supported custom NSIS include |
| `desktop/build/installer.nsh` | Write one current-user Run value on install/upgrade and delete that exact value on uninstall |
| `desktop/tests/windows-autostart-installer.test.ts` | Verify integration hook, exact registration, same-name overwrite, exact cleanup, and excluded mechanisms/arguments |
| `docs/desktop/es-desktop-autostart-01-successor-change-review.md` | Frozen-boundary review and authorization evidence |
| `docs/desktop/es-desktop-autostart-01-candidate-evidence.md` | This candidate evidence |

No other implementation file is changed relative to the P1A governance-cleared successor base.

## Registration Contract

```text
Hive: HKCU
Key: Software\Microsoft\Windows\CurrentVersion\Run
Value name: E-Shop Desktop
Value data: "<installation directory>\E-Shop Desktop.exe"
Arguments: none
```

- Fresh install executes one `WriteRegStr` for the stable value name.
- Upgrade executes the same `WriteRegStr`; registry value assignment replaces the existing value instead of appending another entry.
- Uninstall executes one `DeleteRegValue` for that same hive, key, and value name.
- Reinstall follows the same fresh-install path and recreates the value.
- The compiled NSIS build loaded `desktop/build/installer.nsh` through electron-builder's documented include hook.
- Manual and login launch both execute the same packaged application executable with no special argument.

These statements are source/package contract evidence. Actual Windows Registry creation, overwrite, and deletion remain required observations during the separately authorized V727 baseline provisioning; they are not claimed as FIELD-verified here.

## Activation and P1A Integrity

The candidate has zero diff from `230182b...` in:

- `desktop/src/main/main.ts`
- `desktop/src/main/activation/**`
- `desktop/src/main/config.ts`
- `desktop/src/main/windowManager.ts`
- `desktop/tests/fullscreen-foundation.test.ts`

The three historical P1A files match Candidate `9753a3a...` byte-for-byte:

| File | SHA-256 |
| --- | --- |
| `desktop/src/main/config.ts` | `ee77070297c3cc35a251ed658ccf1f4518a618c0b3b5063c46b6330733ab006a` |
| `desktop/src/main/windowManager.ts` | `bce8c03ea97ec3537815e18ec7339145528bce264da190e72b55146c3c9f698e` |
| `desktop/tests/fullscreen-foundation.test.ts` | `29967d7c865eedf49776c19764992b173b9a75b6bc60a937927c0a2fbace0fc9` |

The existing single-instance lock, `app.whenReady()`, `initializeApplication()`, `ActivationRuntime.initialize()`, credential restore, authorized runtime, and P1A fullscreen path are unchanged.

## Validation Evidence

| Validation | Result |
| --- | --- |
| Successor-change review | `PASS` |
| Focused auto-start tests | `PASS` — 1 file / 6 tests |
| TypeScript | `PASS` |
| Desktop full suite | `PASS` — 21 files / 157 tests |
| Static Electron security | `PASS` — 16/16 |
| Compile | `PASS` |
| Activation dist assets | `PASS` |
| Windows x64 NSIS package | `PASS` — unsigned internal pilot only |
| Packaged Activation assets | `PASS` |
| Packaged Provider resource | `PASS` |
| Release Foundation policy | `PASS` — all 12 frozen groups |
| Scope Guard | `PASS`; Scope exception `NO` |
| Release Lineage | `PASS` — Production/main `822cbef...`, clean worktree at gate run |

Package evidence:

- installer: `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe`
- size: `81,895,373` bytes
- local SHA-256: `ed86f7a631479c23739be14a24991c3514110437668fa5152b8c35bc352c31a3`
- electron-builder: `25.1.8`
- Electron: `33.4.11`
- generated builder evidence contains an include of the candidate `desktop/build/installer.nsh`

The first sandboxed package attempt was blocked by Wine socket permissions. The same unchanged command was rerun with the required local process permission and completed successfully. This was an environment restriction, not a waived build failure.

## Boundary Audit

- Scope Guard and Release Foundation remain separate and both pass.
- No Release Foundation group, path, invariant, hash check, failure condition, or allowlist is changed.
- Web diff: `0`.
- API diff: `0`.
- DB diff: `0`.
- Printing / RC9 diff: `0`.
- Provider / HRT diff: `0`.
- P1A implementation diff: `0`.
- P1B diff: `0`.
- Production code/data/deployment change: `NO`.

## Independent Review Gate

A fresh-context, read-only reviewer must inspect the exact committed candidate, real diff, task state, review record, tests, package evidence, frozen boundary, and governance gates. The candidate cannot be declared ready for V727 until that review returns `PASS` with no blocking issue.

## Candidate Stop State

If Independent Review passes, the maximum allowed status is:

```text
ES-DESKTOP-AUTOSTART-01
CANDIDATE READY FOR V727 BASELINE PROVISIONING
```

V727 installation, first Activation, login/cold-boot observation, P1A FIELD, P1B, Production deployment, and Desktop release publication remain separately gated and unperformed.
