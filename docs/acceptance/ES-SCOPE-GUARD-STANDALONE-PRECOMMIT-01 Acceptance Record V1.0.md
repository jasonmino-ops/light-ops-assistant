# ES-SCOPE-GUARD-STANDALONE-PRECOMMIT-01 Acceptance Record V1.0

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Basic Information

- Task: `ES-SCOPE-GUARD-STANDALONE-PRECOMMIT-01`
- Status: `ACCEPTED — GOVERNANCE-ONLY MERGE AUTHORIZED`
- Baseline `origin/main`: `036aab539eca9f2dfa9c8897dba26f90592cc9dd`
- Branch: `codex/es-scope-guard-standalone-precommit-01`
- Worktree: `/private/tmp/es-scope-guard-standalone-precommit-01`
- Implementation commit: not yet created at preparation of this record; the reviewed script hashes below identify the implementation without inventing a future commit SHA.
- Founder authorization (2026-09-08, latest main-executor instruction): complete this Guard-only governance merge after fresh independent review. Only the Guard, its tests, and this required record may enter main. One unavoidable Git-triggered automatic Production deployment of this governance merge is accepted; only read-only status/SHA/basic-health verification may follow. No manual deploy, retry, promote, or extra deployment is authorized.

## Scope

- Modify only `scripts/guards/check-change-scope.js` and its existing test file, plus this mandatory governance record.
- Allow a new task's primary grant to explicitly use `PRE_COMMIT_CONTENT_SHA256` without an existing feature commit. This mode must omit `authorizedCommits` entirely.
- Preserve the legacy primary grant's default `AUTHORIZED_COMMITS` mode and its commit provenance checks. Reject unknown or ambiguous mode values.
- When a task exception explicitly lists a path, require the existing task, branch, ACTIVE status, exact-path and current-byte SHA-256 checks even if the path is not in the default forbidden set. Check all grants when identifying listed paths so a different branch cannot bypass the checks.
- Preserve the default no-task behavior, existing sibling-path restrictions, additional-grant format, canonical paths (including literal Next.js brackets), Founder approval, timestamps, closure, and trusted-main integrity checks.

## Explicit Non-Scope

- No `gate-config.json`, existing exception, or historical governance record changes.
- No Network Print exception or registration of its 22-file manifest.
- No business code, Desktop, Tray, QZ, USB, Windows printing, schema, migration, installer, or runtime configuration changes.
- Do not alter any Network sealed draft or the user's existing worktree.
- No Network feature commit/merge, Network exception merge, manual deployment, promotion, retry, EXE, or installer build. Governance commit/merge/push is limited to the three files in Scope and the one automatic deployment described above.

## Evidence

- Current Production alias was read-only inspected via the installed Vercel CLI: deployment `dpl_Em86aAsFimYfT1fxAZfy3uy7kwW5`, state `READY`, Git SHA `036aab539eca9f2dfa9c8897dba26f90592cc9dd` (confirmed by the matching deployment-list metadata).
- Fresh `git fetch origin` retained the same main SHA.
- Release Lineage Gate: PASS; Production ancestor of main YES; base worktree CLEAN; Safe Development Base YES. The docs-only exception was not used because this change modifies an executable guard.
- Original Scope Guard test baseline: `55/55 PASS`.
- Final `node --test scripts/guards/check-change-scope.test.js`: `70/70 PASS`, fail 0, skip 0. All 55 original tests remain; 15 focused tests were added. The main agent reran the stable suite after the test author completed it.
- Tests cover standalone pre-commit grants with no feature commit, forbidden and non-forbidden exact hashes, legacy/default modes, mode/commit-field ambiguity rejection, task/branch/status isolation, cross-grant isolation, approved-base ancestry against both main and HEAD, trusted exception/config tampering, missing files/symlinks/directories, and legacy commit-content provenance.
- `node --check` for both JavaScript files: PASS. `git diff --check`: PASS.
- Scope Guard self-check for these two scripts and this record: PASS without a task exception.
- Independent read-only review: PASS, NO BLOCKING CODE ISSUE. The reviewer did not author the implementation or tests and separately passed 15 in-memory checks against the real Guard. Final review covered both script diffs and the scope/authorization boundaries of this record.
- Fresh-context pre-merge independent review (2026-09-08 local date): PASS, no new fail-open. The new reviewer read the local task state, governing files and actual three-file diff without conversation history, confirmed the original 55 tests were preserved, and separately passed 25 in-memory assertions plus syntax/diff checks. The main agent reran all 70 tests, fail 0 / skip 0.
- Reviewed implementation SHA-256: `5081a836751f7bdcc0272e28e099e3a31ed9960b7a9254cb65c5108a1d502283` (`scripts/guards/check-change-scope.js`).
- Reviewed test SHA-256: `65a131488705699a892d0d6b3735c74209ed6d717f994c93199eab78e6206c1f` (`scripts/guards/check-change-scope.test.js`).
- Application TypeScript/Next.js build: N/A; this standalone CommonJS guard has no application build dependency. Validate both scripts with `node --check` and run the actual Guard suite and CLI checks instead.
- Integration tests use disposable, local-only Git repositories to model trusted main and provenance. Their synthetic commits are test fixtures, never project or Network feature commits; they have no network remote and are removed by the tests.

## Acceptance Conditions

- Independent review and all relevant tests must pass before local review completion.
- This record does not authorize registering/merging a Network exception or committing Network implementation.
- Before governance commit/merge/push, complete a fresh-context independent review, reconfirm current main and Production lineage, verify the exact three-file diff, and respect repository permissions/protected-branch rules without bypass.
- This task uses the latest explicit Founder permission, not the prior dynamic-route or G1 permission. Its one-time automatic deployment allowance cannot be transferred to the later Network exception or feature line.
- Network G1 may resume only after this fix is separately accepted into trusted main. No Network feature code is authorized for deployment by this record.

## Result

- Local implementation, tests, and independent review complete; no blocking code issue found.
- Accepted for the exact three-file governance merge under the latest Founder authorization; not a Network exception or feature merge.
- Final project scope: two modified scripts and this one new governance record; no other project file changes.
- At preparation, Git index is empty and HEAD/origin-main equal the recorded baseline. Actual governance commit/merge SHAs and any automatic deployment facts will be recorded in the local task state after execution; they are not predeclared here.
- Risk: medium because this is security-sensitive authorization logic; no application or Production behavior has changed in this uncommitted draft.
- This is not a Network release, FIELD verification, or CLOSED state. Stop before the next Network exception main merge and obtain a separate Founder decision on that merge and its possible automatic Production deployment.
