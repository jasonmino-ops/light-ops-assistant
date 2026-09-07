# ES-PRINT-NETWORK-FIRST-01 G1 Exact Exception Review Record V1.0

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Status and Authority

- Status: ACCEPTED / FOUNDER-AUTHORIZED GOVERNANCE MERGE. Feature release remains unauthorized.
- Task: `ES-PRINT-NETWORK-FIRST-01`; scope is the frozen Chrome cashier Network Print V0.1 only.
- Governance base: `e21cff2b6c9f8c10709bcda6cbbd94e33d635aa3`.
- Governance branch: `codex/es-print-network-first-01-g1-governance`.
- Exact proposed exception: `docs/change-gates/exceptions/ES-PRINT-NETWORK-FIRST-01.json`.
- Future feature branch: `codex/es-network-print-v01` (not the sealed R3 evidence branch). Create its worktree from trusted main containing the exception only after the separate governance merge is approved and completed.
- Founder explicitly approved commit, push and merge of only this record and the exact exception JSON, accepting one unavoidable automatic Production deployment from the existing Git integration. No manual deployment, Promote or retry is authorized; post-deployment verification is read-only SHA, state and basic health only. This authorization excludes the 22 feature files, database changes, installers and functional deployment.
- After trusted-main activation, Founder permits preparing the exact 22-file feature branch, running Scope Guard and necessary regressions, creating a local feature commit and independent review. Stop before any feature-branch push, feature main merge or Network deployment.
- `ACTIVE` is the Guard's required record value, not a claim of current activation. A working-tree draft is unusable until its exact bytes are in trusted `origin/main`.
- `approvedAt` records registration of the already explicit Founder content approval; no historical feature commit or attestation is asserted. The actual governance commit will be discoverable in Git history after creation, never invented as a self-referential field.

## Exact Content and Lineage

- Source evidence: `/private/tmp/es-network-print-v01-r3-draft`, branch `codex/es-network-print-v01-r3-draft`, HEAD `036aab539eca9f2dfa9c8897dba26f90592cc9dd`.
- Verified 22 files (14 modified, 8 added), all regular files, exact approved byte hashes, empty index; the source draft is unchanged and uncommitted.
- No changes to any of these 22 paths occurred between the source base and current trusted main. Guard governance changes are separate.
- Mapping SHA-256: `f8deedb2c1242c581480cf2bfcc97c73b0bb09a62c72e849887e98ead85b7c36`.
- Mapping serialization: sort repository-relative paths lexicographically; concatenate each lowercase SHA-256, two ASCII spaces, path, LF; hash the concatenation as UTF-8.
- The JSON's `authorizedPaths` and `authorizedPathSha256` are the authoritative exact 22-file list. No wildcard, prefix or directory grant is present. No old 50-file scope is used.
- Scope Guard is not a repository-wide whitelist. Unlisted paths outside both the default forbidden rules and authorized parent directories retain the pre-existing default-allowed behavior. Before any feature staging/commit, independently require the complete changed-file set to equal these 22 paths (no missing or extra file), verify all 22 hashes, then run the actual trusted Guard. Passing Guard alone is insufficient to establish the complete task scope.
- Top-level `PRE_COMMIT_CONTENT_SHA256` requires no feature commit and omits `authorizedCommits` entirely. The selected base must remain an ancestor of both trusted main and feature HEAD.

## Frozen Boundaries

- Chrome `/cashier` normal online sales only; durable FRONT/KITCHEN jobs in the sale transaction; reuse existing Relay, job ledger, Binding, ACK, journal and Tray.
- Cloud expresses FRONT/KITCHEN only; host/port remain local, identity-protected and validated. TCP completion is byte submission only, `physicalCompletionKnown=false`; `CROSSING_UNKNOWN` never auto-reprints.
- No Desktop 0.4.7, templates, Renderer, Encoder, QZ, USB, drivers, Windows printing paths, schema, migration or Production configuration changes. The approved local Network node-configuration implementation remains within the 22-file scope.
- No H5/offline/member-balance/payment-entry expansion, reprint UI, multi-Agent scheduling, duplicate Agent/core, formal EXE or installer.
- Desktop 0.4.7 release provenance remains an independent future Release Gate blocker; this exception neither fabricates nor waives it.
- Exception must become CLOSED after feature merge, retaining actual merge SHA and audit history, and must not remain active beyond final freeze.

## Validation Evidence

- G1 focused validation: 248/248 PASS using `/private/tmp/es-print-network-first-01-g1-validation.cjs`; `node --check` PASS. Script SHA-256: `c98774c397a1eb43dcd1fdcd056cce76c5a5f00de1c02332570c8b2d09de918f`.
- Candidate exception file SHA-256: `86ae2c09c47e19ca3083887ebdb88258feaf7e693a86d247fed21d91899f45db`. Content-mapping digest remains the value above.
- SIMULATION ONLY: an isolated local Git fixture used the real governance base and candidate exception, no network remote, and no feature bytes in its synthetic governance commits. All 22 exact uncommitted files passed the actual CLI; each of 22 individual byte mutations was rejected while the other 21 remained allowed.
- Wrong task/branch/CLOSED, trusted exception/config byte tampering, invalid authorization syntax, non-regular files, and unlisted adjacent protected paths were rejected. The fixture was cleaned up; its commits are not project commits or evidence of real trusted-main activation.
- Existing default-allowed paths outside the exception's parents were explicitly tested, not mislabeled as denied: a 23rd change to `lib/qzPrinterAdapter.ts` still passes raw Guard but fails the mandatory supplemental exact changed-files manifest gate. That gate also rejects missing and duplicate paths.
- Source preservation checks passed for real G1 and R3 refs, HEAD, branch, status, index, full exception bytes and all 22 sealed files. The tests did not change either real worktree.
- Fresh-context independent read-only review: PASS, no blocking authorization issue. The reviewer independently validated the actual record, 22-file set/hash mapping, lineage inputs, absence from trusted main, approval/closure semantics and exact two-file governance scope. Review suggestions on approval provenance, default-allow limitations and Production/local configuration wording were incorporated and re-reviewed PASS.
- Governance-path Scope self-check: PASS. Whitespace checks reported no errors (untracked-file `git diff --no-index --check` returns 1 for the added-file difference, with no whitespace diagnostics).
- The real repository must continue to reject this task while its exception is absent from trusted main.
- No application build is needed for this governance-only record; Guard regression and exact-scope validation are required instead.
- This exception JSON affects Guard authorization behavior, so the AGENTS docs-only lineage exemption was not used. Before creating this worktree, the real lineage gate passed against the then-current READY Production `036aab539eca9f2dfa9c8897dba26f90592cc9dd` and clean main `e21cff2b6c9f8c10709bcda6cbbd94e33d635aa3`.

## Next Gate

- Preserve the exception JSON bytes and sealed R3 evidence; retain the completed positive/negative/tamper checks and independent review. Recheck governance scope, latest main and lineage before merging only the two approved governance files.
- Record actual governance commit, merge SHA and automatic deployment facts in the local task-state record after execution, without another main commit or deployment solely to record them.
- Prepare and verify the exact feature branch locally after activation; stop before its push, main merge or deployment and request Founder authorization.
- Do not merge feature code, deploy Network capability, build a formal installer, or infer FIELD VERIFIED from these governance checks.
