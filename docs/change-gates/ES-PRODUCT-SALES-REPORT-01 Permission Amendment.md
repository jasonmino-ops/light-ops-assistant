# ES-PRODUCT-SALES-REPORT-01 — exact permission amendment

Governed by ES-CONST-001, ES-STRAT-001, ES-ENG-001, ES-GOV-001, AGENTS.md and the Founder-Gated workflow. L3 governance-only registration; no feature SQL or runtime file enters main in this change.

## Approved correction

Release preflight found the original Candidate migration omitted the explicit class-D permission footer required by SUPABASE_PERMISSIONS_FREEZE_v1 §4/§6. Founder approved only six SQL statements for the two application-only tables: service_role CRUD, REVOKE ALL from anon and authenticated. This satisfies the frozen rule without changing table structure, fields, unique/FK, RLS design, sales/OWNER/daily/scheduling/printing behavior or any other application code.

Exact migration path: `prisma/migrations/20260909150000_add_product_sales_reports/migration.sql`.

- Previous SHA-256: `877ed14563f0927fc95b80c7705fa30ff4f960d0cc38d39cc485caf6ac248861`.
- Approved revised SHA-256: `42874cdb9133d18c9c3383581549d25d10b32a25222f961b585caadfb4503d85`.
- Existing dashboard/schema grants keep their exact hashes. Task ID, sole feature branch and three exact paths remain unchanged; no wildcard or additional grant.
- New seal keeps all other 25 feature files identical to Candidate `69c21dac`; original seal remains historical evidence. The exception records the revised manifest/protected-patch digests and prior seal references.

## Baseline, authorization and validation

Fresh origin/main and READY Production were both `01c3c1c78b0c9cc4747520ef1416cb842331af72` at registration. Clean Lineage PASS preceded branch creation in the isolated governance worktree. No Docs-only Lineage exemption is used because this record changes Guard authorization.

Founder explicitly approves this independently reviewed governance revision entering origin/main and its one existing main-triggered Production deployment. No Vercel configuration changes, feature migration execution, feature merge, feature deployment or Production business-data writes are approved. The original Candidate release authorization does not carry forward.

Validate the existing Guard suite, strict exception/manifest/content provenance and default two-file governance Scope; obtain fresh-context read-only review before commit/push. A separate architecture Claude review is not required for this registration: it changes only exact approved content evidence in the existing Guard mechanism, not runtime architecture or permission logic. Mandatory L3 independent review still applies. All execution results are recorded in local task evidence.

After governance Production READY and ACTIVE hash confirmation: use updated clean origin/main, recheck Lineage, restore the sealed feature, apply only the approved permission footer, verify all 26 hashes/full diff, rerun necessary permission/migration tests, TypeScript and Build, obtain a new fresh-context review and create a new local Candidate SHA. Stop there for new Founder release authorization. This document does not claim actual database permissions, FIELD VERIFIED or CLOSED.
