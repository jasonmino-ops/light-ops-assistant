# Beta V1.1 Real Store Trial Data Safety Plan

> Scope: data protection for the Beta V1.1 real-store trial. This plan contains
> procedures, checklists, and command templates only. It does not include real
> secrets, database dumps, or business-code changes.

---

## 1. Data Safety Goal

Protect the trial merchant's live operating data while keeping recovery simple:

- Preserve tenant, store, user, product, order, sales, payment, coupon, campaign,
  and ops admin data.
- Keep Supabase Storage files restorable alongside database rows.
- Make backup checks repeatable without exposing secrets.
- Prevent unsafe production operations such as destructive SQL or database
  rollback without fresh backup and human approval.
- Support monthly recovery drills in an isolated temporary environment.

---

## 2. Data Classification

| Level | Meaning | Examples | Recovery target |
|-------|---------|----------|-----------------|
| P0 | Core live business data. Loss blocks trial or damages settlement/security. | Tenant, Store, User, Product, SaleRecord, CustomerOrder, BindToken, OpsAdmin | Must be backed up and restorable |
| P1 | Important operational data. Loss hurts operations but may not stop same-day selling. | PaymentIntent, MerchantPaymentConfig, CampaignLink, StoreCustomerContact, OperationLog | Back up with P0 when possible |
| Rebuildable | Derived, temporary, cached, or re-creatable data. | Daily summaries, import sessions, localStorage cache, computed dashboard state | Recompute or recreate after restore |

Sensitive data includes Telegram IDs, phone numbers, delivery addresses, customer
names, KHQR images/config, service-role keys, bot tokens, and production DB URLs.
Do not paste these into chat tools or commit them to Git.

---

## 3. P0 Critical Tables

| Table | Why important | Impact if lost | Rebuildable |
|-------|---------------|----------------|-------------|
| `Tenant` | Top-level account boundary and tenant ownership | All tenant-scoped data becomes orphaned or inaccessible | No |
| `Store` | Store code, status, menu entry, banner/config, tenant relation | Customer QR and merchant store scope break | No |
| `User` | Owner/staff identity, Telegram binding, role baseline | Merchant cannot enter or role is lost | Partially, but unsafe |
| `UserStoreRole` | Store-level role and permission mapping | Staff/owner access may cross or disappear | Partially, with manual audit |
| `Product` | Product catalog, prices, barcodes, image references | Sales/menu/product management break | Partially, but costly |
| `SaleRecord` | POS sales/refunds audit ledger | Settlement and records become wrong | No |
| `CustomerOrder` | H5 customer order ledger and delivery/payment state | Customer orders and `/records` linkage lost | No |
| `Customer` | Customer/member data if present in production | Customer asset/history features degrade | Partially, only from external records |
| `BindToken` | Owner/staff invite tokens and role/store binding | Existing bind links fail or bind audit is lost | Yes, active tokens can be regenerated |
| `MarketingProductPage` | Product landing page image/material source for `/menu` lightbox and campaigns | Marketing image preview/campaign pages degrade | Partially, from product data and media |
| `CouponTemplate` | Coupon rules and campaigns | Coupon issuance/validation loses rule source | Partially, with manual reconstruction |
| `CustomerCoupon` | Issued coupon ownership/status | Customer benefits become inaccurate | No for already issued coupons |
| `OpsAdmin` | Ops login, Telegram ops identity, admin lock state | Ops backend may be inaccessible or insecure | Partially, with controlled reseed |

Note: `Customer` is included as a P0 planning item because it is part of the
trial data model even if the current Prisma schema primarily uses
`StoreCustomerContact` and coupon/contact tables for customer identity.

---

## 4. P1 Important Tables

- `PaymentIntent`: KHQR/CASH payment state for sale/order payment confirmation.
- `MerchantPaymentConfig`: KHQR image/config, tenant/store payment setup.
- `StoreCustomerContact`: customer Telegram binding to store/order.
- `CouponRedemption`: coupon usage audit.
- `CouponIssueBatch`: coupon issuance batch audit.
- `CampaignLink`: social/TikTok short-link routing and attribution.
- `Creator`: campaign creator metadata.
- `OperationLog`: audit/debug trail.
- `TelegramMessage`: support/ops/customer message trail.
- `SupportSession`: customer support state.
- `CustomerTouchLog`: merchant customer touch history and throttle audit.
- `ConversationLog`: customer bot conversation history.
- `StoreApplication`: merchant application/approval intake.
- `ProductCategory`: product category browsing/filtering.

P1 data should be included in weekly full backups. If a P1 restore is complex,
restore P0 first, then repair P1 data from the latest encrypted backup.

---

## 5. Rebuildable Or Derived Data

