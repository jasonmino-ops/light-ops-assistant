# Diamond sales-control release plan — preparation only

No production action is authorized by this plan. Candidate product tree is
bf43fa367ea658d024d2cc8a7da07091076f523b on Production parent
d1ffbaea3d01c219bfb45a99ea360c511f27cf36. Only the 11 sealed paths may ship.

## Compatibility and safe order

1. At the future Production Gate, re-read live Production/release, schema and
   migration checksums, current Diamond switch and a valid recovery point.
   Reconcile writes since that backup; PITR must not be assumed. Preserve R2
   runtime identity. Other stores and old Feed data are unchanged.
2. Require Diamond new-sales deduction OFF and no checkout/refund underway,
   all terminals refreshed and local offline queues zero. If any condition is
   unknown or Production drifted, stop; this plan does not itself change flags.
3. Prefer **application first while deduction remains OFF**, then the one new
   migration. The new POS helper uses only tables/functions already in schema
   80. Before migration the new control read fails closed as unavailable and
   cannot activate; ordinary inventory/POS/H5 still use existing structures.
   This avoids exposing the new OFF-refund gate to the old no-key helper.
   Do not use migration-first with the incumbent application accepting keyless
   OFF refunds for already-issued sales unless refunds are explicitly paused
   and all old invocations drained under a separate approved maintenance plan.
4. Deploy only the exact candidate and verify READY/current source/normal
   business reads. Execute only
   20261125120000_diamond_sales_control using the approved migration identity,
   strict TLS and Prisma migrate deploy; never db push/reset/ledger editing.
   Expected target count is 81 finished, zero unfinished/failed. This additive
   migration is one BEGIN/COMMIT transaction, updates no balances/history/flags,
   adds no login role and changes no historic migration bytes.
5. Verify private command ACL, real OWNER/receiver read-only isolation, state
   endpoint and immutable operation audit before exposing operator control.
   Resume ordinary operations. Diamond enabling is a separate explicit Gate
   with terminal/offline/checkout confirmation; no automatic activation here.
6. After approval, operator changes only the Diamond switch. Reconcile first
   actual POS/H5 issues, POS returns and operation results. H5 returns stay off.
   Browser viewport tests are not Telegram/Electron or store FIELD acceptance.

## Stop, rollback and recovery boundaries

* On ambiguous migration/deploy/request status: no blind replay. Read the
  original migration/operation/deployment identity and actual state first.
* Before migration commits, transaction failure rolls back its database DDL;
  confirm that fact from schema and migration state, not merely an HTTP error.
* After commit, do not drop private audit/version tables or reverse journal
  entries. Disable only new-sale deduction if authorized, retain valid POS
  reversals and all immutable evidence, reconcile discrepancies and prefer a
  forward repair.
* Rolling an application back is **not** database recovery. Incumbent app plus
  the new gate is not unconditionally safe: its OFF path accepted keyless
  refunds. If old-app rollback is unavoidable, pause Diamond refunds until a
  compatible app or separately reviewed recovery is in place. Never claim
  that disabling the sales flag alone solves this compatibility boundary.
* An old physical backup is not a lossless rollback. Full restore affects
  post-backup merchant writes and requires a new explicit recovery decision,
  protected isolation and write reconciliation; never restore over sales as an
  automatic response. No untested reverse SQL is a recovery guarantee.

## Checks reused / still required

Reuse exact product bytes, 18 targeted cases, 81-migration isolated test,
Build/TypeScript and independent technical review. CORE raw 99/103 stays FAIL;
the four precise non-regression dispositions are candidate-only, not repairs.
At candidate commit run existing Cloud CI. Formal GitHub App production
signing is obtained only under the eventual protected release authorization;
the current ST04-specific signing grant cannot be reused for this feature.
