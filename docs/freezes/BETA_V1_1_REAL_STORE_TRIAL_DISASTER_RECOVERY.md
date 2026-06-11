# Beta V1.1 Real Store Trial Disaster Recovery Guide

> This guide pairs with
> `docs/freezes/BETA_V1_1_REAL_STORE_TRIAL_FREEZE.md`.
> It is a recovery runbook for the small real-store trial. It must not contain
> plaintext secrets, exported production data, or feature work.

---

## 1. Disaster Recovery Goal

Keep the Beta V1.1 real-store trial recoverable during live merchant testing:

- Restore a known-good code baseline quickly.
- Identify whether an incident is code, deployment, database, storage, bot, or
  environment related.
- Avoid unsafe database rollback after real orders or sales have been created.
- Keep customer ordering, merchant sales, records, dashboard, binding, and ops
  entry available for real-store trial operations.

---

## 2. Current Frozen Version

| Item | Value |
|------|-------|
| Version name | Beta V1.1 Real Store Trial |
| Freeze document | `docs/freezes/BETA_V1_1_REAL_STORE_TRIAL_FREEZE.md` |
| Freeze docs commit | `f87cd81` |
| Freeze tag | `beta-v1.1-real-store-trial` |
| Branch | `main` |
| Build state at freeze | `npm run build` passed |
| Database change in disaster package | None |
| Business code change in disaster package | None |

The trial baseline should be treated as the rollback target unless a narrower
hotfix has already been validated and tagged.

---

## 3. GitHub Repository And Tag

- Repository: `github.com:jasonmino-ops/light-ops-assistant.git`
- Frozen tag: `beta-v1.1-real-store-trial`
- Fetch frozen version:

```bash
git fetch origin --tags
git checkout beta-v1.1-real-store-trial
```

- Confirm tag target:

```bash
git rev-parse --short beta-v1.1-real-store-trial
git log -1 --oneline beta-v1.1-real-store-trial
```

Do not force-move the frozen tag. If a post-freeze blocker hotfix is needed,
create a separate hotfix commit and tag.

---

## 4. Vercel Deployment And Rollback

Primary rollback path:

1. Open Vercel Dashboard for `light-ops-assistant`.
2. Go to Deployments.
3. Find the deployment built from `beta-v1.1-real-store-trial` or commit
   `f87cd81`.
4. Use Promote to Production / Rollback to make it active.
5. Re-test `/home`, `/m/{storeCode}`, `/menu?code=...`, `/ops/login`, and
   `/bind?token=...`.

When a newer commit has been deployed after the freeze:

- Prefer Vercel deployment rollback first.
- Do not immediately revert database state.
- If Git rollback is needed for local reproduction, check out the tag:

```bash
git fetch origin --tags
git checkout beta-v1.1-real-store-trial
npm ci
npm run build
```

Vercel must not auto-run migrations during build for this project. Production
migrations are operated manually with `npm run migrate:prod` using `DIRECT_URL`
as documented in `CLAUDE.md`, `AGENTS.md`, `MIGRATIONS.md`, and
`prisma.config.ts`.

---

## 5. Supabase Database State

Current Prisma migration check:

- Command used: `DATABASE_URL="$DIRECT_URL" npx prisma migrate status`
- Result: `29 migrations found in prisma/migrations`
- Result: `Database schema is up to date!`
- Schema path: `prisma/schema.prisma`
- Production migration path: `prisma/migrations/`
- Current freeze adds no database migration.

Product image gallery migration:

- Migration: `20260611000000_add_product_image_gallery`
- Status: applied in production.
- Columns:
  - `Product.imageUrls`
  - `Product.imageStorageKeys`
- Compatibility:
  - Legacy `Product.imageUrl` remains the main image field.
  - Legacy `Product.imageStorageKey` remains available.
  - First gallery image is synced to `imageUrl`.

How to confirm production migration state:

```bash
set -a
source .env
set +a
DATABASE_URL="$DIRECT_URL" npx prisma migrate status
```

