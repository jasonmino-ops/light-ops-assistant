# ES-DESKTOP-ACTIVATION-LAUNCH-CONTEXT-FIX-01 Minimal Successor-Change Review

## Governance

Governed by ES-CONST-001, ES-STRAT-001, ES-GOV-001, ES-ENG-001, the Release Lineage Gate, Scope Guard, and the frozen ES-DESKTOP-UX-01 Blueprint and Roadmap.

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-ACTIVATION-LAUNCH-CONTEXT-FIX-01` |
| Risk | `L3 governance / low technical risk` — `FINAL FROZEN` main startup and WindowManager boundary |
| Founder authorization | `APPROVE MINIMAL BLOCKING FIX`, 2026-09-16 |
| Starting `origin/main` | `5de2b3932981a988d5185e2a1ee4b83e3e0c35fa` |
| Starting Production | `5de2b3932981a988d5185e2a1ee4b83e3e0c35fa` / `READY` |
| Immutable predecessor Desktop Candidate | `c9506307e42bc49d583d90f20a173e17450a7ba9` |
| Review decision | `PASS` |
| Classification | `AUTHORIZED DESKTOP ACTIVATION LAUNCH-CONTEXT SUCCESSOR CHANGE` |

This record authorizes only the smallest correction that carries verified `AuthorizedDesktopContext.device.storeCode` into the existing Desktop employee and customer-window URL builders. It does not authorize installation, deployment, V727 continuation, P1A FIELD, P1B, or any business change.

## Confirmed FIELD Blocker

V727 completed real Mino Pet Shop Activation, but the authorized employee window opened `/desktop?lang=zh` and rendered the mode-selection fallback with no store code. Read-only source diagnosis proved that:

- Activation writes and verifies the device identity before formal Runtime startup;
- the verified context contains `device.storeCode = ST169E7000`;
- `startAuthorizedDesktopRuntime` receives that context but discards it as `_context`;
- `WindowManager` builds both employee and customer URLs from the pre-Activation cached config;
- the first-run config intentionally contains an empty store code, so `employeeUrl()` selects `/desktop` instead of `/desktop/pos`.

This is a launch-context integration defect, not an Activation credential, API, Web, cashier, or store configuration failure. It blocks the V727 Activation baseline and P1A FIELD.

## Authorized Design

1. `startAuthorizedDesktopRuntime(context)` sets the verified `context.device.storeCode` on `WindowManager` before any formal window is created.
2. `WindowManager` retains that value only in process memory as the authorized launch context.
3. Existing `employeeUrl` and `customerUrl` builders receive a derived config whose store code is the verified in-memory value.
4. The verified value overrides any configured store code after authorization; URL input never overrides verified identity.
5. No store code is written to config, installation identity, credential metadata, safeStorage, or any Cloud resource.
6. Activation/credential verification remains the only authorization mechanism; the URL parameter remains routing context only.

## Authorized Files

- `desktop/src/main/main.ts`
- `desktop/src/main/windowManager.ts`
- focused tests under `desktop/tests/`
- `desktop/scripts/release-foundation.mjs`, only for an exact successor snapshot after evidence is complete
- this review and one Candidate evidence record under `docs/desktop/`

## Explicit Non-Scope

- `desktop/src/main/config.ts` persistence or file format
- Activation API/runtime/credential/safeStorage/installation semantics
- Web, cashier, Customer Display business behavior, API, schema, migration, Production, Printing, RC9, Provider, or HRT
- P1B, config cleanup, installer changes, Computer Client convergence, UI work, exception, bypass, frozen-group removal, or gate weakening

## Required Evidence

- first Activation and credential-restore paths both pass verified device identity into formal Runtime startup;
- exact employee POS URL includes verified store code, language, and `mode=pos`;
- customer display uses the same verified store context;
- config persistence, credential/API/schema, Web, and Printing diffs remain zero;
- Activation guard and Electron security remain unchanged;
- focused tests, TypeScript, full Desktop suite, static security, compile/package, Scope Guard, Release Foundation successor gate, Release Lineage, and independent review pass.

## Decision

```text
AUTHORIZED DESKTOP ACTIVATION LAUNCH-CONTEXT SUCCESSOR CHANGE
for ES-DESKTOP-ACTIVATION-LAUNCH-CONTEXT-FIX-01
```

The maximum local outcome is a new successor Candidate ready for separately authorized V727 exact-Candidate upgrade. FIELD does not resume in this task.
