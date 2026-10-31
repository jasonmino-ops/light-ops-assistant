# ES-INVENTORY-PROFIT-PILOT-01 Final Freeze and Closure Record

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline
- E-Shop Founder-Gated Agent Development Workflow V1.0

## 1. Final status

| Item | Result |
| --- | --- |
| Task | `ES-INVENTORY-PROFIT-PILOT-01` |
| Production SHA | `357da46e6fb84c1e97f4dd2f453961e2683e339d` |
| Pilot Store | Diamond Supermarket / `ST883DC00C` |
| FIELD VERIFIED | **YES** — Founder accepted |
| PILOT ACTIVATION | **PASS** |
| FINAL FROZEN | **YES** |
| CLOSED | **YES** |

This record freezes and closes the Inventory Profit Pilot for Diamond Supermarket only. It does not authorize a second merchant, Native inventory implementation, broader commercial rollout, or any additional Product work.

## 2. Product and release identity

- Final implementation RC: `c2d093ca10e150246421b5f1bfb81eeefd7ec8ff`.
- DEF-10 corrective: `a06a437e75f31b3941ee73b7b908c8f0b357d186`.
- DEF-11 corrective: `31ffb80ae8bad44128ebbf6928d06616b27d8223`.
- Final `origin/main` runtime head at closure: `9e33661d54d71eafa438eee11bfff774b30481d7`.
- Final `origin/release` and Production SHA: `357da46e6fb84c1e97f4dd2f453961e2683e339d`.
- Production release parents: release base `1c5e6c6df9d15fa74b3e4bb7f5f4a923aafb4f75` and approved main `9e33661d54d71eafa438eee11bfff774b30481d7`.
- `scripts/check-selective-release.sh --mode normal`: **PASS**; Production tree equals the approved main tree exactly.
- `scripts/check-release-lineage.sh 357da46e...`: **PASS** using the governed `CONTENT_SUBSET_PROVENANCE` proof required by the normal release merge shape.
- Vercel Production: **READY**, bound to the exact Production SHA above.
- Runtime diff between final main and Production: **0 paths**.

The Product Candidate SHA and this governance-only closure head are intentionally separate. This record changes no runtime semantics and does not require another Production deployment.

## 3. Frozen artifacts and configuration

The following Pilot surface is frozen at the Production SHA above:

- inventory-profit feed, Provider, access-control and API paths under `app/api/**/inventory-profit/**` and `lib/inventory-profit/**`;
- OWNER inventory and sales-profit pages, entries, styling and their exact Dashboard/Product-page entry points;
- `apps-script/inventory-profit/Code.gs` as deployed in the Production Apps Script Web App;
- Production Apps Script Web App **Version 3**;
- the Production Google Sheet/Web App binding dedicated to Diamond Supermarket;
- `syncHourly` every hour;
- `syncWeekly` on Sunday during 02:00–03:00, Asia/Phnom_Penh;
- fixed Store binding to Diamond Supermarket / `ST883DC00C` only;
- `DAILY_PERIODIC_WAC`, NULL-cost fail-closed behavior, receiving idempotency, low-stock `<= minimumStock`, and the current stale/unavailable semantics;
- the exact FIELD and automatic-trigger evidence recorded below.

No secret, token, Google credential, Telegram initData, database connection string, internal Store identifier, or personal identifier is included in this record.

## 4. Accepted Pilot semantics

The following Founder decision is part of the frozen Pilot baseline:

- **DEF-05 — FOUNDER-ACCEPTED PILOT DEVIATION:** when cost coverage is below 100%, the Pilot may show Net Sales and Coverage, but it must not show COGS, Gross Profit, or Gross Margin. Native/Productization may revisit this behavior only under a new governed task.

The Pilot continues to fail closed for unavailable or stale external data and must never fabricate zero sales, zero cost, zero profit, or 100% coverage.

## 5. FIELD evidence

Founder accepted the real Diamond Supermarket Production FIELD result:

- FIELD product: `IP-PILOT-FIELD-20261031`.
- Receiving: 10 units at USD 1.00 each — **PASS**.
- Sale: 1 unit at USD 2.00, CASH — **PASS**; exactly one authorized FIELD sale, no duplicate.
- Refund: not executed and not required for final FIELD acceptance.
- Inventory after sale: 9 — **PASS**.
- Average cost: USD 1.00 — **PASS**.
- COGS: USD 1.00 — **PASS**.
- Gross Profit: USD 1.00 — **PASS**.
- Gross Margin: 50% — **PASS**.
- Cost Coverage: 100% — **PASS**.
- Low Stock at threshold 10: **PASS**.
- Failure isolation: **PASS**; Pilot/Google failure did not affect the normal sale, payment, or printing chain.
- Production OWNER UI: USD 2.00 Net Sales / USD 1.00 COGS / USD 1.00 Gross Profit / 50% Gross Margin / 100% Coverage — **PASS**.

