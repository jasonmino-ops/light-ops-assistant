# SV-02 Printer Adapter V1 Acceptance Criteria

> [!WARNING] SUPERSEDED ARCHITECTURE — KEEP AS HISTORICAL EVIDENCE（2026-08-11）
> 本文原有验收设计过程保留，不再作为当前 Printing Architecture authority。任何允许 Printer Adapter 接收 business payload、执行 render / transform、拥有 Receipt/Kitchen/Layout/Language/Image Composition 或 business semantics 的表述，均被 ECCP Printing Capability V1.1 取代。V1.1 要求 Printing Core / Profile 产生 Print Command Stream，Adapter 只负责 Transport → Printer。当前权威：Canonical Vault `ECCP Printing Capability Baseline V1.1 FINAL FROZEN`；Repository 入口：`docs/governance/printing/PRINTING_CAPABILITY_V1_1_INDEX.md`。

## Status

Draft acceptance criteria for Store Validation Era.

## Architecture Acceptance

SV-02 passes architecture acceptance when:

- Printer Adapter is independent from POS sales write path.
- `/api/cashier/sales` is unchanged.
- No database transaction includes printing.
- No cloud print path is introduced or modified.
- No SW-AIOT names, credentials, endpoints, or APIs are used for local adapter.
- Desktop POS only triggers local print after sale success.
- Print failure cannot roll back, cancel, or block a completed sale.
- Existing "自动打印小票" switch is reused.
- No second automatic print setting is added.

## Receipt Acceptance

Receipt output is acceptable when:

- Receipt uses the sale success snapshot.
- Printed order number matches the POS success modal.
- Store name is present.
- Created time is present.
- Payment method is present.
- Each item name is present.
- Quantity and line amount are present.
- Total amount matches POS.
- 80mm paper layout is readable on Xprinter XP-N160II.

V1 does not require:

- Perfect typography.
- Logo printing.
- QR code printing.
- Kitchen-ticket formatting.
- ESC/POS cut command if Windows driver handles cutting differently.

## Existing Print Control Acceptance

V1 uses the existing Desktop POS print controls.

Accepted behavior when "自动打印小票" is on:

- Sale succeeds first.
- Existing browser print flow opens automatically after sale success.
- Print failure or user cancellation does not roll back the sale.
- Closing the print window returns POS to continue-sale / new-order state.

Accepted behavior when "自动打印小票" is off:

- Sale success modal remains visible.
- Existing "预览小票", "打印小票", and "继续收银" remain available.
- Default focus lands on "打印小票".
- Pressing Enter triggers printing.
- Closing the print window returns POS to continue-sale / new-order state.

Accepted manual fallback:

- Operator can preview receipt.
- Operator can click print receipt.
- Operator can continue sale regardless of print result.
- Existing browser preview and browser print remain available.

Not accepted in V1:

- A second automatic print switch.
- Silent background retry.
- Printing before payment confirmation.
- Printing inside sales API response handling before success state is shown.
- Requiring print success before continuing to the next sale.

## Adapter Client Acceptance

Local Printer Adapter Client is accepted when:

- It talks only to loopback local service.
- It has a health check.
- It has a receipt print request.
- It uses a bounded timeout.
- It returns normalized errors.
- It does not call cloud print APIs.
- It does not write to database.
- It does not import `lib/cloudPrinter.ts`.

## Windows Service Acceptance

Windows Local Adapter Service is accepted when:

- It runs on the Windows cashier PC.
- It listens on `127.0.0.1` by default.
- It exposes `/health`.
- It exposes `/print-test`.
- It exposes `/print-receipt`.
- It can target the installed Xprinter XP-N160II printer.
- It submits print jobs through Windows Print Spooler or the installed Xprinter driver.
- It logs local diagnostic results.

It must not:

- Require Supabase credentials.
- Require Telegram credentials.
- Use SW-AIOT credentials.
- Connect to production APIs for business state.
- Modify order, sale, or payment data.

## Real Hardware Acceptance

SV-02 is accepted only after real hardware validation on:

- Xprinter XP-N160II.
- USB connection.
- Windows all-in-one cashier PC.
- 80mm paper.
- Actual `/desktop/pos` cashier flow.

Simulator-only validation is not enough.

## Failure Isolation Acceptance

The following failures must not affect completed sales:

- Adapter service not running.
- Printer powered off.
- Printer out of paper.
- Windows printer driver unavailable.
- Adapter timeout.
- Manual print request fails.
- User cancels print dialog.
- Auto print fails.

Required result:

- Sale remains completed.
- POS can continue to next sale.
- Error is visible to operator.
- Browser print fallback remains available.

## Regression Guard

SV-02 must not regress:

- `/desktop/pos` scanner pipeline.
- `/cashier` checkout flow.
- `/api/cashier/sales`.
- Offline cashier save path.
- Customer H5 `/menu`.
- Customer short link `/m/[storeCode]`.
- Existing cloud print dashboard.
- Existing SW-AIOT customer order auto print.
- `/records`.

## FINAL FROZEN Passing Conditions

SV-02 Printer Adapter V1 may be marked FINAL FROZEN when all conditions are met:

1. Real Xprinter XP-N160II prints a post-sale receipt from `/desktop/pos`.
2. Receipt content matches POS sale success data.
3. Existing "自动打印小票" switch is reused, with no second automatic print setting.
4. Auto-print-on mode opens existing browser print after sale success and returns to new order after print window close.
5. Auto-print-off mode keeps the success modal, focuses "打印小票", and Enter triggers printing.
6. Print failure or user cancellation does not affect completed sale.
7. Existing browser receipt print still works.
8. `/api/cashier/sales` has no print logic.
9. `lib/cloudPrinter.ts` and `app/api/print/*` are untouched.
10. No Prisma schema or migration change exists.
11. Real device validation evidence is archived.
12. Store operator can complete a second sale after print success, print failure, and user-canceled print.
13. The architecture note, implementation plan, validation plan, acceptance criteria, and no-cloud-print boundary are all archived.
