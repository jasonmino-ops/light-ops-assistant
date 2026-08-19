# ES-SALES-LEAD-01 Repository Audit V0.1

- Audit date: 2026-08-19
- Development lane: codex/e-shop-sales-lead-attribution-v01
- Scope: Social Lead Attribution & Sales Follow-up V0.1 — repository audit only
- Classification: 开发日志 / 架构审计
- Business code changed: NO
- Prisma schema or migration changed: NO
- UI, Bot, QR, link, Preview, Production changed: NO

## 1. Executive conclusion

E-Shop currently has three useful but disconnected capability groups:

1. A merchant onboarding chain: Telegram identity → StoreApplication → Ops approval → Tenant + Store + OWNER User.
2. A consumer-order attribution chain: /m source/campaign/visitorId or /v campaign code → CustomerJourneyEvent / CustomerOrder → attributed order.
3. A Telegram manual-support chain: merchant Bot inbound messages → TelegramMessage → Ops current conversations → manual reply.

There is no repository-level linkage that joins those groups into:

external source → identified merchant lead → sales conversation → application → exact Store.

Therefore the requested present-day conversion answer is:

**NO — E-Shop cannot currently prove that a specific source's specific prospect became a specific merchant.**

The main breaks are:

- generic merchant entry pages do not capture or preserve attribution;
- no anonymous merchant visitor/click identity exists;
- no anonymous click → Telegram identity bridge exists;
- Ops conversations have no source, application, lead, assignee, or follow-up linkage;
- StoreApplication has no source/conversation/assignee/direct Store ID;
- approval records tenantId but not createdStoreId/approvedStoreId.

This does not mean the repository starts from zero. Link/QR generation, Telegram identity verification, message persistence, manual reply, store application, approval, and Store creation are all real, reusable building blocks.

## 2. Development Lane and Release Lineage Gate

### Gate evidence

| Check | Result |
|---|---|
| Original current directory | /Users/jason/light-ops-assistant |
| Original branch | 开店销售路径跟踪 |
| Original worktree status | DIRTY: one modified docs workflow file and three untracked paths; unrelated to this lane |
| Latest origin/main SHA after fetch | 0164842299f39d582ab4040ef59bb98fd68314fe |
| Local main SHA | 0164842299f39d582ab4040ef59bb98fd68314fe |
| Production SHA | 0164842299f39d582ab4040ef59bb98fd68314fe |
| Production lookup | npm run vercel:current; READY Production deployment |
| Clean main worktree | /Users/jason/worktrees/ep-br-cd-01-main-freeze |
| origin/main ahead/behind local main | 0 / 0 |
| Release lineage script | scripts/check-release-lineage.sh returned RESULT: PASS |
| Existing unrelated worktrees/branches | PRESENT; not modified |
| Safe new-lane baseline | YES |

### Isolated lane

- Base: origin/main at 0164842299f39d582ab4040ef59bb98fd68314fe
- Branch: codex/e-shop-sales-lead-attribution-v01
- Worktree: /private/tmp/e-shop-sales-lead-attribution-v01.EBV61h
- Initial lane ahead/behind origin/main: 0 / 0
- Initial lane status: clean
- Lineage Gate: **PASS**

The dirty original branch was not used as a base and was not modified.

## 3. Existing Entry Points

### 3.1 Public and onboarding Web URLs

| Entry | Current purpose | Parameters actually read | Attribution behavior | Evidence |
|---|---|---|---|---|
| / | Public home | none | source/ref/campaign/UTM are not read; links to /e-life and /relogin omit the incoming query | app/page.tsx:3-27 |
| /start | Unbound merchant onboarding | none | application action replaces URL with /open and drops all query parameters | app/start/page.tsx:31-45 |
| /open | Store-opening application | useSearchParams is instantiated but ignored | no source/ref/campaign/UTM is read or submitted | app/open/page.tsx:31-34, app/open/page.tsx:69-80 |
| /bind?token=TOKEN | OWNER/STAFF bind | token; Telegram start param fallbacks | only the bind token survives; success redirects to /home | app/bind/page.tsx:29-57, app/bind/page.tsx:172-202 |
| /m/STORECODE | Public store landing | lang, source, campaign | captures source/campaign, creates visitorId, logs journey events, and passes data to /menu | app/m/[storeCode]/page.tsx:5-52, app/m/[storeCode]/PrivateLandingShell.tsx:196-272 |
| /menu | Public customer menu/order | code, ref, intent, table, from, source, campaign, visitorId, couponId; Telegram start_param may supply storeCode | preserves the /m journey only on the landing order path; campaign ref can persist to CustomerOrder | app/menu/page.tsx:883-960, app/menu/page.tsx:1185-1214 |
| /v/CODE | Campaign short link | path code | increments aggregate views/clicks; redirects with ref=CODE and intent | app/api/v/[code]/route.ts:19-60, app/v/[code]/page.tsx:143-167 |
| /p/SLUG | Marketing product page | ref, intent, utm_source, utm_medium, utm_campaign, creator, campaignId | UTM values persist in per-slug localStorage and order remark; ref uses formal CampaignLink attribution | app/p/[slug]/page.tsx:7-12, app/p/[slug]/page.tsx:608-658, app/p/[slug]/page.tsx:914-938 |
| /e-life | Public multi-store marketplace | scan input can contain code or a supported internal URL | scanned internal URLs preserve their query, but normal store navigation constructs a new code/from URL and does not carry an incoming source | app/e-life/page.tsx:136-176, app/e-life/page.tsx:290-315, app/e-life/page.tsx:543 |
| /me | Customer profile | code and lang-related state | no source/ref/campaign persistence; member binding link carries only storeCode | app/me/page.tsx:274-309, app/me/page.tsx:434 |
| /relogin?returnUrl=... | Merchant re-login | returnUrl is read only as a UI hint | redirect goes to plain t.me bot URL without start payload; returnUrl and attribution do not cross Telegram | app/relogin/page.tsx:7-25, app/relogin/page.tsx:60-63 |
| /contact | Static contact page | none relevant | no lead capture or attribution persistence | app/contact/page.tsx |
| /creator/p/TOKEN | Public creator performance dashboard | path token; language preference | token identifies an existing merchant-side promoter dashboard, not a prospective merchant or traffic touch | app/creator/p/[token]/page.tsx:1-29; app/api/creators/[id]/dashboard-token/route.ts:31-37 |

