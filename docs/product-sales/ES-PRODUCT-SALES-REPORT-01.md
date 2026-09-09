# ES-PRODUCT-SALES-REPORT-01 — Fixed product sales V0.1

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Readiness and authorization

Task level: L3 (two feature-owned database models and existing authorized cross-store reads).
Starting HEAD: `3015d0c1a322a96cd8b499ae64ad625145e73889`.
Branch: `codex/es-product-sales-report-01`.

Founder authorized local implementation, minimal schema design and migration **file generation**, tests, Build, a fresh-context read-only reviewer, and repairs in this task's scope. The two storage categories are fixed group configuration and generated daily results. Founder also explicitly allowed local development while Production SHA is UNKNOWN, retaining the Lineage Gate before merge/migration/deployment. No default governance file or guard is changed by this task.

No migration execution, push, merge, Preview/Production deployment, Production data mutation, or release is authorized. The task does not change order/payment/refund flows, OWNER identity or multi-store contracts, printing core/transports, QZ/NP330/Windows printing/Installer, AI, messages, inventory, costs, profits, rankings, or forecasting.

Full changed-file Scope Guard invocation is BLOCKED for the existing dashboard entry, Prisma schema and new migration; --task-id also fails because origin/main has no trusted ACTIVE exception for ES-PRODUCT-SALES-REPORT-01. Conversation scope authorization must not be misreported as a technical Guard PASS. Exact protected-file hashes and gate output are prepared for the formal exception process before acceptance/commit.

## Business behavior

`/product-sales` is linked from the existing OWNER dashboard without changing its metrics. OWNER can search existing products, select up to 100, choose a store or all currently authorized stores, run a query, create/edit/disable a saved group, invoke it with one click, view saved daily reports, and print. The selected products remain real `(tenantId, productId)` identities; names and barcodes do not link identities across tenants.

The new endpoints use the existing context and trusted Telegram OWNER membership resolver. Each request re-resolves active memberships and validates tenant/store pairs. Group ownership uses that existing trusted identity so switching between the OWNER's tenants does not lose saved groups. Staff and untrusted identity headers in production are denied. Historical reports are returned only if the OWNER still has access to **every** included store; no restricted totals or store labels are returned when access was revoked.

## Frozen date rule for this feature

This is the Founder-approved Cambodia-specific report rule, not a global store timezone contract. No Store/Tenant timezone columns are added, and no history timestamps or existing reports are altered.

- Timezone: `Asia/Phnom_Penh` (UTC+07:00).
- Today, yesterday, each custom date, and each complete daily report: local **06:00 inclusive to the next midnight exclusive**.
- Custom ranges are a union of daily windows, excluding 00:00–06:00 on **every** selected date.
- Week: continuously from local Monday 06:00 until query time.
- Month: continuously from local day 1 06:00 until query time.
- The week/month continuous intervals follow the explicit Founder wording and therefore can include intermediate overnight records. They need not equal the sum of daily reports. Before the start boundary on the first day their result is empty.
- Date input is validated, future dates rejected, and custom queries limited to 366 days. Databases receive half-open UTC timestamp predicates.

Example: local 2026-09-09 daily window is `[2026-09-08T23:00:00Z, 2026-09-09T17:00:00Z)`.

## Recorded sales, not financial allocation

- SaleRecord: `COMPLETED` rows; `SALE` contributes stored quantity and lineAmount, filtered by createdAt.
- CustomerOrder: `COMPLETED` and `PAID`; the stored itemsJson productId/quantity/lineAmount contributes, filtered by paidAt, consistent with the existing business-query source coverage.
- Product sales are the sum of recorded product-line amounts. Order coupons are **never** allocated. Recorded 10 + 20 remains 30 even when order receipts are 24. Current product prices are not loaded for calculation.
- Refunds are a separate column of completed recorded negative refund line amounts converted to positive display amounts; they do not reduce the sales quantity/amount into a new net-revenue measure. Original-sale linkage can resolve a missing productId only within the matching tenant, and conflicting identities fail closed.
- Unidentified historical sales/refunds are disclosed in live queries. Automatic reports do not persist incomplete sales coverage. Malformed customer item data or missing selected line amounts fails explicitly, without reconstructing values from prices.
- Decimal arithmetic preserves stored two-decimal monetary/quantity precision and removes JSON floating-point multiplication noise. Different currencies remain separate; no exchange rates or combined monetary total.
- Source reads are paginated in a consistent database transaction, capped at 50,000 source records/orders per query. Oversized queries fail explicitly; no silent truncation.

