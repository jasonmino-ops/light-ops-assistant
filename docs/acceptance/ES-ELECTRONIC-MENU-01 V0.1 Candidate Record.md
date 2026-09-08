# ES-ELECTRONIC-MENU-01 Electronic Menu Screen V0.1 Candidate Record

Date: 2026-09-08. Level: L2 feature development. Status: REVIEW PASS; local candidate only.

## Governance, readiness and authorization

Governed by ES-CONST-001, ES-STRAT-001, ES-GOV-001, ES-ENG-001, repository AGENTS.md and E-Shop Founder-Gated Agent Development Workflow V1.0.

Goal: let an OWNER open a browser-only, read-only menu using the existing catalog, and copy/preview its URL from 概览. The real overview route is `/dashboard`; there is no merchant `/overview` route.

Readiness decision: READY within the Founder-requested L2 scope after trusted exception activation. Existing public Store.code and tenant-scoped catalog reads are sufficient. No schema, token model, new dependency, environment variable, platform resource or local runtime is required. The new presentation does not change existing authorization or product contracts. Primary risks are private-field leakage, cross-tenant reads, persistent root layout state, stale prices and unreadable short-screen layouts; narrow projections and focused runtime/browser verification address them. Fresh-context independent read-only review is required. This is not a Freeze or architecture/Provider replacement package.

Engineering authorization: Founder explicitly requested scoped implementation, tests, fixes and independent review to a complete candidate. Authorized branch is `codex/es-electronic-menu-01`. Initial baseline was `a354624726ffac2600bdb7d18224a09bdf815c65`; implementation starts from clean `origin/main` at `e8ba9368e94a68aa96f7a7488d1412ba25551ffd` after approved governance integration. Release Lineage Gate passed before implementation. Docs-only Exception was not used.

Allowed modules: exact dashboard entry, entry component, public page and its root-shell boundary, narrow public menu API/helper, directly related tests and this technical record. Forbidden: second catalog, database changes/migrations, existing Product semantics changes, Customer Display refactor, Printing/QZ/Windows Desktop/Tray/Installer/NP330/Payment/KHQR/POS/Subscription/Sales Lead changes, CMS/editor/video/model extensions. Partial implementation is not the requested stopping state.

## Exact dashboard exception and governance activation

Founder approved only the sealed import and OWNER component insertion in `app/dashboard/page.tsx`. Its complete resulting SHA-256 is `660f2618303a4fb280c1fd08aab572237c6fb4de4201edb565e906b9ea10f2f6`.

The original registration record describes the historical pre-activation state. Founder subsequently expressly authorized governance commit `bb93ed721b407d2a0d4a262f09a4a63f622bd7ff` to be merged/pushed to main and the consequent automatic Production deployment. Merge `e8ba9368e94a68aa96f7a7488d1412ba25551ffd` contains only the exception JSON and its governance explanation. No electronic-menu application code was included.

Verified after activation: fetched origin/main contains bb93ed7; trusted exception is Founder-approved ACTIVE; Production uses the same e8ba936 SHA; Vercel deployment `7ormCmSWPqjFznjihpHtpkuzAAVn` is READY with successful commit status. Public health returned HTTP 200 with configuration/database checks passing (anonymous-session WARN). Worktree was clean before feature implementation. The trusted exception/config are unchanged in this feature diff.

Feature merge, push/Preview, Production deployment, migration and release are **not authorized**. After a separately approved feature merge, close the exception via its governance lifecycle; do not pre-close it in this candidate.

## Implementation and preserved contracts

