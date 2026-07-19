# EP-MB3-07B1 Activation Startup Diagnostics Fix Evidence

## Package

- Engineering Package: EP-MB3-07B1
- Scope: Activation Startup Diagnostics & Fallback Fix
- Branch: `feat/ep-mb3-07b1-deployment-diagnostics`
- Baseline HEAD before implementation: `fbd993cbb3458dcf21140435c6bfa2905bc00542`
- Source-level bootstrap fix baseline: `1b0e5be4df42bb774ea51ad84ad36528b20702c0`
- Independent Review result after source fix: `CONDITIONAL PASS`

## Field Symptom

Windows installed build `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe` could leave the Activation Window permanently showing `正在启动`.

Field logs already showed:

- `BOOTING`
- approximately 20-40ms later `UNACTIVATED`
- `activation-window.created`

This made a Cloud verify hang, safeStorage hang, credential initialization hang, or ordinary ActivationRuntime state-machine hang unlikely. The highest-risk gap was between the Activation Window loading local assets and the renderer successfully reading/rendering the current state.

Follow-up Windows evidence from commit `1b0e5be4df42bb774ea51ad84ad36528b20702c0`, CI run `29679639325`, artifact `8440144897` narrowed the failure:

- `BOOTING`
- `UNACTIVATED`
- `activation-window.create.started`
- `activation-window.did-start-loading`
- `activation-preload.ready`
- `activation-window.console-error` with `source=activationRenderer.js`, `line=2`
- `activation-window.dom-ready`
- `activation-window.did-finish-load`
- startup watchdog after 8 seconds
- `STARTUP_ERROR`

No renderer checkpoint was emitted before the console error. Missing checkpoints were `activation-renderer.script-started`, `activation-renderer.bridge-detected`, `activation-renderer.subscribed`, `activation-renderer.get-state.started`, `activation-renderer.get-state.succeeded`, and `activation-renderer.rendered`.

## Source-Level Root Cause

The compiled renderer loaded by the Activation HTML was generated as a CommonJS module but executed as a classic browser script.

- Source entry: `desktop/src/renderer/activation/activationRenderer.ts`
- HTML script tag: `<script src="./activationRenderer.js"></script>`
- Script type: classic browser script, no `type="module"`
- Compile path: `npm run compile` -> `tsc -p tsconfig.build.json`
- Module format before fix: CommonJS, from `desktop/tsconfig.json`
- Dist output: `desktop/dist/renderer/activation/activationRenderer.js`
- Sourcemap: `desktop/dist/renderer/activation/activationRenderer.js.map`

Before the fix, compiled line 2 was:

```js
Object.defineProperty(exports, "__esModule", { value: true });
```

The exact runtime error is `ReferenceError: exports is not defined`.

The generated CommonJS prologue itself has no source-map segment. It was caused by `activationRenderer.ts` being forced into module mode by the trailing `export {}` that existed only to support the `declare global` window typing. In a sandboxed renderer, the classic script has no CommonJS `exports` global, so the bundle failed before the first renderer checkpoint.

After the fix, compiled line 2 is:

```js
const titleByState = {
```

The rebuilt renderer SHA-256 is `19531d928b466a702e5d760d03c9a675960f23757f9fdd4190d35057581a4d76`, and the compiled renderer contains no `exports`, `module.exports`, `require(...)`, or ESM `import`.

## Independent Review Closure Conditions

Independent review confirmed the root cause and source-level renderer fix, then identified three final closure conditions:

- Activation Electron smoke existed but was not wired into `package.json` or Windows CI.
- Dist smoke and packaged `app.asar` smoke were not automatic Windows CI gates before artifact upload.
- Renderer console sanitizer matched bare `pin` without word boundaries, which could redact safe words such as `spinner` or `mapping`.

This follow-up wires both smoke modes into explicit npm scripts and Windows CI gates, strengthens smoke integrity checks against the Electron default welcome page, and changes the unsafe renderer console pattern to match standalone `pin` only.

## Root Cause Scope

This fix treats the probable fault domain as:

- preload not starting
- preload bridge missing
- renderer script not starting
- renderer startup exception
- renderer subscription or `getState` failure
- invalid first state snapshot
- local Activation Window resource load failure
- render process exit during pre-authorization activation

This evidence does not claim the Windows field issue is fully closed until a new Windows CI artifact is installed and verified on a real Windows machine.

## Change Boundary

Changed only Activation startup/diagnostics files, CI smoke gate wiring, and focused tests:

