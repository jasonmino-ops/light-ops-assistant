# E-Shop Installer Packaging Phase 1

This directory contains the minimal NSIS wrapper for `E-Shop-V1-Setup.exe`.
It does not implement Runtime capability. It validates and embeds an existing
E-Shop V1 MVP payload, then runs its single PowerShell launcher invisibly via
NSIS `nsExec`.

Build on macOS:

```bash
node tools/e-shop-installer/phase1/build.mjs \
  --payload-dir /path/to/E-Shop-V1-Setup-MVP-064266f \
  --output-dir /path/to/output
```

The build requires NSIS. Set `MAKENSIS_BIN` when it is not available from the
electron-builder cache or the normal Homebrew paths.

Driver payloads remain external. A legally supplied installer may be placed
beside `E-Shop-V1-Setup.exe` under `Drivers/Rongta` or `Drivers/Xprinter`.
The NSIS wrapper copies it into the internal Runtime payload before execution.
