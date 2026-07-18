# EP-MB3-07B1 Deployment Diagnostics & Failure UX Engineering Plan

## Status

Implementation branch: `feat/ep-mb3-07b1-deployment-diagnostics`

Baseline: `15dad1aae9972046258857985469ce13e51349e6`

Scope: implementation only. This document is not an acceptance record, merge record, release record, or freeze record.

## Objective

EP-MB3-07B1 adds local deployment diagnostics for the Windows desktop runtime so a real store can distinguish activation, Cloud page, Provider, display, log, and diagnostics failures without exposing secrets or changing frozen business contracts.

## Approved Architecture

The employee Cloud failure path uses the same employee `BrowserWindow`. When the Cloud business page fails, WindowManager loads a local deployment error renderer in-place. Retry restores the original Cloud business URL in the same window.

Activation failures remain in the activation window and continue to block formal runtime startup.

Customer Cloud failures use the existing customer display window and load a local fallback renderer in-place. The fallback is brand-only and does not expose support codes, store identifiers, installation identifiers, Provider state, logs, or diagnostics actions.

## Implementation Areas

- Shared deployment taxonomy and retry DTOs in `desktop/src/shared/deploymentDiagnostics.ts` and `desktop/src/shared/deploymentRecovery.ts`.
- Runtime health extension inside `desktop/src/main/runtimeHealth.ts`.
- Same-window employee deployment error mode and customer fallback mode in `desktop/src/main/windowManager.ts`.
- Gated deployment IPC in `desktop/src/main/ipcRouter.ts`.
- Support system information and diagnostics bundle export in `desktop/src/main/deploymentSupport.ts`.
- Employee preload fixed-method deployment API in `desktop/src/preload/employeePreload.ts`.
- Local renderer assets under `desktop/src/renderer/deployment-error` and `desktop/src/renderer/customer-fallback`.
- Windows workflow focused deployment diagnostics test step in `.github/workflows/desktop-windows-build.yml`.

## Non-Goals

- No code signing.
- No signed pilot release.
- No electron-updater, update feed, quitAndInstall, rollback, or update IPC.
- No native printer runtime.
- No native scanner runtime.
- No Provider watchdog, auto restart, respawn, or lifecycle strategy change.
- No database, Prisma, payment, cashier, KHQR, mobile, customer H5, or local-first POS change.

## Verification Gates

- `npm run typecheck`
- `npm test`
- `npm run compile`
- `node scripts/verify-activation-assets.mjs dist`
- Windows CI: pending until branch push workflow completes.
