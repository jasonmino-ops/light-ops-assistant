# ES-ELECTRONIC-MENU-01 Electronic Menu Screen V0.1 Candidate Record

Date: 2026-09-08. Level: L2. Shared-catalog refactor supersedes candidate `b6311ccf4619142dac26e53e5982862058d7cdbc`. Implementation review PASS; local candidate, not a release or FIELD record.

## Governance and authorized scope

Governed by ES-CONST-001, ES-STRAT-001, ES-GOV-001, ES-ENG-001, AGENTS.md and E-Shop Founder-Gated Agent Development Workflow V1.0. Founder authorized this minimal refactor, tests, fixes, local commit and fresh-context independent review. Branch: `codex/es-electronic-menu-01`; reused the existing isolated worktree. Clean pre-edit fetch and Release Lineage Gate passed at `origin/main` / formal Production `e8ba9368e94a68aa96f7a7488d1412ba25551ffd`. Docs-only Exception was not used.

Scope: OWNER overview entry, independent browser display UI, a shared extraction of the existing H5 public-menu data chain, a narrow read-only adapter, localized document handling and necessary verification. No database, migration, dependency, environment-variable contract, authentication contract, Product/Discount/Recommendation/Sorting rules or frozen capability changes. Staging drift work is DEFERRED. New-candidate push, Preview, main merge, Production deployment and release are not authorized by this refactor request.

The overview route is `/dashboard`, not `/overview`. Its only changes remain the sealed import and component insertion. Resulting SHA-256: `660f2618303a4fb280c1fd08aab572237c6fb4de4201edb565e906b9ea10f2f6`. Founder-approved exception is ACTIVE on origin/main; its bytes/config are unchanged. Governance commit `bb93ed721b407d2a0d4a262f09a4a63f622bd7ff` entered main through the separately authorized governance-only merge `e8ba936…`; that deployment contained no electronic-menu feature. After any later approved feature merge, close the exception through its governance lifecycle.

## Shared data chain and API decision

`lib/public-menu-data.ts` now contains the existing H5 Store-to-tenant lookup, Product/ProductCategory queries, discount mapping and stored-image parsing. Both `/api/public/menu` and `/api/public/electronic-menu` call `loadPublicMenuCatalog`. The old independent `lib/electronic-menu-data.ts` is deleted. Display product/category types directly reuse the shared types.

Preserved catalog contract: ACTIVE stores/products; products scoped to the resolved tenant, name ascending, take 200; categories scoped to the same tenant, sortOrder then name. Product name/description/specification, price/originalPrice, discountEnabled, isRecommended, category and stored images use the original H5 mapping, including existing Decimal-zero and malformed-image fallback behavior. Same-tenant stores intentionally share the existing tenant-owned catalog; different tenants remain isolated. No storeId product ownership or second catalog is introduced.

The existing H5 endpoint keeps its original HTTP behavior and complete DTO: missing-code/unknown-store behavior, first-code handling, optional trimmed tgId, customerBound, contact/location defaults, marketing queries and marketingImageUrls. Those H5-only reads remain outside the shared catalog. A complete DTO regression plus actual-query equality tests cover this extraction. H5 UI is untouched.

**The Electronic Public API remains, as a thin adapter.** Direct browser consumption of the existing H5 DTO would also receive contactPhone/Telegram/WhatsApp, location and customer-binding/marketing fields outside this display's privacy whitelist. Changing H5's DTO would change a public contract. The retained endpoint only validates selectors, calls the shared catalog, applies `projectElectronicMenuData` and formats generic errors/no-store headers. It contains no Prisma query, separate isolation implementation, price calculation or sorting rule.

Display URL: `/electronic-menu?code=<public-store-code>&lang=zh|en|km`. Store.code is the existing public locator, not a new secret/token model. Exactly one valid code is required; extra/duplicate selectors and token parameters are rejected, unknown/inactive stores return 404, transient failures return generic 503. POST/PUT/PATCH/DELETE return 405. The DTO explicitly selects public display metadata and already-whitelisted catalog fields, excluding tenant/user/session/contact/cost/order/member/operating data.

## Localized document and renderer

The merchant-wide `RootRouteBoundary` is deleted. Merchant JSX in `app/layout.tsx` is restored to the main baseline. The remaining root change consists of reading the existing trusted middleware pathname before cookies and delegating only the electronic-menu path to its route-local `ElectronicMenuDocument`.

This small root early return is necessary: an App Router child layout cannot remove ancestor cookie/session resolution, merchant providers, Telegram initialization or scripts. Moving all existing routes into a different root group would exceed scope. A Pages Router alternative was examined against the installed Next 15.5.14: automatic navigation compatibility types introduce 24 further errors across 16 existing files after removing the old boundary, including frozen Records code. No Pages route, global type override or middleware change was introduced.

The document HTML, styling marker and guards now live under `app/electronic-menu`. The page guard reloads before mounting/fetching catalog data if an actual App Router navigation enters from a persistent merchant document. The document guard exists only inside the public document and reloads when leaving it. The real OWNER preview uses a native separate-tab link. Both native preview and actual RSC/client-router entry plus document exit are verified in the optimized local build. Public HTML excludes synthetic merchant cookies/identity, Telegram init, merchant providers and tracking; catalog fetch uses credentials: omit.

