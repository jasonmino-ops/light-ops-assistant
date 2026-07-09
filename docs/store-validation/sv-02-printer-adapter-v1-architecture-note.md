# SV-02 Printer Adapter V1 Architecture Note

## Status

Draft for Store Validation Era.

SV-02 validates the hardware access pattern for a local USB thermal printer. It does not redesign POS checkout, cloud print, order creation, payment recording, or receipt business truth.

## Device Target

- Printer: Xprinter XP-N160II
- Paper: 80mm thermal receipt
- Interface: USB
- Host: Windows all-in-one cashier PC
- Driver path: Windows printer driver and Windows Print Spooler

## Target Architecture

```text
Desktop POS
  -> Receipt Renderer
  -> Local Printer Adapter Client
  -> Windows Local Adapter Service
  -> Windows Print Spooler / Xprinter Driver
  -> Xprinter XP-N160II USB
```

## Core Boundary

Printer Adapter V1 is a hardware adapter, not a sales feature.

The POS sale is complete when the existing cashier sale flow returns success and writes the existing SaleRecord / PaymentIntent data. Printer Adapter V1 starts after that point, using a receipt snapshot already available to the desktop UI.

Printing must remain a non-blocking side effect. If printing fails, the sale remains completed.

## Receipt Renderer Boundary

Receipt Renderer owns receipt presentation only.

It may transform a stable receipt payload into:

- 80mm HTML for preview and browser print.
- Plain text or print-ready markup for the local adapter.
- Future ESC/POS-ready commands if V2 requires direct command output.

Receipt Renderer must not:

- Create sales.
- Update SaleRecord.
- Update PaymentIntent.
- Call checkout APIs.
- Decide payment status.
- Retry or cancel sales.
- Depend on cloud printer credentials.

The renderer input should be a receipt snapshot such as:

```text
storeName
orderNo
createdAt
cashierName
paymentMethod
totalAmount
items
```

## Desktop POS Boundary

Desktop POS owns user workflow and receipt trigger timing.

For V1, Desktop POS must reuse the existing left-side "自动打印小票" switch. It must not add a second automatic print setting.

When the switch is on, Desktop POS may automatically trigger the existing browser receipt print flow after sale success, then return to the continue-sale / new-order state after the print window closes.

When the switch is off, Desktop POS keeps the sale success modal. The default focus should land on the existing "打印小票" button so the cashier can press Enter to print. After the print window closes, Desktop POS should return to the continue-sale / new-order state.

In both modes, Desktop POS should pass only the sale-success receipt snapshot to the print path. The sale has already been written before printing starts.

Desktop POS must not:

- Talk directly to USB.
- Require printing before sale completion.
- Put print status inside sales submission.
- Block the continue-sale / new-order action when print fails or the user cancels printing.
- Reuse SW-AIOT cloud print endpoints or names.

## Local Printer Adapter Client Responsibility

Local Printer Adapter Client is the browser-side bridge between Desktop POS and the Windows local service.

Responsibilities:

- Check whether the local adapter is reachable on loopback, for example `http://127.0.0.1:<port>/health`.
- Send a normalized receipt payload to the adapter service.
- Return a simple result to the UI: success, adapter offline, printer unavailable, driver error, or timeout.
- Keep timeouts short enough that the cashier can continue work.
- Never mutate POS business data.

Non-responsibilities:

- No database writes.
- No cloud print calls.
- No SaleRecord lookup as the source of truth.
- No payment validation.
- No automatic retry loops that can duplicate receipts without operator awareness.

## Windows Local Adapter Service Responsibility

Windows Local Adapter Service owns local hardware access.

Responsibilities:

- Run on the Windows cashier PC.
- Listen only on loopback by default.
- Receive receipt payloads from Desktop POS.
- Render or transform the payload into a Windows-printable document.
- Submit the job to Windows Print Spooler using the installed Xprinter XP-N160II printer driver.
- Return adapter-level diagnostics to the browser.
- Provide `/health` and `/print-test` endpoints for real device validation.

Non-responsibilities:

- No access to production database credentials.
- No Telegram auth.
- No cloud print provider integration.
- No SW-AIOT token, device id, or API usage.
- No authority to mark orders paid or completed.

## Why Not Put Printing Directly In `cashier/page.tsx`

`/desktop/pos` currently reuses `/cashier/page.tsx`. Adding low-level printer logic directly there would couple the stable cashier UI to Windows-specific hardware behavior.

That would increase risk in a frozen store-validation phase because `/cashier` also carries:

- Desktop POS checkout.
- Customer order handling panel.
- Offline order save and sync controls.
- Member balance payment entry.
- Browser receipt preview and print.
- Shift and day-close reports.

Printer Adapter V1 should be isolated behind a small client boundary. The page should only trigger the adapter and display the result.

## Why Not Modify `/api/cashier/sales`

`/api/cashier/sales` is the current desktop cashier write path for SaleRecord and PaymentIntent.

Printer Adapter V1 must not modify it because:

- Printing is not business truth.
- Print failure must not fail a sale.
- Hardware availability varies by Windows host, USB state, printer driver, and local service state.
- Server-side Next.js API routes cannot directly access the cashier PC USB printer.
- Adding print side effects inside the sales transaction would create a fragile coupling between settlement data and local hardware.

The correct boundary is after sales success, using the returned order number and front-end receipt snapshot.

## Existing Auto Print Switch

V1 must include the existing Desktop POS "自动打印小票" switch. It must not introduce another automatic print toggle.

When automatic receipt print is enabled:

- Sale completes first.
- Existing browser print flow is triggered after sale success.
- Print failure or user cancellation does not roll back the sale.
- After the print window closes, Desktop POS returns to continue sale / new order state.

When automatic receipt print is disabled:

- Sale success modal remains visible.
- Existing "预览小票", "打印小票", and "继续收银" actions remain available.
- Default focus lands on "打印小票".
- Pressing Enter prints the receipt.
- After the print window closes, Desktop POS returns to continue sale / new order state.

This keeps the existing cashier habit intact while avoiding a second setting that would confuse store operators.

## Relationship To Existing Browser Print

Existing browser print remains useful as a fallback and preview path.

Printer Adapter V1 does not remove:

- 80mm receipt preview.
- Browser `window.print()`.
- Shift report print.
- Day-close report print.

V1 adds a separate local hardware path for the Windows cashier machine.

## Relationship To Existing Cloud Print

Printer Adapter V1 is separate from SW-AIOT cloud print.

Existing cloud print code should remain untouched during V1:

- `lib/cloudPrinter.ts`
- `app/api/print/*`
- dashboard cloud printer panel
- customer H5 auto cloud print path

Printer Adapter V1 must use local naming such as `localPrinterAdapter`, `windowsPrinterAdapter`, or `printerAdapterClient`, not `cloudPrinter`.

## Final Architectural Judgment

Printer Adapter V1 is feasible without invading POS business flow.

The safest V1 shape is:

1. Extract or reuse receipt rendering.
2. Add a local adapter client boundary.
3. Run a Windows local adapter service.
4. Reuse the existing "自动打印小票" switch and existing receipt actions.
5. Validate against Xprinter XP-N160II on the real Windows cashier PC.