## Minimal persistence and idempotency

`ProductSalesGroup`: UUID id/create idempotency key, trusted owner identity, name, selection JSON, enabled flag, timestamps. Repeated create requests with the same content return the same group; changed payloads for the same key fail 409. Edits use an updatedAt comparison to reject lost updates. Disable remains possible after product/store access changes.

`ProductSalesDailyReport`: id, groupId, local reportDate, generatedAt, result JSON. JSON contains only printable aggregates, selected product/store labels and identities, currency, date rule and coverage information. No orders, payment records, customer data, journal or versioning system is copied. Unique `(groupId, reportDate)` prevents duplicate days. RLS is enabled on both tables; no public Data API policies are created. The deployment must use the existing trusted server database role with the required access.

Generation locks the group row, then checks enabled state, eligibility and an existing report, resolves access, aggregates and inserts in a serializable transaction. Serialization/unique conflicts retry up to twice. Source failure rolls back without a partial report. Later group edits do not rewrite existing reports. A group created after the target day closed begins with its own creation day; no fictional historical group configurations are generated.

Saved results describe their generation time. Late offline sync may change later live queries. This task does not backdate or modify existing offline timestamp semantics.

## Scheduling and printing

The local candidate uses the existing Vercel project's native Cron capability: `/api/cron/product-sales-daily`, `10 17 * * *` (00:10 Cambodia, subject to platform scheduling precision). It generates the preceding local date for enabled groups and pages through groups. Per-group failures continue other work and return HTTP 503; successful retries see existing reports. No existing OWNER/OPS authentication contract is modified.

The dedicated endpoint denies missing/short configuration and validates Vercel's standard bearer `CRON_SECRET` with a timing-safe comparison. A secret of at least 16 characters must be configured **only under later deployment authorization**. No secret or platform setting is written in this task. Vercel Cron requires a deployed Production endpoint, so actual automatic execution cannot be claimed from this local candidate. Source: [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

The V0.1 worker runs groups sequentially under the 300-second endpoint limit. Actual fleet size and runtime have not been established; slow/large workloads may exhaust that limit. This must be measured during authorized environment acceptance; no new scheduling infrastructure or continuation store is introduced here.

Operational recovery: inspect failed invocation group IDs and codes, correct the scoped cause, and retry the authenticated endpoint within the same local date. A past missed day is not silently regenerated with a later group definition; retrospective recovery needs a separate explicit operational decision. No Telegram/message notifications are added.

Printing renders escaped report HTML and calls existing `openExistingBrowserPrint`; no transport/provider/core or existing receipt format is modified. UI/print copy is provided in zh/en/km.

## Verification and acceptance

- `node --import tsx tests/product-sales-report.test.ts`: date edges, daily gaps vs continuous week/month, leap dates, input bounds, recorded amounts/coupons, currency/identity isolation, unknown coverage, print escaping, scheduler paging/failure continuation and migration declarations.
- `node --import tsx tests/product-sales-api.test.ts`: real route/service code with in-memory database delegates; OWNER/STAFF/auth denial, source predicates, two-source pagination and exact/exceeded 50,000-record cap, single/all stores, create retry, edit conflict, generation concurrency/retry/rollback, disable, history revocation and cron authentication.
- `AUTH_SECRET=<matching local server secret> node --import tsx tests/product-sales-browser.test.ts`: a local built server on port 3107 (override PRODUCT_SALES_UI_BASE_URL), fixture APIs, real components and print helper; selection, dates, group save/edit, history, native print-call observation for popup and popup-block fallback, revoked-store recovery, options retry, desktop/mobile layout. No actual paper printing or migrated database is involved.
- TypeScript, Prisma validate/generate, Next Build, browser interaction and existing sales/product/OWNER/printing regressions are required before candidate delivery. Results and review status are recorded in the local task state and final delivery; this document is not a claim those checks have passed.

No migration was executed. Simulated concurrency does not constitute verification of a migrated PostgreSQL environment. Deployment/schema access, actual scheduler execution, real merchant acceptance and real printer behavior remain release/field checks. FIELD VERIFIED and CLOSED are not claimed.

## Recovery / compatibility

Existing transaction tables and business contracts are unchanged. Old runtime can coexist with the additive tables; deploying the new runtime before the authorized migration will fail new feature queries and is not an acceptable release order. Rollback should disable the new entry/schedule via an authorized runtime rollback, retaining the new tables/results; no destructive rollback script is supplied.