### 3.2 Parameters found

Current supported tracking-shaped parameters are route-specific:

- source, campaign: /m and its /menu landing journey.
- ref, intent: /v → /menu or /p campaign order attribution.
- utm_source, utm_medium, utm_campaign, creator, campaignId: /p only.
- referrer: captured from document.referrer only by the /m customer journey event path.
- visitorId: generated and persisted only for /m customer journey.
- token / startapp / start_param / tgWebAppStartParam: Telegram/bind transport, not marketing attribution.

No generic merchant landing layer reads a common source/ref/campaign/UTM allowlist.

Other token/link mechanisms found but not classified as merchant-lead entries:

- MemberTelegramBindToken is an existing-store customer membership token, not an OWNER/STAFF invite or sales referral.
- Its API currently returns /telegram/member-bind?token=TOKEN, while no matching app/telegram/member-bind page was found in the repository; only /api/telegram/member-bind exists. This audit does not infer a working public entry from that incomplete route surface.
- Creator dashboard tokens grant a promoter access to existing campaign performance; they do not identify who originally referred a prospective E-Shop merchant.

Evidence: prisma/schema.prisma:506-592; app/api/members/[id]/telegram-bind-token/route.ts:23-58; app/api/telegram/member-bind/route.ts; prisma/schema.prisma:1205-1228.

### 3.3 Telegram Deep Links and real payload formats

| Link format | Parser | Saved association | Source capacity today |
|---|---|---|---|
| https://t.me/merchant_bot?startapp=open | TelegramInit exact match | opens /open; StoreApplication later saves Telegram identity | payload is fixed to open; extra attribution has no parser/persistence |
| https://t.me/merchant_bot?startapp=bind_TOKEN | resolveTelegramStartParam + getBindTokenFromStartParam | BindToken resolves tenantId, storeId, role; User gets telegramId | only TOKEN is consumed |
| https://t.me/customer_bot?start=bind_STORECODE | customer webhook parseBindPayload | StoreCustomerContact linked to storeCode + Telegram ID | fixed source telegram_bind_after_order; no campaign |
| https://t.me/customer_bot?start=bind_STORECODE_ORDERNO | customer webhook parseBindPayload | also saves lastOrderId | order correlation exists; no marketing source |
| https://t.me/customer_bot?start=STORECODE | generated by /v support action | unrecognized by customer webhook; falls back to /e-life | store/source context is lost |
| t.me merchant bot without payload | relogin | auth by Telegram ID if User exists | no returnUrl or attribution |
| Mini App startapp=STORECODE | /menu comments and start_param logic | used as menu storeCode only | no central generator found; no attribution |

Evidence:

- Merchant start-param resolution priority and accepted carriers: lib/telegram-start-param.ts:1-72.
- Only bind_ has a semantic extractor: lib/telegram-start-param.ts:75-78.
- Merchant link builder emits startapp without a structured envelope: lib/telegram-link.ts:14-22.
- TelegramInit recognizes bind_ and exact open, otherwise sends an unbound user to /start: app/components/TelegramInit.tsx:159-181, app/components/TelegramInit.tsx:244-273.
- Customer payload parser recognizes only bind_STORECODE and bind_STORECODE_ORDERNO: app/api/webhook/customer/route.ts:19-28, app/api/webhook/customer/route.ts:83-93.
- Unrecognized customer /start payload is discarded and the user is sent to /e-life: app/api/webhook/customer/route.ts:342-370.

Payload constraints found in repository:

