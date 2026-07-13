# SV-05 USB Customer Display Real Device Validation Checklist

Status: IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

## Preconditions

- Use Chrome on the Windows POS computer.
- Open only one Desktop POS tab during serial testing.
- Confirm the USB customer display appears as a COM port in Windows Device Manager.

## Steps

1. Windows Device Manager: confirm the USB customer display COM port.
2. Chrome: open Desktop POS `/desktop/pos?mode=pos&storeCode=<STORE_CODE>`.
3. Click the USB customer display control and choose the matching serial device.
4. Select 2400 baud and run test display `8888.88`.
5. If 2400 fails, switch to 9600 and test again.
6. Verify initialize command behavior.
7. Verify clear command behavior.
8. Verify integer amount display.
9. Verify two-decimal amount display.
10. Add product and confirm order.
11. Confirm the final amount appears within about 1.1 seconds after confirmation.
12. Complete a cash order.
13. Complete a KHQR order.
14. Confirm display clears after the post-sale delay.
15. Complete two orders in sequence and confirm no stale amount remains.
16. Unplug USB and continue cashier operation; order completion must still work.
17. Confirm receipt printing still works when customer display has an error.
18. Confirm barcode scanner continues scanning normally.
19. Refresh page and verify previously authorized device can reconnect without an authorization pop-up.
20. Confirm only one POS tab is open while validating serial ownership.

## Pass Criteria

- Customer display amount matches PosSession payable amount.
- Serial failure does not block cashier, payment, scanner, or receipt printing.
- No repeated flicker from duplicate 800ms writes.
- 2400 or 9600 operating baud rate is recorded for the real device.

## Pending Real Device Risks

- Actual device command set may differ from `ESC Q A`.
- Decimal point rendering may differ by model.
- Visible max digit count may be lower than the software max.
- Browser and driver behavior may differ on the final Windows POS machine.