- `TenantDailySummary` and `StoreDailySummary`: can be recomputed from
  `SaleRecord` and `CustomerOrder` where the current code uses live summary
  queries for dashboard consistency.
- `ProductImportSession`: temporary import state; can be restarted.
- `KhqrConfigSession`: temporary KHQR upload session; can be restarted.
- Browser `localStorage` / `sessionStorage`: local UI convenience cache only.
- Build artifacts: `.next/`, generated files, route manifests.

Do not prioritize rebuildable data over P0/P1 during an incident.

---

## 6. Supabase Database Backup Strategy

### Daily Check

Every day during trial:

1. Confirm the app can connect to production.
2. Confirm migration state:
   `DATABASE_URL="$DIRECT_URL" npx prisma migrate status`.
3. Confirm recent write activity exists for:
   - `SaleRecord`
   - `CustomerOrder`
   - `Product`
   - `BindToken`
4. Confirm no unexpected pending migration exists.
5. Record result in Obsidian.

### Weekly Backup

Every week, and before any risky operation:

1. Create a local encrypted backup directory outside Git, for example:
   `~/E-Life-Backups/beta-v1.1/YYYY-MM-DD/`.
2. Export schema.
3. Export P0/P1 key table data.
4. Export migration status.
5. Record current Git commit/tag.
6. Record Vercel deployment identifier.
7. Store dumps in encrypted local disk / external encrypted drive / approved
   password-manager attachment.

Never put raw dumps in the repository.

### Before Migration

Before `npm run migrate:prod` or any direct SQL:

1. Take a fresh schema and data backup.
2. Confirm backup file size is non-zero.
3. Confirm migration target and rollback plan.
4. Get human approval.
5. Execute migration with `DIRECT_URL`, not pooler `DATABASE_URL`.
6. Run app smoke checks.

---

## 7. Storage File Backup Strategy

| File type | Table/field reference | Bucket | Separate backup | Reverse lookup |
|-----------|-----------------------|--------|-----------------|----------------|
| Product main image | `Product.imageUrl`, `Product.imageStorageKey` | `product-images` | Yes | `imageStorageKey` stores object key |
| Product 3-image gallery | `Product.imageUrls`, `Product.imageStorageKeys` | `product-images` | Yes | `imageStorageKeys` JSON stores keys |
| Marketing page images | `MarketingProductPage.heroImageUrl`, `detailImage1/2/3`, `reviewImage1/2/3` | `product-images` | Yes | URL path includes tenant/product/page structure |
| Marketing page video | `MarketingProductPage.heroVideoUrl` | `product-images` | Yes | URL path includes tenant/product/page structure |
| Store banner / door image | `Store.bannerUrl`, `Store.bannerData` | DB base64 in current implementation | DB backup covers it | `bannerUrl` points to internal endpoint |
| Delivery address photo | `CustomerOrder.deliveryAddressPhotoUrl`, legacy `deliveryAddressPhotoData` | `order-delivery-photos` for new uploads; old data may be DB base64 | Yes for bucket; DB backup for legacy base64 | Storage URL includes bucket/object path |
| KHQR image | `MerchantPaymentConfig.khqrImageUrl` | DB base64 in current implementation | DB backup covers it | Not a Storage object |
| Imported external image URL | `Product.imageUrl` from import | External URL, not controlled bucket | Record DB URL; cannot guarantee external file | Use URL only |

Storage buckets to back up:

- `product-images`
- `order-delivery-photos`

Backup Storage separately because `pg_dump` does not export object files.

---

## 8. Daily Check SOP

1. Open production app health entry points:
   - `/home`
   - `/m/{storeCode}`
   - `/menu?code=...`
   - `/ops/login`
2. Run read-only migration status check.
3. Check recent activity counts in Supabase SQL Editor:

```sql
select count(*) from "SaleRecord" where "createdAt" >= now() - interval '1 day';
select count(*) from "CustomerOrder" where "createdAt" >= now() - interval '1 day';
select count(*) from "Product";
select count(*) from "Store" where status = 'ACTIVE';
```

4. Check Storage bucket object counts from Supabase Dashboard:
   - `product-images`
   - `order-delivery-photos`
5. Write a short Obsidian note:
   - date/time
   - migration status
   - recent sales/orders count
   - Storage check result
   - any anomaly

---

## 9. Weekly Backup SOP

1. Create backup directory outside Git:

```bash
mkdir -p ~/E-Life-Backups/beta-v1.1/YYYY-MM-DD
```

2. Use `scripts/backup-db-template.sh` as a command template.
3. Supply `DIRECT_URL` locally from a secure source.
4. Export schema, key table data, migration status, Git state, and deployment
   notes.
