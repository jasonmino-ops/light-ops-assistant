# Repository / Data Flow

Next15 App Router + Prisma7 / pg adapter. Existing customer/e-Life store cards lead to /menu. Store.code resolves active store/tenant. lib/public-menu-data.ts loads all ACTIVE tenant products in stable200-row keyset batches and existing category query, maps existing DTO. Both public/menu and public/electronic-menu reuse it; H5 adds contact/marketing data and client filters/searches the complete array. No authenticated merchant API called from public route. No shared Prisma singleton/auth/order code changed.

Only production source changed: lib/public-menu-data.ts. Both real public handlers are tested with injected Prisma delegates; UI regression APIs/transactions are synthetic and blocked from external origins. Root query scope continues to derive tenant from store code, never caller-provided tenant headers.
