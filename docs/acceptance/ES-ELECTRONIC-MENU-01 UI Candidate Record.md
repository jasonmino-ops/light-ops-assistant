# ES-ELECTRONIC-MENU-01 UI Candidate Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Scope and readiness

L2 local Renderer revision under Founder's explicit UI-only direction. Starting main and freshly verified READY Production: `0e22ad64804465b5487fc3a8e3494666f7430e84`. Release Lineage PASS; clean isolated worktree reused on `codex/es-electronic-menu-01-ui`. No Docs-only Exception used. The prior dashboard Scope Exception remains CLOSED.

The current request authorizes Renderer/CSS/presentation pagination and their tests. It does not authorize push, main merge, deploy, schema/migration, Production data changes, changes to the shared catalog or frozen capabilities. Readiness is READY for this reversible local presentation change; no new Runtime, Provider, identity/isolation model, production-critical API or public contract is introduced. Fresh L2 independent review is required. Architecture-sensitive Claude Review/Freeze processing is not applicable to this UI candidate.

## Final presentation

- A 30% brand panel and 70% compact category/price list at normal landscape sizes. Product media becomes a small thumbnail; names, existing specifications, current/original discount prices and existing recommendation badges retain their meanings.
- Consume unchanged `groupElectronicMenu` in its supplied category/product order. A route-local layout helper budgets headings and one/two-line product rows, continuing categories across columns/pages. Typical 1920×1080 coverage is 20–40 products; measured mixed-category example is 26.
- Page rotation is 15 seconds and loops only when more than one populated page exists. Page changes reuse the current catalog. The existing 30-second refresh, timeout, request deduplication, anonymous fetch, error handling, stale data and visibility behavior are unchanged.
- Brand media reuses the current banner first, then up to three existing product image/GIF sources. Missing/failed media uses store typography and existing promo text or a neutral brand line. No independent advertising configuration exists.
- Video is DEFERRED: the shared DTO has no video media type. Existing marketing-page video belongs to a separate model/read path and is not imported or guessed from image extensions.
- QR uses the existing `react-qr-code` component and `publicCustomerEntryUrl(data.store.code)`, targeting the existing canonical `/m/<storeCode>` H5 customer entry. It is not a new order route or a second URL builder. QR caption follows the selected menu language.

No changes to data/Prisma/schema/migrations, shared menu grouping, public APIs, Product/Discount/Recommendation/Sorting, store isolation, OWNER entry/copy/preview, global layout, Customer Display, Printing/QZ/Desktop/Tray/Installer/Payment/Sales Lead/Subscription or dependencies.

## Verification

Verified local candidate:

- Shared catalog and existing semantics/QR/OWNER plus new layout tests: 24/24 Node runner tests PASS, zero skipped. Includes 13 unchanged data/API/isolation tests and 7 new pure presentation pagination tests.
- Initial browser run: 19 PASS / 2 selector-ambiguity failures after the QR caption repeated the store name; headings were selected explicitly. Unchanged implementation then passed 21/21 browser scenarios.
- Screenshots at 1920×1080, 1366×768, 1024×768, 960×540 and 390×844 checked; rows/prices/QR remain within viewport. Dense desktop example shows 26 products. Actual QR pixels decode to the shared H5 entry.
- Final 22/22 browser scenarios PASS. XAF Decimal(12,2) maximum-width text initially overflowed on a narrow screen; bounded price typography fixed it without changing values. Tests now wait for settled resize layout and check actual text ranges at both wide and narrow sizes.
- Final standalone TypeScript PASS; optimized local Production Build PASS after the price correction.
- Default six-file Scope Guard and full diff checks PASS; generated TypeScript cache restored. Fresh-context read-only independent review PASS, no remaining blocking/non-blocking or boundary findings. Reviewer inspected the full six-file diff, final logs, screenshots and the price-boundary fix; no reviewer writes occurred.

Local browser tests use intercepted fixtures, a synthetic session secret and an unreachable localhost database placeholder. No real business write or deployment occurs. All external network resources are blocked during these tests. The QR test verifies the configured local canonical site; unchanged shared URL tests protect the production canonical-domain behavior.

## Acceptance boundary

Founder reports the preceding Production feature chain usable. That does not accept this new visual candidate. A new visual FIELD is recommended after separate release authorization. UI FIELD VERIFIED: NO. UI CLOSED: NO. No merge/deploy/migration is performed for this revision. Historical staging drift remains DEFERRED; no staging work resumes.