- The merchant resolver trims and decodes up to twice, but implements no length or character-set guard.
- The merchant bind token is 40 hex characters; bind_ plus token is 45 characters.
- open is 4 characters.
- The customer parser splits STORECODE at the first underscore; an underscore inside storeCode would be interpreted as the order separator.
- **NO REPOSITORY-SIDE TELEGRAM PAYLOAD LENGTH GUARD FOUND.**
- Platform/provider limits are not encoded or validated by this repository and therefore are not asserted by this audit.

### 3.4 QR generators

| QR type | Encoded value | Token/store/role | Existing source | Same URL as copy link? | Evidence |
|---|---|---|---|---|---|
| OWNER invite QR | https://t.me/merchant_bot?startapp=bind_TOKEN | token; Store/OWNER role live in BindToken | none | YES, result.tgLink drives QR, link and copy | app/invite/page.tsx:257-279; app/api/admin/bind-tokens/route.ts:95-111 |
| STAFF invite QR | same format | token; Store/STAFF role live in BindToken | none | YES | same files; prisma/schema.prisma:733-752 |
| Ops-generated OWNER/STAFF QR | same format | same | none | YES | app/ops/[tenantId]/page.tsx:1318-1391; app/api/ops/tenants/[tenantId]/tokens/route.ts:73-83 |
| Telegram admin /genowner, /genstaff QR | same format | same | none | link and QR use same tgLink | app/api/tg-admin/route.ts:52-57, app/api/tg-admin/route.ts:119-138 |
| Customer/Store/H5 QR | https://elifekh.com/m/STORECODE | storeCode in path; no token/role | none by generator; route can accept source/campaign if manually appended | YES | lib/public-url.ts:25-35; app/invite/page.tsx:409-472 |
| Desktop customer-entry QR | same /m/STORECODE URL | storeCode | none | one generated value | app/desktop/display/page.tsx:201-305 |
| Table QR | https://public-site/menu?code=STORECODE&table=TABLE | storeCode + table | none | YES | app/table-qrcodes/page.tsx:139-145, app/table-qrcodes/page.tsx:229-251 |
| Campaign QR | https://public-site/v/CODE | CampaignLink code | sourcePlatform/creator/campaign link metadata behind code | YES; matUrl is copied and QR-encoded | app/campaign/page.tsx:839-884 |
| Fixed opening QR | https://t.me/merchant_bot?startapp=open | fixed open payload | none | repository comments/routing support format; no QR generator located | app/open/page.tsx:8-16 |

Non-attribution QR capabilities such as KHQR payment and cashier-device authorization were found but excluded from marketing-source conclusions.

Conclusion: the system already proves the principle **“a QR is a carrier for a URL”**. Campaign QR is already a source-bearing link. However, current store/invite/open QR UIs do not accept arbitrary attribution values.

## 4. Redirect and Context-Preservation Chains

### 4.1 Generic social URL to merchant application

Facebook/TikTok
→ /?source=tiktok&campaign=launch01
→ root page does not read parameters
→ Merchant Login sends user to /relogin without the query
→ /relogin sends user to plain t.me/merchant_bot
→ TelegramInit authenticates or sends unbound user to /start
→ /start replaces URL with /open
→ /open ignores all query parameters
→ /api/open creates StoreApplication without attribution.

Loss points:

- root internal links: app/page.tsx:12-18;
- relogin plain Bot URL: app/relogin/page.tsx:7-25;
- TelegramInit redirects to /start or /open without query: app/components/TelegramInit.tsx:261-273;
- /start → /open: app/start/page.tsx:31-45;
- /open ignores search params and submits only identity/form data: app/open/page.tsx:31-34, app/open/page.tsx:69-80.

### 4.2 Merchant invitation

Invite/QR
→ t.me/merchant_bot?startapp=bind_TOKEN
→ Telegram provides start_param
→ TelegramInit extracts bind token
→ /bind?token=TOKEN
→ /api/bind verifies initData and joins User to BindToken's tenant/store/role
→ /home.

The token, store, role, and Telegram identity survive. Any additional external source does not.

### 4.3 Customer store landing journey

Facebook/TikTok/poster
→ /m/STORECODE?source=SOURCE&campaign=CAMPAIGN
→ server reads source/campaign
→ browser localStorage visitorId
→ landing_view / landing_cta_click
→ /menu?code=...&from=landing&source=...&campaign=...&visitorId=...
→ menu_arrival
→ CustomerOrder
→ order_conversion event.

This chain preserves anonymous customer-order attribution. It does not create a merchant lead or link to StoreApplication.

Evidence: app/m/[storeCode]/page.tsx:46-52; app/m/[storeCode]/PrivateLandingShell.tsx:196-272; app/menu/page.tsx:883-960; app/api/public/orders/route.ts:323-334.

Important branch losses from /m:

- membership Telegram link carries only bind_STORECODE;
- My Orders and Coupons quick links carry only store code.

Evidence: app/m/[storeCode]/PrivateLandingShell.tsx:373, app/m/[storeCode]/PrivateLandingShell.tsx:410-415.

### 4.4 Campaign short-link journey

