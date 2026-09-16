# ES-DESKTOP-ACTIVATION-RENDERER-BOOT-FIX-01 Candidate Evidence

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Candidate Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-ACTIVATION-RENDERER-BOOT-FIX-01` |
| Risk | `L3` — frozen Desktop Activation delivery boundary and Windows installer Candidate |
| Successor review | `PASS` / `AUTHORIZED ACTIVATION RENDERER BOOT SUCCESSOR CHANGE` |
| Successor review commit | `4b7c0342e12a35856c41162f7ad54b8c390b74f4` |
| Implementation commit | `abbab8c4f76fa3508b424a45a3ad360e25a59921` |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| Direct predecessor Candidate | `00cb46602acdbfed7446260298b17810a7b2dab9` |
| Historical P1A Candidate | `9753a3ab76be072bbd6582608048268bfec66aeb` / preserved in predecessor history |
| Production change | `NO` |
| V727 install / Activation | `NOT PERFORMED FOR THIS CANDIDATE` |
| P1A FIELD | `NOT VERIFIED` |
| P1B | `NOT STARTED` |

The commit containing this evidence record is the proposed local successor Candidate. It is not an Acceptance, Merge, Freeze, installer publication, Production deployment, V727 installation, Activation, or P1A FIELD claim.

## Root Cause and Fix

The Activation renderer source was included in the shared Desktop TypeScript compilation with `module: "CommonJS"`. Its module-only `export {}` marker caused the emitted classic browser script to reference `exports` before any UI initialization. The hardened Activation main world intentionally provides no CommonJS globals, so V727 reproduced `ReferenceError: exports is not defined` and remained on the static HTML text `正在启动`.

The fix is source-local:

- declare the `Window.eshopDesktopActivation` type augmentation directly in the renderer's global script;
- remove the module-only wrapper and `export {}` marker;
- keep the existing compiler, package pipeline, preload bridge, runtime, IPC, API, credential, and safeStorage behavior unchanged.

The compiled and packaged renderer now begins as a classic strict browser script and contains no `exports`, `require(...)`, or `module` runtime reference.

## Implemented Scope

| File | Change |
| --- | --- |
| `desktop/src/renderer/activation/activationRenderer.ts` | Remove the TypeScript module marker while preserving the existing `Window` bridge type and all runtime behavior |
| `desktop/tests/activation-renderer-boot.test.ts` | Compile under the real CommonJS setting, reject CommonJS runtime globals, execute in a browser-like context, call the preload bridge, and verify the unactivated form |
| `docs/desktop/es-desktop-activation-renderer-boot-fix-01-successor-change-review.md` | Record the frozen-boundary cause, alternatives, authorization, and non-scope |
| `docs/desktop/es-desktop-activation-renderer-boot-fix-01-candidate-evidence.md` | Record Candidate evidence and stop state |

No package script, tsconfig, dependency, preload, main process, Activation runtime/API/credential implementation, P1A implementation, Web, Printing, Provider, or HRT file changed.

## Verification Evidence

| Validation | Result |
| --- | --- |
| Root-cause reproduction using predecessor packaged bytes | `PASS` — exact `ReferenceError: exports is not defined` at line 2 |
| Focused renderer boot tests | `PASS` — 1 file / 3 tests |
| Browser-like renderer execution | `PASS` — bridge subscription and `getState()` called; `UNACTIVATED` reveals store-code, PIN, and activation controls |
| TypeScript | `PASS` |
| Desktop full suite | `PASS` — 22 files / 160 tests |
| Static Electron security | `PASS` — 16/16 |
| Compile | `PASS` |
| Activation dist assets | `PASS` |
| Windows x64 NSIS package | `PASS` — unsigned internal pilot only |
| Packaged Activation assets | `PASS` |
| Packaged Provider resource | `PASS` |
| Packaged renderer equals compiled renderer | `PASS` — byte-exact SHA-256 `1e8f5abbc5427be4cedece671f00fc5c8b8e6288eb47dfa47e3d881cd37373a6` |
| Packaged renderer CommonJS references | `NONE` — `exports`, `require(...)`, and `module` absent |
| Packaged renderer browser parse | `PASS` |
| Release Foundation policy before final Candidate record | `PASS` — 12/12 frozen groups |
| Scope Guard on authorized implementation paths | `PASS`; Scope exception `NO` |
| Release Lineage | `PASS` — Production/main `822cbef...`, clean predecessor worktree at gate run |

Exact-Candidate Release Foundation manifest verification and fresh-context independent review run after this record is committed. They do not modify product source or the installer.

## Package Evidence

- installer: `desktop/release/E-Shop-Desktop-Setup-0.2.0-pilot.2.exe`
- byte size: `81,895,417`
- local SHA-256: `d01f411a1f954c69b79c9432abed5af1d6537d97fbcd27ab579916db698d6c6b`
- packaged `app.asar` SHA-256: `619209f615df6db9c7b50491e91181e3c2e41312e6a473bf1778aaba8b820b25`
- Electron: `33.4.11`
- electron-builder: `25.1.8`
- distribution: unsigned internal pilot; not published

## Boundary Audit

- Electron security remains `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `webSecurity: true`.
- CSP, navigation protection, popup denial, permission denial, IPC allowlist, sender validation, and main-frame validation are unchanged.
- Activation API contract, public state contract, IPC channel names, preload bridge surface, credential file format, safeStorage use, and Activation state machine are unchanged.
- P1A fullscreen source and tests are unchanged from direct predecessor Candidate `00cb466...`.
- Auto-start installer registration and tests are unchanged from direct predecessor Candidate `00cb466...`.
- Release Foundation implementation, group definitions, hashes, invariants, allowlists, exceptions, and failure behavior are unchanged.
- Web diff: `0`.
- API diff: `0`.
- DB diff: `0`.
- Printing / RC9 diff: `0`.
- Provider / HRT diff: `0`.
- Production code/data/deployment change: `NO`.

## Independent Review Gate

A fresh-context, read-only reviewer must inspect the exact committed Candidate, predecessor diff, task state, successor review, focused test, security posture, package evidence, Scope Guard, and Release Foundation result. The Candidate cannot be declared ready for V727 until that review returns `PASS` with no blocking issue.

## Candidate Stop State

If exact-Candidate gates and Independent Review pass, the maximum allowed status is:

```text
ES-DESKTOP-ACTIVATION-RENDERER-BOOT-FIX-01
CANDIDATE READY FOR V727 ACTIVATION BOOT FIELD
```

V727 installation, Activation, baseline provisioning continuation, P1A FIELD, P1B, Production deployment, and Desktop release publication remain separately gated and unperformed.