- `.github/workflows/desktop-windows-build.yml`
- `desktop/package.json`
- `desktop/src/main/activation/activationTypes.ts`
- `desktop/src/main/activation/activationRuntime.ts`
- `desktop/src/main/activation/activationIpc.ts`
- `desktop/src/main/activation/activationWindowController.ts`
- `desktop/src/main/main.ts`
- `desktop/src/preload/activationPreload.ts`
- `desktop/src/renderer/activation/activationRenderer.ts`
- `desktop/tests/activation-ipc.test.ts`
- `desktop/tests/activation-state-machine.test.ts`
- `desktop/tests/activation-compiled-renderer.test.ts`
- `desktop/tests/activation-renderer-startup.test.ts`
- `desktop/tests/activation-window-controller.test.ts`
- `desktop/tests/smoke/activation-window-smoke.cjs`

No Cloud API contract, endpoint, credential schema, Provider, WindowManager business window logic, updater, release manifest, installer config, frozen contract, or database files were changed.

## Diagnostics Added

Main / Window checkpoints:

- `activation-window.create.started`
- `activation-window.created`
- `activation-window.did-start-loading`
- `activation-window.did-finish-load`
- `activation-window.dom-ready`
- `activation-window.preload-error`
- `activation-window.did-fail-load`
- `activation-window.render-process-gone`
- `activation-window.console-error`
- `activation-window.startup-watchdog-triggered`

Preload checkpoint:

- `activation-preload.ready`

Renderer checkpoints:

- `activation-renderer.script-started`
- `activation-renderer.bridge-detected`
- `activation-renderer.subscribed`
- `activation-renderer.get-state.started`
- `activation-renderer.get-state.succeeded`
- `activation-renderer.get-state.failed`
- `activation-renderer.rendered`
- `activation-renderer.startup-error`

IPC checkpoints:

- `activation-ipc.get-state.invoked`
- `activation-ipc.get-state.completed`

## Safety Controls

- Renderer checkpoint IPC uses allowlisted stages and allowlisted activation state kinds.
- Renderer-supplied reason codes are normalized and sanitized.
- Console diagnostics record only warning/error messages.
- Console source is reduced to basename only.
- URL logging was changed to URL category plus origin host hash.
- Diagnostic messages are passed through existing sanitizer.
- Renderer console sanitizer now preserves safe error names and core messages such as `ReferenceError: exports is not defined`.
- Renderer console sanitizer treats `pin` as sensitive only as a standalone field/word, so safe words such as `spinner`, `mapping`, and `pinning` do not force full redaction.
- PIN, token-shaped values, credential-shaped values, raw query strings, full `STORE-*` codes, and absolute paths are not accepted in new startup diagnostics.

## CI Smoke Gates

Two non-interactive npm smoke scripts are now available:

- `npm run smoke:activation:dist`
- `npm run smoke:activation:asar`

Windows CI runs the dist smoke after `npm run compile` and `node scripts/verify-activation-assets.mjs dist`.

Windows CI runs the packaged `app.asar` smoke after `npx electron-builder --win --x64 --publish never` and `node scripts/verify-activation-assets.mjs asar release/win-unpacked/resources/app.asar`.

Both gates run before release foundation manifests, artifact allowlist verification, and artifact upload. Neither gate uses `continue-on-error`; a failed smoke exits non-zero and fails the workflow.

Smoke integrity assertions now verify:

- BrowserWindow title is `E-Shop Desktop Activation`.
- Loaded URL is the formal activation `index.html`.
- Page is not the Electron default welcome page.
- Activation brand is present.
- Store code and PIN inputs are present.
- Renderer reaches `UNACTIVATED` and shows the store code + PIN form.
- Required checkpoints are emitted.
- No console errors are captured.
- No startup/watchdog error checkpoint is emitted.

## Windows Unit Test Portability Follow-up

Windows CI run `29686430111` for commit `a370cd6e27fe2ddc004df7d1b8ceb9e03307db01` failed before compile and before both Activation Electron smoke gates.

Failure:

- Step: `Unit tests`
- File: `desktop/tests/activation-compiled-renderer.test.ts`
- Line: `82`
- Error: `Error: spawnSync npm ENOENT`

Root cause confirmed: the compiled renderer regression test directly spawned `npm`, which resolved on macOS but was not portable to the Windows runner process lookup.

Portability fix commit `96dbfeb7965132be5278a832829c850e220f7b97` introduced:

- `resolveNpmCommand(platform)`
- `win32 -> npm.cmd`
- non-Windows -> `npm`
- preserved argument array `['run', 'compile']`
- preserved `cwd`
- added `encoding: 'utf8'`
- added `timeout: 120_000`
- explicitly kept `shell: false`
- tests proving non-zero exits and ENOENT are not swallowed
- tests proving compiled renderer test still runs the formal compile output

