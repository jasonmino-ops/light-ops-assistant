# ES-PRINT rc.7 Candidate Registration and D1 Plan

## Governance status

- Task: `TASK-PRINT-RC7-PREFLIGHT-01`
- Level: L3
- Baseline at investigation: `origin/main` and READY Production both `a33b44c1c51223009326c4869526f7de6bd4a89d`
- This document is a registration and deployment-control plan plus the as-executed D1 control record. External actions described below occurred only under their separately named Founder Gates; this document itself does not authorize an rc.7 build, future push/ref update, Preview/Production deployment, migration, publication, installation, or FIELD acceptance.
- Frozen printing architecture and product scope remain unchanged. In particular this plan adds no FRONT/KITCHEN work, G1 source, USB/Linux/HRT work, Renderer/Agent/networkRuntime change, UI, copy, or product feature.

### Readiness Review and Engineering Authorization disposition

Readiness is `READY` only for the local repository governance implementation described here:

- Risk/Production impact: changing `vercel.json` changes the Git deployment policy after integration; an incorrect transition could create an unintended Preview or Production deployment against a shared database.
- Runtime/contract/provider impact: no application runtime, print contract, Provider, schema, migration, order flow or installed Agent behavior changes.
- Required review: L3 Scope Guard, deployment-policy test and a fresh-context independent review using the ES-ENG Claude Review output fields are mandatory before commit.
- Required Founder gates remain independent. `D1-CONTROL-01` and `D1-BOOTSTRAP-01` completed the control-plane/bootstrap steps; `PRINT-RC7-INTEGRATE` authorizes only this reviewed Candidate's integration into `main`. Any `release` update, Production deployment, rc.7 build, installation or FIELD still requires a separate approval.

Engineering implementation is `AUTHORIZED` only by the Founder's current instructions for branch `codex/print-rc7-preflight-governance` from starting HEAD `a33b44c1c51223009326c4869526f7de6bd4a89d`. The authorized package is limited to:

- truthful closure metadata in the two named exception JSON files;
- this rc.7 registration/D1 plan;
- `vercel.json` entries `main:false`, `release:true` and exact `codex/print-rc7-preflight-governance:false` while preserving the four existing exact Network exclusions;
- the exact deployment-policy test update.

Required outputs are the four closures, plan, policy/test, Phase 0 Known Failure baseline, validation evidence and independent review. No 80%-90% partial product implementation is permitted. This local authorization does not extend to any external state change or later build.

The canonical Phase 0 failure baseline is the tracked repository file `docs/change-gates/ES-PRINT-RC7-KNOWN-TEST-FAILURES.md`. Any `.task-state` copy and temporary log path is execution evidence only. Every later merge calibration must use the tracked file, rerun the then-applicable suite and update evidence rather than relying on the original worktree.

## 1. rc.7 registration plan

### Version and bounded delta

The next unsigned TEST candidate version is `0.1.0-commercial-rc.7`: only the candidate suffix advances from rc.6 to rc.7. `appId`, product name, executable name, per-user install behavior, `win32-x64` target and Electron `44.3.0` stay unchanged.

The retained rc.6 source anchor is `7291c4ba1fc8b8f4d8d926616ccf42b0445a22c0`. Between that anchor and the current functional baseline `a33b44c1c51223009326c4869526f7de6bd4a89d`, Git shows one accepted diagnostics change and exactly three changed files:

- `e-shop-tray/network-addon/ui.ts`
- `e-shop-tray/src/networkDiscovery.ts`
- `e-shop-tray/tests/network-discovery.test.ts`

The functional scope is failure diagnostics only. Phase 0/1 governance files, the Vercel policy and the later mechanical rc.7 version/authorization preparation are provenance inputs, not new print functionality. Before an authorized build, the final source delta must be regenerated from the retained rc.6 anchor to the exact candidate source SHA; any additional functional path blocks the build gate.

The current C3 proposal to change `productName` to Chinese is explicitly deferred. rc.7 keeps `E-Shop Network Print Add-on`, because changing `productName` changes the install directory and would turn the V727 exercise into uninstall/reinstall rather than the required upgrade/cold-start baseline.

### Required registration record

The rc.7 build record must contain, at minimum:

| Field | Required value/evidence |
| --- | --- |
| Candidate version/class | `0.1.0-commercial-rc.7`; `unsigned-test-only`; `published=false`; `releaseReady=false` |
| Source SHA | Full 40-character clean committed SHA; it must equal trusted `origin/main` at the authorized build gate, not a plan-time placeholder |
| Source lineage | Production SHA used by the gate, `origin/main` SHA, Release Lineage result and timestamp |
| Source snapshot | Build manifest `sourceSnapshotSha256` and exact input mapping/hash evidence |
| Installer | Exact filename, byte size and independently recomputed SHA-256 |
| Build manifests | Paths and SHA-256 for `candidate-build-manifest.json`, embedded `build-manifest.json`, `SHA256SUMS.txt` and builder log |
| Toolchain | Node, npm, TypeScript, esbuild, electron-builder, app-builder-lib, `@electron/asar`, `7zip-bin`, 7-Zip binary SHA-256 and Electron runtime; versions must match lockfiles/current pinned config |
| Build machine | Stable machine label, OS name/version/build, CPU architecture, Node architecture and UTC build time; do not record usernames, credentials or sensitive absolute paths |
| Authorization | New exact rc.7 authorization ID, branch, approved path-to-SHA256 mapping and approval timestamp |
| Verification | Repository verifier result, installer/ASAR/NSIS checks, independent review record, `installed=false`, `fieldVerified=false` at build time |

No field may be filled from memory or an earlier candidate. Installer and manifest hashes are computed after the build and checked again from the retained artifacts.

### Artifact naming

The candidate installer name is fixed as:

`E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.7-x64.exe`

The extracted uninstaller evidence follows the existing pattern:

`Uninstall-E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.7-x64.exe`

This preserves the rc.6 naming and C3 upgrade boundary. No official/signed `Setup` artifact is implied.

### Release Lineage Gate integration

At the later, separately authorized build gate:

1. Fetch the real remote state and read the current READY Production Git SHA.
2. Require a clean isolated rc.7 build worktree whose HEAD equals trusted `origin/main`.
3. Run `./scripts/check-release-lineage.sh <production_sha>` and require PASS before preparing or invoking candidate packaging.
4. Require a new Founder-approved ACTIVE exact rc.7 candidate authorization whose branch, candidate fields and path hashes match the build script and trusted `origin/main`. Closed rc.5/rc.6 grants cannot be reused.
5. Run the existing source/input/toolchain and installer verification, then retain immutable manifests, checksums and builder log.
6. Recheck that the recorded source SHA is still the build HEAD and an ancestor of current `origin/main`. A build does not create `FIELD VERIFIED`, publication, or release authority.

The necessary rc.7 constant/hash/authorization preparation and the candidate build require a new Founder Gate. They are intentionally not performed or requested in this task.

## 2. D1 — Production and main separation

### Current state and gate boundary (after D1-BOOTSTRAP-01)

- Repository candidate: `main:false`, `release:true` and exact `codex/print-rc7-preflight-governance:false` exist on the local governance branch pending the Founder-authorized `PRINT-RC7-INTEGRATE` main integration.
- Vercel control plane: Production Branch is `release`.
- Git remote: `origin/main` and `origin/release` both point to `a33b44c1c51223009326c4869526f7de6bd4a89d`; the governance Candidate branch has not been pushed.
- READY Production remains deployment `dpl_Hy3PrXRw7dSNv5Bahf4H6S9tSCac` at source SHA `a33b44c1c51223009326c4869526f7de6bd4a89d`.
- D1 status: control-plane switch and zero-delta `release` bootstrap are complete; repository integration and post-integration no-deployment verification remain pending. No future `release` update or Production deployment is authorized here.

### Verified trigger

Read-only evidence on 2026-09-12 established:

- Vercel project `light-ops-assistant` is connected through the GitHub integration.
- Before `D1-CONTROL-01`, the live Project setting had Production Branch=`main`; it now reads `release`.
- At baseline, `vercel.json` did not list `main`; Vercel documents unspecified branches as deployment-enabled by default.
- No repository GitHub workflow deploys the web application to Vercel.
- A read-only remote query before `D1-BOOTSTRAP-01` found no `origin/release` branch; the authorized bootstrap later created it at the unchanged READY Production SHA `a33b44c1c51223009326c4869526f7de6bd4a89d`.
- Vercel deployment metadata contains five READY Production deployments dated 2026-09-11 UTC, all sourced from branch `main`: `d25b0fee47b42bb979f481eaff1f1dd9a1738f6f`, `1781c5637e40e9033c0c074830b73476247fd972`, `9919828f7bd07c4d1aade46163e7623829e6fc2b`, `7291c4ba1fc8b8f4d8d926616ccf42b0445a22c0`, and `a33b44c1c51223009326c4869526f7de6bd4a89d`.

The trigger is therefore the Vercel GitHub integration plus Production Branch=`main`, with automatic deployment enabled by the repository default.

