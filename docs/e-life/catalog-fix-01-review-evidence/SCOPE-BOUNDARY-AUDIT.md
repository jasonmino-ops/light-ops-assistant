# Scope Boundary Audit

| Boundary | Result |
| --- | --- |
| Store code/ACTIVE selection | Original query unchanged |
| Tenant/status visibility | Same tenant and ACTIVE required on every batch |
| Price/discount/recommendation/media | Original product mapping unchanged |
| Category selection/order | Original tenant/sortOrder/name query unchanged |
| Product ordering | Original name asc; unique id only resolves previously unspecified equal-name order |
| H5/electronic HTTP DTO | No field/shape change; actual route DTO regressions PASS |
| Customer UI/search/cart/details | app/menu bytes unchanged; full incoming catalog exercised by local browser |
| Auth/order/payment/printing/Local First/offline | No implementation edit; related regression evidence and limitations disclosed |
| Product data/schema/migrations/env/dependencies | No change |
| Fixed total limit | None;200 is only per-query size, repeat until final short batch |
| Failures | Later query rejects, cannot report partial catalog as success |

Path lookups: no planned code/test path binds a FINAL/FROZEN asset; electronic-menu acceptance is explicitly candidate-only. Beta V1.1 §10 permits store-trial blockers with existing core semantics preserved. No exception to protected paths claimed or used. Homepage dead search, marketing-image500 enrichment bound, unrelated core manifest/test debt not repaired.
