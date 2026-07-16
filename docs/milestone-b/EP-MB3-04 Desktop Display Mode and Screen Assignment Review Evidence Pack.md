# EP-MB3-04 Desktop Display Mode and Screen Assignment Review Evidence Pack

Date: 2026-07-16

## A. Baseline

- Desktop repository: `/Users/jason/light-ops-assistant`
- Desktop branch: `feat/ep-mb3-04-desktop-display-assignment`
- Desktop baseline: `6e51079a11d52efc0e397bdc989cf366f14bb48a`
- Provider repository: `/Users/jason/eshop-windows-provider`
- Provider branch: `feat/ep-mb3-03b-real-receipt-payload`
- Provider paired baseline: `c5cc86b35fa185aac795d0e141de549858b81f8b`
- Provider handling: read-only validation only

## B. Scope

Implemented Desktop display mode and screen assignment runtime:

- Single / dual display mode.
- Employee-owned display controls for mode and swap.
- Persistent display mode and display assignment settings in Electron user data.
- Dynamic display reconciliation for add, remove, and metrics changes.
- Customer display fullscreen placement on assigned screen without stealing focus.
- Safe degradation to single mode when only one screen is available.
- Recovery when the assigned employee or customer display disappears.

Explicit non-goals preserved:

- Frozen contract changes: none.
- Provider implementation changes: none.
- Runtime Core / HRT changes: none.
- Printer payload / printer logic changes: none.
- Installer workflow changes: none.

## C. Architecture

- `desktop/src/main/displayAssignment.ts`
  - Pure display assignment planner.
  - Uses saved display ids first, then stable display features such as label, internal flag, size, scale factor, and bounds.
  - Defaults to primary display for employee and first sorted non-primary display for customer.
  - Assigns only employee and customer roles; no orchestration for third or later displays.

- `desktop/src/main/displaySettings.ts`
  - Loads and saves `display-settings.json`.
  - Invalid, missing, or unsupported settings recover to defaults.
  - Saves atomically through temp file plus rename.

- `desktop/src/main/windowManager.ts`
  - Owns effective display plan application.
  - Debounces Electron display events.
  - Moves existing employee window instead of recreating it.
  - Creates, places, or closes customer window according to effective display mode.
  - Persists successful dual-screen assignments without overwriting saved customer assignment during degraded single-screen fallback.

- `desktop/src/main/ipcRouter.ts`, `desktop/src/shared/ipcChannels.ts`, `desktop/src/preload/employeePreload.ts`
  - Adds employee-only display IPC: get state, set mode, swap.
  - Rejects customer, iframe, and unknown senders through existing role authorization.
  - Does not expose raw bounds, display ids, window ids, or BrowserWindow controls to web content.

- `app/desktop/pos/DesktopDisplayControls.tsx`
  - Employee POS display controls.
  - Renders only when the employee preload API exists.
  - Normal browser and customer display contexts do not receive the display API.

## D. Files Changed

- `app/desktop/pos/DesktopDisplayControls.tsx`
- `app/desktop/pos/page.tsx`
- `desktop/src/main/displayAssignment.ts`
- `desktop/src/main/displaySettings.ts`
- `desktop/src/main/ipcRouter.ts`
- `desktop/src/main/main.ts`
- `desktop/src/main/windowManager.ts`
- `desktop/src/preload/employeePreload.ts`
- `desktop/src/shared/ipcChannels.ts`
- `desktop/tests/display-assignment.test.ts`
- `desktop/tests/display-ipc.test.ts`
- `desktop/tests/display-settings.test.ts`
- `desktop/tests/ipc-whitelist.test.ts`
- `desktop/tests/static-security.test.ts`
- `desktop/tests/window-manager-display.test.ts`

## E. Local Validation

Desktop validation:

- `cd desktop && npm run typecheck`: PASS
- `cd desktop && npm run compile`: PASS
- `cd desktop && npm test`: PASS
  - Test files: 16 passed
  - Tests: 139 passed
- `npm run build`: PASS
  - Next.js generated 133 static pages.

Provider read-only validation:

- `cd /Users/jason/eshop-windows-provider && npm run type-check`: PASS
- `cd /Users/jason/eshop-windows-provider && npm test`: PASS
  - Test files: 7 passed, 1 skipped
  - Tests: 31 passed, 5 skipped
- `cd /Users/jason/eshop-windows-provider && npm run build`: PASS
- Provider post-validation `git status --short`: clean

## F. Security And Authorization

- Display IPC channels are invokable only by `employee`.
- Customer role has no display control channel.
- Employee preload exposes only high-level commands: `getState`, `setMode`, and `swap`.
- `setMode` accepts only `single` or `dual`.
- No IPC accepts arbitrary screen coordinates, raw display ids, window ids, or web-provided BrowserWindow references.
- Customer preload remains without display assignment API.

## G. Display Matching And Recovery

Covered behaviors:

- No display data falls back to safe single mode.
- One display with configured dual mode degrades to effective single mode.
- Default dual mode assigns employee to primary display and customer to a non-primary display.
- Saved display ids are preferred when present.
- Feature matching supports stable recovery when Electron display ids change.
- Three or more displays are reduced to employee plus customer only.
- Swap persists employee/customer display references.
- Customer display removal closes customer window rather than moving it to the employee screen.
- Employee display removal moves employee window to the remaining display and degrades to single.
- Bounds or primary display changes do not silently swap roles when saved assignment is still matchable.

True-machine acceptance still required on Windows with actual dual monitors:

- Confirm customer window appears on the physical customer screen.
- Confirm employee window remains focused after customer display placement.
- Confirm unplug/replug recovery with real Windows display ids and labels.
- Confirm installer artifact boots with persisted display settings.

## H. Windows CI And Installer Artifact

Windows CI evidence:

- Workflow: `desktop-windows-build`
- Runner: `windows-latest`
- Run id: `29502600015`
- Run number: `32`
- Run URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29502600015`
- Source commit: `14e962cc1cc3a37d6d6753d0b6b2fdc217d31203`
- Status: `completed`
- Conclusion: `success`
- Created at: `2026-07-16T13:32:12Z`
- Updated at: `2026-07-16T13:35:49Z`

Installer artifact evidence:

- Artifact id: `8377166728`
- Artifact name: `eshop-desktop-windows-installer`
- Size: `131785303` bytes
- Digest: `sha256:7dce44451f442d4293bbf3071bd01b42d7d1dd4b3ddfc464d619269f225c7f2a`
- Expired: `false`
- Created at: `2026-07-16T13:35:41Z`
- Expires at: `2026-10-14T13:32:12Z`
- Download API URL: `https://api.github.com/repos/jasonmino-ops/light-ops-assistant/actions/artifacts/8377166728/zip`

## I. Integrity Notes

- Provider source files changed: no.
- Frozen Contract files changed: no.
- Runtime Core / HRT files changed: no.
- Printer payload files changed: no.
- Installer workflow changed: no.
- Implementation commit: `14e962cc1cc3a37d6d6753d0b6b2fdc217d31203`
- Evidence update commit: current evidence-only commit.
- Branch pushed: yes.
