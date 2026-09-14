# ES-PRINT-KITCHEN-ITEM-ROUTING-01 Repository Overview

Repository worktree: `/Users/jason/.codex/worktrees/e10e/light-ops-assistant`

Feature branch: `codex/es-print-kitchen-item-routing-01`

Current HEAD and trusted `origin/main`: `942fb4b84ca0dba8e484833c528600a39a03178c`

Production commit: `a33b44c1c51223009326c4869526f7de6bd4a89d`

## Responsibility Map

- `app/api/cashier/sales/route.ts`: resolves Store/Product eligibility and supplies full FRONT plus routed KITCHEN items inside the sale transaction.
- `lib/es-tray-relay/cashier-network-producer.ts`: constructs role-specific requests, suppresses empty KITCHEN before parsing, and persists/rechecks the internal ledger.
- `lib/es-tray-relay/cashier-network-confirmation.ts`: fail-closed Cashier interpretation of the enqueue result.
- Product APIs/UI/i18n: OWNER management of the tenant-level eligibility flag.
- Network jobs API/UI: read-only distinction between legitimate suppression and true missing roles.
- Prisma schema/migration: additive Product and print-job ledger columns.
- Tests: routing, transaction, idempotency, confirmation, observability, Product/default/import compatibility, and exact Cashier byte boundary.

## Dependency Direction

Cashier sale reads Store and Product data, writes sale/payment/job state in one Prisma transaction, and calls the server-only Network producer. The producer reuses the frozen Network parser and existing relay service. Tray code consumes unchanged schema 2 role-specific payloads and has no dependency on the new Product or ledger columns.

## Stable Areas Not Modified

- `e-shop-tray/src` Network contract/runtime/renderer/transport.
- Relay endpoint/claim/lease execution behavior.
- Browser/QZ/USB printing implementation.
- Other sale entry points.
- Scope Guard implementation/configuration.
- FINAL and Freeze records.

## Current Lifecycle Position

Implementation and governance registration are complete. The candidate is uncommitted and under final independent pre-commit review. Production Gate, Acceptance, feature merge, FIELD verification, Freeze, and Closure have not begun.
