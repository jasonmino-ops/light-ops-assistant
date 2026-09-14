# ES-PRINT-KITCHEN-ITEM-ROUTING-01 Commit Scope Audit

## Git Lineage

- Feature branch: `codex/es-print-kitchen-item-routing-01`.
- Pre-registration base: `f89384e60f967423ac0739bd7711e7106fdd789b`.
- Governance registration commit / synchronized HEAD: `942fb4b84ca0dba8e484833c528600a39a03178c`.
- Trusted `origin/main`: `942fb4b84ca0dba8e484833c528600a39a03178c`.
- Feature commit: NONE.
- Feature push: NONE.

## Implementation and UI Files

- `app/api/cashier/sales/route.ts`
- `app/api/network-print/jobs/route.ts`
- `app/api/products/[id]/route.ts`
- `app/api/products/photo-recognize-draft/route.ts`
- `app/api/products/route.ts`
- `app/cashier/page.tsx`
- `app/network-print/jobs/page.tsx`
- `app/products/page.tsx`
- `lib/es-tray-relay/cashier-network-confirmation.ts`
- `lib/es-tray-relay/cashier-network-producer.ts`
- `lib/i18n/en.ts`
- `lib/i18n/km.ts`
- `lib/i18n/zh.ts`

## Database Files

- `prisma/schema.prisma`
- `prisma/migrations/20260914143000_add_kitchen_item_routing/migration.sql`

The migration is a repository candidate under `MIGRATIONS.md`. No `migrate:prod`, Production DDL, backfill, or database write occurred.

## Tests and Test Manifest

- `scripts/test/manifests/root-core-tests.json`
- `tests/cashier-network-print-v01.test.ts`
- `tests/cashier-network-confirmation.test.ts`
- `tests/es-tray-device-print-contract.test.ts`
- `tests/network-print-jobs-api.test.ts`
- `tests/product-recommendation-v01.test.ts`

The device contract test changes only the latest approved Cashier content hash and explanatory comment. The observability test includes one type-only declaration fix found by root TypeScript checking.

## Durable Evidence

- `docs/e-shop-tray/es-print-kitchen-item-routing-01-review-evidence/`

## Excluded Generated Changes

`tsconfig.tsbuildinfo` was modified by an initial incremental TypeScript command and restored to HEAD. It is not part of the candidate.

No unrelated user changes were overwritten or included.