References: [Vercel Git deployment and Production Branch](https://vercel.com/docs/git), [Vercel `git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration).

### Repository-side policy in this governance commit

`vercel.json` is changed to:

- `main: false` — a main merge must create neither an automatic Production deployment nor an automatic Preview deployment.
- `release: true` — an explicit update of the future Production Branch remains the release trigger.
- `codex/print-rc7-preflight-governance: false` — the exact governance Candidate branch is also suppressed; it remains unpushed.
- Preserve the four existing exact Network branch exclusions.
- Do not add a wildcard. Other branches retain Vercel's default Preview behavior.

`tests/network-release-deployment-policy.test.cjs` seals that exact repository policy. It cannot verify the Vercel control-plane Production Branch; that remains a Founder-executed and separately verified setting.

The test change is a necessary synchronization with the D1 policy, not an assertion relaxation. The prior exact `deepEqual` expected `main` to be absent and would now enforce the obsolete policy. The updated test retains exact full-object comparison, adds explicit `main:false` and `release:true` assertions, and preserves the no-wildcard and four existing branch-exclusion checks.

### Gates D1-CONTROL-01 and D1-BOOTSTRAP-01 — completed control/bootstrap

`D1-CONTROL-01` first authorized only the Vercel control-plane change. Vercel rejected `release` while that remote branch did not exist, so the operation stopped without changing the setting. `D1-BOOTSTRAP-01` then separately authorized the zero-delta bootstrap and one control-plane retry:

1. Audit the READY Production source/build path for migration, schema or production-data-write side effects.
2. Create only `refs/heads/release` at the exact current READY Production SHA `a33b44c1c51223009326c4869526f7de6bd4a89d`; do not push the governance Candidate.
3. Confirm Vercel created no deployment for the already-deployed SHA.
4. Save Branch Tracking=`release` once and do not redeploy.
5. Read back Production Branch=`release`; confirm the existing Production deployment, SHA, aliases, domain and Cron stayed unchanged.

Those steps completed on 2026-09-12. No Preview or Production deployment was created, and the existing Production source remained `a33b44c1c51223009326c4869526f7de6bd4a89d`.

### Gate PRINT-RC7-INTEGRATE — current repository integration

Founder Gate `PRINT-RC7-INTEGRATE` authorizes direct integration of the reviewed local governance commits into `main` and the single resulting main ref update. Do not push the feature branch; although this exact branch is now disabled in the Candidate policy, its push is neither necessary nor authorized. The main update must already contain `main:false`; after the push, verify that Vercel created neither a Production nor Preview deployment for that main SHA. A discrepancy blocks every further D1 forward operation; a necessary incident rollback remains a separate Founder-authorized action.

### Gate D1-RELEASE-03 — later manual Production release

For a later authorized Production release:

1. Select an exact, reviewed SHA already present in `origin/main` and rerun the Release Lineage Gate against the then-current Production SHA.
2. `release` already exists at bootstrap SHA `a33b44c1c51223009326c4869526f7de6bd4a89d`. Updating it to a new exact SHA is the first explicit Production release event after the control-plane switch and requires separate Founder push and Production authorization. Every update must be a fast-forward; never force-update it.
3. The Vercel Git integration builds the `release` push as Production. Verify target=`production`, source branch=`release`, exact Git SHA, state=`READY`, and application health.
4. Run `npm run vercel:current` and the Release Lineage Gate again; retain the deployment receipt. An rc.7 build or FIELD approval does not imply this Production authorization.

This is a manual release decision expressed as an explicit `release` ref update; merging `main` alone is no longer a release action.

### Preview effect and shared-database constraint

Changing Production Branch from `main` to `release` would normally make `main` a Preview branch. The repository's `main:false` rule intentionally suppresses that Preview, avoiding an automatic deployment against the database currently shared by Preview and Production.

Other unspecified branches still auto-create Preview deployments. The existing rule remains: do not push feature branches while Preview shares the Production database unless an exact branch exclusion is already trusted on main or a separately approved isolated Preview database exists. This task does not change databases, environment variables, Preview isolation, or other branch behavior.

### Rollback

- Configuration rollback: Founder can set Production Branch back to `main`, but repository `main:false` must first be changed through a separately reviewed governance commit if automatic main Production deployment is intentionally restored. This rollback reintroduces the original risk and is not an incident response shortcut.
- Application rollback: Founder may immediately point Production to a prior known-good READY deployment, then land a normal revert commit on `main` and fast-forward `release` to that new revert SHA so Git lineage becomes consistent again. Do not force-push `release`.
- Any dashboard rollback, ref update, redeploy or promotion is a distinct Founder-authorized Production operation.

### D1 control completion evidence

D1 control separation is complete only when all of the following are recorded:

- repository policy and its test are present in trusted `origin/main`;
- live Vercel Production Branch reads `release`;
- merging the policy SHA to `main` produced no automatic Production or Preview deployment;
- the pre-existing Production deployment stayed unchanged until an explicitly authorized `release` update;
- `origin/release` remains unchanged until a separately authorized manual Production release.

A later manual release receipt must independently tie Production to its exact approved `origin/main` SHA and pass Release Lineage, but it is not authorized or performed by this integration gate.
