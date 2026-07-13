# SV-05B USB Customer Display Real-time Cart Sync Architecture Note

Status: IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

## Scope

SV-05B upgrades the already verified SV-05 USB customer display path from final-amount-only display to real-time cart total sync.

SV-05 already verified:

- COM3 / 2400 connection works on the real device.
- Web Serial works.
- ESC/POS initialize, clear, and amount commands are compatible.
- Test display and clear work.
- Repeated `open()` handling is fixed.
- Serial failure does not block cashier operation.

SV-05B only adds cart total sync. It does not add product names, change, welcome text, payment method labels, or dual-line display.

## Architecture

- `CashierPage` owns the real cart state.
- Existing `cartTotal(cart)` remains the only trusted total calculation.
- `CashierPage` emits a small browser `CustomEvent` only when running as `/desktop/pos?mode=pos`.
- `UsbCustomerDisplayBridge` listens for `cashier:cart-total-changed`.
- The bridge writes cart totals to the already connected USB customer display.
- PosSession polling remains as fallback for final confirmation, completion delay clear, cancellation, and refresh recovery.

## Event Contract

Event name:

`cashier:cart-total-changed`

Payload:

- `storeCode`
- `totalAmount`
- `itemCount`
- `updatedAt`
- `reason`: `cart` / `clear` / `final`

`CashierPage` does not import the serial adapter and does not know about Web Serial, ESC/POS, device status, or settings UI.

## Real-time Behavior

- Cart from empty to non-empty: display current total.
- Add item: update current total.
- Change quantity: update current total.
- Delete item: update current total.
- Clear cart: clear customer display.
- Confirm checkout: force one final amount display.
- Completed sale: keep final amount for about 2.5 seconds, then clear through PosSession fallback.

Target delay: 100-300ms. The cart event path uses a 75ms debounce; it no longer depends on 800ms polling for normal cart changes.

## Deduplication

The bridge tracks:

- pending amount
- last successfully displayed amount
- display sequence
- PosSession final signature

This prevents duplicate writes while ensuring quick changes such as `10.00 -> 15.00 -> 20.00` end with `20.00`.

## Boundaries

SV-05B does not modify:

- Sales API
- Payment API
- Database or Prisma schema
- POS device token authorization
- Scanner logic
- Receipt printing logic
- KHQR logic
- Member balance logic
- `/desktop/display`

## Frozen File Note

`app/cashier/page.tsx` is touched because the real cart state and trusted `cartTotal(cart)` function are local to that component. The change is limited to publishing a lightweight cart-total event and does not alter cart mutation, sale submission, payment, print, scanner, or authorization logic.

## Pending Verification

This is not Final Frozen. Real device validation must confirm perceived latency, duplicate suppression during rapid scans, final amount stability, and clear timing.
