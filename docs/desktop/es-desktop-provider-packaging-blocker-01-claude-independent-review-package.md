# ES-DESKTOP-PROVIDER-PACKAGING-BLOCKER-01 Claude Independent Review Package

## Review boundary

Review the local-only candidate for `ES-DESKTOP-PROVIDER-PACKAGING-BLOCKER-01`.

- Founder authorization: `APPROVE Frozen Installer Corrective Successor / Limited Implementation`, 2026-10-12.
- Baseline: `origin/main=d454cc7fea21b51f91bc45660b980424b8abe869`.
- Production: `a35b2e88c372f79b8ce2614306ab92f13c6a3e58`, `READY`.
- Candidate branch: `codex/es-desktop-provider-packaging-blocker-01`.
- Candidate commit: `906237ffd545293131b803ab207a3b8df44d81a6`.
- Maximum outcome: local implementation candidate and review only.
- Push, merge, deploy, formal installer release, Windows FIELD, and CLOSED are not authorized.

Primary governance record:
`docs/desktop/es-desktop-provider-packaging-blocker-01-successor-change-review.md`

## Exact candidate paths

- `desktop/electron-builder.yml`
- `desktop/scripts/verify-provider-packaging.mjs`
- `desktop/tests/provider-packaging.test.ts`
- `.github/workflows/desktop-windows-build.yml`
- `.github/workflows/desktop-release-pilot.yml`
- `docs/desktop/es-desktop-provider-packaging-blocker-01-successor-change-review.md`
- This review package.

The two workflow changes only invoke the verifier after the existing unpacked Provider resource existence check. No Provider runtime source, M1 runtime behavior, activation behavior, contract source, broad `node_modules` staging, or release semantics were changed.

## Problem and corrective boundary

The compiled Provider entry contains `require("@eshop/hrt-contract")`. The previous Desktop `extraResources.filter` staged only `dist/**` and `package.json`, omitting the package-relative runtime dependency. The candidate adds only:

```text
node_modules/@eshop/hrt-contract/**
```

The verifier statically inventories emitted JavaScript, resolves external packages from the staged Provider root, rejects resolutions outside staged `node_modules`, and loads the entry in an isolated child process with `NODE_PATH` cleared.

## Evidence

### Provider dependency inventory

- External runtime dependencies: `@eshop/hrt-contract` only.
- Node builtins: `node:child_process`, `node:crypto`, `node:fs`, `node:net`, `node:os`, `node:path`, `node:string_decoder`.
- Local modules: Provider-local relative modules only.
- Dynamic literal imports: none.
- Optional external runtime dependencies: none.
- Bundled external dependencies: none.
- Platform-specific artifact observed: `helper/win-x64`; this is not a Node package dependency and was not changed by this narrow successor.
- Result: `MISSING RUNTIME DEPENDENCIES=NONE` for the source Provider artifact and the candidate staged artifact.

### Packaging and negative evidence

- Reduced staging containing only `dist/**` and `package.json` fails dependency resolution with `MODULE_NOT_FOUND`.
- Candidate electron-builder staging resolves `@eshop/hrt-contract` inside the staged Provider `node_modules` subtree.
- Candidate staged Provider entry loads successfully in an isolated child process.
- Removing the staged contract subtree makes the verifier fail with `MISSING_RUNTIME_DEPENDENCIES: @eshop/hrt-contract`.
- The test fixture uses a `Program Files/E-Shop Desktop/resources/eshop-windows-provider` path and verifies package-relative resolution independent of `NODE_PATH`.

### Validation

- Provider packaging tests: 3 passed.
- Desktop typecheck: PASS.
- Desktop compile: PASS.
- Full Desktop test suite: 41 files, 361 passed, 1 skipped.
- Release Foundation tests: 14 passed, 1 skipped.
- Release Foundation policy: PASS; 12/12 frozen groups PASS.
- Scope Guard: PASS; all candidate paths ALLOWED.
- STRICT lineage from Production SHA: PASS before implementation and on the clean committed candidate.
- Actual Windows build: not run on this non-Windows host.
- FIELD VERIFIED: not established.

## Independent review questions

1. Is the dependency inventory complete for all emitted Provider JavaScript, including literal dynamic imports?
2. Does the verifier prove staged package-relative resolution without accepting workspace, global, symlink, or `NODE_PATH` fallback?
3. Is the `electron-builder.yml` addition the minimum deterministic closure and limited to the Founder-authorized boundary?
4. Do the workflow invocations gate the actual post-package layout without changing release semantics?
5. Are the negative, isolation, Windows-compatible path, Scope, frozen-boundary, and lineage claims supported by the recorded evidence?
6. Is any additional change required before a separately authorized merge/release decision?

## Reviewer decision

To be completed by an independent fresh-context Claude reviewer. This package is evidence for review, not an approval, merge authorization, release authorization, FIELD verification, or Closure record.
