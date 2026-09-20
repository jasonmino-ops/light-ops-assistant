# ES-CASHIER-PRODUCT-CARD-COLLAPSE-01 Final Closure Record

## Status

```text
Production Verified = YES
V727 Runtime Acceptance = PASS
Founder Acceptance = PASS
FINAL FROZEN = YES
CLOSED = YES
```

This governance-only record closes the Browser product-card collapse
incident. It authorizes no further Cashier, API, database, Auth, Printing,
Runtime, Electron/IPC, or Phase 6/7/8 work.

## Delivery identity

| Item | Evidence |
| --- | --- |
| Task | `ES-CASHIER-PRODUCT-CARD-COLLAPSE-01` |
| Delivery class | Web UI layout corrective |
| Product corrective commit | `726587769d2aeacdb461a936ac5e28422258e153` |
| Test synchronization commit | `e463e8c34c73a0dedfa8c1bfc9cee5f9f634085a` |
| Final Product / Production SHA | `e463e8c34c73a0dedfa8c1bfc9cee5f9f634085a` |
| Canonical Production deployment | `dpl_AGD3gpuBFX7EnhnVtDXVqWcg6757` |
| Production state | `READY` |
| Protected file SHA-256 | `d6b715c7270284cb85119de3e0ae08458f0954d431f4a6ef06d0fcca34a906c0` |
| Final governance state | Exception `CLOSED` after feature merge |

## Root cause and corrective

Root cause category:

`Browser product-card layout shrink / missing defensive size invariants`

Authenticated real V727 runtime evidence before correction showed:

- 62 products: card height approximately `2.67px`, image wrapper `0px`,
  card `minHeight=auto`, image wrapper `flexShrink=1`;
- 26 products: card height approximately `13.35px`, image wrapper `0px`;
- 7 products: card height approximately `48.76px`, image wrapper approximately
  `29.09px`.

The exact corrective in `app/cashier/page.tsx` was:

- shared Browser/base `pcard`: `minHeight: auto → 180`;
- shared Browser/base `pcardImg`: `flexShrink: 1 → 0`.

Product count now increases scroll length rather than compressing cards.

## Historical false-positive lesson

The earlier hypothesis that missing `display: flex` / `flexDirection: column`
was the root cause was insufficient. Fixture-only validation produced a false
positive. The final diagnosis and acceptance used authenticated real V727 DOM
and computed-style evidence.

## Founder V727 runtime acceptance

Founder validated the final canonical Production on the real V727:

- 7-product category: PASS;
- 26-product category: PASS;
- 62-product category: PASS;
- ALL PRODUCTS, approximately 190 products: PASS;
- product images visible: PASS;
- product names and prices visible: PASS;
- grid scrolls instead of collapsing cards: PASS;
- add-to-cart: PASS;
- Management Center entry: PASS.

## Final evidence

- Scope Guard: `PASS` before integration and final governance closure;
- Release Lineage Gate: `PASS` with Production at the final Product SHA;
- Build: `PASS`, including the canonical Production build;
- Print-contract test: `PASS` after exact SHA synchronization;
- Product-card targeted tests: `PASS`;
- Production contains the exact corrective candidate: `YES`;
- API / DB / Auth / Electron / IPC / Printing / Runtime changes: `NONE`;
- Management Center behavior: unchanged;
- Desktop large/compact behavior: unchanged;
- Compact/large Browser control: not restored.

## Governance closure

The task-scoped exception was changed from `ACTIVE` to `CLOSED` after the
exact corrective feature merge. Its historical path and SHA-256 remain
preserved and it cannot authorize future Cashier changes.

The closure changes only governance/evidence files. No product, test,
Blueprint, Roadmap, API, Auth, database, Electron/IPC, Printing, or Runtime
bytes are changed by this closure.

`FIELD REQUIRED = NO` for this Web UI corrective. The Founder real V727
acceptance is recorded as runtime acceptance, not printer or Runtime FIELD.

No further action is required for this incident. Any future Browser compact
mode or Cashier layout work requires a separate governed task.
