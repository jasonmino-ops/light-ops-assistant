# ES-DESKTOP-AUTOSTART-01 Milestone A Minimal Successor-Change Review

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-AUTOSTART-01` |
| Risk | `L3` — `FINAL FROZEN` installer / NSIS boundary |
| Founder authorization | `APPROVE`, 2026-09-16 |
| Starting `origin/main` | `822cbef0eda7ad73192537d35648d24067d77ef9` |
| Starting Production | `822cbef0eda7ad73192537d35648d24067d77ef9` / `READY` |
| P1A successor base | `230182b450f7dd280a6646bc9140d08feec53464` |
| Historical P1A Candidate | `9753a3ab76be072bbd6582608048268bfec66aeb` |
| Review decision | `PASS` |
| Authorized successor classification | `AUTHORIZED INSTALLER SUCCESSOR CHANGE` |

This review authorizes only the smallest installer-owned Windows user-login auto-start change required to make the frozen P1A cold-boot FIELD sequence executable. It does not accept, merge, freeze, publish, install, deploy, or FIELD-verify the resulting implementation.

## Frozen Boundary and Necessity

`docs/desktop/milestone-a-freeze-record.md` freezes the Electron workspace foundation, electron-builder configuration, and Windows CI / NSIS build chain. Every regular product-owned auto-start option necessarily touches either that installer boundary or the separately frozen Desktop main lifecycle. The boundary therefore must be opened through this explicit successor review rather than bypassed or silently edited.

The frozen ES-DESKTOP-UX-01 Roadmap requires a real Windows sequence of login, Desktop auto-start, Activation restore, and P1A native fullscreen. The V727 readiness audit found no official E-Shop Desktop auto-start capability. Without one, the cold-boot FIELD requirement cannot be tested without manufacturing an unauthorized Startup item. The successor is consequently a necessary P1A FIELD prerequisite, not P1B or a new business capability.

## Alternatives Reviewed

| Option | Boundary | Lifecycle properties | Decision |
| --- | --- | --- | --- |
| Electron `app.setLoginItemSettings()` | Frozen Desktop main lifecycle | Per-user and official, but installation does not create the registration until the app runs; repair after an upgrade also depends on app launch; normal NSIS uninstall has no guaranteed app callback to remove it | Rejected |
| Installer-managed HKCU Run value through NSIS `customInstall` / `customUnInstall` | Frozen installer / NSIS boundary | Per-user, no administrator requirement, one stable value name, install/upgrade overwrite the same value, uninstall deletes the same value, and reinstall recreates it | Selected |
| Installer-managed Startup shortcut | Frozen installer / NSIS boundary | Can be removed by the installer but adds a filesystem artifact with weaker duplicate/stale-path characteristics than one named registry value | Rejected |

No equally complete solution avoids a frozen boundary. The selected option opens only the installer boundary and leaves the Desktop main lifecycle untouched.

## Authorized Design

- Use the existing electron-builder custom NSIS include mechanism.
- On successful per-user install, write exactly one named value beneath `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- The value data is the quoted installed E-Shop Desktop executable path.
- Add no command-line argument, FIELD mode, Activation bypass, secondary executable, service, scheduled task, or Startup-folder item.
- On upgrade, write the same named value so Windows retains one registration and any changed install path is replaced.
- On uninstall, delete that exact named value.
- Keep `deleteAppDataOnUninstall: false`; Activation credentials and all other install behavior remain unchanged.

The registered executable enters the existing process unchanged:

```text
E-Shop Desktop executable
→ existing single-instance lock
→ app.whenReady()
→ initializeApplication()
→ existing ActivationRuntime.initialize()
→ authorized runtime
→ existing P1A fullscreen behavior
```

## Authorized Files

- `desktop/electron-builder.yml`
- new `desktop/build/installer.nsh`
- new focused installer auto-start test under `desktop/tests/`
- this review and the minimal candidate evidence record

## Explicit Non-Scope

- P1A fullscreen implementation and `desktop/src/main/windowManager.ts`
- Desktop main, Activation, credential, preload, IPC, security, Provider, HRT, or business logic
- Web / cashier / Customer Display business UI
- API, schema, Production data, deployment, Printing, RC9, or printer configuration
- P1B, P7, settings UI, Technical Support UI, framework work, or any new startup mechanism
- Release Foundation baseline, frozen group list, invariant, exception, bypass, or strength

## Security and Compatibility Review

- The executable and its arguments are fixed by the installer; no user-controlled data is introduced.
- Quoting the executable path protects installation directories containing spaces.
- Registration is in HKCU and matches the existing per-user installer; no elevation or system-wide execution is introduced.
- No BrowserWindow preference, IPC channel, preload surface, navigation policy, popup/permission policy, or Electron sandbox setting changes.
- Manual launch uses the same executable and remains unchanged.
- Activation remains the only authorization gate because no alternate main path or bypass argument is added.
- RC9 and Network Printing remain independent and untouched.

## Required Candidate Evidence

- focused structural tests for exact registration, same-name overwrite semantics, no extra launch arguments, and exact uninstall deletion;
- TypeScript and complete Desktop test suite;
- static Electron security suite;
- compile and Windows x64 NSIS package generation;
- packaged NSIS evidence showing the custom install/uninstall hooks were included;
- Scope Guard, Release Foundation policy, and Release Lineage PASS;
- unchanged Activation guard and historical P1A file bytes;
- fresh-context independent read-only review PASS.

Windows registry behavior remains a real-machine FIELD item. Local/package evidence may establish only `CANDIDATE READY FOR V727 BASELINE PROVISIONING`; it may not claim install, Activation, cold boot, P1A FIELD, or Production status.

## Decision

The review is `PASS`.

The exact scope above is classified as:

```text
AUTHORIZED INSTALLER SUCCESSOR CHANGE
for ES-DESKTOP-AUTOSTART-01
```

Any need to edit another Desktop implementation file, weaken a gate, add a second startup path, or change install semantics beyond the single HKCU Run lifecycle is outside this authorization and must STOP.
