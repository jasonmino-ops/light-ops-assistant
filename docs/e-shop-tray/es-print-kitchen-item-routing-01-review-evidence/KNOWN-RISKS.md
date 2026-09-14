# ES-PRINT-KITCHEN-ITEM-ROUTING-01 Known Risks

## Production Store Compatibility

Historical Network KITCHEN behavior did not read `Store.printKitchenTicket`, whose existing default is `false`. Production stores with proven SHARED/KITCHEN history must be audited and, if authorized, backfilled before the new gate is enabled in Production. Current production data state is UNKNOWN.

## Migration Ordering

The new application reads two added columns. Production rollout must follow repository `MIGRATIONS.md`: execute and verify the Prisma migration before deploying the new application. Production `migrate:prod` is not authorized by this package.

## Same Field Name at Different Scopes

`Store.printKitchenTicket` is a store-level master gate; `Product.printKitchenTicket` is a tenant-wide product eligibility flag. Callers and future maintainers must identify the receiver scope explicitly.

## Tenant-Wide Product Eligibility

Changing one Product flag affects every Store in the same tenant. This is the explicitly accepted V0.1 model; store-product override is out of scope.

## Defensive Routing Conflict

`NETWORK_KITCHEN_ROUTING_CONFLICT` is a fail-closed defensive branch for an idempotent retry whose persisted suppression decision differs. Normal application flow should rarely reach it; the behavior is retained and tested.

## Suppression Ledger Integrity

The ledger is stored outside the frozen payload and request hash to preserve schema 2. Same-transaction writes and retry checks protect normal application paths, but direct database tampering could misclassify an order.

## Observability Scan Bound

The jobs page retains the existing 5000-row scan cap and reports `truncated`. A high-volume range may not enumerate every anomaly.

## Legacy Paths

Browser/QZ/USB `kitchenTicket` behavior is unchanged and does not receive Product-level filtering in this task.

## ROOT CORE Pre-Commit Ordering

`tests/cashier-realtime-integration.test.ts` asserts that `git diff HEAD` contains only a historical task allowlist. It therefore fails every unrelated uncommitted feature candidate. Modifying that test or faking Git state is prohibited. Founder instruction currently permits the local feature commit only after all gates pass, so this creates a real sequencing blocker pending independent review/Founder disposition.

## Pending External Evidence

No feature CI, Preview, Production migration/deploy, production data audit, or FIELD verification exists. No claim of Acceptance, FIELD VERIFIED, Freeze, or Closure is made.