Social post/Bio/QR
→ /v/CODE
→ aggregate viewCount
→ clickCount
→ /menu or /p with ref=CODE and intent
→ /api/public/orders resolves CampaignLink
→ CustomerOrder stores sourcePlatform, campaignCode, campaignLinkId, campaignIntent
→ campaign dashboard groups attributed orders/sales.

Evidence: app/api/v/[code]/route.ts:25-60; app/api/v/[code]/click/route.ts:12-27; app/v/[code]/page.tsx:143-160; app/api/public/orders/route.ts:216-243, app/api/public/orders/route.ts:263-285; app/api/campaign-links/route.ts:60-99.

### 4.5 Middleware, cookie, and login behavior

- auth-session contains tenantId, userId, storeId and role only: lib/session.ts:11-18.
- /api/auth/telegram verifies Telegram identity and finds User by telegramId, then sets the cookie; it does not persist start payload/profile/source: app/api/auth/telegram/route.ts:78-105, app/api/auth/telegram/route.ts:137-156.
- middleware redirects protected pages to /ops/login, /relogin or /home using new path URLs and does not preserve the incoming query: middleware.ts:61-72.

## 5. Existing Attribution Capability

### 5.1 Present and genuinely useful

1. CustomerJourneyEvent
   - eventType, visitorId, source, campaign, referrer, orderId, createdAt.
   - Events: landing_view, landing_cta_click, menu_arrival, order_conversion.
   - Evidence: prisma/schema.prisma:897-918; lib/customer-journey.ts:3-15.

2. CampaignLink + CustomerOrder
   - code, sourcePlatform, creator, viewCount, clickCount.
   - CustomerOrder stores campaignCode and campaignLinkId.
   - Can attribute consumer orders/revenue to a campaign short link.
   - Evidence: prisma/schema.prisma:855-895, prisma/schema.prisma:1177-1203.

3. Product marketing UTM capture
   - /p accepts utm_source, utm_medium, utm_campaign, creator, campaignId.
   - Persists values in localStorage and a CustomerOrder remark; values also enter TikTok Pixel events.
   - The submitted marketingTracking object is not accepted by /api/public/orders, so normalized database persistence is only the remark unless ref is also used.
   - Evidence: app/p/[slug]/page.tsx:7-12, app/p/[slug]/page.tsx:619-658, app/p/[slug]/page.tsx:917-938; app/api/public/orders/route.ts:64-76.

4. Correlation carriers
   - BindToken maps a Telegram bind to tenant/store/role.
   - Customer bind payload can correlate Telegram identity to storeCode and orderNo.
   - These are useful identifiers but not marketing attribution by themselves.

### 5.2 Partial or narrow

- /m recognizes source/campaign but requires a Store and is designed for customer order journeys.
- /v provides campaign attribution but only to menu/product orders for an existing merchant Store.
- Campaign views/clicks are aggregate counters, not identifiable click rows.
- Telegram payload resolution can transport a string, but downstream semantics only understand bind_, open, or customer bind payloads.
- StoreCustomerContact has source, but it is fixed to telegram_bind_after_order rather than original traffic source.

### 5.3 Existing fields that are not marketing attribution

- SaleRecord.source such as CASHIER_OFFLINE.
- payment callback/inquiry source.
- desktop authentication source ACCOUNT / DEVICE / STORE_CODE.
- AI intent or photo-recognition source.
- OperationLog/delegation source.
- SubscriptionEvent.operatorId.
- Creator and CampaignLink are merchant-side customer acquisition/promoter records, not E-Shop platform sales-lead ownership.

### 5.4 Completely absent for prospective merchants

- source/ref/referrer/referral/UTM/campaign on StoreApplication.
- source/campaign on TelegramMessage or SupportSession.
- platform merchant lead/click/touch record.
- generic anonymous merchant visitor ID.
- visitor → Telegram user bridge.
- lead → conversation linkage.
- conversation → application linkage.
- application → direct Store ID.
- lead stage, next follow-up, assignee, claimedBy, sales owner.
- affiliate/promo/referral mechanism tied to application or merchant conversion.

## 6. Existing Identity Capability

### 6.1 Anonymous phase

For generic merchant traffic:

| Identity question | Result |
|---|---|
| browser identity | **NOT PRESENT** |
| anonymous session | **NOT PRESENT** |
| merchant visitor | **NOT PRESENT** |
| individual merchant click | **NOT PRESENT** |

Narrow exception: the customer /m order journey has a browser-local visitorId and event records. It is not used on /, /start, /open, Telegram merchant onboarding, StoreApplication, or Ops conversations.

- visitorId generation: app/m/[storeCode]/PrivateLandingShell.tsx:196-205.
- event persistence: app/api/public/landing-events/route.ts:49-59.

CampaignLink has aggregate viewCount/clickCount only, so it cannot identify an anonymous browser or individual click.

### 6.2 After Telegram starts

