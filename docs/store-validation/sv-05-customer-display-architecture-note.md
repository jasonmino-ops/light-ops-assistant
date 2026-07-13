# SV-05 USB Customer Display Adapter Architecture Note

Status: IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

## Scope

SV-05 adds a browser-side USB customer display adapter for Desktop POS only. The implementation uses the existing PosSession mirror as a side path and does not change the frozen cashier, payment, sale, print, scanner, token, database, or `/desktop/display` flows.

## Architecture

- Desktop POS remains `/desktop/pos?mode=pos&storeCode=...`.
- `app/desktop/pos/page.tsx` still renders the existing `CashierPage`.
- `UsbCustomerDisplayBridge` is mounted next to `CashierPage` and only observes existing PosSession state.
- The bridge polls `GET /api/pos/session/current?storeCode=...` every 800ms, matching the existing web customer display polling cadence.
- The cashier write path already has about 300ms debounce, so maximum theoretical display latency is about 300ms debounce + 800ms polling.

## Serial Adapter

The isolated adapter is `lib/customer-display-adapter.ts`.

Default serial settings:

- baudRate: 2400
- dataBits: 8
- stopBits: 1
- parity: none
- flowControl: none

9600 is selectable for field testing. No COM port name is hard-coded or persisted.

## ESC/POS Bytes

- Initialize: `1B 40`
- Clear: `0C`
- Display amount: `1B 51 41` + ASCII amount + `0D`
- Example `12.50`: `1B 51 41 31 32 2E 35 30 0D`

Amounts reject NaN, Infinity, negative values, non-digit characters other than `.`, and values longer than the max display length constant.

## PosSession Mapping

- `AWAITING_PAYMENT`: send final payable `totalAmount`.
- `COMPLETED`: retain the last amount for about 2.5 seconds, then clear.
- `CANCELLED`: clear.
- `DRAFT` / no session: clear after a successful poll indicates idle or reset.
- Poll failure: warn only, keep current display, do not disconnect, do not clear.

## Deduplication

The current API does not expose a separate PosSession id. SV-05 deduplicates with:

- `orderNo`
- `status`
- `totalAmount`
- `updatedAt`

It also tracks the last successful amount string, so repeated 800ms polls do not resend the same visible amount.

## Isolation

Serial write failures are caught inside the adapter and bridge. They update customer display status but do not throw into the cashier flow.

This implementation did not modify:

- `app/cashier/page.tsx`
- Sales API
- Payment API
- Prisma schema or migrations
- POS device token authorization
- Scanner logic
- Receipt printing logic
- Existing PosSession write logic
- `/desktop/display` web customer display logic

## Current Limits

- Only one POS tab should own the serial port at a time.
- Decimal point display behavior and max visible digits still require real device verification.
- 2400 and 9600 baud rates both require field testing.
- If field latency is unacceptable, a future task must separately request frozen cashier-link changes. SV-05 does not change that chain.
