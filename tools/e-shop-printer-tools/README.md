# E-Shop Printer Tools — P0

Independent, isolated printer configuration tooling for the future Windows executable `E-Shop-Printer-Tools.exe`.

P0 is a TypeScript core plus a read-only diagnostic CLI. It does not modify the existing Printing Core, ESC/POS Core, Browser POS, QZ, Desktop Runtime, E-Shop V1 Setup, or production paths. It also does not redistribute or load the supplied vendor binaries.

## Frozen product roles

- `FRONT`: USB identity, then an idempotent Windows queue named `前台`.
- `KITCHEN`: LAN discovery first, network provisioning plan, RAW TCP 9100, then an idempotent Windows queue named `厨房`.
- Temporary USB recovery is a later capability and is not implemented in P0.

Every discovered device uses one common model:

```ts
{
  manufacturer,
  model,
  mac,
  ip,
  port,
  transport,
  capabilities,
  rawData,
  metadata
}
```

Unknown values stay `null`; RP331A manufacturer/model are never inferred from an MP4200FOUND packet because that packet has no such fields.

## P0 safety gates

- Network state is read from the target Windows machine at runtime; no store IP, mask, or gateway is hardcoded.
- A provisioning plan requires an explicit fingerprint match for the selected device.
- A new kitchen address is blocked until the conflict detector reports it available.
- TCP 9100 verification sends zero bytes.
- `MP4200SAVE` can be built and unit-tested but is not exposed through the CLI and is never transmitted by P0.
- Queue commands are generated only after the plan gates pass and reuse/repair existing state idempotently.
- Missing-driver automation remains blocked until RP331A driver compatibility and a safe driver-only installation path are field verified.

## Diagnostic CLI

```bash
npm install
npm run check
npm run cli -- --help
```

Available commands inspect Windows networking, USB PnP devices, and installed drivers; scan with exact `MP4200FIND`; decode captured `MP4200FOUND`; and perform a connect-only TCP 9100 probe. No CLI command writes printer configuration or changes a queue.

## Evidence documents

- [Static audit](docs/STATIC-AUDIT.md)
- [Windows EXE feasibility](docs/WINDOWS-EXE-FEASIBILITY.md)
- [Windows golden-machine verification](docs/WINDOWS-FIELD-VERIFICATION.md)
- [P0 report](docs/P0-REPORT.md)

Evidence labels are strict:

- `STATIC CONFIRMED`: supported by supplied files, binary metadata, strings, imports/exports, or recovered code paths.
- `TEST VERIFIED`: exercised by deterministic fixture/unit tests only.
- `FIELD VERIFIED`: requires real execution on the Windows golden machine with the actual RP331A hardware. P0 contains no field-verified claims.