How to confirm image gallery columns without exporting data:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'Product'
  and column_name in ('imageUrls', 'imageStorageKeys');
```

Do not commit production dumps, raw customer data, Telegram IDs, phone numbers,
payment config, or service-role credentials to Git.

---

## 6. Key Database Tables To Back Up

Minimum real-store trial backup set:

- `Tenant`
- `Store`
- `User`
- `UserStoreRole`
- `Product`
- `ProductCategory`
- `SaleRecord`
- `PaymentIntent`
- `MerchantPaymentConfig`
- `CustomerOrder`
- `Customer`
- `StoreCustomerContact`
- `CouponTemplate`
- `CustomerCoupon`
- `CouponRedemption`
- `CouponIssueBatch`
- `MarketingProductPage`
- `CampaignLink`
- `BindToken`
- `OpsAdmin`
- `OperationLog`
- `TelegramMessage`
- `SupportSession`
- `CustomerTouchLog`
- `ConversationLog`

Recommended backup storage:

- Save encrypted dumps outside the repository.
- Suggested location: local secure disk + 1Password / encrypted external drive.
- File naming: `beta-v1.1-real-store-trial-YYYYMMDD-HHMM.sql`.
- Before any destructive recovery, create a fresh pre-restore dump first.

Example backup commands, with secrets supplied locally:

```bash
pg_dump "$DIRECT_URL" --no-owner --schema=public > beta-v1.1-schema.sql
pg_dump "$DIRECT_URL" --no-owner --data-only --column-inserts \
  --table='"Tenant"' \
  --table='"Store"' \
  --table='"User"' \
  --table='"UserStoreRole"' \
  --table='"Product"' \
  --table='"SaleRecord"' \
  --table='"PaymentIntent"' \
  --table='"CustomerOrder"' \
  --table='"MarketingProductPage"' \
  --table='"BindToken"' \
  --table='"OpsAdmin"' \
  > beta-v1.1-key-tables.sql
```

These output files contain sensitive production data. Do not place them in the
Git working tree unless they are encrypted and explicitly approved.

---

## 7. Supabase Storage Buckets

Known Storage buckets used by Beta V1.1:

| Bucket | Usage | Public | Notes |
|--------|-------|--------|-------|
| `product-images` | Product main/gallery images, marketing page images, marketing video | Yes | Used by `/api/products/[id]/image`, marketing image/video upload |
| `order-delivery-photos` | Customer delivery address photos | Yes | Used by `/api/uploads/delivery-photo` |

Notable non-Storage image data:

- `Store.bannerData` stores banner base64 in DB.
- `MerchantPaymentConfig.khqrImageUrl` stores KHQR image data in DB.

Storage backup:

1. Supabase Dashboard -> Storage.
2. Download `product-images` and `order-delivery-photos`.
3. Keep folder structure and object keys unchanged.
4. Store the archive encrypted outside Git.

Storage restore:

1. Recreate buckets as public buckets if using a new Supabase project.
2. Upload objects to the same keys.
3. Confirm one product image URL and one delivery photo URL open.

---

## 8. Environment Variables

Record names and purpose only. Do not write plaintext values in this file.

### Vercel / App Runtime

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` | Production public app URL used for links and Mini Apps |
| `NEXT_PUBLIC_PUBLIC_SITE_URL` | Public site URL fallback |
| `PUBLIC_SITE_URL` | Server-side public URL fallback |
| `AUTH_SECRET` | Signs app session cookies |
| `TENANT_ID` | Default tenant ID for bot/runtime flows |
| `DEFAULT_STORE_CODE` | Default customer bot store code fallback |
| `NODE_ENV` | Runtime environment |
| `DEV_ROLE` | Local development role fallback only |

### Supabase / Prisma

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Runtime PostgreSQL connection, Supabase pooler port 6543 |
| `DIRECT_URL` | Migration/direct PostgreSQL connection, Supabase port 5432 |
| `SUPABASE_URL` | Supabase project URL for Storage REST API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Storage service-role credential |

