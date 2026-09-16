# ES-DESKTOP-UX-01 P1A — V727 FIELD Verification Record

## Document Identity

- Task: `ES-DESKTOP-UX-01 / P1A — Fullscreen Foundation`
- Record Type: `FIELD VERIFICATION`
- FIELD Date: `2026-09-16`
- Target Machine: `V727 / PC-20260119FZUI`
- Installed Candidate: `65eb082e19683658ceda29254d5454a920bb208d`
- Installer: `E-Shop-Desktop-Setup-0.2.0-pilot.2.exe`
- Founder-confirmed V727 Installer SHA-256: `5fb9d37f2a44c316c1957ffb0855b2dba682da4d8103eb5aba11eff495c766ab`
- Final FIELD Status: `PASS`

## Frozen P1A Scope Verified

The Founder performed or directly confirmed the following real Windows observations on V727:

| FIELD item | Result |
|---|---|
| Browser `/cashier` fallback, Mino context, products, and basic interaction | `PASS` |
| Browser manual customer-display fallback | `PASS` |
| Installer upgrade lifecycle | `PASS` |
| Packaged Activation renderer boot | `PASS` |
| First real Desktop Activation | `PASS` |
| Activation credential persistence | `PASS` |
| Mino Pet Shop / `ST169E7000` restore | `PASS` |
| Store-scoped Desktop POS route | `PASS` |
| Windows login auto-start | `PASS` |
| Automatic native fullscreen | `PASS` |
| Per-launch temporary opt-out | `PASS` |
| Normal-window bounds persistence | `PASS` |
| Exit-fullscreen normal-bounds restore | `PASS` |
| Windows cold boot/login sequence | `PASS` |
| RC9 printing regression | `PASS` |

The cold-start sequence observed was:

`Windows boot/login → E-Shop Desktop auto-start → Activation credential restore → Mino Pet Shop / ST169E7000 → correct Desktop POS → native fullscreen → exit fullscreen → previously saved normal bounds restored`.

The verified employee route was:

`https://elifekh.com/desktop/pos?storeCode=ST169E7000&lang=zh&mode=pos`

The temporary opt-out used the existing process-local environment capability `ESHOP_DESKTOP_DISABLE_AUTO_FULLSCREEN=1`. No permanent environment value, registry preference, Desktop config, startup entry, AppData, or product code was changed for that observation.

## Printing Regression Evidence

- One real minimal CASH order was created from the installed Desktop on V727.
- Founder physically confirmed both FRONT and KITCHEN tickets for that same order.
- Existing RC9 / Network Add-on configuration and Printing code were not changed.
- The earlier no-output observation was resolved by normally starting the already-installed RC9 Network Add-on.
- Root cause: `RC9 NOT RUNNING`.
- `P1A CAUSED PRINTING REGRESSION = NO`.

This is regression evidence only. It does not expand P1A ownership into RC9, Printing Core, HRT, or Provider work.

## Security And Scope Preservation

- Browser fallback remained available throughout FIELD.
- P1A did not change Web, cashier business logic, API, schema, database, Printing, RC9, Provider/HRT, or Cloud business behavior.
- Electron security boundaries remained unchanged.
- P1B was not started.

## External Compatibility Finding

After the P1A environment checks passed, the Web POS could present a business-authorization warning when no existing Browser POS authorization session was available. Founder classified this as `EXTERNAL WEB COMPATIBILITY BLOCKER`, not a P1A Fullscreen Foundation failure.

The separate follow-up `ES-DESKTOP-POS-WEB-AUTH-COMPAT-01` is recorded but not implemented. No `app/cashier/page.tsx`, authorization, API, schema, Desktop IPC, or credential change is included in this closure.

## Deferred Non-Blocking Findings

- Bundled HRT Provider log reports missing `@eshop/hrt-contract`.
- Exit can log `Object has been destroyed`.

Both findings are `RECORD + DEFER`. Neither invalidated the observed P1A environment behavior, printing regression evidence, or Browser fallback, and neither is fixed in P1A.

## FIELD Decision

- `P1A ENVIRONMENT FIELD = PASS`
- `P1A FIELD VERIFIED = YES`
- Remaining P1A FIELD blocker: `NONE`
