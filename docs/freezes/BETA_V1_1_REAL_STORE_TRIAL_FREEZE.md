# Beta V1.1 Real Store Trial Freeze

> This document freezes the small-scope real-store trial baseline. Do not use
> this freeze as a feature branch. New work continues on `main`; trial blockers
> should be handled as narrowly scoped hotfixes.

---

## 1. Freeze Conclusion

**Beta V1.1 Real Store Trial is frozen for limited real-store trial.**

The full merchant, customer H5, cashier, records, dashboard, binding, ops entry,
i18n, Khmer readability, performance, and entry-routing smoke checks have passed.
No new database change is included in this freeze.

---

## 2. Freeze Metadata

| Item | Value |
|------|-------|
| Freeze time | 2026-06-11 |
| Version name | Beta V1.1 Real Store Trial |
| Suggested tag | `beta-v1.1-real-store-trial` |
| Freeze commit | `d6dcf89` |
| Full SHA | `d6dcf89920d696bbc77b2038ce81db594a87a453` |
| Branch | `main` |
| Build status | `npm run build` passed before freeze document commit |
| Database change in this freeze | None |

---

## 3. Freeze Scope

- `/home` merchant workspace
- `/products` product management
- Product image gallery, up to 3 images
- `/menu` customer H5 ordering
- `/menu` image detail preview, prioritizing marketing page image materials
- `/sale` mobile sales
- `/cashier` desktop cashier
- `/records` sales records
- `/dashboard` owner business overview
- `/invite` + `/bind` owner/staff binding
- `/m` customer public short link
- `/ops` operations backend entry
- Multi-language i18n
- Khmer font readability
- E-Life + customer H5 Khmer experience
- Merchant entry flash prevention
- Entry boot screen timing optimization
- Minimal performance optimization
- Entry matrix regression

---

## 4. Passed Core Flows

- Owner/staff invite and binding:
  `/invite` generates role-specific bind links; `/bind` consumes bind tokens and
  signs the merchant session.
- Merchant entry:
  protected merchant pages do not render real business children or BottomNav
  before entry/auth checks complete.
- Customer public entry:
  `/m/[storeCode]` redirects to `/menu?code=...`; `/menu`, `/m`, `/e-life`,
  `/me`, `/p`, `/v`, and `/cashier` remain public and do not use merchant
  OWNER/STAFF guard.
- Product management:
  product create/edit, barcode fallback, image upload, 3-image gallery,
  image field fallback, search/filter, import preview, and active/disabled
  behavior are frozen.
- Customer H5 ordering:
  store open, product browsing, image preview, cart, self-pickup/delivery
  validation, order submit, and records linkage are frozen.
- Sales:
  `/sale` and `/cashier` load ACTIVE products and create records using current
  CASH/KHQR flows.
- Records and dashboard:
  `/records` merges SaleRecord and paid CustomerOrder data; `/dashboard` uses
  live same-day queries aligned with `/records`.
- Operations backend:
  `/ops` uses ops-specific auth/session handling and does not loop through the
  merchant boot shell.

---

## 5. Key Fix Summary

- Product gallery added while preserving legacy `imageUrl` as main image.
- Product list has fallback behavior if a deployment sees image-gallery columns
  before migration rollout.
- Customer `/menu` lightbox prioritizes marketing page image materials, then
  product gallery, then legacy main image.
- `/sale` and `/cashier` were regressed after product image-field expansion.
- `/menu` customer H5 ordering was closed for real ordering and `/records`
  linkage.
- `/invite` + `/bind` role-specific binding was closed for owner/staff trial.
- `/dashboard` was aligned with live `/records` same-day data.
- Merchant and customer i18n gaps were reduced, with Khmer readability improved.
- `/api/public/menu` marketing image lookup was narrowed to active product IDs,
  and non-first-screen images were lazy-loaded.
- Entry flash was fixed by gating merchant children before rendering.
- `/m` customer code was restored as a public route.
- `/ops` auth boot loop was fixed with an ops-specific WebView session key.
- Entry boot page display was delayed so fast auth does not visibly flash.

---

## 6. Key Commits

| Commit | Summary |
|--------|---------|
| `20550d4` | Product 3-image base capability |
| `f6d4f78` | Product list fallback when production migration is not yet applied |
| `9296769` | `/menu` prioritizes marketing page image materials |
| `7dededb` | `/sale` + `/cashier` sales flow regression |
| `5bea056` | `/menu` customer H5 ordering closure |
| `44f6525` | `/invite` + `/bind` binding flow closure |
| `9e3f2b2` | `/dashboard` live business overview |
| `bea68b3` | Merchant i18n + Khmer readability |
| `a758bcc` | E-Life + customer H5 Khmer experience |
| `1899c0a` | Minimal performance optimization |
| `60dcabd` | Entry flash fully fixed by pre-render guard |
| `8343d5f` | `/m` customer public entry fix |
| `d582071` | `/ops` entry boot-loop fix |
| `d6dcf89` | Entry boot page timing optimization |

---

## 7. Database Migration Status

- `Product.imageUrls` and `Product.imageStorageKeys` migration has been executed
  successfully in production.
- This freeze introduces **no new database migration**.
- After freeze, non-blocking issues must not change schema casually.

---

## 8. Build Status

`npm run build` passed on 2026-06-11 before creating this freeze document.

---

## 9. Remaining Manual Device Checks

- Telegram Mini App owner entry on real device.
- Telegram Mini App staff entry on real device.
- Customer QR `/m/[storeCode]` scan in Telegram and regular browser.
- Camera barcode scanning on `/sale`.
- Real KHQR display and merchant confirmation.
- `/cashier` on the target desktop/tablet browser.
- Khmer readability on the devices used by local staff/customers.
- `/ops` entry from ops bot Mini App and normal browser `/ops/login`.

---

## 10. Allowed Post-Freeze Fixes

Only trial-blocking fixes are allowed:

- Cannot bind owner/staff.
- Cannot enter merchant, customer, or ops entry.
- Customer QR cannot open.
- Customer cannot place order.
- Merchant cannot sell.
- Merchant cannot confirm payment collection.
- `/records` amount or source is wrong.
- `/dashboard` does not match `/records`.
- Permission escalation or unauthorized access.
- Bot, store, tenant, or role routing is mixed.
- Severe language display issue blocking use.
- Other real-store trial blockers.

---

## 11. Post-Freeze Forbidden Additions

Do not add:

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

---

## 12. Real Store Trial Recommendation

- Start with 1 real merchant and 1 store.
- Use 1 owner and 1-2 staff accounts.
- Prepare 10-30 real products, including:
  no barcode, barcode, no image, one image, and three-image products.
- Print and test one customer QR `/m/[storeCode]` before service starts.
- Run both flows daily:
  customer H5 orders and staff mPOS sales.
- Compare `/records` and `/dashboard` at the end of each day.
- Keep all post-freeze changes limited to the allowed blocker list above.

---

**Freeze owner:** jasonmino  
**Freeze time:** 2026-06-11  
**Version:** Beta V1.1 Real Store Trial  
**Tag:** `beta-v1.1-real-store-trial`