### Telegram Bots

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Merchant bot token for initData verification and merchant notifications |
| `TELEGRAM_BOT_USERNAME` | Merchant bot username for owner/staff invite links |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Public merchant bot username fallback |
| `NEXT_PUBLIC_BOT_USERNAME` | Public bot username fallback |
| `BOT_USERNAME` | Server-side bot username fallback |
| `TG_BOT_TOKEN` | Legacy/admin bot token used by `/api/tg-admin` |
| `TG_WEBHOOK_SECRET` | Legacy/admin webhook secret |
| `TG_ADMIN_IDS` | Legacy/admin allowed Telegram IDs |
| `MERCHANT_WEBHOOK_SECRET` | Merchant webhook secret |
| `CUSTOMER_BOT_TOKEN` | Customer bot token |
| `CUSTOMER_WEBHOOK_SECRET` | Customer webhook secret |
| `NEXT_PUBLIC_CUSTOMER_BOT_USERNAME` | Customer bot username for customer binding links |
| `OPS_BOT_TOKEN` | Ops bot token for ops Mini App verification |
| `OPS_TG_IDS` | Allowed ops Telegram IDs |
| `OPS_USER_IDS` | Allowed ops user IDs fallback |

### Ops Login

| Variable | Purpose |
|----------|---------|
| `OPS_USERNAME` | Ops password-login username seed/fallback |
| `OPS_PASSWORD` | Ops password-login password seed/fallback |
| `OPS_AUTO_SEED` | Allows ops admin auto seed when explicitly enabled |

