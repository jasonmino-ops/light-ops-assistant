# ES-DESKTOP-ACTIVATION-LAUNCH-CONTEXT-FIX-01 Release Foundation Successor Alignment

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-ACTIVATION-LAUNCH-CONTEXT-FIX-01` |
| Action | Minimal Release Foundation successor alignment |
| Founder authorization | `APPROVE MINIMAL BLOCKING FIX`, 2026-09-16 |
| Starting `origin/main` | `5de2b3932981a988d5185e2a1ee4b83e3e0c35fa` |
| Starting Production | `5de2b3932981a988d5185e2a1ee4b83e3e0c35fa` / `READY` |
| Prior legal snapshot | `439dcac561734d07b9e022c8d99e693c99d26794` |
| Immutable implementation snapshot | `17c764427f1e53288dedb82a1965b1365c1ded3d` |
| Immutable predecessor Desktop Candidate | `c9506307e42bc49d583d90f20a173e17450a7ba9` |
| Classification | `AUTHORIZED DESKTOP ACTIVATION LAUNCH-CONTEXT SUCCESSOR CHANGE` |
| Production change | `NO` |
| V727 installation | `NOT PERFORMED` |
| P1A FIELD | `NOT VERIFIED` |
| P1B | `NOT STARTED` |

## Successor Basis

V727 real Activation produced a verified `AuthorizedDesktopContext` containing `device.storeCode = ST169E7000`, but formal Runtime discarded that context. The employee and customer-window URL builders consequently read the empty pre-Activation config store code. The employee window opened the existing `/desktop` mode-selection fallback instead of the store-scoped POS route, blocking the Activation baseline and P1A FIELD.

The Founder-authorized successor review is:

- `docs/desktop/es-desktop-activation-launch-context-fix-01-successor-change-review.md`
- review commit `4f945cf`
- review decision `PASS`

It permits only the minimum in-memory handoff from the already verified device identity into the existing employee and customer-window URL builders, focused tests, and exact Release Foundation alignment evidence.

## Exact Frozen-Boundary Delta

Comparing prior legal snapshot `439dcac561734d07b9e022c8d99e693c99d26794` with immutable implementation snapshot `17c764427f1e53288dedb82a1965b1365c1ded3d` changes exactly two frozen groups:

| Frozen group | Changed path | Authorized effect |
| --- | --- | --- |
| `main startup gate` | `desktop/src/main/main.ts` | Pass verified `context.device.storeCode` to `WindowManager` before any formal window is created |
| `WindowManager` | `desktop/src/main/windowManager.ts` | Retain verified store code in process memory and supply it to the existing employee/customer URL builders |

The frozen-boundary code delta is `19 insertions, 3 deletions` across those two files. No other frozen group changes between these snapshots.

The successor does not change Activation authorization, credential verification, safeStorage, installation identity, config persistence, Web business behavior, cashier logic, Customer Display behavior, API, schema, migration, Printing, RC9, Provider/HRT, or P1B.

## Durable Alignment

The default executable comparison reference may advance from prior legal snapshot `439dcac561734d07b9e022c8d99e693c99d26794` to immutable implementation snapshot `17c764427f1e53288dedb82a1965b1365c1ded3d`.

This is not Candidate self-comparison: the final Candidate necessarily descends from this immutable snapshot and includes this alignment record and the one-line baseline reference update. The baseline accepts no later Candidate bytes.

The alignment changes none of the following:

- the twelve frozen groups;
- any protected path;
- exact `git diff --name-only` comparison behavior;
- failure semantics;
- release-asset or provenance validation;
- invariants, hashes, allowlists, exceptions, or bypasses.

Unknown future changes to `main.ts`, `windowManager.ts`, including any P1B display-assignment bytes, or any other frozen group remain unaccepted and fail the unchanged gate.

## Evidence Status

Before alignment, the default policy fails closed and reports exactly `main startup gate, WindowManager`. This failure is not ignored or allowlisted.

The implementation snapshot has focused evidence for:

- first Activation forwarding the verified device store code;
- credential restore forwarding the verified device store code;
- exact employee URL `/desktop/pos?storeCode=ST169E7000&lang=zh&mode=pos`;
- customer-display URL using the same verified store code;
- unchanged pre-authorization config fallback;
- no config writeback.

After the baseline reference update, the default Release Foundation policy, full Desktop suite, TypeScript, static security, compile/package validation, Scope Guard, Release Lineage, and fresh-context independent review remain mandatory. Results are recorded in the Candidate evidence and final task report; this record does not pre-claim them.

## Stop Boundary

This alignment authorizes no merge, push, Production deployment, V727 installation, Activation continuation, P1A FIELD, P1B, or unrelated correction.
