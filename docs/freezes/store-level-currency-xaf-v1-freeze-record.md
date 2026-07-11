# Store-Level Currency XAF V1 Freeze Record

Freeze status:

`FINAL FROZEN`

## 1. Frozen Scope

The following rules are frozen for Store-Level Currency XAF V1:

1. `Store.currencyCode` is the store-level currency source of truth.
2. The database stores standard ISO currency codes.
3. `XAF` is the standard currency code for this store.
4. `F` is the frontend display form for XAF in this product context.
5. Standard currency code and display symbol must remain separated.
6. One store uses one currency at a given time.
7. Product price numbers do not change because the store currency changes.
8. No exchange-rate conversion is performed.
9. `Product.sellPrice` must not be batch modified for currency display changes.
10. Other stores must not be affected by the specified store configuration.
11. Payment methods may be restricted by store-level currency capability.
12. XAF stores must disable, hide, or reject KHQR because KHQR is not supported for XAF in this system.
13. Amount display must go through `lib/currency.ts` or an equivalent centralized formatter.
14. Pages must not hand-write currency display logic, including:
    - `$`
    - `FCFA`
    - `F`
    - `$...toFixed(2)`
    - Other manual currency concatenation
15. Store currency must not be hardcoded by checking a specific `storeCode`.
16. Missing currency values must not silently submit default `USD` and overwrite the real store currency.
17. Historical amounts must not be automatically converted after a store currency change.
18. Ops admin, owner frontend, sale page, cart, and receipts should read the same store currency source of truth.

## 2. Frozen Data Rules

- `currencyCode` stores standard codes such as `USD` or `XAF`.
- Display symbols are UI formatting concerns, not persisted currency codes.
- `F` must never be saved as `Store.currencyCode`.
- Currency display changes must not mutate product, order, inventory, member balance, or historical transaction numbers.

## 3. Frozen Formatting Rules

Current frozen examples:

- USD: `$3.00`
- XAF integer: `3 F`
- XAF decimal: `3.50 F`
- XAF zero: `0 F`

XAF preserves meaningful decimals and does not round `3.50` to `4`.

## 4. Frozen Payment Rules

- CASH can be used for XAF.
- KHQR is not available for XAF in this implementation.
- Unsupported payment methods must not proceed just because the amount display changed.

## 5. Out Of Scope

The following are not part of this freeze. They require a separate review, implementation plan, build verification, acceptance, and freeze:

- Multi-currency single order
- Real-time exchange rates
- Automatic conversion
- Multi-currency member balance
- Multi-currency inventory cost
- Cross-currency report aggregation
- Historical order currency conversion
- Cross-currency refunds
- Multi-currency accounting
- New payment channel integration
- New country localization system

## 6. Required Change Gate

Any future change affecting the following boundaries must go through:

Review -> Development -> Build Verification -> Acceptance -> Freeze

Affected boundaries include:

- `Store.currencyCode`
- `formatMoney`
- Product price saving
- Cart amounts
- Sale amounts
- Receipt amounts
- Payment-method currency checks
- Historical amount display

## 7. Final Freeze Status

`FINAL FROZEN`