Local verification for the portability fix:

- `npm ci`: PASS on rerun with elevated sandbox permission for npm home cache/log writes.
- `npm run typecheck`: PASS.
- `npm test -- tests/activation-compiled-renderer.test.ts --reporter=verbose`: PASS, 1 test file, 5 tests.
- `npm test`: PASS, 26 test files, 199 tests.
- `npm run compile`: PASS.
- Focused activation tests: PASS, 9 test files, 63 tests.
- `npm run smoke:activation:dist`: PASS.
- `npm run pack:dir`: PASS; local unsigned macOS directory package only.
- `npm run smoke:activation:asar`: PASS against local macOS `app.asar`.

New Windows CI run `29686965635` for commit `96dbfeb7965132be5278a832829c850e220f7b97` still failed in `Unit tests`.

New failure:

- Step: `Unit tests`
- File: `desktop/tests/activation-compiled-renderer.test.ts`
- Line: `39`
- Error: `Error: spawnSync npm.cmd EINVAL`

CI status after run `29686965635`:

- `npm ci`: PASS.
- `typecheck`: PASS.
- focused activation tests: PASS.
- deployment diagnostics focused tests: PASS.
- full unit tests: FAIL.
- compile: NOT EXECUTED.
- dist Activation Electron smoke: NOT EXECUTED.
- Windows installer build: NOT EXECUTED.
- packaged `app.asar` smoke: NOT EXECUTED.
- artifact upload: NOT EXECUTED.

This indicates that `npm.cmd` with `execFileSync` and `shell: false` is still not a valid Windows runner strategy. A follow-up fix should avoid shell string execution while using a Windows-safe Node/npm entrypoint strategy, such as `process.execPath` with the local npm CLI entry, before rerunning Windows CI.

## Fallback UX

If the preload bridge is missing, the renderer stops normal initialization and shows:

- Title: `启动组件加载失败`
- Detail: `请重新启动应用；若问题持续，请联系技术支持并提供日志。`
- Action: `重新加载`

If preload, renderer, IPC, load, or render startup fails after a window exists, the UI shows:

- Title: `启动失败`
- Detail: `激活界面未能正确加载。请重新启动应用；如问题持续，请联系技术支持。`
- Action: `重新加载`

The fallback does not clear credentials, delete AppData, or start an infinite restart loop.

## Startup Watchdog

Activation Window starts an 8 second startup watchdog when created.

The main watchdog is acknowledged by renderer startup checkpoints, especially first `getState` success or first non-`BOOTING` render.

The renderer also has a local 8 second watchdog. It does not clear merely because `BOOTING` was rendered; it requires a non-`BOOTING` state render. This prevents a permanent visible `正在启动` state if no later state arrives.

## Main Initialization Error Handling

Unexpected `ActivationRuntime.initialize()` failures now convert into public `STARTUP_ERROR` without exposing stack, token, PIN, URL query, full store code, or absolute path data.

`STARTUP_ERROR` is limited to pre-authorization Activation startup and does not change existing `AUTHORIZED_*`, `UNACTIVATED`, `VERIFYING`, Cloud API mapping, or credential schema semantics.

## Tests

Added focused coverage for:

- main state already `UNACTIVATED` then renderer subscribes, calls `getState`, and renders current snapshot
- preload bridge missing pure DOM fallback
- `getState` reject fallback
- subscribe throw fallback
- invalid first state snapshot fallback
- renderer state render error fallback
- renderer watchdog timeout fallback
- BOOTING snapshot does not permanently disable watchdog
- non-BOOTING render cancels watchdog
- global renderer startup error fallback
- renderer reload re-syncs current state
- `initialize()` unexpected rejection converts to `STARTUP_ERROR`
- preload-error visible fallback
- did-fail-load main-frame visible fallback
- render-process-gone visible fallback
- warning/error console sanitation
- preservation of safe renderer error names and messages
- redaction of renderer console messages containing token, PIN, store code, local path, or URL query material
- hardening URL sanitation
- activation IPC checkpoint allowlist and sanitized reason code
- compiled activation renderer classic-script compatibility
- compiled renderer execution without Node/CommonJS globals
- formal Electron Activation Window smoke with `sandbox=true`, `contextIsolation=true`, and `nodeIntegration=false`
- packaged `app.asar` activation smoke
- smoke failure if the Electron default welcome page is loaded
- smoke validation of BrowserWindow title, loaded activation URL category, activation brand, store code input, and PIN input
- sanitizer boundary tests for standalone `PIN` / JSON `pin` redaction and safe `spinner` / `mapping` preservation
- existing activation normal flows remain covered

