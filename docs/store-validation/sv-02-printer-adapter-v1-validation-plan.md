# SV-02 Printer Adapter V1 Validation Plan

> [!WARNING] SUPERSEDED ARCHITECTURE — KEEP AS HISTORICAL EVIDENCE（2026-08-11）
> 本文原有验证设计过程保留，不再作为当前 Printing Architecture authority。任何允许 Printer Adapter 接收 business payload、执行 render / transform、拥有 Receipt/Kitchen/Layout/Language/Image Composition 或 business semantics 的表述，均被 ECCP Printing Capability V1.1 取代。V1.1 要求 Printing Core / Profile 产生 Print Command Stream，Adapter 只负责 Transport → Printer。当前权威：Canonical Vault `ECCP Printing Capability Baseline V1.1 FINAL FROZEN`；Repository 入口：`docs/governance/printing/PRINTING_CAPABILITY_V1_1_INDEX.md`。

## Goal

Validate that a Windows local Printer Adapter can print a real 80mm receipt to Xprinter XP-N160II over USB without changing POS sales logic.

## Validation Scope

In scope:

- Windows all-in-one cashier PC.
- Xprinter XP-N160II connected by USB.
- Installed Windows printer driver.
- Local adapter service running on loopback when local adapter validation is enabled.
- Existing Desktop POS "自动打印小票" switch.
- Existing receipt actions: "预览小票", "打印小票", and "继续收银".
- Existing browser receipt fallback.

Out of scope:

- Cloud print.
- SW-AIOT.
- Database schema.
- `/api/cashier/sales` changes.
- Automatic printing.
- Cash drawer.
- Kitchen printing.
- mPOS printing.

## Preconditions

Hardware:

- Xprinter XP-N160II powered on.
- 80mm paper installed.
- USB cable connected to Windows cashier PC.
- Printer visible in Windows printer list.
- Windows test page can print successfully.

Software:

- Light Ops Assistant opens `/desktop/pos`.
- Local adapter service is running.
- Adapter `/health` returns ok.
- Desktop POS can complete a normal CASH sale.
- Desktop POS can complete a normal KHQR-confirmed sale if configured for the store.

## Test Data

Prepare products covering:

- Short English or numeric name.
- Chinese name.
- Khmer name if available.
- Product with spec.
- Multiple item order.
- Quantity greater than 1.
- Decimal price.

## Validation Matrix

| Case | Scenario | Expected Result |
| --- | --- | --- |
| V1-01 | Adapter health check | Desktop can detect local adapter online |
| V1-02 | Adapter offline | POS remains usable; print action reports adapter offline |
| V1-03 | Windows test print | Xprinter prints from Windows directly |
| V1-04 | Local adapter test print | Xprinter prints adapter test receipt |
| V1-05 | Auto print on: Desktop POS CASH sale | Sale completes first; existing browser print opens automatically |
| V1-06 | Auto print on: print closes | POS returns to continue-sale / new-order state |
| V1-07 | Multiple items | Printed lines, quantities, and total match POS success modal |
| V1-08 | Long product name | Receipt remains readable; no critical truncation |
| V1-09 | Printer out of paper | Sale remains complete; adapter returns clear error |
| V1-10 | Printer powered off | Sale remains complete; adapter returns clear error |
| V1-11 | Adapter service stopped after sale | Sale remains complete; browser fallback still available |
| V1-12 | Auto print off: sale success modal | Default focus lands on "打印小票" |
| V1-13 | Auto print off: Enter key | Pressing Enter triggers existing browser print |
| V1-14 | Print canceled by user | Sale remains complete and POS returns to continue-sale / new-order state |

## Step-by-Step Real Device Validation

### 1. Windows Printer Baseline

1. Start Windows cashier PC.
2. Connect Xprinter XP-N160II by USB.
3. Confirm printer appears in Windows Printers & Scanners.
4. Print Windows test page.

Pass condition: Xprinter produces a physical printout.

### 2. Adapter Health

1. Start Windows Local Adapter Service.
2. Open adapter health endpoint on the same PC.
3. Confirm response includes ok status, adapter version, and configured printer name.

Pass condition: adapter reports healthy without opening the cloud print path.

### 3. Adapter Test Print

1. Call adapter `/print-test`.
2. Confirm physical 80mm receipt prints.
3. Check that text is readable and centered/aligned enough for V1.

Pass condition: local service can print without Desktop POS involvement.

### 4. Desktop POS CASH Sale With Auto Print On

1. Open `/desktop/pos` on the Windows cashier PC.
2. Turn on the existing "自动打印小票" switch.
3. Add one product.
4. Select CASH.
5. Complete sale.
6. Confirm the existing browser print flow opens after sale success.
7. Close or complete the print dialog.
8. Confirm Desktop POS returns to continue-sale / new-order state.

Pass condition: sale completion is not delayed or blocked by printing, and receipt content matches the completed sale snapshot.

### 5. Desktop POS With Auto Print Off

1. Turn off the existing "自动打印小票" switch.
2. Add at least one product.
3. Complete sale.
4. Confirm sale success modal remains visible.
5. Confirm default focus is on "打印小票".
6. Press Enter.
7. Confirm existing browser print flow opens.
8. Close or complete the print dialog.
9. Confirm Desktop POS returns to continue-sale / new-order state.

Pass condition: no second automatic print switch exists, and Enter prints through the existing receipt flow.

### 6. Desktop POS Multi-Item Sale

1. Add at least two products.
2. Set one line quantity greater than 1.
3. Complete sale with either auto print mode.
4. Print the receipt through the applicable path.
5. Compare printed line totals and grand total against POS success data.

Pass condition: printed item names, quantities, payment method, order number, and total are correct.

### 7. Failure Isolation

1. Complete a sale.
2. Turn off printer or stop adapter service before printing.
3. Trigger printing through auto print or the focused "打印小票" button.
4. Confirm POS shows print failure.
5. Confirm the sale remains completed.
6. Confirm POS can return to continue-sale / new-order state.
7. Confirm next sale can proceed.

Pass condition: print failure does not affect completed sale or next sale.

### 8. Browser Print Fallback

1. Complete sale.
2. Use existing preview/browser print action.
3. Confirm fallback path still exists.

Pass condition: existing browser print has not regressed.

## Evidence To Capture

For FINAL FROZEN review, capture:

- Windows printer settings screenshot.
- Adapter `/health` response.
- Adapter service log for successful print.
- Physical receipt photo for CASH sale.
- Physical receipt photo for multi-item sale.
- Evidence that the existing "自动打印小票" switch was reused.
- Evidence that auto-print-off mode focuses "打印小票" and Enter prints.
- Evidence that print window close returns to continue-sale / new-order state.
- Failure test evidence for adapter stopped or printer offline.
- Confirmation that `/api/cashier/sales` was not modified.
- Confirmation that `lib/cloudPrinter.ts` and `app/api/print/*` were not modified.

## Validation Exit Rule

SV-02 can move to FINAL FROZEN only when the real Xprinter XP-N160II prints from the Windows cashier PC through the local adapter, and all failure isolation cases confirm that sales remain complete even when printing fails.
