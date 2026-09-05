# E-Shop Tray 0.1.3

Tray 0.1.3 is the Windows runtime consumer for the ES-TRAY-02 Production Relay.
It reuses the existing Desktop ComputerBinding identity and the fixed Windows
queue `前台`. The Windows RAW transport and `Write-RawPrint.ps1` remain the
printing boundary.

Reliability additions in 0.1.3 are limited to claim leases, mark-executing,
terminal result acknowledgement, and a durable encrypted local execution
journal. `SUCCEEDED` means Winspool accepted the command bytes. It does not
claim physical paper completion.

Required runtime configuration:

- `ES_TRAY_02_CLOUD_URL`: HTTPS origin only (localhost HTTP is accepted for tests).
- Existing E-Shop Desktop ComputerBinding identity under `%APPDATA%\E-Shop 店小二\identity.json`.

The package opens no listening port and creates no firewall rule.
