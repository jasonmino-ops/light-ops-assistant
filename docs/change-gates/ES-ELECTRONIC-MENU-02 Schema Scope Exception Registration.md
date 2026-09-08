# ES-ELECTRONIC-MENU-02 Schema Scope Exception Registration

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Status

| Item | Value |
| --- | --- |
| Task | ES-ELECTRONIC-MENU-02 / Dedicated Promotion Media V0.1 |
| Feature starting level | L2; schema and exact exception registration follow L3 gates |
| Governance branch | `codex/es-electronic-menu-02-schema-governance` |
| Feature branch | `codex/es-electronic-menu-02` |
| Base origin/main and verified READY Production | `bcc3ee26947a0673159a80c71a97b8ebcf2410d1` |
| Governance scope | Exact exception JSON and this explanation only |
| Record lifecycle state | ACTIVE |
| Effective authorization | NOT EFFECTIVE until byte-identical in trusted origin/main |
| Governance merge/push and automatic deployment | NOT AUTHORIZED; not performed |
| Schema/migration runtime application | NOT PERFORMED; sealed draft only |
| Database migration execution | NOT AUTHORIZED against any database |
| Feature acceptance / FIELD / CLOSED | NOT VERIFIED / NO / NO |

## Readiness review

**Goal:** register the exact approved storage addition without putting the feature or migration into a governance deployment.

**Current state:** Store/Tenant has no suitable approved general configuration storage. Existing bannerData/bannerUrl serve both H5 and Customer Display. Other configuration/JSON fields have unrelated business contracts. The approved storage choice is two nullable Store fields, mirroring the existing banner data/URL pair.

**Prerequisites:** fresh origin/main fetch, clean worktree and current Vercel metadata confirmed Production `bcc3ee26947a0673159a80c71a97b8ebcf2410d1` READY (`dpl_4tKop8Ec51YhhPwDKQPP2Dbdb5Yu`); Release Lineage PASS before the isolated governance worktree was created. The old V0.1 runtime is unchanged. No Docs-only Exception is used: machine-readable exception registration affects authorization behavior.

**Scope:** prepare sealed schema/migration content and its exact two-path authorization; validate and independently review the local governance-only commit. Business implementation waits for trusted ACTIVE registration.

**Non-scope:** no actual schema/migration path edits in this governance tree; no existing migration-history changes, database connection/execution, backfill, defaults, NOT NULL constraints, new infrastructure, business implementation, API/renderer/upload changes, Guard/configuration changes, merge, push or deployment.

**Risk assessment:** both new PostgreSQL TEXT columns are nullable with no default; existing rows need no backfill and old application code remains compatible after a separately authorized migration. New feature code will require the schema to exist; activation of this Scope Exception does not make any database ready. DDL runtime locking and actual application compatibility remain future migration/feature validation, not claims of this registration.

**Production / runtime / contract impact:** none from this two-file governance diff. If a later approved main push triggers a Vercel deployment, its application, Prisma schema and migration tree must remain identical to the pre-governance main. H5 and Customer Display keep original banner semantics; Product/QR/fullscreen/pagination/30s refresh remain frozen.

**Required review:** fresh-context read-only schema/governance review under Founder's current workflow direction, plus existing Guard tests. This registration applies no schema or API change and does not enter feature Acceptance/Freeze; feature schema/runtime/permission risk review and full regression remain mandatory after activation. No separate Claude execution is claimed.

**Required Founder approval:** local schema/migration-file design and precise exception registration already explicitly approved. Governance merge/push and any automatic governance-only deployment still require a separate decision. No database migration execution is included.

**Decision:** READY for local registration preparation/validation/review/commit only. NOT READY to activate through origin/main or apply protected feature files.

## Engineering authorization

- Authorized package/branch/base: this registration on the governance branch and base above; later feature work on the named feature branch only.
- Allowed scope: Store.electronicMenuMediaData and Store.electronicMenuMediaUrl, both nullable and exclusively Electronic Menu image/GIF; minimal additive migration-file creation; exact Scope Exception; subsequent dedicated-media feature development after activation.
- Prohibited scope: executing migrations on any database; changing existing Store/banner/Product semantics or migration history; main merge/push, Preview/Production deployment, release and destructive actions without separate approval.
- Required outputs/evidence: sealed exact files/patch hashes, two-file governance commit, unchanged runtime proof, strict exception validation, Guard regression and fresh-context independent review.
- Required future verification: A banner/B dedicated image/GIF independence; NULL/deletion fallback; OWNER/store isolation; existing <=2MiB upload errors/animation; H5/Customer Display and frozen Menu regression; TypeScript, Build, Scope and fresh-context feature review.
- Acceptance/freeze: no feature acceptance or freeze claimed. This record must be CLOSED after its feature merge; historical authorization remains available for audit.

