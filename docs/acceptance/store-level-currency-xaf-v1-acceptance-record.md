# Store-Level Currency XAF V1 Acceptance Record

## 1. Background And Goal

Light Ops Assistant needed store-level currency configuration for the Central African Republic store without changing the existing cashier calculation flow or affecting existing USD merchants.

The goal was to configure one specified store to use the standard currency code `XAF`, while keeping product price numbers unchanged and changing only the displayed money unit.

Final acceptance status:

`ACCEPTED - PRODUCTION VERIFIED`

## 2. Store Information

- Store code: `ST5B7AFF38`
- Store name: `够意思超市`
- Target store scope: the specified store only

## 3. Target Currency

- Stored standard currency code: `XAF`
- Frontend display symbol: `F`
- Example display:
  - `0 F`
  - `3 F`
  - `3.50 F`

Currency unit changes do not mean price conversion. The original product price numbers remain unchanged.

## 4. Implementation Scope

Implemented as store-level configuration using `Store.currencyCode` as the currency source of truth.

The implementation covered:

- Store settings currency reading and saving
- Dashboard and home amount display
- Product list and product price display
- Sale page amount display
- Cart line, subtotal, total, deferred order, restore prompt, and sale success amount display
- Shared money formatting through `lib/currency.ts`
- Payment capability isolation for XAF where KHQR is not supported

The implementation did not include:

- Exchange-rate conversion
- Multi-currency orders
- Product price mutation
- Historical order conversion
- Inventory calculation changes
- Member balance calculation changes
- Full multi-currency accounting

## 5. Production Deployment Commits

- Store-level currency base capability: `7d2fb5cb6a19a022197a0676b5a92fd45f2afe57`
- Currency source reading and dashboard/product display fix: `1647089e0e69b958fda5087256b84fc368ab1cc1`
- Compact XAF `F` display and sale/cart display fix: `d0bfba7561b07d16430364f2dd885dd3a26b4203`

## 6. Migration Execution Result

Production migration:

`20260711110000_add_store_currency_code`

Acceptance result:

- Migration completed successfully in production.
- Migration added store-level currency configuration.
- No historical order amounts were modified.
- No product price values were modified.
- No unrelated store data was converted.

## 7. Store.currencyCode Final Value

Production verified final value:

- `Store.currencyCode = XAF`
- `currencyCode` remains the standard code.
- The display symbol `F` is not stored as `currencyCode`.

## 8. Product Price Value Verification

Accepted facts:

- Product price numbers were not modified.
- `Product.sellPrice` was not batch updated.
- Existing product values remain the original business numbers.
- Changing the money unit does not convert `10.00` into another numeric value.

## 9. No Exchange-Rate Conversion

No exchange-rate logic was introduced.

No conversion was performed between USD and XAF. The system only changes the displayed money unit for the configured store.

## 10. USD Merchant Isolation

Accepted facts:

- Existing USD stores keep `$` display.
- Existing USD stores keep the original payment behavior.
- Existing USD stores were not configured as `XAF`.
- No global currency setting was introduced.

## 11. XAF Store KHQR Isolation

Accepted facts:

- XAF store does not use KHQR.
- Unsupported KHQR flows are hidden or rejected according to store currency capability.
- CASH remains available for the XAF store.

## 12. Amount Display Acceptance

The following areas were production verified for the XAF store:

- Home and dashboard main amount display
- CASH amount display
- KHQR historical/statistical amount display, where present
- Pending payment amount display
- Pending order amount display
- Product price display
- Product selection display
- Sale page selected product display
- Cart line unit price display
- Cart subtotal and total display
- Deferred order amount display
- Restore order amount display
- Sale success amount display

Accepted display form:

- `0 F`
- `3 F`
- `10.50 F`

## 13. Production Device Acceptance Items

Production device verification confirmed:

- Store settings read `XAF`.
- Refresh did not revert the store to `USD`.
- Home amount no longer showed `$`.
- Product price display no longer showed `$` or `FCFA`.
- Sale page product selection used `F`.
- Cart line used `1件 x 3 F` equivalent display.
- Cart total used `3 F`.
- Sale success amount used `F`.
- USD stores still displayed `$3.00`.
- No product price number changed.

## 14. Evidence Note

Acceptance evidence is recorded as production device verification text. Screenshots are not stored in this repository document.

Production fact:

`ACCEPTED - PRODUCTION VERIFIED`

## 15. Final Acceptance Status

`ACCEPTED - PRODUCTION VERIFIED`