5. Download Storage bucket archives from Supabase Dashboard or Supabase CLI.
6. Confirm files exist and are non-empty:

```bash
ls -lh ~/E-Life-Backups/beta-v1.1/YYYY-MM-DD
```

7. Move the backup directory to encrypted storage.
8. Record backup path and checksum/size summary in Obsidian, not the data itself.

---

## 10. Monthly Recovery Drill SOP

Goal: prove that backups can restore into a temporary environment without
touching production.

1. Create a temporary Supabase project or isolated local PostgreSQL database.
2. Use a clearly named temporary database, for example:
   `elife_restore_drill_YYYYMM`.
3. Import schema:

```bash
psql "$TEMP_RESTORE_DATABASE_URL" -f schema.sql
```

4. Import a small approved sample or key-table dump:

```bash
psql "$TEMP_RESTORE_DATABASE_URL" -f key-tables.sql
```

5. Restore a small Storage sample into temporary buckets:
   - `product-images`
   - `order-delivery-photos`
6. Point a local `.env.restore-drill` to the temporary database only.
7. Run:

```bash
npx prisma generate
npm run build
```

8. Validate:
   - Prisma can query P0 tables.
   - `Product.imageUrls` / `imageStorageKeys` columns exist.
   - A product image path resolves in the temporary Storage project.
   - `/menu` can read a sample store/product in local restore mode if used.
9. Confirm production was not touched by checking production row counts did not
   change during drill.
10. Destroy the temporary Supabase project/database and temporary Storage
    buckets after the drill.
11. Record drill result in Obsidian.

---

## 11. Human Confirmation Before Data Recovery

Before any production data restore or repair:

1. Classify severity: P0, P1, or P2.
2. Identify affected table(s), tenant(s), store(s), and time range.
3. Take a fresh pre-recovery backup.
4. Confirm backup location and file sizes.
5. Decide restore type:
   - no DB action
   - targeted row repair
   - Storage object restore
   - full DB restore
6. Get explicit owner approval.
7. Run the smallest possible restore.
8. Verify `/records`, `/dashboard`, `/menu`, `/sale`, and `/ops` where relevant.
9. Record exact commands and result in Obsidian.

Default decision: code rollback first, database recovery only if live data is
actually damaged.

---

## 12. Forbidden Operations

Never:

- Commit real `.env` files to Git.
- Commit real database dumps to Git.
- Send service-role keys, bot tokens, DB URLs, or `.env` screenshots to chat
  tools.
- Run destructive SQL directly on production without backup and approval.
- Run `prisma migrate reset` on production.
- Execute migration before taking a fresh backup.
- Roll back database before confirming impact on new live orders/sales.
- Use test scripts to clear production data.
- Delete Storage buckets without verified backup.
- Force-move the frozen tag `beta-v1.1-real-store-trial`.

---

## 13. Incident Severity And Handling

### P0: Blocking Or Data-Risk Incident

Examples:

- Cannot enter system.
- Cannot bind.
- Customer QR cannot open.
- Cannot order or sell.
- `/records` amount/source is wrong.
- Tenant/store/role/bot data crosses boundaries.
- Production data was deleted or corrupted.

Handling:

1. Stop feature work.
2. Preserve evidence and current commit/deployment.
3. Use code rollback if deployment regression is likely.
4. Take fresh DB backup before any data action.
5. Apply minimal fix or targeted recovery only.

### P1: High Impact But Not Blocking

Examples:

- Khmer display impacts use.
- Images do not display but ordering works.
- Dashboard is delayed but `/records` is correct.
- One non-critical Storage object is missing.

Handling:

1. Decide whether it blocks the live trial.
2. If not blocking, queue after trial.
3. If blocking a real operator, fix minimally.

### P2: Non-Core Issue

Examples:

- UI spacing.
- Copy details.
- Non-core page polish.
- Optional report mismatch that does not affect settlement.

Handling:

1. Record.
2. Do not change during freeze unless explicitly approved.

---

## 14. Related Files

- Freeze document:
  `docs/freezes/BETA_V1_1_REAL_STORE_TRIAL_FREEZE.md`
- Disaster recovery guide:
  `docs/freezes/BETA_V1_1_REAL_STORE_TRIAL_DISASTER_RECOVERY.md`
- Rollback SOP:
  `docs/freezes/ROLLBACK_TO_FREEZE_SOP.md`
- Backup command template:
  `scripts/backup-db-template.sh`
- Prisma schema:
  `prisma/schema.prisma`
- Product image gallery migration:
  `prisma/migrations/20260611000000_add_product_image_gallery/migration.sql`

---

**Plan owner:** jasonmino  
**Plan date:** 2026-06-11  
**Version:** Beta V1.1 Real Store Trial