## Exact sealed content

| Protected path | Complete resulting file SHA-256 |
| --- | --- |
| `prisma/schema.prisma` | `743d163a3de165206fe9cef36796f91db5fcb7acb206fc45d2f4fb920015017a` |
| `prisma/migrations/20260908155736_add_electronic_menu_media/migration.sql` | `3ac9b3f7aa00e14a84633df80151dc7012e5ccef1618f7e2cd0bb95376fc1ba5` |

Base schema SHA-256: `241e8aa96760a87d7819f47caaabae50525c7c3dd69a3a3a9dcb4eeeca61aff3`. Sealed combined patch SHA-256: `105b52a76e069ec00ad033bef6971c701cac73932dd6ee7fce5993819d99c6a7`. Two paths, 5 added lines, zero deleted lines. Draft artifacts live under `.task-state/ES-ELECTRONIC-MENU-02-sealed/schema-exception/`; they are not deployable files in this governance commit.

Only these lines are inserted immediately after the existing Store.bannerData line; all other schema bytes remain identical:

```prisma
  electronicMenuMediaData String? @db.Text // Electronic Menu 专属图片/GIF 原始 data URI
  electronicMenuMediaUrl  String? // Electronic Menu 专属媒体访问 URL；NULL 时回退首页门头图
```

The new migration SQL is generated by the installed Prisma CLI using schema-to-schema comparison only:

```sql
-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "electronicMenuMediaData" TEXT,
ADD COLUMN     "electronicMenuMediaUrl" TEXT;
```

Both values remain NULL for legacy stores; clearing the pair restores the existing banner/product/brand fallback. The URL persists the versioned public media reference so catalog refresh need not read/hash the up-to-2MiB data payload. No enabled/type/version columns or additional table are added.

## Guard activation and lifecycle

Existing `PRE_COMMIT_CONTENT_SHA256` validation checks task ID, exact feature branch, approved base ancestry, identical trusted/working record and gate-config, and full content SHA-256 for both exact paths. No directory/wildcard grant or authorized-commit shortcut exists. The local ACTIVE record grants nothing before entering origin/main; the real pre-activation Guard must remain BLOCKED.

After separately approved governance merge/push: verify trusted ACTIVE record, final main/Production SHA and READY (if auto-deployed), clean worktrees and unchanged application/schema/migration tree. Then incorporate trusted governance into the feature branch, apply only the exact sealed patch, and run full feature development/verification. Any protected-byte/path deviation requires a renewed Founder Gate. Migration execution and feature release always need separate explicit authorization.

## Registration verification

- Prisma validation of the sealed schema: PASS.
- Installed Prisma schema-to-schema diff: PASS; exactly two nullable TEXT additions.
- Sealed patch apply check against the actual unmodified feature tree: PASS; patch not applied.
- These commands used only a dummy 127.0.0.1:1 datasource value and local schema inputs; no database connection or migration execution occurred.
- Strict exception/manifest/boundary validation: 27/27 PASS, including all sealed content hashes, exact branches/paths and unchanged protected files.
- Existing Scope Guard regression suite: 70/70 PASS. Two-file governance Scope and whitespace/diff checks: PASS.
- Real CLI pre-activation check: BLOCKED as required because no trusted origin/main exception is registered; simulated unit allow cases do not constitute activation.
- Fresh-context read-only independent review: PASS (menu02_schema_governance_review). Initial strict timestamp-format finding fixed and re-reviewed; no remaining blocking or substantive non-blocking issues. Independent schema validation, schema-only SQL reproduction and sealed hashes PASS. Review covers local registration/draft only, not database readiness, feature acceptance, formal CI or deployment.
- Application TypeScript/Build/browser tests: N/A for governance-only registration; remain required for the later feature. No push means no new formal CI or deployment.

## Recovery / stop point

Until activation is separately approved, retain the local governance and feature branches without external writes. No runtime or data rollback is required. Staging historical drift stays DEFERRED; this package does not repair it. No business code, schema tree, migration tree or database has changed. Feature implementation remains blocked at the explicit trusted-ACTIVE Founder Gate.
