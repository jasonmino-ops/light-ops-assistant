# Dev-Gate-01B / Batch3 Task-Scoped Governance Exception

## Status

| Item | Value |
| --- | --- |
| Gate | Dev-Gate-01B / Batch3 |
| Service task | ES-PRINT-DUAL-CHANNEL-01 |
| Governance branch | `codex/dev-gate-01b-batch3-task-scope-exception` |
| Starting HEAD | `369996d92e5d6fab1fff69cf7da3b9d00dec7c78` |
| Exception status | `ACTIVE` |
| Authorization | `FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION` |
| Merge status | NOT MERGED |

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Readiness and authorization

The Founder explicitly authorized this named Governance Exception package on 2026-09-05. Before the line was created, live Production and `origin/main` were both verified at `369996d92e5d6fab1fff69cf7da3b9d00dec7c78`, and the Release Lineage Gate returned `PASS`.

The exception exists only because the already-reviewed ES-PRINT-DUAL-CHANNEL-01 Production Relay V0.1 requires a dedicated `EshopTrayPrintJob` model and one new migration, while the frozen Dev-Gate-01A default policy correctly blocks accidental Prisma changes.

## Authorized feature identity

- Task ID: `ES-PRINT-DUAL-CHANNEL-01`
- Feature branch: `codex/es-print-dual-channel-relay-v01`
- Authorized commits:
  - `cf3a582ffb51ba0adcea03554ad39ebd3ed8446b`
  - `73ad3a4e3fcc095b9709a7e74657522984fd9371`

The branch name is not the sole boundary. The Guard reads the approved record from the trusted `origin/main` blob and requires the working-tree record to be byte-identical. It also requires the exact task ID, an `ACTIVE` exception, approved commit ancestry from the recorded base through current `HEAD`, an exact path match, and a SHA-256 match against both the approved commit and current file content.

## Exact authorized paths

Only these two paths are authorized:

1. `prisma/schema.prisma`
2. `prisma/migrations/20260905070000_es_tray_production_relay_v01/migration.sql`

No directory, prefix, or wildcard exception is authorized. In particular, `prisma/migrations/**` remains prohibited, and every other migration remains blocked.

## Exception contract

The machine-readable record is:

`docs/change-gates/exceptions/ES-PRINT-DUAL-CHANNEL-01.json`

`ACTIVE` in this unmerged governance branch is only the approved lifecycle state; it grants nothing until the byte-identical record exists in trusted `origin/main`.

Required controls are:

- `taskId` must match the explicit `--task-id` argument.
- The trusted record and `gate-config.json` must exist in `origin/main`; feature-local changes cannot grant authority, and both working copies must remain byte-identical to their trusted blobs.
- `featureBranch` must match the current Git branch discovered by the Guard.
- `baseOriginMainSha` must be an ancestor of `origin/main` and every authorized commit.
- `authorizedCommits` must be in ancestor order, must be ancestors of current `HEAD`, and the final authorized commit must contain the approved file hashes.
- `status` must be `ACTIVE`.
- `authorizationType` and `approvedBy` must identify Founder approval.
- `authorizedPaths` must contain canonical repository-relative exact paths without traversal or wildcard syntax.
- `authorizedPathSha256` must cover every authorized path exactly, and current file content must match.
- malformed, absent, unknown, mismatched, or `CLOSED` records fail closed.

## Guard usage

Default Dev-Gate-01A behavior is unchanged:

```bash
node scripts/guards/check-change-scope.js --files "<comma-separated paths>"
```

After this governance package is merged, run `git fetch origin` and integrate the governance commit into the feature branch without rewriting the two authorized feature commits. The approved feature line may then request its specific exception:

```bash
node scripts/guards/check-change-scope.js \
  --task-id ES-PRINT-DUAL-CHANNEL-01 \
  --files "prisma/schema.prisma,prisma/migrations/20260905070000_es_tray_production_relay_v01/migration.sql"
```

The exception argument does not skip the Guard. It adds all exception checks before either forbidden path can be allowed.

## Closure

After the feature is merged, a governance closure commit must change the exception record to `CLOSED` and add `closedAt` plus the known `featureMergeCommitSha` as closure audit metadata. The record remains in the repository as evidence, but a closed record cannot authorize future changes.

The trusted `origin/main` anchor plus commit ancestry and content hashes prevent a feature from self-authorizing by editing its local exception record or Prisma content. The exception does not authorize merge, Production deployment, Production migration, additional schema work, another migration, or another task.

## Explicit non-scope

- No business code changes
- No Prisma schema or migration changes
- No Tray or Installer changes
- No Production deployment or migration
- No weakening or removal of the existing default forbidden paths
- No `--force`, validation skip, silent bypass, or unknown-task fallback
