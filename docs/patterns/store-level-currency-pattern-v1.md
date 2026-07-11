# Store-Level Currency Pattern V1

# 门店级货币配置复用模式 V1

## A. Core Principle

Frozen principle:

> 货币是门店配置，价格是业务数值；改变货币展示，不等于换算价格。

Additional principles:

- Standard currency code and frontend display symbol must be separated.
- One store uses one currency at a time.
- Do not build a full multi-currency system by default.
- First solve display consistency and payment capability isolation.
- Do not touch transaction core logic unless separately approved.

## B. Applicability

This pattern applies when:

- Adding a store in a new country or region
- Configuring a new currency for a specified store
- Product price numbers must stay unchanged
- Only amount unit and display should change
- The store remains single-store, single-currency
- Payment methods need to be limited by currency capability

This pattern does not apply to:

- Exchange-rate conversion
- Multi-currency single order
- Cross-currency settlement
- Multi-currency accounting
- Multi-currency member balance
- Historical amount conversion
- Cross-currency refunds

## C. Standard Implementation Steps

1. Confirm the target store `storeCode`.
2. Confirm the target `Store.id`.
3. Confirm the target `tenantId`.
4. Confirm the target ISO currency code.
5. Confirm the local display symbol.
6. Confirm whether the symbol is prefix or suffix.
7. Confirm decimal behavior.
8. Store the standard code in `Store.currencyCode`.
9. Update only the specified store.
10. Keep other stores unchanged.
11. Route all amount display through one formatter such as `formatMoney`.
12. Do not convert product input values or product save payloads.
13. Check whether each payment channel supports the target currency.
14. Hide or reject unsupported payment channels.
15. Verify both the target store and existing stores.
16. Complete Acceptance and Freeze records.

## D. Standard Data Principles

- `Store.currencyCode` stores the standard code.
- Do not store the display symbol as the currency code.
- `XAF` is the standard code.
- `F` is the display symbol used for the accepted XAF store.
- Do not save `F` as `currencyCode`.
- Do not judge currency by hardcoding a specific `storeCode` in business pages.
- Do not batch update `Product.sellPrice`.
- Do not silently save unknown currency values as `USD`.
- Do not use exchange rates to update historical product prices.
- Do not change amount field types unless separately scoped and approved.

## E. Standard Formatting Principles

Examples:

USD:

`$3.00`

XAF:

`3 F`

`3.50 F`

Future currencies should be added to the centralized formatting mapping. Pages must not concatenate currency symbols on their own.

Each currency formatting rule should define:

- ISO code
- Display symbol
- Symbol position
- Decimal behavior
- Zero amount behavior
- Thousands separator
- Fallback behavior

## F. Required Page Checklist

At minimum, check:

- Owner store settings
- Owner home
- Today net revenue
- CASH
- KHQR historical statistics
- Pending payment amount
- Pending order amount
- Product list
- Product edit
- Product search results
- Recent products
- Product dropdown
- Sale page
- Selected product
- Cart line item
- Product subtotal
- Cart total
- Payment modal
- Sale success result
- Deferred order
- Restore deferred order
- Sale records
- Customer menu
- Desktop POS
- 80mm receipt
- Reprinted receipt
- Cloud print template
- Member balance
- Refund
- Pending orders

## G. Real Issues Found In This Rollout

### 1. Database was XAF, but settings still showed USD

Root cause:

Frontend state, default values, or save payloads used default `USD`.

Experience:

Pages must initialize from real `Store.currencyCode`. A default `USD` must not overwrite real store configuration.

### 2. Home still showed dollars

Root cause:

The page manually rendered `$...toFixed(2)`.

Experience:

All amount display must use the centralized formatter.

### 3. Product added to cart still showed dollars

Root cause:

The cart component did not receive `currencyCode`.

Experience:

Currency context must be passed to all child components that display amounts.

### 4. `$$3.00` appeared

Root cause:

`formatMoney` already returned the currency symbol, and the page manually prepended `$` again.

Experience:

The formatter returns the full display text. Pages must not add a second symbol.

### 5. `FCFA` was too long in the home layout

Resolution:

The database standard code stayed `XAF`; frontend display changed to `F`.

Experience:

Standard currency code and UI display form must stay separated.

### 6. Saving other settings could reset XAF to USD

Root cause:

Missing values used `USD` as a submit-capable default.

Experience:

Fallback defaults may be used for display only. They must not be silently submitted to overwrite real configuration.

### 7. Product and OWNER data seemed lost

Resolution:

Production read-only audit confirmed the data still existed before any recovery action.

Experience:

When data appears missing, do not immediately re-enter products or rebind owners. First classify the issue:

- DATA DELETED
- RELATIONSHIP MISMATCH
- SESSION CONTEXT MISMATCH
- OPERATOR MODE CONTEXT MISMATCH

### 8. Product ownership follows tenantId, not storeId

Experience:

When product lists appear empty, verify `tenantId` in addition to `storeCode` and `storeId`.

## H. Minimal Template For Adding A Currency

Each new currency rollout must define:

- `ISO currencyCode`
- `displaySymbol`
- `symbolPosition`
- `decimalMode`
- `zeroAmountFormat`
- `targetStoreCode`
- `targetStoreId`
- `targetTenantId`
- `supportedPaymentMethods`
- `unsupportedPaymentMethods`
- Whether historical data changes
- Whether product values change

Example:

```yaml
currencyCode: XAF
displaySymbol: F
symbolPosition: suffix
decimalMode: preserve-significant-decimals
paymentCapabilities:
  cash: true
  khqr: false
```

This is a reusable design template only. It does not require a full currency engine refactor.

## I. Acceptance Template

Every future currency addition should verify at least:

1. Settings page shows the correct currency.
2. Currency does not revert after refresh.
3. Home amount unit is correct.
4. Product price numbers stay unchanged.
5. Product display unit is correct.
6. Sale page unit is correct.
7. Cart unit is correct.
8. Total unit is correct.
9. Deferred and restored order amounts are correct.
10. Sale success result is correct.
11. Sale records are correct.
12. Receipt and reprint are correct.
13. Unsupported payment method is hidden on the frontend.
14. Unsupported payment method is rejected on the backend.
15. Existing currency stores are unchanged.
16. No exchange-rate logic exists.
17. No product price batch update exists.
18. No historical amount conversion exists.
19. Build passes.
20. Production device acceptance passes.

