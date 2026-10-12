# ES-DESKTOP-WINDOWS-CI-RELEASE-GATE-FIX-01 Successor Alignment

Date: 2026-10-12

## Authority and boundary

- Parent task: `ES-DESKTOP-NEW-PC-RUNTIME-START-FAILURE-01 / INSTALLER RELEASE GATE`
- Subtask: `ES-DESKTOP-WINDOWS-CI-RELEASE-GATE-FIX-01`
- Founder authorization: one limited Windows CI corrective investigation and minimal fix for the observed Windows parser failure and Release Foundation source-policy cleanliness failure.
- Trusted baseline: `0ba19ca5ae5394b398b1b5ba6dd1251f48c2675b`.
- Prior Provider packaging candidate remains immutable. This document records a successor corrective candidate; it does not amend, rebase, or overwrite the prior candidate.

## Corrective candidate

- Implementation commit: `38292d866fb575e49ea3fa909b6e6fd9e375e2af`
- Current successor candidate: this document is added after the implementation commit and will be recorded by the containing commit.
- Authorized implementation paths:
  - `.github/workflows/desktop-windows-build.yml`
  - `desktop/tests/provider-packaging.test.ts`
- Governance evidence path:
  - `docs/desktop/ES-DESKTOP-WINDOWS-CI-RELEASE-GATE-FIX-01-successor-alignment.md`
- No Provider source, M1 runtime, `package.json`, lockfile, dependency, database, `desktop/electron-builder.yml`, `desktop/scripts/release-foundation.mjs`, or `desktop/tests/release-foundation.test.ts` was changed.

## Blocker A evidence and fix

The failed Windows run `38207581070` / job `114674381041` failed during Unit tests at `desktop/tests/provider-packaging.test.ts:5:31` with `SyntaxError: Invalid or unexpected token`, with the parser marker in the descriptive text following the TypeScript `@ts-expect-error` directive.

The source blob was verified as ASCII/LF without BOM. The minimal cross-platform fix canonicalizes the directive to the parser-safe form:

```ts
// @ts-expect-error: the verifier is a Node ESM CLI module with no generated declaration file.
```

This changes no runtime behavior and preserves the existing Provider packaging test intent.

## Blocker B evidence and fix

The Release Foundation source policy rejects any non-empty `git status --porcelain` before integration. The workflow checked out the external Provider repository into the main worktree at `ep-mb3-provider/`, producing the first dirty status entry `?? ep-mb3-provider/`. The Contract install/build was separately verified not to create tracked drift.

The minimal workflow fix:

1. disables Windows global Git autocrlf for the checkout so the working register remains byte-aligned with the trusted LF blob;
2. verifies the source worktree is clean before Unit tests;
3. moves the external Provider checkout/install/build/stage sequence after Unit tests;
4. records the post-Provider-checkout dirty status without weakening Release Foundation policy.

The workflow still checks out the exact authorized Provider commit and retains the existing Provider packaging verifier and build sequence.

## Local gate evidence

- Provider packaging targeted tests: PASS, 3/3.
- Release Foundation tests: PASS, 14 passed, 1 skipped.
- Full Desktop tests: PASS, 361 passed, 1 skipped.
- Typecheck: PASS.
- Compile: PASS.
- Release Foundation policy: PASS; 12 frozen groups PASS.
- STRICT Release Lineage against Production SHA `a35b2e88c372f79b8ce2614306ab92f13c6a3e58`: PASS.
- Scope Guard: pending final exact-file invocation before push.
- Windows CI rerun: pending; no push or rerun has occurred at the time this evidence was written.

## Integrity fingerprints

SHA-256 after the implementation commit:

- `desktop/tests/provider-packaging.test.ts`: `1c80f88658ed335cfac58c688e3e6311b83b5ebfc7d401d6ee6eecd75f790c5b`
- `.github/workflows/desktop-windows-build.yml`: `fceae26fbf778feafbbcf69804383e580ca9cb8294a52bae15210807cf1a1a02`

## Release boundary

This corrective candidate has not been pushed, merged, or released. Windows Build Verified remains NO until the authorized build-only workflow rerun executes on `windows-latest`. Installer Release Ready, Windows FIELD, FINAL FROZEN, and CLOSED remain NO.
