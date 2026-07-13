# SV-05 USB Customer Display Adapter Acceptance Record

Status: IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

## Decision

SV-05 uses the existing PosSession mirror side path. It adds a Web Serial USB customer display adapter on `/desktop/pos` without changing the frozen cashier chain.

## Implemented Files

- `lib/customer-display-adapter.ts`
- `types/web-serial.d.ts`
- `app/desktop/pos/UsbCustomerDisplayBridge.tsx`
- `app/desktop/pos/page.tsx`
- `tests/customer-display-adapter.test.ts`
- `docs/store-validation/sv-05-customer-display-architecture-note.md`
- `docs/store-validation/sv-05-customer-display-real-device-validation-checklist.md`
- `docs/store-validation/sv-05-customer-display-acceptance-record.md`

## Acceptance State

IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

This record is not accepted, final frozen, or production verified.

## Non-Modified Frozen Scope

- `app/cashier/page.tsx`
- Sales API
- Payment API
- Prisma schema or migrations
- POS device token authorization
- Scanner logic
- Receipt printing logic
- Existing PosSession write logic
- `/desktop/display` web customer display logic

## Verification Required

Real device validation must confirm:

- 2400 baud operation.
- 9600 baud fallback operation.
- Initialize, clear, and amount display bytes.
- Decimal point display.
- Maximum visible amount length.
- One POS tab exclusive serial ownership.
- Cashier, KHQR, scanner, and receipt printing remain unaffected by serial failure.
