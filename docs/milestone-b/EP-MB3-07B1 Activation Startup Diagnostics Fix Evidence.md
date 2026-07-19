# EP-MB3-07B1 Activation Startup Diagnostics Fix Evidence

## Package

- Engineering Package: EP-MB3-07B1
- Scope: Activation Startup Diagnostics & Fallback Fix
- Branch: `feat/ep-mb3-07b1-deployment-diagnostics`
- Baseline HEAD before implementation: `fbd993cbb3458dcf21140435c6bfa2905bc00542`

## Field Symptom

Windows installed build `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe` could leave the Activation Window permanently showing `正在启动`.

Field logs already showed:

- `BOOTING`
- approximately 20-40ms later `UNACTIVATED`
- `activation-window.created`

This made a Cloud verify hang, safeStorage hang, credential initialization hang, or ordinary ActivationRuntime state-machine hang unlikely. The highest-risk gap was between the Activation Window loading local assets and the renderer successfully reading/rendering the current state.

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

Changed only Activation startup/diagnostics files and focused tests:

- `desktop/src/main/activation/activationTypes.ts`
- `desktop/src/main/activation/activationRuntime.ts`
- `desktop/src/main/activation/activationIpc.ts`
- `desktop/src/main/activation/activationWindowController.ts`
- `desktop/src/main/main.ts`
- `desktop/src/preload/activationPreload.ts`
- `desktop/src/renderer/activation/activationRenderer.ts`
- `desktop/tests/activation-ipc.test.ts`
- `desktop/tests/activation-state-machine.test.ts`
- `desktop/tests/activation-renderer-startup.test.ts`
- `desktop/tests/activation-window-controller.test.ts`

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
- PIN, token-shaped values, credential-shaped values, raw query strings, full `STORE-*` codes, and absolute paths are not accepted in new startup diagnostics.

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
- hardening URL sanitation
- activation IPC checkpoint allowlist and sanitized reason code
- existing activation normal flows remain covered

## Verification Results

Commands executed from `desktop/`:

- `npm ci`: PASS on rerun with elevated sandbox permission for npm home cache/log writes. No tracked dependency files changed.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 25 test files, 190 tests.
- `npm run compile`: PASS.
- Focused activation tests: PASS, 8 test files, 54 tests.

No flaky test was observed in this local run.

NPM reported 15 dependency advisories during `npm ci` (`3 moderate`, `11 high`, `1 critical`). This package did not change dependency versions and did not run `npm audit fix`.

## Not Completed

- No Windows installed-artifact reverification was performed in this local environment.
- No new Windows installer was created in this step.
- No GitHub Release, tag, merge, or main branch operation was performed as part of implementation.

## Windows Reverification Requirement

Windows field/CI verification must use a new CI artifact built from this commit:

1. Install the new Windows artifact on the affected Windows machine.
2. Launch E-Shop Desktop.
3. First activation screen must enter the store code + PIN flow when no credential exists.
4. The UI must not permanently show `正在启动`.
5. Logs should show the startup checkpoint chain:
   - `activation-preload.ready`
   - `activation-renderer.script-started`
   - `activation-renderer.bridge-detected`
   - `activation-renderer.subscribed`
   - `activation-renderer.get-state.started`
   - `activation-ipc.get-state.invoked`
   - `activation-ipc.get-state.completed`
   - `activation-renderer.get-state.succeeded`
   - `activation-renderer.rendered`
6. If the issue persists, logs must identify the failing domain as preload, renderer, IPC, snapshot render, local resource loading, or render process failure.

## Outcome

Local engineering implementation and verification are ready for Windows CI artifact build and Windows field reverification.

Acceptance remains blocked until the new Windows artifact is installed and verified on a real Windows machine.
