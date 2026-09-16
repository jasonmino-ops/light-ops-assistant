# ES-DESKTOP-INSTALLER-UPGRADE-LIFECYCLE-FIX-01 Minimal Successor-Change Review

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-INSTALLER-UPGRADE-LIFECYCLE-FIX-01` |
| Risk | `L3` — `FINAL FROZEN` NSIS installer boundary |
| Founder authorization | `APPROVE`, 2026-09-16 |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| Direct predecessor Candidate | `5c899f7bd17bca59ec35afb1a15de34fff0a2826` |
| Historical reuse classification | `A — REUSE EXISTING PATTERN` |
| Review decision | `PASS` |
| Authorized successor classification | `AUTHORIZED INSTALLER UPGRADE LIFECYCLE SUCCESSOR CHANGE` |

This review authorizes only the smallest E-Shop Desktop NSIS upgrade-lifecycle correction described below. It does not accept, merge, freeze, publish, deploy, install on V727, resume Activation FIELD, or start P1A FIELD.

## Frozen Boundary and Necessity

`docs/desktop/milestone-a-freeze-record.md` freezes the Windows CI / NSIS build chain. V727 supplied direct FIELD evidence that the predecessor installer could not hand off through the ordinary prior-version uninstall lifecycle: the interactive installer claimed that E-Shop Desktop could not be closed even though read-only process inspection found no running E-Shop Desktop process, and the predecessor `app.asar` remained installed. The exact successor Candidate therefore never ran.

The Activation Renderer boot fix cannot receive its separately authorized FIELD verification until a regular upgrade can install the exact Candidate. This is a Windows-machine-proven installer blocker and satisfies the freeze record's reopen condition for a formal successor review. The change is an installation prerequisite, not a Desktop business feature, P1A expansion, P1B, Printing, or Production work.

## Historical Reuse Basis

The reviewed pattern is limited to the already audited and FIELD-verified RC9 installer lifecycle:

- `def76447bf0702be2ee1158569e92daa19285873` — `e-shop-tray/network-addon/installer.nsh` exact-process check, fail-closed safe exit, `customInit` / `customUnInit`, and `$TEMP` working-directory handoff;
- `a7bee16c9bbdc4f32360afa331a3b66fd80c1fe2` — accepted RC9 successor lineage;
- `e-shop-tray/scripts/build-network-addon.mjs` — outer NSIS and embedded-uninstaller CRC32 verification;
- `e-shop-tray/tests/network-addon.test.ts` — lifecycle and integrity assertions.

Only generic installer mechanics are reusable. RC9 product names, executable paths, Printing Runtime, provisioning/state machines, identity model, binding protocol, security settings, wrappers, shortcuts, QZ/driver/certificate logic, and forced termination are explicitly excluded.

## Alternatives Reviewed

| Option | Consequence | Decision |
| --- | --- | --- |
| Keep electron-builder's default `tasklist/find` plus `taskkill/uninstallOldVersion` path | Already produced a false/blocking V727 lifecycle and includes force-termination behavior prohibited by this task | Rejected |
| Add application IPC or change Desktop main to let the installer command a shutdown | Would modify the frozen Desktop runtime and create a new cross-process contract outside the authorized files | Rejected |
| Manual uninstall/reinstall or direct `app.asar` replacement | Bypasses the product upgrade path and risks Activation/AppData state | Prohibited |
| Adapt RC9's exact `nsProcess` check, safe manual exit, hook ordering, temporary uninstaller working directory, and CRC validation | Localized to NSIS lifecycle and validation; no Runtime or business change | Selected |

No equally regular solution avoids the frozen NSIS boundary. The selected pattern is the smallest known solution that removes default force-kill behavior and protects the prior-version uninstaller handoff.

## Authorized Design

- Override electron-builder's app-running check with `customCheckAppRunning` using `nsProcess::_FindProcess` and `${APP_EXECUTABLE_FILENAME}`.
- Treat `0` as exact executable running, `603` as not running, and unexpected plugin results as fail-closed installer errors.
- If the exact Desktop executable is running, require the operator to exit through the existing normal application/tray path and rerun; do not terminate it.
- Invoke the exact check from `customInit` and `customUnInit` so install and prior-version uninstall both apply the same policy.
- Set the uninstaller working directory to `$TEMP` before the existing electron-builder prior-version uninstall handoff.
- Force installer and uninstaller to use the same default NSIS icon so electron-builder's embedded-uninstaller icon patch cannot invalidate its CRC.
- Add a read-only package verifier that validates the outer installer NSIS CRC32 and finds and validates exactly one embedded uninstaller NSIS CRC32.
- Preserve the existing `customInstall` / `customUnInstall` HKCU Run hooks exactly.
- Preserve `deleteAppDataOnUninstall: false`; do not delete, migrate, synthesize, or inspect Activation data.

## Authorized Files

- `desktop/build/installer.nsh`
- new focused lifecycle test under `desktop/tests/`
- new package-integrity verifier under `desktop/scripts/`
- this successor review and a minimal Candidate evidence record under `docs/desktop/`

`desktop/electron-builder.yml` is already wired to `build/installer.nsh`; no change is authorized unless implementation proves that the existing hook cannot express the selected design.

## Explicit Non-Scope

- `desktop/src/main/**`, including main lifecycle, tray, Activation, credential/safeStorage, P1A fullscreen, and `windowManager.ts`
- `desktop/src/renderer/**`, preload, IPC, Electron security settings, Provider, or HRT
- Web, cashier, Customer Display business behavior, API, schema, Production, Printing, RC9, or printer configuration
- P1B, service, scheduled task, Startup-folder workaround, installer framework rewrite, forced termination, deployment, or V727 execution
- Release Foundation group definitions, invariants, hashes, allowlists, exceptions, bypasses, or gate strength

## Security, Reliability, and Compatibility Review

- Exact executable-name detection replaces the default user/task-list heuristic and cannot match RC9 because the executable identities differ.
- Safe exit remains owned by the application and operator; the installer receives no capability to kill or signal unrelated processes.
- `$TEMP` is used only as a working directory for the existing electron-builder uninstaller handoff, preventing the uninstaller process from retaining the installation directory as its current directory.
- CRC validation is a build-time read-only integrity gate. It does not patch, sign, execute, or mutate the produced installer.
- One fixed HKCU Run value remains the sole Desktop auto-start registration; install/upgrade overwrite it and uninstall deletes it as before.
- Electron security, Activation authorization, safeStorage, credentials, installation identity, AppData retention, and manual launch are unchanged because no Runtime source is modified.

## Required Candidate Evidence

- structural assertions for exact process detection, no `taskkill` or process-kill instruction, supported hook order, `$TEMP` handoff, matching icon protection, and preserved HKCU hooks;
- outer-installer and embedded-uninstaller CRC32 verification against the generated exact package;
- TypeScript, complete Desktop suite, static Electron security, compile, Windows x64 NSIS package, packaged Activation assets, and packaged Provider resource;
- Scope Guard, Release Foundation policy, and Release Lineage PASS without gate weakening or exception;
- unchanged Activation/P1A/auto-start Runtime bytes and zero Web/API/DB/Printing diff;
- fresh-context independent read-only review PASS.

Windows upgrade behavior remains a real-machine FIELD item. Local/package evidence may establish only `CANDIDATE READY FOR V727 FIELD`; it may not claim installation, Activation Boot Fix FIELD, P1A FIELD, or Production status.

## Decision

The successor-change review is `PASS`.

```text
AUTHORIZED INSTALLER UPGRADE LIFECYCLE SUCCESSOR CHANGE
for ES-DESKTOP-INSTALLER-UPGRADE-LIFECYCLE-FIX-01
```

Any need to edit Desktop runtime code, change Activation/AppData semantics, add forced termination, change RC9/Printing, weaken a gate, or modify installer behavior beyond the exact lifecycle above must STOP and require renewed Founder authorization.