- OWNER entry reads current `storeCode` from existing WorkMode context, uses existing `publicUrl`, and offers a readonly URL, clipboard copy with manual fallback, and a separate-document preview. STAFF has no entry. URL format: `/electronic-menu?code=<public-store-code>&lang=zh|en|km`.
- Public API `GET /api/public/electronic-menu?code=<public-store-code>` accepts exactly one valid code and no other selectors. Code follows existing generated public store identity; this is a public locator, not a new secret/token authorization scheme. Unknown or inactive stores return generic 404; malformed/duplicate/extra selectors return 400; read failures return generic 503. Responses are no-store. POST/PUT/PATCH/DELETE have no handlers and return 405.
- Store lookup resolves its tenant internally. Product and ProductCategory have tenantId, not storeId: stores in the same tenant retain their shared catalog. Different tenants cannot substitute tenant/store selectors. The code in a URL selects that store's public display metadata and existing catalog; it never selects an OWNER session or POS session.
- Product query preserves ACTIVE-only, name ascending and existing 200-product cap. Category order is sortOrder then name; parent/direct-child grouping and iced-coffee priority follow `/menu`, with unassigned/orphan products last. Recommendation remains a badge, not a new ordering rule. Discount price/projection is checked against the actual existing public-menu GET. USD/XAF formatting and recommendation utility are reused.
- Whitelisted DTO contains only store display text, catalog names/descriptions/specifications, public prices/discount/recommendation, categories and image URLs. No contact/location fields, cost, operating totals, orders, customers/members, tenant/user IDs or merchant sessions. Native images preserve existing stored image/GIF URLs. Upload formats remain unchanged; no video support is added.
- Public root shell skips cookie/session resolution, WorkMode/Lang merchant providers, delegate banner, Telegram SDK/init and tracking. Crossing between this shell and existing application pages reloads the document because Next root layouts persist during client navigation. Other routes retain their existing shell.
- Catalog polling every 30 seconds, 10-second timeout, no credentials/cache, one in-flight request, cleanup on unmount, and visibility/online recovery. Temporary failure keeps the last menu with an explicit stale status; 400/404 clears it. A changed store cannot apply an old response. New catalog responses retry failed images at the same URL.
- Cards rotate every 12 seconds; successful polling does not restart pagination. Default 4/3/2/1 columns with two rows; landscape heights below 650px use one row. Includes reduced-motion handling and Chinese/English/Khmer fallback. Product modification-to-screen latency is normally up to 30 seconds plus request latency; later pages appear on their next rotation.

## Verification

All local browser fixtures and session identities are synthetic. API writes in old-feature regressions are intercepted; no database migration or real business write is executed.

| Check | Result |
| --- | --- |
| Governance Guard suite / registration checks | 70/70 and 19/19 PASS before activation |
| Data/isolation/actual old API parity + relevant existing unit/static regressions | 26/26 PASS |
| Existing dashboard mobile print-settings lifecycle | PASS, unchanged test |
| Standalone TypeScript | PASS after final runtime fixes |
| Local optimized Production Build | PASS after final runtime fixes |
| Browser Production-mode flow/regression suite | 16/16 PASS, zero skipped |
| Complete feature Scope Guard / diff check | 13-file list PASS; dashboard exact approved hash; no unrelated changes |
| Fresh-context independent review | PASS after fixes; no blocking/non-blocking issues or boundary violations |

Commands (using installed lockfile dependencies):

```sh
node --import tsx --test tests/electronic-menu-data.test.ts
node --import tsx tests/dashboard-print-settings-mobile.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100
node node_modules/@playwright/test/cli.js test tests/electronic-menu.browser.spec.ts --workers=1 --reporter=line
node scripts/guards/check-change-scope.js --task-id ES-ELECTRONIC-MENU-01 --files '<complete changed-file list>'
git diff --check
```

The browser suite targets localhost by default and rejects non-local hosts. Run the raw-HTML privacy assertion against a **Production-mode local build**: Next development-mode diagnostics serialize incoming headers, including synthetic test cookies. That assertion was retained unchanged and passed against the optimized build; development debug output is not a deployed artifact. Build and standalone TypeScript must run sequentially because build regenerates `.next/types`.

Independent-review fixes: retry a failed same-URL image on fresh catalog data (new regression demonstrably fails against the pre-fix build); use one row on short landscape screens and assert price bounds inside cards with long Khmer names. Supplemental checks cover pagination beyond the 30-second refresh, legacy menu rendering, and existing Customer Display polling.

Reviewer `feature_review` received no implementation conversation context and performed a read-only review of all changed/untracked files, related legacy source and evidence. The reviewer independently ran the complete Scope Guard and diff check and verified the sealed dashboard hash; final test/build results were reviewed as primary-executor evidence, not claimed as reviewer-executed tests. No reviewer or auxiliary reviewer modified files/Git/platform state. Current Production was not independently read by the reviewer; primary activation evidence above is separately attributed.

Local evidence is retained in ignored `.task-state/ES-ELECTRONIC-MENU-01-sealed/`. Screenshots are synthetic test fixtures, not merchant FIELD evidence.

## Remaining acceptance / stopping point

Existing live Production smoke was run during governance activation: 1 pass, 3 fail because the browser lacked required Telegram/device login. It is not reported as PASS, and no unrelated authentication behavior was changed. This candidate's Production-mode browser regressions use local fixtures; real database integration and Windows/Mac/tablet storefront acceptance remain to be performed after separately authorized deployment.

No feature CI/push/merge/deployment, migration or release. No FIELD VERIFIED, CLOSED or FINAL FROZEN claim. The existing 200-product cap and same-tenant shared catalog remain intentional compatibility limits. Code, local checks and independent review are complete; authorization for a later merge/deployment is a separate Founder Gate.