| Context | Data available | Persistence |
|---|---|---|
| Merchant WebApp auth | Telegram user id from verified initData | User.telegramId; auth-session references internal user/tenant/store/role |
| Store application | Telegram id, username, first/last in initData, entered/prefilled owner name | StoreApplication stores telegramId, telegramUsername, ownerName; first/last are not separately stored |
| Merchant bind | Telegram id and profile data available | User stores telegramId and displayName; User has no Telegram username/first/last columns |
| Customer Bot bind | Telegram id, username, first name, last name, language, storeCode, optional orderNo | StoreCustomerContact stores all listed fields and lastOrderId |
| Merchant support message | Telegram id and display name | TelegramMessage.recipientTelegramId and senderName |
| Customer Bot conversation | Telegram id, store/tenant context if resolvable | ConversationLog |

Real identity models:

- User: prisma/schema.prisma:275-304.
- Member: existing-store POS/member identity with name, phone, optional Telegram identity and balance; not a prospective-merchant lead: prisma/schema.prisma:506-535.
- StoreCustomerContact: prisma/schema.prisma:1005-1027.
- CustomerOrder optional customerTelegramId/contact details: prisma/schema.prisma:855-888.
- StoreApplication: prisma/schema.prisma:813-828.
- OpsAdmin: prisma/schema.prisma:988-1002.

Models named Lead, Visitor, Click, Chat, Customer, StoreCustomer, or generic Contact were not found. StoreCustomerContact exists under that full name. SupportSession exists but is state, not an authenticated Web session.

### 6.3 Anonymous click to Telegram identity

**NO LINKAGE FOUND.**

CustomerJourneyEvent has visitorId but no telegramId. Merchant auth/application has telegramId but no visitorId/source/campaign. Telegram start redirects do not preserve the anonymous key.

## 7. Existing Conversation Capability

### 7.1 Data models

| Model | Purpose | Material limitations |
|---|---|---|
| TelegramMessage | Merchant Bot inbound/outbound/system message log | no conversationId, bot/channel, read/unread, external message ID, assignee, close/archive, source, application |
| SupportSession | one state row per telegramId: auto_active / awaiting_human / human_active | global Telegram key, no bot/channel key, no assignee, no release/reset endpoint, no lifecycle history |
| ConversationLog | Customer Bot rule/AI IN/OUT logs | not used by Ops current-conversation API; no assignee/read state/conversation lifecycle |
| AiSupportAudit | AI support audit | not a sales conversation or lead |

Evidence: prisma/schema.prisma:830-845, prisma/schema.prisma:928-938, prisma/schema.prisma:1156-1174.

### 7.2 Ops APIs

- GET /api/ops/conversations
  - reads only TelegramMessage where sentBy=CUSTOMER;
  - takes latest 300 messages and groups by Telegram ID;
  - messageCount is therefore count within that capped sample, not an authoritative total/unread count;
  - current means last customer message within 30 days or a human state;
  - archive is derived by age, not persisted.
  - Evidence: app/api/ops/conversations/route.ts:11-12, app/api/ops/conversations/route.ts:43-64, app/api/ops/conversations/route.ts:76-129.

- GET /api/ops/conversations/TELEGRAM_ID
  - returns up to 100 TelegramMessage rows, chronological.
  - Evidence: app/api/ops/conversations/[telegramId]/route.ts:17-37.

- POST /api/ops/messages
  - sends via sendAndLogMessage and logs sentBy=OPS.
  - Evidence: app/api/ops/messages/route.ts:37-68.

- POST /api/ops/support/TELEGRAM_ID/takeover
  - sets human_active only;
  - comment explicitly says reset is for a future version.
  - Evidence: app/api/ops/support/[telegramId]/takeover/route.ts:1-27.

Not found:

- unread/read API;
- assign/claim/reassign API;
- named operator on takeover/reply;
- close/reopen/archive mutation;
- support-session release/reset route;
- conversation/application/source link.

### 7.3 Bot split

Merchant Bot:

- webhook: /api/webhook/merchant;
- token: TELEGRAM_BOT_TOKEN;
- incoming messages append TelegramMessage;
- unbound senders are allowed with tenantId null;
- human_active suppresses automatic reply but keeps logging;
- escalation sets awaiting_human;
- optional forwarding to FORWARD_CHAT_ID.

Evidence: app/api/webhook/merchant/route.ts:132-187, app/api/webhook/merchant/route.ts:803-820, app/api/webhook/merchant/route.ts:848-909.

Customer Bot:

- webhook: /api/webhook/customer;
- token: CUSTOMER_BOT_TOKEN;
- customer conversation messages append ConversationLog;
- it can set the shared SupportSession to awaiting_human;
- regular customer messages do not append TelegramMessage.

Evidence: app/api/webhook/customer/route.ts:14-38, app/api/webhook/customer/route.ts:423-478, app/api/webhook/customer/route.ts:481-501, app/api/webhook/customer/route.ts:710-726.

Critical boundary:

- Ops current conversations are sourced from TelegramMessage.
- Customer Bot conversations are sourced from ConversationLog.
- Ops manual reply defaults to TELEGRAM_BOT_TOKEN.

Therefore a Customer Bot escalation can set SupportSession but its messages are not listed by the current-conversations API, and an Ops reply would use the merchant Bot rather than the Customer Bot. The current UI is not a unified cross-Bot conversation center.

