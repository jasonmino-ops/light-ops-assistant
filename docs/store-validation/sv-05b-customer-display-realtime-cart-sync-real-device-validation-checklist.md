# SV-05B USB Customer Display Real-time Cart Sync Real Device Validation Checklist

Status: IMPLEMENTED — PENDING REAL DEVICE VERIFICATION

## Steps

1. Connect COM3 / 2400.
2. Clear the display.
3. Scan the first product.
4. Confirm the current total appears quickly.
5. Scan the second product.
6. Confirm the amount accumulates.
7. Increase quantity.
8. Decrease quantity.
9. Delete a product.
10. Clear the cart.
11. Rapidly scan 5 products.
12. Confirm the final amount is correct.
13. Press Enter to confirm checkout.
14. Confirm the final payable amount remains correct.
15. Complete a cash order.
16. Confirm the display clears after about 2.5 seconds.
17. Complete a second order continuously.
18. Test a KHQR order.
19. Unplug the customer display and continue cashier operation.
20. Verify barcode scanner and receipt printing have no regression.

## Pass Criteria

- Cart total changes are visible in about 100-300ms.
- Same amount does not repeatedly flicker or rewrite.
- Rapid scans finish on the latest total.
- Final checkout amount is guaranteed once.
- Completed sale keeps the final amount briefly, then clears.
- Serial failure does not block cashier operation.
