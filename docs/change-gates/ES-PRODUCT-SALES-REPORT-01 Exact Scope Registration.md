# ES-PRODUCT-SALES-REPORT-01 — exact Scope Exception registration

## Governance

Governed by ES-CONST-001, ES-STRAT-001, ES-ENG-001, ES-GOV-001, AGENTS.md and the Founder-Gated Agent Development Workflow.

L3 governance-only change. Founder expressly approved this independent registration and its entry into origin/main, restricted to the already sealed three protected files. This commit contains only the exception JSON and this explanatory record; no functional file, schema, migration, Guard implementation/config, dependency, CI or platform setting is included.

## Exact authorization

- Task and sole authorized feature branch: ES-PRODUCT-SALES-REPORT-01 / codex/es-product-sales-report-01.
- Trusted source: origin/main; registration state ACTIVE; mode PRE_COMMIT_CONTENT_SHA256.
- Baseline: 3015d0c1a322a96cd8b499ae64ad625145e73889.
- app/dashboard/page.tsx: 26cbe937969126d44bb107c6ded0ca0ab787500586d0d216a5c70c4826777832. Only import/render the OWNER product-sales entry (two lines).
- prisma/schema.prisma: 42fdabd4afbdcb3e62075cad4c1d5b80749bb00224099580be94866296391f1b. Only ProductSalesGroup and ProductSalesDailyReport models.
- prisma/migrations/20260909150000_add_product_sales_reports/migration.sql: 877ed14563f0927fc95b80c7705fa30ff4f960d0cc38d39cc485caf6ac248861. Only those two new tables, indexes/unique/FK and RLS; migration FILE only.

No directory/wildcard grants, additional branches or content are authorized. Frozen feature files and the full 26-file seal remain unchanged. The registered hashes must match final file bytes; an actual trusted Guard PASS is required after registration, not merely successful JSON validation. Close this record after the separately authorized feature merge.

## Readiness and controlled stop

On 2026-09-09 the existing Vercel CLI authenticated GETs resolved production alias light-ops-assistant.vercel.app and project production target to READY deployment dpl_GXxyVkN6sNfFjdPDpNeo6N38no2q, githubCommitSha 3015d0c1a322a96cd8b499ae64ad625145e73889. Refreshed origin/main has the same SHA. The real Release Lineage Gate passed in clean /private/tmp/es-product-sales-report-01-governance before edits. No docs-only Lineage exemption was used.

Current live Git configuration connects jasonmino-ops/light-ops-assistant, productionBranch main, gitProviderOptions.createDeployments enabled, commandForIgnoringBuildStep null; repository vercel.json does not disable main deployments. Therefore pushing this governance change to main is expected to trigger the existing automatic Production deployment. Founder expressly withheld Preview/Production deployment authorization. Do not push the governance branch (Preview), push main, alter deployment settings, manually deploy, promote or cancel a deployment to work around this boundary. Separate explicit approval for the automatic governance-only deployment is required before main push. See [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

The governance record is prepared/reviewed locally while stopped before external writes. ACTIVE in this local file is not effective until the exact bytes enter origin/main. No feature merge, actual migration, deployment, Production data write or release is authorized by this record.

## Validation and next execution

Claude Review applicability under ES-ENG-001: a separate architecture-sensitive Claude review is not mandatory for this registration. It records already approved exact evidence hashes using the existing exception mechanism; it does not introduce or change a Runtime, Provider, public contract, permission/security/isolation model, Production-critical API or Freeze candidate. The existing Guard implementation and trust model are unchanged. The mandatory L3 fresh-context independent read-only review still applies and is performed; this assessment is limited to the governance registration, not the feature package.

Validate the exception using the current Guard validator, cross-check all three hashes against the immutable sealed manifest and patch, run existing Guard tests, default Scope on these two governance files and diff whitespace checks, then obtain a fresh-context read-only review before the independent local governance commit. Validate actual changed paths before any push. Results, commit SHA and later activation facts belong in local task state, avoiding extra governance commits solely for execution status.

After the separately authorized main push: refresh live Production metadata and origin/main; check exact trusted ACTIVE bytes; confirm clean lineage; safely replay the unchanged sealed feature onto the updated legal line; verify all 26 hashes, full diff and task-ID Scope Guard; rerun necessary tests, TypeScript and Build; obtain a new fresh-context read-only feature review. Stop at formal Candidate Gate for Founder decisions on feature merge, actual migration and deployment/release.

No migration or build is part of governance registration. Build is not applicable to this two-file governance commit because executable/runtime/dependency files are unchanged; the later feature candidate still requires Build. This registration does not claim FIELD VERIFIED, CLOSED, successful deployment or feature acceptance.