### 7.4 Multiple sessions

Message history can append indefinitely for the same Telegram ID, but SupportSession is a single global row keyed by telegramId. There is no explicit open/close session instance and no durable multiple-conversation lifecycle.

### 7.5 Can “Current Conversations” be the sales-follow-up foundation?

Overall classification: **REUSABLE WITH SMALL EXTENSION**, with an important boundary.

- Reusable: Telegram ID thread key, message persistence, Ops list/thread APIs, manual reply transport, human-waiting state, Ops authentication/UI shell.
- Not reusable as-is as CRM: no source, lead/application link, assignee, sales stage, follow-up date, notes, close/reopen, channel key, or reliable unread/message totals.
- NOT SUITABLE component: the current SupportSession lifecycle by itself is not a sales pipeline and must not be relabeled as one.
- Customer Bot unification is not a cosmetic extension; Bot/channel-safe persistence and reply routing must be made explicit before it can support sales follow-up.

## 8. Store Application and Approval Chain

### 8.1 Current chain

t.me/merchant_bot?startapp=open
→ TelegramInit routes exact open payload to /open
→ /open reads verified Telegram initData and applicant-entered names
→ POST /api/open
→ StoreApplication PENDING
→ GET /api/ops/applications?status=PENDING
→ Ops approve
→ one database transaction creates Tenant, Store, OWNER User, UserStoreRole
→ application becomes APPROVED and records approvedAt + tenantId
→ trial subscription is created
→ merchant Bot sends approval/welcome message
→ next Mini App open authenticates User by Telegram ID.

Evidence:

- creation: app/api/open/route.ts:31-105;
- listing: app/api/ops/applications/route.ts:9-22;
- approval transaction: app/api/ops/applications/[id]/approve/route.ts:34-93;
- notification/response: app/api/ops/applications/[id]/approve/route.ts:95-109;
- later auth: app/api/auth/telegram/route.ts:90-156.

### 8.2 Application field audit

| Field/link | Result |
|---|---|
| Telegram user id | PRESENT |
| Telegram username | PRESENT, optional |
| firstName / lastName | NOT separately persisted |
| owner name | PRESENT, entered or prefilled into ownerName |
| phone | NOT PRESENT |
| store name | PRESENT |
| application status | PRESENT |
| applied time | PRESENT as createdAt |
| approved time | PRESENT as approvedAt |
| tenant linkage | PRESENT after approval as tenantId |
| direct Store linkage | NOT PRESENT |
| User/OWNER binding | PRESENT through User.telegramId + UserStoreRole created in approval transaction |
| operator/approvedBy | NOT PRESENT on application |
| conversation linkage | NOT PRESENT |
| source/ref/referral/campaign/UTM | NOT PRESENT |
| invite token | nullable legacy bindTokenValue field exists, but current approval flow does not set or require it |
| note | PRESENT, but not used as a structured attribution/follow-up field |

Schema evidence: prisma/schema.prisma:813-828.

### 8.3 Application to Store

The approval transaction unquestionably creates one Store and one OWNER User for the application. However StoreApplication does not store store.id.

Direct linkage result:

**NO DIRECT CONVERSION LINK FOUND**

An indirect reconstruction is possible:

StoreApplication.tenantId
→ Tenant
→ User where telegramId matches applicant
→ UserStoreRole
→ Store.

That is not an explicit application-to-created-Store conversion foreign key and can become ambiguous with multi-store or cross-tenant owner identities.

The Ops user ID is passed into trial-subscription creation, producing a SubscriptionEvent.operatorId. That is subscription audit, not application approvedBy or sales ownership.

## 9. First/Last Contact Timestamps

| Required concept | Existing evidence | Assessment |
|---|---|---|
| First Seen | CustomerJourneyEvent.createdAt can derive minimum per visitor; StoreCustomerContact.firstBoundAt exists | PARTIAL; no merchant-lead firstSeenAt |
| Last Seen | StoreCustomerContact.lastSeenAt; CustomerJourneyEvent max(createdAt) can be derived | PARTIAL; no generic merchant visitor/lead lastSeenAt |
| Last Message | TelegramMessage.createdAt and ConversationLog.createdAt; Ops derives latest | PARTIAL; no lastMessageAt field |
| Applied At | StoreApplication.createdAt | PRESENT |
| Approved At | StoreApplication.approvedAt | PRESENT |
| Activated At | device lifecycle fields only | NOT PRESENT for merchant lead/application/store activation |
| Last Activity | Ops derives merchant business activity from sales/orders | PRESENT for merchant operations, not lead follow-up |

SupportSession.createdAt/updatedAt timestamps state-row creation/change, not a formal conversation start/end or last message.

## 10. Sales Owner / Operator Assignment

Searches for assignedTo, handledBy, assignee, claimedBy, claimedAt and approvedBy found no lead/conversation/application ownership field.

Current human states answer only “waiting” or “human active”; they do not answer which OpsAdmin took ownership.

