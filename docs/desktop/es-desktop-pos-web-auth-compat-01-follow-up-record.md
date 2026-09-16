# ES-DESKTOP-POS-WEB-AUTH-COMPAT-01 — Follow-up Record

## Status

- Classification: `EXTERNAL WEB COMPATIBILITY BLOCKER`
- Relationship to P1A: `OUT OF P1A IMPLEMENTATION SCOPE`
- Implementation: `NOT STARTED`
- Required Before: `P3-B Desktop Pilot`
- Founder Decision Date: `2026-09-16`

## Observed Compatibility Gap

The new Desktop can validly restore its Activation credential, verified device/store identity, correct store-scoped `/desktop/pos` route, Windows auto-start, and P1A fullscreen behavior while the embedded Web POS lacks an existing Browser POS business-authorization session.

This does not invalidate P1A Fullscreen Foundation environment behavior. Desktop Activation / device identity and Browser POS authorization remain separate identity layers in the current product.

## Authorized Future Goal

Allow `/desktop/pos` to reuse the existing Browser POS device-authorization flow on first use.

Expected minimal future scope:

- `app/cashier/page.tsx`
- focused tests
- hash-bound Scope Guard exception
- necessary governance evidence

Expected invariants:

- New API: `NO`
- Schema: `NO`
- Migration: `NO`
- Desktop IPC: `NO`
- New authorization architecture: `NO`

## Current Task Boundary

This record creates no implementation authorization. It does not change Web, cashier, API, schema, Desktop, credentials, Production, RC9, Printing, Provider/HRT, or P1B. A separate Founder decision is required before implementation.