No additional FIELD sale or receiving was created during trigger activation or closure.

## 6. Trigger and runtime evidence

- Hourly trigger: **ACTIVE**, `syncHourly`, time-driven, every hour.
- Weekly trigger: **ACTIVE**, `syncWeekly`, time-driven, Sunday 02:00–03:00, Asia/Phnom_Penh.
- Trigger owner: current Founder Google account.
- Trigger inventory: exactly 2; duplicate trigger: **NO**; other function triggers: **NO**.
- First natural hourly execution: 2026-10-31 19:41:46 +07, completed successfully in 22.356 seconds, 0% error rate.
- `LAST_FEED_SYNC_AT`: `2026-10-31T12:41:58.173Z`.
- `_Log`: one additional SYNC row from the automatic execution.
- Inventory integrity: one FIELD row; stock remains 9, average cost 1, inventory value 9.
- SalesDaily integrity: one row; quantity 1, Net Sales 2, COGS 1; no duplicate.
- DailyProfit integrity: one row; `2 / 1 / 1 / 0.5 / 1`; no duplicate.
- Store isolation: **PASS**; no other Store data appeared in the Pilot Google runtime or OWNER Pilot result.

## 7. Carry-forward debt

The following items are explicitly non-blocking and are not fixed by this closure:

- `ES-INVENTORY-PROFIT-PILOT-PERF-01` — **OPEN / NON-BLOCKING**:
  - OWNER first render approximately 9 seconds;
  - Apps Script response approximately 7.4 seconds;
  - automatic sync approximately 22.4 seconds.
- DEF-06 — Script Properties hardening.
- DEF-07 — timing-safe secret comparison.
- DEF-08 — duplicate `requestKey` payload comparison.
- COUNT / ADJUSTMENT.
- D+3 close.
- nightly backup.
- OperationLog metrics.
- migration-chain debt: the current repository migration chain cannot reconstruct an empty database from zero because `20260531000000_customer_order_campaign` expects `CustomerOrder` before it exists in the replay chain.

These items require separate scoped authorization. They do not expand or weaken the frozen Pilot baseline.

## 8. Freeze boundary

- Pilot activation remains restricted to Diamond Supermarket / `ST883DC00C`.
- No second merchant is activated or authorized.
- No business code, Apps Script logic, Production environment variable, database/schema/migration, Google binding, trigger, or business data is changed by this closure record.
- Future changes to the frozen paths, business semantics, Store binding, Apps Script version, Google runtime, credentials, triggers, cost/profit rules, or merchant scope require a new governed task, review, release, and applicable FIELD acceptance.
- The existing Dashboard exception is already `CLOSED` and cannot authorize future Dashboard work.

## 9. Closure decision

Obsidian closeout sync:

- `OBSIDIAN_SYNC=YES` to the governed real E-Shop Obsidian Vault.
- Development record: `05-开发记录/开发日志/2026-10-31 ES-INVENTORY-PROFIT-PILOT-01 Development Record.md` (`SHA-256 34f1396d6c0b4828eb4664bfc3a531647ef2b9e9028462fa8ee8c52a639f11d5`).
- FIELD record: `05-开发记录/验收记录/2026-10-31 ES-INVENTORY-PROFIT-PILOT-01 FIELD Acceptance.md` (`SHA-256 f175215110dbcc312ec962da3ede5334d21d48f7d42804a2a35e0fd14c4e6ffc`).
- Freeze record: `03-冻结文档/01-正式冻结/2026-10-31 ES-INVENTORY-PROFIT-PILOT-01 FINAL FROZEN.md` (`SHA-256 d1446a24929fda851a36fb83e6cfff741c8e6c4c0553c5d3c53f88573e372865`).
- `CONTENT_MATCH=YES`; each Vault file is byte-identical to its verified closeout draft.

All closure predicates are satisfied: Founder acceptance passed; the exact runtime is in `origin/main`; Production contains the same runtime tree through the validated normal release lineage; Vercel is READY; FIELD and automatic-trigger evidence are PASS; Store isolation is PASS; no known blocking regression remains; and the required development, FIELD, and freeze records are synchronized to the real Obsidian Vault.

```text
FIELD VERIFIED = YES
PILOT ACTIVATION = PASS
FINAL FROZEN = YES
CLOSED = YES
```

No further action is required for this Pilot closure. Native implementation and second-merchant rollout are expressly outside this record.