- SupportSession fields: prisma/schema.prisma:928-938.
- OpsAdmin identity exists: prisma/schema.prisma:988-1002.
- takeover API writes only sessionState: app/api/ops/support/[telegramId]/takeover/route.ts:21-27.
- manual reply logs sentBy=OPS but not the specific OpsAdmin ID: app/api/ops/messages/route.ts:53-58; lib/telegram.ts:83-101.

Other operator fields found are unrelated:

- SubscriptionEvent.operatorId: subscription audit.
- POS/sales operator fields: transaction execution.
- CustomerTouchLog.sentByUserId: merchant-to-existing-customer templated outreach, not platform prospect sales ownership.

## 11. Existing Ops Admin

The current Ops backend already provides:

- merchant count and filtered count;
- current and historical conversations;
- waiting-human and human-active status;
- message thread and manual reply;
- pending store applications and approval;
- merchant list and merchant detail;
- OWNER/STAFF Telegram-bound identities;
- renewal-due and merchant-attention summaries;
- recent merchant activity;
- merchant search/filter in /ops/overview;
- tenant creation and operational/broadcast tools.

Evidence:

- app/ops/page.tsx:195-230 loads applications/conversations/merchant work;
- app/ops/page.tsx:342-346 summary tiles;
- app/ops/page.tsx:929-1189 conversation/takeover/reply UI;
- app/ops/page.tsx:1212-1296 application approval UI;
- app/api/ops/overview/route.ts:46-239 merchant operational overview.

Missing for a Sales Lead layer:

- lead list;
- source/campaign/referral filtering;
- lead/contact profile;
- assignee and ownership;
- next follow-up/task;
- lead stage/outcome;
- conversation ↔ application ↔ Store chain;
- first-touch and last-touch view.

Assessment: adding a small Sales Lead layer to this Ops shell is technically realistic. The existing “current conversations” section should remain support-oriented unless the missing channel, ownership, and lifecycle semantics are added.

## 12. Scenario Answers

### Scenario A

TikTok
→ https://xxx.com/?source=tiktok&campaign=launch01

- The request reaches app/page.tsx, but there is **no implemented read point** for source/campaign on /.
- The first root navigation drops both values.
- If the target is instead /m/STORECODE?source=tiktok&campaign=launch01, app/m/[storeCode]/page.tsx is the earliest implemented reader and the values survive through the customer order journey.
- They do not survive into merchant onboarding/application.

### Scenario B

Facebook
→ Telegram Deep Link

- The generic merchant start-param resolver can technically return an arbitrary string.
- Current downstream behavior recognizes only bind_ or exact open for merchant onboarding.
- Customer Bot recognizes only bind_STORECODE and bind_STORECODE_ORDERNO.
- Therefore there is **transport capacity but no attribution payload contract or persistence**.

Result: PARTIAL infrastructure; not usable end-to-end today.

### Scenario C

QR
→ same attribution URL

- QR libraries can encode a URL.
- Campaign QR already uses exactly the same /v/CODE value as copy-link.
- Invite/store/table generators hardcode their URL shapes and expose no source/ref/campaign input.

Result:

- existing Campaign QR: YES;
- existing generic/open/store QR UI for arbitrary attributed URL: NO;
- reusable QR/link primitive: YES.

### Scenario D

Jason shares a dedicated link carrying ref=sales_jason.

- URLs can mechanically carry the query.
- /menu ref expects a valid CampaignLink code and attributes customer orders.
- /p UTM/creator values are customer marketing-page metadata.
- no platform sales-person referral registry, persistence, or application/conversion join exists.

Result: **NO suitable current E-Shop merchant-sales mechanism.** This is a NEW MINIMAL CAPABILITY, not a reuse of Creator/CampaignLink semantics.

## 13. Traffic Attribution vs Identified Lead

### Traffic Attribution

PARTIAL:

- present for customer store landing and campaign order funnels;
- absent for generic merchant entry, Telegram open application, conversations, and StoreApplication.

### Identified Lead

PARTIAL:

- Telegram yields a stable user ID;
- StoreApplication and merchant messages can identify that Telegram user;
- there is no Lead entity or common prospect record;
- the identity is not joined to the original traffic touch.

### Anonymous → Telegram bridge

**MISSING.**

No current record links CustomerJourneyEvent.visitorId or a generic browser visitor to Telegram ID when the user opens the Bot/WebApp.

## 14. End-to-End Gap Map

| Node | Status | Repository evidence / gap |
|---|---|---|
| External Link / QR | **PRESENT** | public URL helpers, /m links, invite QR, table QR, campaign /v QR |
| Source identification | **PARTIAL** | /m source/campaign and /v CampaignLink work for customer orders; merchant onboarding does not capture |
| Customer identity identification | **PARTIAL** | Telegram ID works after launch; generic anonymous merchant identity absent |
| Create/find conversation | **PARTIAL** | TelegramMessage/SupportSession and ConversationLog exist, but Bot stores are split and no formal conversation instance |
| Manual sales communication | **PARTIAL** | Ops can take over/reply on merchant Bot; no sales ownership, follow-up state, source, or application link |
| Send store-opening entry | **PARTIAL** | fixed startapp=open and /open exist; no source-carrying entry or structured action from conversation |
| Submit StoreApplication | **PRESENT** | /api/open creates PENDING application with Telegram identity |
| Ops review/approval | **PRESENT** | Ops list + approve transaction |
| Create Store | **PRESENT** | approval creates Tenant, Store, User, UserStoreRole |
| Confirm successful source conversion | **MISSING** | no original source, conversation/application link, or direct Application→Store ID |

