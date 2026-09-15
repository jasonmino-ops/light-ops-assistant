# ES-DESKTOP-ACTIVATION-RENDERER-BOOT-FIX-01 Minimal Successor-Change Review

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-ACTIVATION-RENDERER-BOOT-FIX-01` |
| Risk | `L3` — FINAL FROZEN Desktop Activation delivery boundary and Windows installer Candidate |
| Founder authorization | New independent minimal fix task authorized, 2026-09-16 |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| Direct predecessor Candidate | `00cb46602acdbfed7446260298b17810a7b2dab9` |
| Historical P1A Candidate | `9753a3ab76be072bbd6582608048268bfec66aeb` |
| V727 target | `PC-20260119FZUI` / V727 |
| Review decision | `PASS` |
| Authorized successor classification | `AUTHORIZED ACTIVATION RENDERER BOOT SUCCESSOR CHANGE` |

This record authorizes only the smallest browser-compatible compilation correction for the packaged Activation renderer. It does not accept, merge, freeze, publish, install, deploy, activate, or FIELD-verify the resulting Candidate.

## Confirmed Field Blocker

The authorized predecessor installer was installed on V727 after an exact SHA-256 match. The Activation HTML loaded, but remained permanently on its static initial text `正在启动` instead of displaying the store-code and six-digit PIN form.

Read-only diagnosis established:

- the Desktop main process and renderer process remained running and responsive;
- main logging reached `app.start`, `app.ready`, `config.loaded`, and `activation-window.created`;
- the fresh credential store contained a valid installation record and no metadata or credential;
- current-user Windows DPAPI completed an in-memory protect/unprotect round trip;
- Production and both Activation endpoint routes were reachable over valid TLS;
- the installed `app.asar` hash matched the locked predecessor build;
- the packaged `dist/renderer/activation/activationRenderer.js` began with `Object.defineProperty(exports, "__esModule", ...)`;
- the Activation window retained `nodeIntegration: false`, `sandbox: true`, `contextIsolation: true`, and `webSecurity: true`.

Executing the exact packaged renderer bytes in a browser-like global reproduced `ReferenceError: exports is not defined` at line 2. The failure occurs before the renderer subscribes to state changes or calls the preload bridge.

This is a Windows FIELD-proven core defect in the frozen Desktop Activation delivery boundary and satisfies the Milestone A reopen condition for a formal successor review. It is not a P1A fullscreen defect and does not authorize P1B.

## Exact Build Cause

`desktop/tsconfig.json` compiles every Desktop TypeScript source with `module: "CommonJS"`. The Activation renderer source currently uses `declare global` and a trailing `export {}` solely to make TypeScript treat the file as a module. That marker causes TypeScript to emit the CommonJS `exports` prologue.

The renderer is loaded as a classic browser script from `index.html`, not as a Node module or a bundled CommonJS module. Under the frozen Electron security configuration, the main world correctly has no `exports`, `require`, or `module` global. The emitted module prologue therefore fails before any Activation UI logic runs.

## Alternatives Reviewed

| Option | Scope / consequence | Decision |
| --- | --- | --- |
| Make the renderer a true global browser script by declaring the `Window` augmentation directly and removing the module-only marker | One source file; existing compile pipeline; no runtime or security change | Selected |
| Add a dedicated renderer tsconfig and a second TypeScript compile invocation | Adds build configuration and pipeline complexity for one script | Rejected as unnecessary |
| Add a renderer bundler or dependency | Introduces a new dependency and build subsystem | Rejected |
| Inject `exports` / `require`, enable Node integration, or weaken sandbox / context isolation / CSP | Violates the frozen Electron security boundary | Prohibited |

The selected change preserves the existing TypeScript target and package pipeline. With no import or export in the renderer source, CommonJS compilation emits a classic browser-compatible script and no CommonJS runtime references.

## Authorized Files

- `desktop/src/renderer/activation/activationRenderer.ts`
- one focused test under `desktop/tests/`
- this successor-change review
- one minimal Candidate evidence record under `docs/desktop/`

Package or build configuration may be changed only if the selected source-level correction is proven insufficient. Any need to edit `desktop/src/main/windowManager.ts`, Activation main/API/runtime/credential/preload behavior, or Electron security settings requires STOP and renewed authorization.

## Explicit Non-Scope

- P1A fullscreen logic and `desktop/src/main/windowManager.ts`
- Activation API, IPC contract, state machine, credential, safeStorage, or installation identity semantics
- preload bridge shape or exposed capability
- Electron security configuration, CSP, navigation, popup, permission, sender, or main-frame controls
- Web, cashier, Customer Display business behavior, API, schema, Cloud business logic, Production, Printing, RC9, Provider, or HRT
- P1B, settings UI, Technical Support UI, build-system rewrite, new dependency, deployment, publication, or V727 Activation
- Release Foundation group definitions, frozen hashes, invariants, allowlists, exceptions, or gate strength

## Required Evidence

- focused compilation test proving the emitted renderer contains no `exports`, `require`, or `module` references;
- browser-like renderer execution proving the preload bridge is called and `UNACTIVATED` reveals store code, PIN, and activation controls;
- existing Activation API, credential, safeStorage, IPC, and state-machine suites unchanged and passing;
- TypeScript, complete Desktop suite, static Electron security, compile, Activation asset checks, and Windows NSIS package PASS;
- packaged `app.asar` contains the browser-compatible renderer bytes;
- Scope Guard, Release Foundation policy/verification, and Release Lineage PASS without exception or gate weakening;
- historical P1A and auto-start predecessor bytes unchanged outside the exact authorized scope;
- fresh-context independent read-only review PASS.

## Decision

The successor-change review is `PASS`.

```text
AUTHORIZED ACTIVATION RENDERER BOOT SUCCESSOR CHANGE
for ES-DESKTOP-ACTIVATION-RENDERER-BOOT-FIX-01
```

The maximum post-review implementation state is a new local Candidate ready for a separately authorized V727 Activation Boot Fix FIELD. P1A FIELD and P1B remain prohibited.
