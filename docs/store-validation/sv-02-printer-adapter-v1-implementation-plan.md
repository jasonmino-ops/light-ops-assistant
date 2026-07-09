# SV-02 Printer Adapter V1 Implementation Plan

## Status

Draft plan. Do not implement until explicitly approved.

## Principles

- Do not modify POS sales logic.
- Do not modify `/api/cashier/sales`.
- Do not enter database transactions.
- Do not develop cloud print.
- Do not reuse SW-AIOT cloud print naming.
- Do not add a second automatic print switch.
- Do not block completed sales on print result.
- Treat Printer Adapter like Scanner Pipeline: an independent hardware-access path.

## Phase 0: Baseline Confirmation

Confirm current state before any implementation:

- `/desktop/pos` still renders through `/cashier/page.tsx`.
- `/api/cashier/sales` still completes sales without printing.
- `DesktopReceiptData` is still available after a successful desktop sale.
- Existing browser print remains available.
- Existing cloud print files are unchanged.

Expected result: no code change.

## Phase 1: Receipt Renderer Boundary

Goal: create a reusable receipt rendering boundary without changing sale behavior.

Recommended files:

- Add `lib/receipt/desktop-receipt-types.ts`
- Add `lib/receipt/render-desktop-receipt-html.ts`
- Optionally refactor `app/components/DesktopReceipt.tsx` to import the renderer.

Allowed output formats for V1:

- 80mm HTML.
- Plain text receipt body.

Not required in V1:

- ESC/POS binary command generation.
- Barcode or QR printing.
- Kitchen ticket format.
- Cloud print message format.

Acceptance for this phase:

- Existing browser receipt preview still looks the same.
- Existing browser print still works.
- No sales API changes.

## Phase 2: Local Printer Adapter Client

Goal: add a small browser client that talks only to the Windows local service.

Recommended files:

- Add `lib/printer-adapter/local-printer-adapter-client.ts`

Suggested contract:

```text
health(): Promise<{ ok: boolean; adapterVersion?: string; printerName?: string; error?: string }>
printReceipt(receipt): Promise<{ ok: boolean; jobId?: string; errorCode?: string; message?: string }>
```

Suggested endpoint:

```text
GET  http://127.0.0.1:17802/health
POST http://127.0.0.1:17802/print-receipt
```

Client rules:

- Use short timeout.
- Handle adapter offline gracefully.
- Return normalized error codes.
- Never call `/api/cashier/sales`.
- Never write database state.
- Never call `/api/print/*`.

## Phase 3: Windows Local Adapter Service

Goal: provide a local Windows process that can receive print requests and submit jobs to Windows Print Spooler.

Recommended location:

- `printer-adapter/windows-local-service/`

Possible implementation choices:

- Node.js local service.
- .NET minimal local service.
- Small Windows tray utility in a later version.

V1 service endpoints:

```text
GET /health
POST /print-test
POST /print-receipt
```

Service responsibilities:

- Bind to `127.0.0.1` by default.
- Check configured printer name.
- Accept receipt payloads.
- Produce a Windows-printable document.
- Send to Xprinter XP-N160II through Windows installed printer driver.
- Return job result and diagnostic message.

V1 service should not:

- Store production credentials.
- Connect to Supabase.
- Connect to Telegram.
- Connect to SW-AIOT.
- Modify sales or payment records.

## Phase 4: Desktop POS Existing Print Controls

Goal: reuse existing Desktop POS print controls and the existing left-side "自动打印小票" switch.

Required behavior when "自动打印小票" is on:

- Sale completes through the existing flow first.
- Existing browser receipt print flow triggers automatically after sale success.
- Print failure or user cancellation does not change SaleRecord or PaymentIntent.
- After the print window closes, Desktop POS returns to continue-sale / new-order state.

Required behavior when "自动打印小票" is off:

- Sale success modal remains visible.
- Existing "预览小票", "打印小票", and "继续收银" remain available.
- Default focus lands on "打印小票".
- Pressing Enter triggers printing.
- After the print window closes, Desktop POS returns to continue-sale / new-order state.

Required artificial fallback:

- Keep "预览小票".
- Keep "打印小票".
- Keep "继续收银".

Forbidden:

- Do not add another automatic print setting.
- Do not make print success required for continuing.
- Do not move print logic into the sales API.
- Do not call cloud print.

## Phase 5: Logging For Validation

Goal: support field validation without changing business records.

Allowed logs:

- Browser console during development.
- Local adapter service log on Windows.
- Optional local file log in the adapter service directory.

Avoid:

- OperationLog changes in V1.
- Database schema changes.
- Print status columns on SaleRecord.

Recommended local service log fields:

```text
timestamp
adapterVersion
printerName
orderNo
payloadHash
result
errorCode
message
durationMs
```

## Explicit Non-Goals

- No cloud print.
- No kitchen printing.
- No print queue management in POS.
- No automatic retry.
- No second automatic print switch.
- No database migration.
- No mPOS integration.
- No cash drawer.
- No USB raw driver work inside Next.js.

## Minimal Change Surface

When implementation is approved, preferred code touch points are:

- New receipt renderer files under `lib/receipt/`.
- New local adapter client under `lib/printer-adapter/`.
- New Windows local service under `printer-adapter/`.
- Small UI behavior adjustment in `app/cashier/page.tsx` limited to existing `/desktop/pos` print controls and success modal focus/return behavior.

Files that should remain untouched:

- `app/api/cashier/sales/route.ts`
- `app/api/sales/route.ts`
- `app/api/print/*`
- `lib/cloudPrinter.ts`
- `prisma/schema.prisma`
- `prisma/migrations/*`