Condensed requested map:

Link / QR — PRESENT
↓
Attribution — PARTIAL
↓
Identity — PARTIAL
↓
Conversation — PARTIAL
↓
Sales Follow-up — MISSING
↓
Application — PRESENT
↓
Approval — PRESENT
↓
Store — PRESENT
↓
Conversion — MISSING

## 15. Conversion Capability

Can the current system prove:

“A prospect from TikTok/Facebook/poster/Jason, identified as Telegram user X, was followed by salesperson Y, submitted application A, and became Store S”?

**NO.**

What it can prove separately:

- Telegram user X submitted application A.
- Ops approved application A and created tenant T plus an OWNER User for X.
- The approval transaction created a Store under T.
- Customer campaign C produced CustomerOrder O for an existing Store.
- Telegram user X exchanged merchant-Bot support messages.

What it cannot prove:

- which original source brought applicant X;
- which anonymous visit became X;
- which conversation/follow-up produced application A;
- which salesperson owned the follow-up;
- a direct application A → store S relation;
- a source-level merchant conversion.

## 16. Reuse Matrix

| Existing capability | Classification | Reason |
|---|---|---|
| publicUrl / publicCustomerEntryUrl and QR rendering | **REUSE** | URL and QR already share generated values |
| Telegram start-param resolver and verified initData identity | **REUSE** | stable transport/identity building blocks |
| TelegramMessage send/log and Ops manual reply | **REUSE** | valid message transport and persistence base |
| StoreApplication submission and approval transaction | **REUSE** | real applicant → merchant creation workflow |
| Ops auth, application list, merchant details/overview shell | **REUSE** | suitable operational host |
| Preserve a small attribution allowlist through merchant landing/open | **SMALL EXTENSION** | current routes discard it; no broad platform required |
| Add channel-safe source/application linkage to a sales thread | **SMALL EXTENSION** | reuse thread UI/transport, add missing semantics |
| Record minimal first touch and bind it to Telegram identity | **NEW MINIMAL CAPABILITY** | no generic merchant visitor/touch bridge exists |
| Record explicit Application → created Store conversion | **NEW MINIMAL CAPABILITY** | no direct Store ID exists on application/conversion record |
| Record sales owner + follow-up state/timestamps | **NEW MINIMAL CAPABILITY** | current human state has no named owner or follow-up lifecycle |
| Full CRM, AI sales, auto follow-up, commissions, channel APIs, marketing automation, CDP | **DEFERRED** | explicitly outside this lane and unnecessary for the minimum chain |

## 17. Minimal Recommendation for a Later Phase

If a next phase is approved, the smallest coherent scope is:

1. Establish one canonical merchant-entry attribution contract for ordinary URLs and Telegram payloads, with a small allowlist such as source, campaign, ref.
2. Preserve one stable first-touch identifier until Telegram identity appears, then record the bridge once.
3. Attach the identified attribution/contact to StoreApplication and the relevant sales conversation.
4. Record a named Ops/sales owner plus only the minimum follow-up state and timestamps.
5. Record an explicit application-to-created-Store conversion link at approval.
6. Make Bot/channel identity explicit before reusing current conversations across merchant and customer Bots.

Not recommended in the next minimum phase:

- general CRM platform;
- Facebook/TikTok/WhatsApp messaging APIs;
- AI sales or automatic replies/follow-up;
- advertising APIs;
- commissions;
- bulk messaging;
- CDP, marketing automation, or broad analytics redesign.

All items above remain **DEFERRED**.

## 18. Audit Boundary and Final Result

Repository audit completed without changing application code, Prisma schema, migrations, Bots, Ops UI, QR generation, link generation, deployment configuration, Preview, or Production.

Final result:

- Link/QR infrastructure: substantial and reusable.
- Consumer traffic attribution: real but narrow.
- Telegram identity: real after launch.
- Manual support: real but split across two Bot persistence paths.
- Store application/approval/store creation: real.
- Platform merchant sales follow-up: missing as a structured capability.
- End-to-end source-to-merchant proof: **NO**.

## 19. Verification

- npm ci: PASS from repository lockfile.
- npm run build: **PASS**.
- Next.js production build: compiled, type-checked, generated 153 static pages, and completed build traces.
- First build attempt against the original worktree's shared node_modules failed because that directory lacked lockfile-declared QZ/AWS packages. A clean lockfile install in this isolated worktree resolved it without source changes.
- Final Git scope before commit: this Audit document only.
- Risk: LOW; documentation-only lane, no runtime or deployment mutation.
