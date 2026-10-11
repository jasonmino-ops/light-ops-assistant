# ES-DINE-IN-01 M1 — FIELD Evidence

## Status

- FIELD VERIFIED: **YES**
- FIELD environment: Production + V727 + `Mino Pet Shop / ST169E7000`
- FIELD mode: initial M1 FIELD plus targeted corrective re-verification

## Initial FIELD evidence

- Open table, first order, second add-on, KHQR settlement, FRONT receipt and clear-table flow were exercised on V727.
- The first kitchen batch exposed the authority/lifecycle timing defect: no physical kitchen paper, `UNKNOWN`, and no durable print-job evidence.
- The second batch, KHQR settlement, FRONT receipt and table clearing were valid evidence and retained.
- The first-batch failure is retained as historical defect evidence; it is not represented as a PASS.

## Corrective targeted FIELD evidence

Founder confirmed all targeted steps PASS on the real V727. Production read-only evidence for the newest closed meal confirms:

- two required KITCHEN batches;
- two durable KITCHEN `SUCCEEDED / CROSSED` print jobs;
- no missing or non-crossed KITCHEN job;
- KHQR payment `PAID`;
- durable FRONT `SUCCEEDED / CROSSED` receipt job;
- table cleared after settlement.

## Production baseline reconcile

- Store: `ACTIVE`, `FOOD`, kitchen printing enabled.
- Active dining tables: `2 total / 2 free / 0 occupied`.
- All-time `OPEN DiningMeal`: `0`.
- Orphan `DiningBatch`: `0`.
- Current recent print anomaly jobs: `0`.
- Historical first-FIELD missing job remains preserved as incident evidence only; no active open meal, payment, table, or current print anomaly remains.

## Boundary

No new FIELD, CORE, feature, migration, configuration, or Production data mutation was performed during closure.