### Support / Customer Service

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPPORT_URL` | Public support URL override |
| `NEXT_PUBLIC_CUSTOMER_SERVICE_URL` | Customer service URL fallback |
| `NEXT_PUBLIC_SUPPORT_BOT_USERNAME` | Support bot username |
| `NEXT_PUBLIC_CUSTOMER_SERVICE_BOT_USERNAME` | Customer service bot username |

### Payment / KHQR / Printer / AI / Tracking

| Variable | Purpose |
|----------|---------|
| `STORE_OPEN_CODE` | New merchant opening code |
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | TikTok pixel ID for marketing page tracking |
| `ANTHROPIC_API_KEY` | AI product import recognition |
| `FORWARD_CHAT_ID` | Telegram forward/notification chat ID |
| `SW_PRINTER_USERNAME` | Printer service username |
| `SW_PRINTER_KEY` | Printer service key |
| `SW_PRINTER_SECRET` | Printer service secret |
| `SW_PRINTER_DEVID` | Printer device ID |

---

## 9. Telegram Bot Configuration

The trial uses separate bot roles. Do not mix them.

### Merchant Bot

- Purpose: OWNER/STAFF binding, merchant Mini App, merchant notifications.
- Expected Mini App URL: app root or merchant entry that resolves to `/home`.
- Invite link logic:
  - `/invite` creates role-specific `BindToken`.
  - Owner/staff links use merchant bot username.
  - Deep link payload: `bind_<token>`.
  - Final binding page: `/bind?token=...` or Telegram `startapp=bind_<token>`.
- Must not be used for customer `/m` ordering QR.

### Customer Bot

- Purpose: customer H5 entry, customer post-order Telegram binding, customer
  touch notifications.
- Customer menu entry:
  - `/m/{storeCode}` redirects to `/menu?code={storeCode}`.
  - `/menu?code=...` is public and must not require merchant binding.
- Post-order customer bot binding:
  - `/start bind_<storeCode>_<orderNo>` links customer Telegram to store/order.
- Must not generate OWNER/STAFF bind tokens.

### Ops Bot

- Purpose: operations backend Mini App and ops/admin notifications.
- Expected Mini App URL: `/ops`.
- Auth route: `/api/auth/telegram-ops`.
- Ops pages must use ops auth / `/api/ops/check`, not merchant OWNER/STAFF
  session.
- Must not show the merchant boot screen as a blocking guard.

### Entry Separation Rules

- Merchant protected: `/home`, `/sale`, `/records`, `/products`, `/invite`,
  `/dashboard`.
- Customer/public: `/m`, `/menu`, `/e-life`, `/me`, `/me/coupons`,
  `/menu/orders`, `/p`, `/v`, `/cashier`.
- Binding: `/bind`, `/start`.
- Ops: `/ops`, `/ops/login`, `/ops/*`.

Never point customer QR codes to `/bind`. Never point ops Mini App to merchant
bot entry. Never generate owner/staff links with customer or ops bot username.

---

## 10. Local Mac mini / RustDesk Takeover

Use local takeover only for urgent production triage or supervised recovery.

Checklist:

1. Confirm the Mac mini is online and reachable through RustDesk.
2. Ask the owner for the current RustDesk ID/password through an approved secure
   channel.
3. Open the project at `/Users/jason/light-ops-assistant`.
4. Confirm current Git state:

```bash
git status --short
git log -3 --oneline
git tag --points-at HEAD
```

5. Do not open or copy `.env` values into chat, screenshots, or Git.
6. If a DB command is required, run read-only checks first.
7. Record every production action in Obsidian after the incident.

---

## 11. Obsidian Knowledge Base

True Vault path:

```text
/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/商户端收口记录-2026-06-10.md
```

Project path that must not be used for this record:

```text
/Users/jason/light-ops-assistant/05-开发记录/
```

Incident notes should include time, symptom, affected entry/page, customer/store
impact, commands run, fix decision, commit/tag, and follow-up verification.

---

## 12. Incident Severity

### P0: Trial Blocking

- Cannot enter system.
- Cannot bind owner/staff.
- Customer QR cannot open.
- Customer cannot place order.
- Merchant cannot sell.
- Merchant cannot confirm payment collection.
- `/records` amount or source is wrong.
- Permission crosses store, tenant, bot, or role.

Action: stop feature work, triage immediately, apply minimal hotfix or rollback.

### P1: High Impact

- Khmer display affects real use.
- Images fail to display but ordering still works.
- `/dashboard` is delayed but `/records` is correct.
- One entry is slow but still usable.

Action: fix during trial only if it affects real operation; otherwise queue for
post-trial.

### P2: Non-Blocking

- Copywriting details.
- UI spacing.
- Non-core page experience.
- Cosmetic loading state.

Action: do not change during freeze unless explicitly approved.

---

## 13. Common Accident SOP

### Customer QR Opens Binding Page

1. Check QR payload: it must be `/m/{storeCode}` or `/menu?code=...`.
2. If it is `/bind` or `bind_<token>`, regenerate customer QR.
3. Confirm `/m/{storeCode}` redirects to `/menu?code={storeCode}`.
4. Confirm `/menu` and `/m` are public and not guarded by merchant auth.
5. Reprint QR only after browser and Telegram tests pass.

### Merchant Entry Stuck On Boot Page

1. Check if path is merchant protected or ops/public.
2. For merchant pages, confirm Telegram initData/session is available.
3. For `/ops`, confirm it is using ops auth and not merchant guard.
4. For public pages, confirm they are whitelisted.
5. If a recent deployment caused it, roll back Vercel to the frozen deployment.

### Owner/Staff Binding Fails

1. Confirm link uses merchant bot username.
2. Confirm payload is `bind_<token>`.
3. Check `BindToken.status`, `expiresAt`, `usedCount`, `maxUses`, `tenantId`,
   `storeId`, and `role`.
4. Regenerate token if old token was revoked or consumed.
5. Do not manually change role/store without documenting why.

### Customer Cannot Place Order

1. Open `/menu?code=...` in browser.
2. Confirm `Store.status = ACTIVE`.
3. Confirm products are `ACTIVE` and belong to the expected tenant/store scope.
4. Submit one self-pickup order.
5. Check `CustomerOrder` row and `/records` display.
6. If submission fails, capture API response and rollback only if a deployment
   regression is confirmed.

### Merchant Cannot Sell

1. Check `/sale` and `/cashier` product loading.
2. Confirm product is `ACTIVE`.
3. Test CASH first.
4. Test KHQR only after checking `MerchantPaymentConfig`.
5. Confirm `/records` shows the sale source and payment state.

### `/records` And `/dashboard` Disagree

1. Treat `/records` as the primary audit page.
2. Confirm date/timezone range.
3. Compare SaleRecord, PaymentIntent, CustomerOrder, and refund rows for the day.
4. Do not change dashboard formulas during trial unless the discrepancy affects
   real settlement.

### Ops Cannot Enter

1. Test `/ops/login` in a regular browser.
2. Test ops bot Mini App.
3. Confirm `OPS_BOT_TOKEN` and allowed ops IDs are configured.
4. Confirm `/ops` is not running merchant OWNER/STAFF guard.
5. Roll back latest deployment if it regressed after freeze.

---

## 14. Rollback Steps

### Code-Only Rollback

Use when:

- A recent deployment breaks entry, binding, ordering, sales, records, dashboard,
  or ops.
- No new database migration or irreversible data change is involved.

Steps:

1. Promote the frozen Vercel deployment.
2. Or check out and redeploy the frozen tag:

```bash
git fetch origin --tags
git checkout beta-v1.1-real-store-trial
npm ci
npm run build
```

3. Confirm:
   - `/home`
   - `/m/{storeCode}`
   - `/menu?code=...`
   - `/sale`
   - `/cashier`
   - `/records`
   - `/dashboard`
   - `/ops/login`

### Database Rollback

Use only when:

- A database migration or manual data operation corrupted production data.
- A fresh pre-restore dump has been taken.
- The business owner accepts potential RPO impact.

Rules:

- Do not roll back DB just because code has a bug.
- Do not restore an old DB over live orders without preserving new orders.
- Prefer targeted repair SQL over full restore.
- Keep restore SQL and resulting row counts in incident notes.

### Bot Rollback

Use when:

- Customer QR opens wrong bot/path.
- Merchant bind links use wrong bot.
- Ops Mini App opens merchant flow.

Steps:

1. Check BotFather Menu Button URL for each bot.
2. Check webhook target:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

3. Re-set webhook to the correct production endpoint.
4. Re-test the relevant entry in Telegram.

---

## 15. Recovery Steps

If rebuilding from a new Supabase/Vercel project:

1. Create a new Supabase project.
2. Restore schema and data from an encrypted backup.
3. Create public buckets:
   - `product-images`
   - `order-delivery-photos`
4. Restore Storage objects with the same keys.
5. Configure Vercel environment variables from the secure password manager.
6. Deploy code from `beta-v1.1-real-store-trial`.
7. Run `npm run build` locally or in CI before production promotion.
8. Run `DATABASE_URL="$DIRECT_URL" npx prisma migrate status`.
9. Configure bot webhooks and Mini App URLs.
10. Verify the real-store smoke path:
    - Owner bind
    - Staff bind
    - Product list
    - Customer `/m` QR
    - Customer order
    - `/sale` CASH
    - `/cashier` CASH
    - `/records`
    - `/dashboard`
    - `/ops`

---

## 16. Forbidden During Real-Store Trial

Do not add or change:

- New membership system.
- New coupon mechanics.
- Automatic payment callback.
- Complex inventory, purchase, or stocktaking.
- New reports or BI.
- AI customer service.
- Large-scale ad-spend workflow.
- Large-scale multi-store expansion.
- New payment provider/interface.
- Major UI redesign.
- Database schema for non-blocking issues.
- Bot routing experiments.
- Force-moving the frozen tag.
- Committing `.env`, plaintext secrets, or production dumps.

Allowed changes are limited to P0 blockers and severe P1 issues that block the
real-store trial. Every change must be minimal, built, committed, pushed, and
recorded in Obsidian.

---

**Disaster recovery owner:** jasonmino  
**Guide date:** 2026-06-11  
**Version:** Beta V1.1 Real Store Trial  
**Frozen tag:** `beta-v1.1-real-store-trial`
