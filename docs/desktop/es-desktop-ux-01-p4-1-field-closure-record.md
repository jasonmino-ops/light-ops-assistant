# ES-DESKTOP-UX-01 / P4-1 Minimal Operator Boundary — FIELD Closure

## Status

`P4-1 FIELD VERIFIED = YES`

Final governance state for this authorized closure:

```text
P4-1 FINAL FROZEN = YES
P4-1 CLOSED       = YES
Production Change = NO
P4-1B Started     = NO
```

This record preserves Founder-provided V727 Production evidence for the
already-deployed P4-1 Minimal Operator Boundary. It does not authorize P4-1B,
another test order, a rollback exercise, or any further Production change.

## Delivery identity

| Item | Evidence |
| --- | --- |
| FIELD target | `V727 / PC-20260119FZUI` |
| Store | `Mino Pet Shop / ST169E7000` |
| Production SHA | `7615a233952de5b5562f482d2fc13a899b0f5195` |
| Delivery | Production deployment already READY; no new deployment in this closure |
| Code/config/schema changes in FIELD closure | `NO` |

## Operator boundary evidence

### DEVICE path

- Source: `DEVICE` — PASS.
- Current operator: `OWNER（本机授权）`.
- Real CASH order: `S-20260918-ST169E7000-0006`, `$0.50` — PASS.
- Attribution: legacy `Device → OWNER` — PASS.
- `POS_DEVICE_UNAUTHORIZED`: `NO`.
- Mino store restore and POS business path remained usable.

### ACCOUNT path

- Source business path: `ACCOUNT` — PASS.
- Existing authorized account/operator: `Jason Sun`.
- Store: `Mino Pet Shop / ST169E7000`.
- Real CASH order: `S-20260918-ST169E7000-0008`, `$10.00` — PASS.
- Mobile Production order detail: payment `PAID`; sales status `COMPLETED`.
- Attribution: selected ACCOUNT identity — PASS.
- Device fallback for this order: `NO`.
- `POS_DEVICE_UNAUTHORIZED`: `NO`.

The supplied manual evidence does not separately record whether the selected
ACCOUNT role was OWNER or STAFF; it does confirm the existing authorized
ACCOUNT path and the resulting `Jason Sun` operator attribution. No role or
permission was changed for this FIELD.

## Regression and deferred evidence

- Existing automated and integration evidence is reused for POS authorization,
  real PostgreSQL offline CASH write/fallback, Scope Guard, Release Foundation,
  Release Lineage, and the candidate independent review.
- Offline lock/switch and rollback were not forced through additional risky
  Production actions. The source-level rollback contract remains
  `DESKTOP_OPERATOR_BOUNDARY_ENABLED=0 → legacy Desktop behavior`.
- P1A / Single Authorization regression: no new regression reported in the
  accepted candidate validation evidence.
- RC9 / Printing changed: `NO`.
- Desktop Sales Record can list order `#0008`, but its Desktop order-detail view
  shows `订单加载失败，请重试`; the same mobile Production detail loads
  successfully. Classification: `NON-BLOCKING / DEFERRED`, outside P4-1 scope.
- `KTF-20260912-03` remains deferred as existing Next.js request-scope test
  harness debt; it is not absorbed by P4-1.

## Exit status

| Gate | Result |
| --- | --- |
| DEVICE FIELD | `PASS` |
| DEVICE legacy OWNER fallback | `PASS` |
| ACCOUNT FIELD | `PASS` |
| ACCOUNT attribution | `PASS` |
| Real CASH evidence | `PASS` |
| New business-blocking regression | `NO` |
| P4-1B started | `NO` |
| Additional DEVICE/ACCOUNT test orders | `NO` |
| P4-1 FIELD VERIFIED | `YES` |

## Final governance closure

- Closure type: governance-only documentation closure after accepted FIELD
  evidence.
- Authorized repository action: commit this record and fast-forward it into
  `origin/main`; Production product bytes remain the deployed candidate bytes.
- Production SHA: `7615a233952de5b5562f482d2fc13a899b0f5195`.
- Main/Production lineage requirement: the final closure verification must
  confirm that this Production SHA is an ancestor of final `origin/main`.
- Database/schema/migration: unchanged; no migration required or executed.
- Production/Vercel: unchanged; no redeploy required or executed.
- Browser/real-device FIELD evidence: accepted as recorded above; no further
  FIELD action is authorized by this record.
- Remaining deferred items: Desktop Sales Record order-detail load failure and
  `KTF-20260912-03` existing test-infrastructure debt.

This record does not claim that the deferred Desktop Sales Record detail issue
was fixed. No code, Production configuration, schema, migration, Cashier,
Activation, POS Authorization architecture, or Printing behavior was changed
for this closure.