The independent renderer retains 16:9 responsive cards, existing image/GIF URLs, three languages and shared currency/recommendation helpers. Parent/direct-child grouping and iced-coffee priority retain the prior candidate's H5-compatible presentation; remaining active orphan products appear last. Recommendations are badges, not an additional sort. Polling is 30 seconds with one in-flight request, 10-second timeout, no-store, cleanup, visibility/online recovery, explicit stale state and 400/404 clearing. Twelve-second pagination is not reset by polling. Short landscape screens use one row; no video/editor/CMS scope is added.

## Current local verification

All test identities/products are synthetic. Database-facing unit tests replace delegates and use an unreachable localhost database placeholder; browser APIs are intercepted. No real product/session/database write is performed.

| Check | Result |
| --- | --- |
| Shared data, old H5 DTO/query parity, selectors, readonly and tenant isolation | 13/13 PASS |
| Above plus existing discount/recommendation/Customer Display regressions | 23/23 Node runner tests PASS, zero skipped (13 data tests and 10 existing test files) |
| Optimized local browser suite | 17/17 PASS, zero skipped |
| Existing standalone dashboard mobile print-settings lifecycle | PASS in its intended dev/StrictMode environment; unchanged test |
| Standalone TypeScript | PASS, including the final App Router test |
| Optimized Production Build | PASS; local build only |
| Complete feature Scope Guard and diff check | 16-file list PASS; exact dashboard hash; no unrelated change |
| Fresh-context read-only implementation review | PASS; no blocking or non-blocking code findings |

The browser suite covers anonymous display, no session serialization, no credential API reads, copy/fallback/OWNER/STAFF behavior, price updates, pagination, stale/404/offline/timeout boundaries, invalid selectors, write-method rejection, missing/GIF image recovery, five viewport sizes, `/menu`, `/dashboard`, Customer Display, native preview and actual App Router entry. Screenshots were visually inspected at 1920x1080 and 960x540. This is local automated evidence, not real storefront acceptance.

Commands use installed lockfile dependencies. For browser tests, build and start with `NEXT_PUBLIC_PUBLIC_SITE_URL=http://127.0.0.1:3100`; the suite rejects non-local hosts. Use an unreachable local DATABASE_URL for builds/data tests. No real deployment configuration is exported.

```sh
node --import tsx --test tests/electronic-menu-data.test.ts tests/product-discount-v01-static.test.ts tests/product-recommendation-v01.test.ts tests/customer-display-*.test.ts tests/browser-pos-customer-display-entry.test.ts
node node_modules/next/dist/bin/next build
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
node node_modules/@playwright/test/cli.js test tests/electronic-menu.browser.spec.ts --workers=1 --reporter=line
node scripts/guards/check-change-scope.js --task-id ES-ELECTRONIC-MENU-01 --files '<complete changed-file list>'
git diff --check
```

Run build and standalone TypeScript sequentially because `.next/types` is regenerated. Raw-HTML privacy assertions require the optimized build: Next development diagnostics can serialize incoming test headers. Those assertions were retained and passed, not relaxed. The existing standalone dashboard lifecycle test assumes dev/StrictMode repeated mounts; run it against `DEV_ROLE=OWNER` on local `next dev`, separately from the optimized browser suite. An unauthenticated Production-mode attempt failed and the signed-fixture attempt waited on the dev-only double-mount assumption; neither is counted as PASS.

Fresh reviewer `shared_catalog_final_review` received task materials and no implementation conversation. It reviewed the complete feature vs origin/main and the refactor vs b6311cc, existing H5 source and shared behavior, root/auth/provider code, tests and logs. It independently ran 13 data tests and the existing discount/recommendation checks (15 runner tests), Scope Guard, diff checks and dashboard hash. It read the final 17-browser and Build PASS logs and independently reran final TypeScript with exit code 0. A missing real App Router entry check was added and passed. Final record and dashboard evidence review also passed. No reviewer changed files/Git/platform state. Local evidence is in ignored `.task-state/ES-ELECTRONIC-MENU-01-sealed/refactor-*`.

## Limits and release stop

Historical formal CI run `34194428633` and protected Preview `2kwpyXoLPVEp6VXVNwKk3gHjbqzF` verified the old b6311cc candidate only. They do not certify this refactor. New-candidate remote CI/Preview have not run. The original three real-login smoke items remain NOT VERIFIED; local synthetic sessions cannot convert them to PASS.

No staging operation was performed in this refactor. Historical staging runtime compatibility remains FAIL/DEFERRED due to missing Product fields; Staging Full Schema Alignment is NO/DEFERRED. Earlier authorized 5/16 staging migrations are historical, not feature migrations and not a completed alignment. They are not resumed or represented as resolved here.

The feature requires no migration and changes no public business contract. Production code risk is assessed LOW after shared data extraction, narrowly justified endpoint/document handling and local regression/review. Real OWNER, real store data, ordinary Windows/Chrome/Edge device acceptance and live 30-second updates remain NOT VERIFIED. Recommend a separately approved controlled Production FIELD with exact candidate lineage, immediate OWNER/public/legacy checks and an explicitly authorized rollback path.

New feature merge: NO. New feature deployment: NO. Release: NO. FIELD VERIFIED: NO. CLOSED: NO. Staging drift: DEFERRED. Stop at the local candidate and request Founder authorization; no approval is inferred from test or review PASS.
