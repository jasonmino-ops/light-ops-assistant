# Test Coverage Matrix

| Requirement | Evidence |
| --- | --- |
|2096 eligible /1896 previously omitted | prior audit real-ID replay:2096/2096, missing0 |
| Growing catalog without total cap | counts0,1,199,200,201,400,2096,20001; exact complete ordered ID sets |
| Same-name boundary |307 same-name groups span multiple200-row batches; no missing/duplicate IDs |
| Merchant/tenant generality |2096 tenantA,1234 tenantB; exact own-ID sets and same-tenant StoreA2 parity |
| Visibility | disabled/foreign fixtures excluded; unknown/inactive store behavior unchanged |
| Mid-batch failure | loader/H5 reject; electronic-menu503; no partial-success response |
| DTO/price/detail/image/category | actual H5/electronic route comparison plus original mapping regressions |
| Search/category/detail/cart/order |2096 mobile-size local browser, tail item, category counts, image/spec/description, reload persistence, intercepted order ID/key |
| Larger rendering/search |5000 full cards and last-item search; local timings in JSON |
| Transaction/core boundaries |56 related Node checks PASS; broader baseline debts explicitly not green |
| Real SQL latency/concurrent edits | NOT VERIFIED; no Production data/SQL writes; no repeat audit |
| Physical low-end phone/FIELD/Production | PENDING separate release authorization and real acceptance |
