# ES-ELECTRONIC-MENU-02 / Dedicated Promotion Media V0.1 — Local Candidate

## Governance and authorization

Governed by ES-GOV-001, ES-ENG-001, AGENTS.md and the Founder-Gated Agent Development Workflow V1. Task starts L2; schema and controlled API/authorization work follow L3 gates.

Founder approved two nullable Store fields, the exact additive migration **file**, dedicated image/GIF management, existing banner upload reuse, tests and independent review. Separate explicit approval activated governance commit `29fc52b0f7e22eea0aada2b19453c82c0b7718ae` through origin/main and its automatic governance-only Production deployment. Both main and Vercel deployment `dpl_kaRSy381o6JwLzdeHvyQFAu988eB` were verified at that SHA, READY; the governance diff contains only the exception JSON and its explanation. No application/schema/migration file was deployed by that activation.

Feature branch: `codex/es-electronic-menu-02`. Base: `29fc52b0f7e22eea0aada2b19453c82c0b7718ae`. Clean Release Lineage PASS before implementation; no Docs-only Exception. The feature source is the local commit containing this record. No feature push, merge, deployment or release is authorized or performed. No database migration was executed against any database. FIELD VERIFIED = NO; CLOSED = NO.

## Readiness and scope

Goal: independently select a store's Electronic Menu image/GIF while H5 and Customer Display keep the existing homepage banner. Store/Tenant has no suitable existing general media configuration field; the approved storage adds only `electronicMenuMediaData String? @db.Text` and `electronicMenuMediaUrl String?`.

Exact trusted ACTIVE exception allows only `prisma/schema.prisma` and `prisma/migrations/20260908155736_add_electronic_menu_media/migration.sql` at approved complete-file hashes. The sealed schema hash is `743d163a3de165206fe9cef36796f91db5fcb7acb206fc45d2f4fb920015017a`; migration hash is `3ac9b3f7aa00e14a84633df80151dc7012e5ccef1618f7e2cd0bb95376fc1ba5`. No history rewrite, default, backfill, rename or deletion. The exception remains ACTIVE until a separately authorized feature merge, after which governance requires closing it.

Readiness covers local code, static schema compatibility and tests with mocked database boundaries. It does not establish database runtime readiness. The new code requires the two columns before any later deployment. Migration execution, DDL locking, real database verification, CI requiring a temporary database reset, and actual FIELD remain separately authorized later stages.

## Implementation and protected behavior

- OWNER's existing Electronic Menu dialog shows media preview, original-file upload/replace and restore-homepage action. Native file selection and FormData retain the original file; shared server/client media policy enforces the established JPEG/PNG/WebP/GIF and <=2MiB rules. UI requests mount only for the current OWNER/store, cancel on close/store change, ignore stale completions, prevent concurrent operations and allow retrying the same file.
- The original banner upload/read routes and dedicated routes share `lib/store-media.ts`; the original errors, MIME/bytes and banner cache/response keys remain intact. Both media fields update or clear in one Store update, scoped by id and authenticated tenant. Dedicated content revisions avoid same-millisecond URL collisions. Dedicated responses use no-store; no advertising/upload infrastructure or dependencies are introduced.
- `GET/POST/DELETE /api/stores/[id]/electronic-menu-media` reuse OWNER/session/tenant authorization. Management GET exposes only the dedicated URL and original banner URL. Binary `GET /api/public/stores/[code]/electronic-menu-media` reads only that ACTIVE store's dedicated data; invalid/missing/error cases return bounded empty/generic errors.
- Existing H5 `loadPublicMenuCatalog` and `/api/public/menu` remain byte-identical. Electronic Menu alone adds a code+tenantId+ACTIVE Store lookup selecting only its dedicated URL after the shared catalog. Its DTO appends optional `electronicMenuMediaUrl`; renderer priority is dedicated -> original banner -> original first-three product-image sources -> brand. NULL and absent values preserve V0.1 behavior; image failures fall through the same priority list.
- H5 and Customer Display continue using Store.banner. No Product, discount, recommendation, sorting, QR ordering, pagination, 30-second polling, shared fullscreen, dashboard page, Customer Display page, Printing, QZ, Desktop, Tray, Installer, Payment, Sales Lead or Subscription implementation changes.
- No videos, media library, templates, editor, scheduling or signage CMS. Historical staging schema drift remains DEFERRED and outside this task.

## Verification

| Check | Result and evidence |
| --- | --- |
| Prisma schema validation / schema-only migration diff | PASS; two nullable TEXT additions; no DB inputs or execution |
| Core menu + dedicated media + layout Node tests | 27/27 PASS; real handlers with in-memory Prisma boundary doubles |
| Existing regression files | 10/10 PASS; Customer Display, customer journey, product discount/recommendation |
| Browser verification | 40/40 PASS; existing 31 plus dedicated 9, local Production build with mocked APIs and external requests blocked |
| OWNER media | PASS: original GIF multipart bytes, upload/replace/clear, banner independence, error/retry, duplicate prevention, closed-dialog late responses, unmatched store rejection, compact-screen dialog bounds |
| Public display | PASS: dedicated/banner/product/brand priority, image error fallback, original GIF animation frames, media change at 30-second refresh |
| Frozen UI/behavior | PASS: native fullscreen/reentry/exit-state and graceful failure, Staff/Customer Display fullscreen, QR decoding/current store, multi/single-page timing, prices/order/language, 1366x768 and 1920x1080 plus smaller viewports |
| Security | PASS: OWNER/STAFF/anonymous, forged production headers, cross-tenant writes, same-tenant store separation, GET-only public surface, invalid store and generic query/write errors |
| TypeScript | PASS: `tsc --noEmit --incremental false` |
| Production Build | PASS: `npm run build`; dummy localhost datasource, local canonical URL for browser tests; no migration/deploy |
| Scope / diff | PASS; exact sealed hashes and trusted ACTIVE, no unrelated implementation changes |
| Independent review | PASS; fresh-context ephemeral read-only reviewer rechecked all 18 file hashes, exact Scope, TypeScript and final logs; no remaining blocking or non-blocking issues |

Local evidence: `.task-state/ES-ELECTRONIC-MENU-02-node.log`, `-regression.log`, `-tsc.log`, `-build.log`, `-browser.log`; sealed schema evidence under `.task-state/ES-ELECTRONIC-MENU-02-sealed/schema-exception/`. Browser screenshots include `test-results/electronic-menu-media-owner.png` and `electronic-menu-1920.png`, using fixtures only. None of this constitutes real-device FIELD.

Initial review identified a duplicate style key (fixed) and inaccurate default-media copy (fixed in all three languages). Final independent re-review verified both fixes and accepted the stable local candidate; no remaining code findings. Browser test setup was aligned to the suite's required localhost canonical URL; an overflow assumption now uses a compact 600px viewport and verifies actual bounds, and the existing refresh assertion waits for the updated product count before asserting its name. Runtime polling/fullscreen logic is unchanged.

## Next controlled stages

Retain this as a local candidate. Before a later release, obtain explicit authorization for any database preparation/migration, verify actual schema and A/B media behavior against the target database, then complete the separately approved CI/preview/release and real OWNER FIELD workflow. No existing migration or Production credentials were used here. Update this record and Obsidian with actual outcomes only; do not mark FIELD VERIFIED or CLOSED from these local tests.
