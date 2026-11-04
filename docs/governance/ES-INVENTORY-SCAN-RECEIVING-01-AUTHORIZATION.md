# ES-INVENTORY-SCAN-RECEIVING-01 Readiness and Engineering Authorization

## Governance

- ES-CONST-001, ES-STRAT-001, ES-ENG-001 and ES-GOV-001
- E-Shop Founder-Gated Agent Development Workflow V1.0 and AGENTS.md
- [Diamond Pilot Final Freeze and Closure Record](../acceptance/ES-INVENTORY-PROFIT-PILOT-01%20Final%20Closure%20Record.md), sections 3 and 8

## Readiness Review

The Diamond Pilot OWNER inventory page currently selects receiving products from a dropdown. The existing sales camera component and the Pilot inventory read API supply the barcode and current inventory data needed for scanning.

The proposed L2 change adds a scan interaction to the receiving picker. It uses the existing access, inventory read and single-item receiving contracts. An unmatched, ambiguous or cancelled scan must leave the user able to choose a product manually. Scanner dismissal must release the camera through the shared component lifecycle. Submitting a receipt remains a separate, explicit action.

GitHub main and the freshly fetched origin/main agreed at `a26c6dc3f2cf789b6331bb6e9d23325a7ba879cb`. Vercel Production was READY at `754866c956568a1e728f1476e34010f6146e3a00`. Release Lineage passed via `CONTENT_SUBSET_PROVENANCE` on the clean implementation baseline. Default Scope Guard permits the two scoped paths.

Decision **READY** for the local candidate below.

## Engineering Authorization

- Authorized package: Diamond Pilot single-item receiving barcode selection
- Authorized branch: `codex/es-inventory-scan-receiving-01`
- Authorized starting HEAD: `a26c6dc3f2cf789b6331bb6e9d23325a7ba879cb`
- Approval source: Founder Limited Engineering Authorization for this task, 2026-11-03, sections 1–6. “Founder 批准本任务进入 L2 实施阶段。批准对 Diamond Pilot 冻结页面进行一次有限范围修改。”
- Frozen surface approval: `app/inventory/page.tsx` only, limited to the receiving product picker and its camera interaction. This is the task-specific ES-ENG-001 record of the Founder decision. The page is outside the default Scope Guard forbidden paths.
- Allowed product behavior: camera button, exact primary barcode selection against the existing store inventory query, selected product details, match and camera feedback, manual selection and an explicit next scan after a successful receipt.
- Prohibited scope: all other business files, including the shared scanner, inventory API, Apps Script, Prisma schema, migrations and bulk import. The existing manual receiving fields, write API and Telegram authentication remain part of the acceptance criteria.
- Required outputs: complete, locally committed candidate with scope, test and build evidence. Partial implementation is outside this authorization.
- Required verification: exact and ambiguous matches, missing barcode, manual receiving, receipt fields and request, repeat scan, camera dismissal, existing inventory regressions, typecheck, build, Scope Guard and diff check.
- Review requirement: fresh-context independent L2 review before integration.
- Acceptance and freeze: actual Telegram camera permission and live receipt are deferred to integrated FIELD acceptance. Merge, migration, deployment and final freeze require separate authority.

Decision **AUTHORIZED** for local implementation, verification and candidate commit.
