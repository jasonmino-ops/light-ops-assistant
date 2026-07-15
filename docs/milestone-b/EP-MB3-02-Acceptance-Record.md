# EP-MB3-02 Acceptance / Freeze Record

## Gate

- Gate conclusion: PASS
- Acceptance: ACCEPTED

## Reviewed Commits

- Desktop reviewed commit: `ab8c10c46bbf2dc51c03d9f67a417437b94a34af`
- Provider reviewed commit: `9db89a32c664382552e4a5bd0bd0e18b36c671f0`

## Main Merge Commits

- Desktop merge commit: `1528253e14ccd825a57d972a6bad9a4e4b495e77`
- Provider merge commit: `b9dbdbf761288c72262fcc93cad81f591a876a78`

## Main CI

- Desktop main CI run: `29439811243`
- Desktop main CI URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29439811243`
- Desktop status: PASS
- Desktop artifact: `eshop-desktop-windows-installer`
- Desktop artifact ID: `8352999790`
- Desktop artifact digest: `sha256:321b01bf0b95123bd3e32162a4afc7bff96339081aa3af40e000ac3efc2eb31c`

- Provider main CI run: `29439811138`
- Provider main CI URL: `https://github.com/jasonmino-ops/eshop-windows-provider/actions/runs/29439811138`
- Provider status: PASS
- Provider artifact: `eshop-windows-provider-bootstrap`
- Provider artifact ID: `8352948464`
- Provider artifact digest: `sha256:df2162db4543dee788a3ba71329e11687bd91e170ff563f4187f66a51dcd17ff`

## Integrity

- Frozen Contract unchanged: yes
- Runtime Contract version: `1.0.0`
- Desktop baseline: `540e0d15408bbb27bb03cc55275fb7f43245c38a`
- Provider baseline: `68a9d63fc5285fdf1e4f4fe892a1fca1015bbed7`

## Scope Exclusions

- Printer Executor: not implemented
- GDI: not implemented
- Raw ESC/POS: not implemented
- Sales printing: not implemented
- Printer config: not implemented
- Other hardware: not implemented
- Windows Service: not implemented
- Runtime Core contract changes: none

## Known Non-Blocking Limitations

- Windows ACL hardening is not claimed; EP-MB3-02 uses session-scoped pipe names, single-client enforcement, and supervisor token validation.
- Installer is unsigned; code signing remains outside EP-MB3-02.

## Final Freeze Tags

- Desktop: `ep-mb3-02-desktop-provider-supervision-v1.0-final`
- Provider: `ep-mb3-02-provider-named-pipe-transport-v1.0-final`
