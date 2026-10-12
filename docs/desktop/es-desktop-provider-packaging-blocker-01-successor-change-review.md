# ES-DESKTOP-PROVIDER-PACKAGING-BLOCKER-01 Successor-Change Review

## Governance

Governed by:

- `ES-GOV-001 Level 0 Governance Baseline V1.0 FINAL`
- `ES-ENG-001 Engineering Workflow Baseline V1.0 FINAL`
- `E-Shop Founder-Gated Agent Development Workflow V1`
- `ES-DESKTOP-UX-01 P1A Fullscreen Foundation Final Freeze Record`
- `EP-MB3-07A Phase 1 Release Foundation Final Freeze Record`
- Release Lineage Gate and Scope Guard

## Record Identity

| Item | Value |
| --- | --- |
| Task | `ES-DESKTOP-PROVIDER-PACKAGING-BLOCKER-01` |
| Risk | `L3` — corrective successor to the FINAL FROZEN installer boundary |
| Founder authorization | `APPROVE Frozen Installer Corrective Successor / Limited Implementation`, 2026-10-12 |
| Starting `origin/main` | `d454cc7fea21b51f91bc45660b980424b8abe869` |
| Production SHA | `a35b2e88c372f79b8ce2614306ab92f13c6a3e58` / `READY` |
| Candidate branch | `codex/es-desktop-provider-packaging-blocker-01` |
| Candidate commit | `906237ffd545293131b803ab207a3b8df44d81a6` — local implementation candidate |
| Classification | `AUTHORIZED INSTALLER SUCCESSOR CHANGE` |
| Production / merge / push | `NO` |
| Windows FIELD | `NOT VERIFIED` |

This record is a narrow corrective successor. It does not revise the P1A freeze, reopen M1 Runtime, establish a new installer baseline, authorize a formal installer release, or weaken any Release Foundation assertion.

## Governing Freeze and Predecessor

The predecessor is the P1A FINAL FROZEN installer configuration recorded in `docs/desktop/es-desktop-ux-01-p1a-final-freeze-record.md`, including the hash-bound `desktop/electron-builder.yml`. That freeze explicitly retained the deferred finding that the bundled HRT Provider could log missing `@eshop/hrt-contract`.

The current Release Foundation predecessor remains the frozen Phase 1 policy and its twelve frozen groups. No frozen group definition, release-asset allowlist, provenance invariant, security check, or failure condition is changed by this successor.

## Root Cause

The external Provider compiles CommonJS output containing `require("@eshop/hrt-contract")`. Its Provider artifact includes `node_modules/@eshop/hrt-contract`, but Desktop `extraResources.filter` stages only `dist/**` and `package.json`. The installed Provider entry therefore has no package-relative runtime dependency and fails with `MODULE_NOT_FOUND` outside the monorepo.

The compiled Provider scan found exactly one external runtime dependency: `@eshop/hrt-contract`. Its dependency package has no additional external runtime dependency. The minimal closure is therefore the exact subtree `node_modules/@eshop/hrt-contract/**`.

## Exact Authorized Paths

### Implementation and verification

- `desktop/electron-builder.yml` — add only the Provider contract runtime subtree to the existing `extraResources` filter.
- `desktop/scripts/verify-provider-packaging.mjs` — inventory emitted dependencies, validate package-relative staging, and load the isolated entry.
- `desktop/tests/provider-packaging.test.ts` — positive, negative, closure, deterministic-layout, and Windows-compatible path evidence.

### Conditional CI paths

- `.github/workflows/desktop-windows-build.yml`
- `.github/workflows/desktop-release-pilot.yml`

Both workflow paths are authorized only for invoking the packaging verifier after electron-builder creates `release/win-unpacked/resources/eshop-windows-provider`. Existing workflows currently check only `dist/index.js`; their pre-package test step cannot prove final staging resolution. No deploy, promotion, release-channel, signing, or other workflow semantics may change.

## Allowed Purpose

Only:

1. Ship the deterministic Provider runtime dependency closure.
2. Prove complete external runtime dependency inventory.
3. Prove isolated `require.resolve("@eshop/hrt-contract")` and Provider entry load.
4. Prove the negative missing-dependency case fails.
5. Prove package-relative resolution with spaces and installed `resources/eshop-windows-provider` layout.

## Explicit Exclusions

- Provider source, lifecycle, health, retry, async/non-blocking, or child-process behavior;
- M1 Runtime, activation, PIN, credential, authorization, and startup stages;
- `packages/hrt-contract/` source or contract semantics;
- `desktop/build/installer.nsh` and all unrelated Desktop packaging behavior;
- database, migration, Production, formal installer release, Windows FIELD, V727, push, and merge;
- broad `node_modules` or monorepo staging;
- NODE_PATH, global dependencies, absolute developer paths, catch-and-ignore behavior, or frozen assertion weakening.

## Candidate Hash Binding

Candidate hash binding:

- Commit: `906237ffd545293131b803ab207a3b8df44d81a6`
- `desktop/electron-builder.yml`: `58dc72b40c149d166688b8d4bb432fdd806a1e53ae474eeb60fe7948a12168bc`
- `desktop/scripts/verify-provider-packaging.mjs`: `6234bcc2b118f0ab8018c91bd95ff86c6ad8a3f39fba800fa48bdf825fc9fd07`
- `desktop/tests/provider-packaging.test.ts`: `00df9c755891b12b572aecbeb099887e5c665e8c52d2d273974091acdd244822`
- `.github/workflows/desktop-windows-build.yml`: `740ea561fd069992a280b04f103cd62e806edac078ae9c650c5f7fcffd70b704`
- `.github/workflows/desktop-release-pilot.yml`: `9090870f3214695a0e23bf2ea2663e2f78cf284f19e97dfd0126a3d801706f9d`
Any unlisted path or behavior change invalidates this successor record and requires a new Founder decision.

## Required Validation

- dependency closure inventory: `MISSING RUNTIME DEPENDENCIES = NONE`;
- reduced/current staging fails on missing contract;
- candidate staged artifact resolves the contract and loads Provider in an isolated child process;
- no workspace symlink, monorepo root dependency, global package, or `NODE_PATH` is used;
- deterministic layout and Windows-compatible path evidence;
- Desktop typecheck, compile, targeted tests, Release Foundation policy/tests, frozen groups, Scope Guard, and STRICT Release Lineage;
- fresh-context Claude independent review before any merge consideration.

## Decision and Stop Boundary

```text
AUTHORIZED INSTALLER SUCCESSOR CHANGE
for ES-DESKTOP-PROVIDER-PACKAGING-BLOCKER-01
```

The maximum authorized outcome is a local implementation candidate and Claude Independent Review Package. Push, merge, deploy, formal installer release, Windows FIELD, FINAL FROZEN, and CLOSED remain prohibited.
