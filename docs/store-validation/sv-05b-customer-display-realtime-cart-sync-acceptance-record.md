# SV-05B USB Customer Display Real-time Cart Sync Acceptance Record

Status: IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

## Summary

SV-05B adds real-time cart total sync to the verified SV-05 USB customer display path.

## State

IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

This record is not Final Frozen and not production verified.

## Scope

- Cart event is the primary channel.
- PosSession remains the fallback channel.
- Target visible latency is 100-300ms.
- No database or schema changes.
- No sales or payment boundary changes.
- No scanner or receipt printing changes.

## Modified Files

- `app/cashier/page.tsx`
- `app/desktop/pos/UsbCustomerDisplayBridge.tsx`
- `lib/customer-display-cart-event.ts`
- `tests/customer-display-cart-sync-static.test.ts`
- `docs/store-validation/sv-05b-customer-display-realtime-cart-sync-architecture-note.md`
- `docs/store-validation/sv-05b-customer-display-realtime-cart-sync-real-device-validation-checklist.md`
- `docs/store-validation/sv-05b-customer-display-realtime-cart-sync-acceptance-record.md`

## Frozen File Justification

`app/cashier/page.tsx` was modified because the cart state and trusted `cartTotal(cart)` calculation are internal to that component. The change only emits a lightweight browser event and does not move serial logic into the cashier.

## Verification Required

Real device testing must confirm:

- First item total appears quickly.
- Add, quantity change, delete, and clear update correctly.
- Rapid scans finish on the newest total.
- Checkout final total is stable.
- Completed sale clears after about 2.5 seconds.
- Cashier, scanner, KHQR, and receipt printing are unaffected.
