# SV-02 Printer Adapter V1 No-Cloud-Print Boundary

> [!WARNING] SUPERSEDED ARCHITECTURE — KEEP AS HISTORICAL EVIDENCE（2026-08-11）
> 本文原有边界设计过程保留，不再作为当前 Printing Architecture authority。任何允许 Printer Adapter 接收 business payload、执行 render / transform、拥有 Receipt/Kitchen/Layout/Language/Image Composition 或 business semantics 的表述，均被 ECCP Printing Capability V1.1 取代。V1.1 要求 Printing Core / Profile 产生 Print Command Stream，Adapter 只负责 Transport → Printer。当前权威：Canonical Vault `ECCP Printing Capability Baseline V1.1 FINAL FROZEN`；Repository 入口：`docs/governance/printing/PRINTING_CAPABILITY_V1_1_INDEX.md`。

## Purpose

This document freezes the no-cloud-print boundary for SV-02 Printer Adapter V1.

SV-02 is a local hardware access validation task. It must prove that Desktop POS can reach a Windows-local adapter and print to Xprinter XP-N160II over USB.

It must not become a cloud print task.

## Explicit Boundary

Printer Adapter V1 must not use:

- SW-AIOT token API.
- SW-AIOT print API.
- SW-AIOT bind API.
- SW-AIOT device id.
- SW-AIOT key or secret.
- `lib/cloudPrinter.ts`.
- `app/api/print/test`.
- `app/api/print/status`.
- `app/api/print/bind`.
- `app/api/print/reprint/[orderNo]`.

## Naming Boundary

Do not name local adapter code:

- `cloudPrinter`
- `cloudPrint`
- `swPrinter`
- `swAiotPrinter`
- `printApi`

Preferred names:

- `localPrinterAdapter`
- `windowsPrinterAdapter`
- `localPrinterAdapterClient`
- `windowsLocalPrintService`
- `receiptRenderer`

The naming should make it impossible to confuse local USB printing with cloud printing.

## Existing Cloud Print Ownership

Existing cloud print remains owned by:

- `lib/cloudPrinter.ts`
- `app/api/print/*`
- Dashboard printer panel
- Customer H5 order auto print path

SV-02 V1 must not refactor, rename, or share those files.

## Why Cloud Print Is Out Of Scope

Cloud print is out of scope because the current validation target is:

- USB-attached Xprinter XP-N160II.
- Windows cashier PC.
- Local hardware adapter pattern.
- Store Validation Era hardware reliability.

Cloud print would validate different risks:

- Internet availability.
- Cloud vendor credentials.
- Vendor device binding.
- Vendor API message format.
- Remote print queue behavior.

Those are not the SV-02 target risks.

## Why Local Adapter Must Be Independent

The Scanner Pipeline was validated as an independent hardware input path. Printer Adapter should follow the same principle:

- POS owns business state.
- Adapter owns hardware access.
- Adapter failure is isolated.
- Hardware validation can proceed without changing sales truth.

This keeps the trial store safe while allowing real device learning.

## Forbidden Couplings

SV-02 V1 must not couple local print to:

- SaleRecord creation.
- PaymentIntent creation.
- Prisma transactions.
- CustomerOrder cloud print.
- Dashboard cloud print controls.
- Tenant tier cloud print gate.
- SW-AIOT printer status.

If any of these are required, the task is no longer SV-02 Printer Adapter V1 and must be redesigned.

## Allowed Local Behaviors

SV-02 V1 may:

- Check local adapter health.
- Send a receipt snapshot to `127.0.0.1`.
- Print through Windows Print Spooler.
- Return local error codes.
- Keep local adapter logs.
- Reuse the existing Desktop POS "自动打印小票" switch.
- Keep existing "预览小票", "打印小票", and "继续收银" controls.
- Show print success or failure in Desktop POS without changing sale state.

SV-02 V1 may not:

- Upload receipt data to a third-party printer cloud.
- Store print credentials in the web app.
- Treat cloud printer status as local adapter status.
- Use cloud print logs as acceptance evidence.
- Add a second automatic print switch.
- Route auto print through SW-AIOT.

## FINAL FROZEN Boundary Check

Before SV-02 FINAL FROZEN, confirm:

- No import from `lib/cloudPrinter.ts` exists in local adapter client code.
- No changes were made to `app/api/print/*`.
- No SW-AIOT environment variables are required.
- Real hardware validation used USB printer through Windows local service.
- Printed receipt evidence came from Xprinter XP-N160II connected to the cashier PC.
