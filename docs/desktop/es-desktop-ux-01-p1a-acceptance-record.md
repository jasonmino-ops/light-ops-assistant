# ES-DESKTOP-UX-01 P1A — Fullscreen Foundation Acceptance Record

## Document Identity

- Task: `ES-DESKTOP-UX-01 / P1A — Fullscreen Foundation`
- Status: `ACCEPTED`
- Acceptance Date: `2026-09-16`
- Exact Accepted Candidate: `65eb082e19683658ceda29254d5454a920bb208d`
- Historical Fullscreen Candidate: `9753a3ab76be072bbd6582608048268bfec66aeb`
- Candidate Base: `origin/main@5de2b3932981a988d5185e2a1ee4b83e3e0c35fa`
- Target Machine: `V727 / PC-20260119FZUI`
- FIELD Record: `docs/store-validation/es-desktop-ux-01-p1a-v727-field-verification-record.md`

## Accepted Scope

P1A accepts only the frozen Fullscreen Foundation outcome and the minimal prerequisites required to execute its real Windows FIELD sequence:

- employee window automatically enters native fullscreen after authorized Desktop startup;
- fullscreen physical bounds never replace the normal-window preference;
- exiting fullscreen restores the saved normal-window size and position;
- process-local temporary automatic-fullscreen opt-out;
- official current-user Windows login auto-start;
- packaged Activation renderer boot compatibility;
- safe installer upgrade lifecycle;
- verified activated store carried into the existing Desktop launch URL.

The accepted implementation preserves one fullscreen owner: Electron main process. Web does not request automatic fullscreen on mount.

## Acceptance Evidence

### Engineering And Governance

- Release Foundation default policy: `PASS` for all 12 frozen groups.
- Scope Guard: `PASS`; no exception required for the P1A/launch-context Desktop paths.
- TypeScript: `PASS`.
- Desktop full suite: `24/24 files`, `176/176 tests`.
- Static security coverage in the full suite: `PASS`.
- Desktop compile and activation asset copy: `PASS`.
- Release Foundation gate strength: unchanged; exact successor snapshots remain fail-closed.
- Fresh-context launch-context independent review: `PASS`, no blocking findings.
- Prior P1A Release Foundation alignment and independent review: `PASS`.

### Real Windows FIELD

- Exact installed Candidate: `65eb082e19683658ceda29254d5454a920bb208d`.
- Founder-confirmed V727 installer SHA-256: `5fb9d37f2a44c316c1957ffb0855b2dba682da4d8103eb5aba11eff495c766ab`.
- Browser fallback: `PASS`.
- Activation and credential persistence: `PASS`.
- Mino Pet Shop / `ST169E7000` restore and exact POS route: `PASS`.
- Login auto-start and cold-start native fullscreen: `PASS`.
- Temporary opt-out: `PASS`.
- Normal bounds persistence and fullscreen-exit restoration: `PASS`.
- One real CASH order with FRONT and KITCHEN physical output through unchanged RC9: `PASS`.

## Explicit Exclusions

- P1B display assignment and swap
- Web POS business-authorization compatibility
- Cashier business behavior
- API, schema, migration, or Cloud business logic
- RC9, Printing Core, Provider/HRT, or printing configuration
- P2 through P8

The Web POS authorization compatibility finding is a separate recorded follow-up, `ES-DESKTOP-POS-WEB-AUTH-COMPAT-01`, and is not merged into P1A.

## Acceptance Decision

- Candidate scope: `PASS`
- FIELD: `PASS`
- Security: `PASS`
- Release Foundation: `PASS`
- Independent Review: `PASS`
- Acceptance: `ACCEPTED`
- Ready for no-fast-forward merge to `main`: `YES`
- Ready for Final Freeze after merge and lineage verification: `YES`
- P1B Started: `NO`
