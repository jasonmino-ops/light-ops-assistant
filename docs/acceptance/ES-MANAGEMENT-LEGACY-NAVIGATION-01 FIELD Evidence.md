# ES-MANAGEMENT-LEGACY-NAVIGATION-01 — FIELD Evidence

## Status

- FIELD VERIFIED: **YES**
- FIELD machine: **V727 E-Shop Desktop**
- Acceptance source: Founder-provided real Desktop acceptance
- FIELD scope: Desktop Management Center → Sales Records, Records context preservation, Records → Management return navigation, and Desktop broken Refund entry hiding

This evidence does not claim Desktop Refund functionality, Cashier FIELD,
Printing FIELD, or Auth FIELD.

## Product and Production identity

- Authoritative origin/main Product SHA: `c1bedd7d89c280553c6c96c70c30fc800f890ddf`
- Production Product SHA: `c1bedd7d89c280553c6c96c70c30fc800f890ddf`
- Production Deployment ID: `dpl_Gp67TnNE7g4tk4jii8sez6Lf4DC9`
- Production READY: **YES**
- Release Lineage: **PASS**

## Founder V727 FIELD acceptance

### Initial FIELD round

The first real V727 Desktop round established:

1. Management → Sales Records: **PASS**.
2. Sales Records loading: **PASS**; the prior `401 MISSING_CONTEXT` / “加载失败，请重试” condition was gone.
3. Desktop Refund entry hidden: **PASS**.
4. Sales Records → 返回管理中心: **FAIL**. The native `<a href>` performed a full reload; the protected Management boot then entered `/relogin` and showed the Telegram re-login page.

The initial round therefore did not produce FIELD VERIFIED.

### Return-navigation corrective round

Founder re-accepted the same real V727 Desktop flow after the return corrective:

1. Management → Sales Records: **PASS**.
2. Sales Records loading: **PASS**.
3. Sales Records → 返回管理中心: **PASS**.
4. Return did not enter `/relogin` or the Telegram re-login page: **PASS**.
5. Desktop Refund entry hidden: **PASS**.
6. Pending Orders / Cashier primary path was not modified and was outside this corrective scope.

## Root cause and corrective

The Records return URL correctly preserved the controlled Desktop context:

`/management?from=desktop&storeCode=<current store>`

The failure was the native anchor navigation itself. A full document reload
discarded the active Desktop client context. The protected Management boot
then evaluated the request through the Web-session path and redirected to
`/relogin` when no Web auth session was present.

The corrective preserved the existing URL and replaced only the Desktop
click semantics with `preventDefault()` plus `router.push()`, matching the
already FIELD-verified Cashier → Management client-side navigation contract.
The Records API, auth, middleware, Cashier, and business logic were not
changed.

- Final corrective commit: `5d11ea10941b52e8d7fd49479af509f148c9b002`
- Corrective file: `app/records/page.tsx`

## Explicit non-scope

- Desktop Refund business functionality: **NOT IMPLEMENTED / DEFERRED**. Only the known broken Desktop entry was hidden; no Refund capability was verified.
- Cashier sidebar information density: **DEFERRED UX OBSERVATION**. `app/cashier/page.tsx` was not modified.
- Cashier FIELD: **NOT CLAIMED**.
- Printing FIELD: **NOT CLAIMED**.
- Auth FIELD: **NOT CLAIMED**.
- Auth Bridge: **NOT STARTED**.
- No API, schema, migration, auth, middleware, Electron, IPC, Printing, Runtime, or RC10 change was made for this closure.

## Governance boundary

- Scope Exception: `ES-MANAGEMENT-LEGACY-NAVIGATION-01-RETURN`
- Protected file: `app/records/page.tsx`
- Exception status: **CLOSED** after the corrective entered the product lineage.
- The original `ES-MANAGEMENT-LEGACY-NAVIGATION-01` exception was not reused for this return corrective.