## Verification Results

Commands executed from `desktop/`:

- `npm ci`: PASS on rerun with elevated sandbox permission for npm home cache/log writes. No tracked dependency files changed.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 26 test files, 199 tests.
- `npm run compile`: PASS.
- Focused activation tests: PASS, 9 test files, 63 tests.
- `npm test -- tests/activation-compiled-renderer.test.ts --reporter=verbose`: PASS, 1 test file, 5 tests.
- `node scripts/verify-activation-assets.mjs dist`: PASS.
- `npm run smoke:activation:dist`: PASS.
- `npm run pack:dir`: PASS; local unsigned macOS directory package only, no installer created.
- `node scripts/verify-activation-assets.mjs asar 'release/mac-arm64/E-Shop Desktop.app/Contents/Resources/app.asar'`: PASS.
- `npm run smoke:activation:asar`: PASS.

Dist smoke result:

- BrowserWindow title: `E-Shop Desktop Activation`
- Loaded URL category: `DIST_ACTIVATION_INDEX_HTML`
- Default Electron page detected: `false`
- Watchdog/startup error triggered: `false`
- Console errors: `[]`

Dist smoke checkpoint sequence:

- `preload-ready`
- `script-started`
- `bridge-detected`
- `subscribed`
- `get-state-started`
- `get-state-succeeded` with `UNACTIVATED`
- `rendered` with `UNACTIVATED`

Packaged `app.asar` smoke result:

- Local package tested: `/Users/jason/light-ops-assistant/desktop/release/mac-arm64/E-Shop Desktop.app/Contents/Resources/app.asar`
- BrowserWindow title: `E-Shop Desktop Activation`
- Loaded URL category: `PACKAGED_ASAR_ACTIVATION_INDEX_HTML`
- Default Electron page detected: `false`
- Watchdog/startup error triggered: `false`
- Console errors: `[]`

Packaged smoke checkpoint sequence:

- `preload-ready`
- `script-started`
- `bridge-detected`
- `subscribed`
- `get-state-started`
- `get-state-succeeded` with `UNACTIVATED`
- `rendered` with `UNACTIVATED`

Smoke DOM result: title `激活此收银台`, activation form visible, store code hint `STORE-A`, and no console errors.

No flaky test was observed in this local run.

NPM reported 15 dependency advisories during `npm ci` (`3 moderate`, `11 high`, `1 critical`). This package did not change dependency versions and did not run `npm audit fix`.

## Not Completed

- No Windows installed-artifact reverification was performed in this local environment.
- No new Windows CI artifact has been verified after the unit test portability follow-up.
- Windows CI run `29686965635` failed before compile and before both Activation Electron smoke gates.
- No GitHub Release, tag, merge, or main branch operation was performed as part of implementation.
- Acceptance remains blocked until Windows CI and Windows field reverification pass.

## Windows Reverification Requirement

Windows field/CI verification must use a new CI artifact built from this commit:

1. Run Windows CI from the feature branch commit that contains this source-level bootstrap fix.
2. Confirm the Windows workflow log shows both Activation Electron smoke gates:
   - `Activation Electron smoke — dist`
   - `Activation Electron smoke — packaged app.asar`
3. Confirm both smoke outputs show BrowserWindow title `E-Shop Desktop Activation`, loaded activation URL category, default Electron page detected `false`, watchdog triggered `false`, and console errors `[]`.
4. Download the exact CI artifact, not a local build.
5. Verify release/artifact allowlist, SHA-256, and provenance before installation.
6. Install the new Windows artifact on the affected Windows machine.
7. Launch E-Shop Desktop.
8. First activation screen must enter the store code + PIN flow when no credential exists.
9. The UI must not permanently show `正在启动`.
10. Logs should show the startup checkpoint chain:
   - `activation-preload.ready`
   - `activation-renderer.script-started`
   - `activation-renderer.bridge-detected`
   - `activation-renderer.subscribed`
   - `activation-renderer.get-state.started`
   - `activation-ipc.get-state.invoked`
   - `activation-ipc.get-state.completed`
   - `activation-renderer.get-state.succeeded`
   - `activation-renderer.rendered`
11. Logs must not show `activation-window.console-error` from `activationRenderer.js` line 2.
12. Startup watchdog must not trigger.
13. If the issue persists, logs must identify the failing domain as preload, renderer, IPC, snapshot render, local resource loading, or render process failure.

## Outcome

Local engineering implementation and verification are ready for Windows CI artifact build.

Acceptance remains blocked until the new Windows artifact is installed and verified on a real Windows machine.
