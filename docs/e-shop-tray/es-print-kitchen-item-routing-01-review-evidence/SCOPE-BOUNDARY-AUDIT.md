# ES-PRINT-KITCHEN-ITEM-ROUTING-01 Scope Boundary Audit

## Accepted Scope

- Existing `Store.printKitchenTicket` acts as the Network KITCHEN master gate.
- New tenant-level `Product.printKitchenTicket` determines KITCHEN item eligibility and defaults to `true`.
- FRONT always receives the complete immutable sale snapshot.
- SHARED_PRINTER KITCHEN receives only eligible items.
- Store-off or zero eligible items suppresses KITCHEN before request construction/parsing, while the sale and FRONT job remain successful.
- A persistent internal ledger distinguishes legitimate suppression from a true missing KITCHEN role.
- Product OWNER API/UI and three locales expose the minimum flag.
- Existing import writers omit the field so database default and re-import preservation remain in effect.

## Protected Scope

The trusted ACTIVE exception authorizes exactly:

- `app/api/cashier/sales/route.ts`
- `app/cashier/page.tsx`
- `prisma/schema.prisma`
- `prisma/migrations/20260914143000_add_kitchen_item_routing/migration.sql`

Post-sync content hashes match the Founder approval exactly. No authorized path was expanded.

## Frozen Boundaries with Zero Diff

- `NETWORK_SCHEMA = 2`.
- Exact `NetworkSnapshot.items` contract.
- FRONT/KITCHEN endpoint contract.
- SHARED_PRINTER and FRONT_ONLY semantics.
- Tray endpoint/runtime/renderer/transport/claim/lease and Device Onboarding.
- `e-shop-tray/src` frozen implementation.
- FINAL/Freeze governance assets and Scope Guard implementation/configuration.

## Explicit Non-Scope

- Browser/QZ/USB kitchen item filtering.
- BAR/GRILL, multi-station routing, category defaults, or store-product overrides.
- Network printing for offline-sync, member-balance-pay, or `app/api/sales`.
- Feature push/merge, Preview/Production deploy, Production migration/backfill, FIELD, Freeze, or Closure.

## Scope Guard Result

The complete implementation/test candidate file list passes `check-change-scope.js` with task ID `ES-PRINT-KITCHEN-ITEM-ROUTING-01` and the trusted ACTIVE exact-byte exception.
