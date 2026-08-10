# ECCP Printing Capability V1.1 Governance Index

| Field | Value |
| --- | --- |
| Repository role | **CONTROLLED MIRROR / INDEX / CROSS-REFERENCE** |
| Capability authority | **E-Life Knowledge Base / Obsidian Vault** |
| Capability version | V1.1 |
| Governance status | FINAL FROZEN authority indexed |
| Synchronization date | 2026-08-11 |

> [!IMPORTANT]
> This repository is not an independent Printing Architecture authority. If a repository document, implementation name, or historical record conflicts with the canonical Vault documents below, the Vault V1.1 classification governs. Historical facts and evidence remain unchanged.

## Canonical Vault Documents

| Document ID | Version | Status | Canonical Vault path |
| --- | --- | --- | --- |
| `ECCP-PRINT-BASELINE-1.1` | V1.1 | FINAL FROZEN | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/03-冻结文档/01-正式冻结/ECCP Printing Capability Baseline V1.1 FINAL FROZEN.md` |
| `ECCP-PRINT-CONTRACT-1.1` | V1.1 | FINAL FROZEN | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/03-冻结文档/01-正式冻结/ECCP Printing Capability Contract V1.1 FINAL FROZEN.md` |
| `ECCP-PRINT-EVOLUTION-CONST-1.1` | V1.1 | FINAL FROZEN | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/03-冻结文档/01-正式冻结/ECCP Printing Evolution Constitution V1.1 FINAL FROZEN.md` |
| `ECCP-PRINT-CROSSWALK-1.0-TO-1.1` | V1.1 | FINAL FROZEN | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/03-冻结文档/01-正式冻结/Printing Capability V1.0 to V1.1 Supersession Crosswalk FINAL FROZEN.md` |
| `EP-LAN-PRINT-02-MOBILE-PROOF-CLOSEOUT-001` | V1.0 | FIELD VERIFIED / CLOSED | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/LAN Printing/EP-LAN-PRINT-02 Mobile LAN Printing Capability Proof Final Closeout.md` |
| `ECCP-PRINT-EVIDENCE-GAP-1.1` | V1.1 | OPEN LOCATION GAP | `/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/ECCP/2026-08-11 ECCP Printing Evidence Asset Gap Record V1.1.md` |

## Capability Boundary

```text
Printing Core + Printing Profile
        ↓
Print Command Stream
════════════════════════════════ Capability Boundary
        ↓
Transport Adapter
        ↓
Delivery Result
```

- QZ: Transport Adapter; its signing/certificate/trust chain is a security contract.
- Windows Queue: Transport / Transport Infrastructure.
- LAN RAW TCP: Transport Adapter.
- USB, Bluetooth, Serial, IPP, AirPrint, Mobile Transport, Cloud Print, WebUSB, WebBluetooth, Native SDK, Device Gateway and AI-controlled Delivery: Transport Adapter or Runtime Consumer by default.
- Business variation belongs to Printing Profile; transport has no business semantics.

## Source-to-Capability Map

This is a V1.1 governance classification map. It does not assert that every legacy source file is already physically separated according to the V1.1 boundary.

| Repository source / concern | V1.1 classification | Governance note |
| --- | --- | --- |
| `app/components/DesktopReceipt.tsx` | Printing Core + Receipt Profile | Document/receipt markup, layout, language and print semantics. |
| `app/components/KitchenTicket.tsx` | Printing Core + Kitchen Profile | Kitchen document semantics, layout and language. |
| `app/components/ShiftReportPrint.tsx` | Printing Core + Report Profile | Report document/layout and browser rendering. |
| `app/components/DayCloseReport.tsx` | Printing Core + Report Profile | Report document/layout and browser rendering. |
| `lib/qzHtmlBitmapRenderer.ts` | Printing Core | Bitmap rendering/image composition; platform-independent responsibility. |
| `lib/qzEscPosBitImage.ts` | Printing Core | ESC/POS encoding and Print Command Stream construction. |
| `lib/qzPrinterAdapter.ts` | QZ Transport Adapter + associated security contract | QZ delivery belongs to Adapter. Existing renderer invocation within this file is recorded as boundary debt; V1.1 does not reclassify rendering as Adapter work. |
| `lib/cloudPrinter.ts` | Cloud Transport Adapter; embedded receipt/profile work is legacy boundary debt | Cloud delivery is Adapter work. Existing receipt composition/formatting in the same module remains implementation debt and is not adopted by V1.1. |
| QZ certificate/signing endpoints and KMS trust chain | Adapter security contract / infrastructure | Preserve all verified certificate, signing and trust evidence. |
| Windows Queue, driver, port, setup and discovery | Transport / Transport Infrastructure | These concerns do not define Printing Core or Printing Profile. |
| `desktop/src/main/hrt/commandRuntime.ts` and Command Runtime contract | Runtime Consumer / generic dispatch boundary | Runtime dispatch remains generic; it does not own Printing business semantics. |

## Evidence Pyramid

| Evidence layer | Record | V1.1 meaning | Historical status |
| --- | --- | --- | --- |
| Production Printing | QZ / Windows Queue FIELD VERIFIED records | Production continuity | KEEP AS EVIDENCE |
| LAN Foundation | EP-LAN-PRINT-01 RAW TCP FIELD VERIFIED | Transport independence | KEEP AS EVIDENCE |
| Mobile LAN | EP-LAN-PRINT-02 iPhone RAW TCP 9100 FIELD VERIFIED | Runtime independence; Mobile Runtime Consumer + LAN RAW Adapter | KEEP AS EVIDENCE |

EP-LAN-PRINT-02 verified Receipt, Chinese, English, Khmer, Feed and Cut. QZ and Windows Queue were not used. Production was not modified and no production deployment occurred.

## Evidence Asset Gap

`tools/lan-print-poc/` was not locatable during V1.1 synchronization.

- Evidence Record: **VALID**
- Evidence Asset Location: **UNKNOWN**
- Action: preserve the FIELD VERIFIED record; do not recreate, infer or fabricate the missing asset or path.

## Historical Evidence Rule

V1.1 changes capability classification only. It does not change FIELD VERIFIED status, commit hashes, deployment IDs, CI results, printer IPs, queues, drivers, certificates, KMS/trust-chain facts, device evidence, receipt/kitchen evidence, language evidence, feed or cut evidence.
