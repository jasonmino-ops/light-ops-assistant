# ES-SALES-LEAD-01 Minimal Implementation Design V0.1

- Design date: 2026-08-19
- Development lane: `codex/e-shop-sales-lead-attribution-v01`
- Audit base: `0164842299f39d582ab4040ef59bb98fd68314fe`
- Audit commit: `ac2a6239c11d9f46f5b5da6ba7c318bebc6c9347`
- Audit evidence: `docs/audits/ES-SALES-LEAD-01_REPOSITORY_AUDIT_V0.1.md`
- Classification: architecture design / minimal implementation design
- Scope: design only
- Business code, Prisma schema, migration, UI, Bot, Preview, Production changed: **NO**
- Required next gate: Architecture Review

## 1. Lineage Gate

### 1.1 Evidence

| Check | Result |
|---|---|
| Original working directory | `/Users/jason/light-ops-assistant` |
| Original branch | `开店销售路径跟踪` |
| Original working tree | DIRTY; unrelated modified and untracked documentation paths remain untouched |
| Recovered design worktree | `/private/tmp/e-shop-sales-lead-attribution-v01.EBV61h` |
| Recovered branch | `codex/e-shop-sales-lead-attribution-v01` |
| Recovered HEAD before this design | `ac2a6239c11d9f46f5b5da6ba7c318bebc6c9347` |
| Audit commit exists | YES |
| Audit document exists | YES |
| Latest `origin/main` after fetch | `0164842299f39d582ab4040ef59bb98fd68314fe` |
| Production SHA | `0164842299f39d582ab4040ef59bb98fd68314fe` (`npm run vercel:current`, READY Production) |
| Merge base with `origin/main` | `0164842299f39d582ab4040ef59bb98fd68314fe` |
| Branch relative to `origin/main` before design | 0 behind / 1 ahead; the one commit is the Audit document |
| Design worktree before design | CLEAN |
| Release lineage script | `RESULT: PASS` |

`origin/main` has **not** changed since the Audit. No rebase, merge, or product-goal adjustment is needed. The dirty original branch is not a source or destination for this work.

**Lineage Gate: PASS**

## 2. Architecture Summary

### 2.1 Frozen outcome

V0.1 implements one traceable merchant-acquisition loop and nothing broader:

```text
AcquisitionInvite
  → /j/[code] visit and valid lead form
  → SalesLead (first-touch locked)
  → phone/dedup/rate/block guards
  → opaque Telegram bridge token
  → verified Merchant Bot Telegram identity
  → existing TelegramMessage / SupportSession / Ops conversation
  → existing /open confirmation
  → existing StoreApplication review
  → existing approval transaction
  → exact StoreApplication.createdStoreId
  → attributable conversion
```

This is not a CRM, a new chat platform, or an alternative application workflow.

### 2.2 Core decisions

1. **The short Web link is canonical.** Each invite owns one immutable code and one URL, `https://elifekh.com/j/<code>`. The QR renders that exact URL. There is no QR-specific attribution model.
2. **Lead exists before Telegram.** A valid store name, owner name, and normalized phone create or restore a `SalesLead` immediately. Telegram abandonment does not lose the contact.
3. **First touch is a server-owned snapshot.** `firstSourceChannel`, `firstCampaign`, and `initialSalesOwnerId` are copied from the invite only when the lead is first created and are never overwritten by later links.
4. **Telegram carries only an opaque capability token.** `startapp=open_<opaque>` contains no phone, name, address, GPS, campaign, invite code, or database ID. Only a SHA-256 hash is stored.
5. **Merchant Bot is the sole sales/support channel.** It already feeds `TelegramMessage`, `SupportSession`, Ops takeover, and Ops replies. The Customer Bot remains the customer-order channel and is not added to the sales flow.
6. **`/open` remains the formal application endpoint.** It becomes a resume/confirmation screen, not a second lead form system. Legacy `startapp=open` remains valid.
7. **Application and lead remain different records.** A Web lead is not an application. A `StoreApplication` is created only after verified Telegram identity and explicit `/open` confirmation.
8. **Conversion becomes an explicit relation.** Approval writes `StoreApplication.createdStoreId` in the same existing transaction that creates the Store.
9. **Assignment is not a pipeline state.** `initialSalesOwnerId = null` is displayed as `UNASSIGNED`; no separate status, round robin, reassignment workflow, or capacity model is introduced.
10. **Funnel values are derived from event/relationship rows.** No copied dashboard counter columns are proposed.

### 2.3 Existing evidence and proposed change points

| Existing repository evidence | Existing capability | Proposed minimal change |
|---|---|---|
| `app/invite/page.tsx` | `react-qr-code`, one URL for QR/display/copy, WebView clipboard fallback | Reuse the dependency and copy/render pattern in an isolated Ops acquisition-invite page; do not reuse merchant `BindToken` semantics |
| `lib/public-url.ts` | canonical public host and `publicUrl(path)` | Build `/j/<code>` with `publicUrl`; no second link builder |
| `lib/telegram-link.ts` | sanitized Merchant Bot username and `startapp` link builder | Reuse for `open_<token>`; add a narrowly scoped Bot-chat `start` builder for `support_<token>` |
| `lib/telegram-start-param.ts` | resolves Telegram start payload across SDK/query/hash/initData sources | Extend with strict `open_` / `support_` parsing, length and character guards; retain `bind_` behavior unchanged |
| `app/components/TelegramInit.tsx` | routes `bind_` and exact `open` | Recognize exact `open` and `open_<token>` before public-path short-circuit; redirect to `/open` without putting token into the browser URL |
| `app/open/page.tsx` | verified-Telegram application form and submitted state | Keep the route; add context load, prefill, phone and optional location/address, resume states, support footer, and true zh/en/km keys |
| `app/api/open/route.ts` | verifies Merchant Bot initData, guards existing merchant, creates `StoreApplication` | Extract/reuse shared initData verification, resolve lead token, enforce application guard/blocklist/idempotency, create/link application transactionally |
| `app/api/webhook/merchant/route.ts` | logs inbound Merchant Bot messages, owns `SupportSession`, supplies Ops current conversations | Handle `/start support_<opaque>` as sanitized help context; bind identity and create an awaiting-human conversation without creating an application |
| `lib/telegram.ts`, `app/api/ops/messages/route.ts` | Merchant Bot send + `TelegramMessage` persistence and Ops reply | Keep send/persist behavior; after a successful Ops reply, make the small lead `lastActivityAt` update; no `SalesMessage` or new Bot |
| `app/api/ops/conversations/*`, `app/api/ops/support/*`, `app/ops/page.tsx` | current/history conversation list, full messages, takeover, reply | Join a lead summary by `telegramId`, link to lead detail, support Ban Application, and allow `/ops?lead=<leadId>` to open the existing conversation |
| `StoreApplication`, `app/api/ops/applications/*` | PENDING/APPROVED/REJECTED and approval transaction | Add nullable lead and Store relations; add idempotent reject; update lead/application/store linkage in existing transaction |
| `lib/ops-auth.ts`, `OpsAdmin` | Ops identity and role hierarchy | Reuse for all PII and mutation authorization; use `OpsAdmin` as invite sales owner |
| `lib/member-phone.ts` | Cambodia-oriented normalization | Reuse normalization behavior inside a new strict sales-lead validator; do not relax/change member behavior |
| `lib/store-location.ts` | address cleaning and coordinate range validation | Reuse cleaners/range checks; location is always optional |
| `LangProvider`, `lib/i18n/{zh,en,km}.ts` | existing three-language framework | Add all new keys to the same dictionaries; no second i18n layer |

## 3. Reuse Matrix

| Capability | Classification | Design decision |
|---|---|---|
| `publicUrl('/j/<code>')` | **REUSE AS-IS** | Canonical short-link host/path generation |
| `react-qr-code` | **REUSE AS-IS** | QR value is the exact short link |
| Invite page copy fallback | **SMALL EXTENSION** | Extract or reproduce the existing tested clipboard + `execCommand` pattern in one small shared component/helper |
| Existing OWNER/STAFF `BindToken` API | **DEFERRED / NOT REUSED FOR ACQUISITION** | It is tenant/store/role binding, not a prospective-merchant invite |
| `buildTelegramStartAppLink` | **REUSE AS-IS** | Generates `startapp=open_<token>` |
| Bot-chat support link builder | **NEW MINIMAL CAPABILITY** | Generates `?start=support_<token>` for the same Merchant Bot |
| `resolveTelegramStartParam` | **SMALL EXTENSION** | Add typed open/support extraction and repository-side payload guard; preserve bind precedence |
| `TelegramInit` | **SMALL EXTENSION** | Route tokenized open to existing `/open`; no PII or token in normal Web URL |
| Merchant Bot webhook | **SMALL EXTENSION** | Resolve support token and persist a sanitized help message/context |
| Customer Bot webhook / `ConversationLog` | **REUSE AS-IS OUTSIDE SCOPE** | Customer ordering remains separate and unchanged |
| `TelegramMessage` | **REUSE AS-IS** | Sole sales/support message persistence; latest message time remains derivable from `createdAt` |
| Ops reply API | **SMALL EXTENSION** | Keep Merchant Bot send path and touch the matching Lead activity time after success |
| `SupportSession` | **REUSE AS-IS** | Existing `awaiting_human` / `human_active`; sales owner comes from the joined lead |
| Ops current/history conversation UI/API | **SMALL EXTENSION** | Lead join, lead navigation, application-ban action; no new conversation table |
| `/open` | **SMALL EXTENSION** | Becomes Telegram confirmation/resume endpoint while retaining legacy entry |
| `StoreApplication` | **SMALL EXTENSION** | Add nullable `salesLeadId` and `createdStoreId`; existing formal meaning/status retained |
| Approval transaction | **SMALL EXTENSION** | Write exact Store link and Lead `ACTIVATED` atomically; do not rewrite tenant/store/user creation |
| Ops auth / `OpsAdmin` | **REUSE AS-IS** | PII access, invite owner, ban audit actor |
| Existing i18n | **SMALL EXTENSION** | Add real Chinese, English, Khmer strings to existing dictionaries |
| Phone normalization | **SMALL EXTENSION** | Wrap existing Cambodia normalization with strict lead rules |
| Location validation | **REUSE AS-IS** | Existing cleaners and lat/lng range checks |
| Generic public rate limiter | **NEW MINIMAL CAPABILITY** | No reliable repository helper exists; add one DB-backed, flow-scoped guard table/helper |
| Support configuration | **NEW MINIMAL CAPABILITY** | One small server helper using existing Merchant Bot username plus one support-phone environment value |
| Sales lead/invite/block/token/visit data | **NEW MINIMAL CAPABILITY** | Six focused models; no CRM infrastructure |
| CRM, AI sales, multi-touch, task/timeline/tag systems | **DEFERRED** | Explicitly excluded from V0.1 |

## 4. Proposed Data Model

This section is a proposal only. `prisma/schema.prisma` is not changed by this design.

### 4.1 Enums

```prisma
enum AcquisitionSourceChannel {
  FACEBOOK
  TIKTOK
  SALES
  POSTER
  TELEGRAM
  OTHER
  DIRECT_TELEGRAM
}

enum AcquisitionInviteStatus {
  ACTIVE
  INACTIVE
}

enum SalesLeadStatus {
  NEW
  FOLLOWING
  WAITING_TELEGRAM
  APPLIED
  ACTIVATED
  LOST
}

enum SalesLeadTokenPurpose {
  APPLICATION_OPEN
  SUPPORT
}

enum SalesLeadSupportStage {
  LEAD_FORM
  OPEN_CONFIRMATION
  WAITING_APPROVAL
}

enum SalesLeadGuardAction {
  LEAD_CREATE
  APPLICATION_SUBMIT
}
```

`DIRECT_TELEGRAM` is system-written for legacy `startapp=open`; invite-management APIs must reject it as a selectable acquisition-invite source.

### 4.2 `AcquisitionInvite` — new

| Field | Shape | Why |
|---|---|---|
| `id` | `String @id @default(cuid())` | Internal identifier; never used as public code |
| `code` | `String @unique` | Immutable 10-character uppercase Crockford/Base32 code; about 50 bits of non-sequential space |
| `sourceChannel` | `AcquisitionSourceChannel` | Required controlled source |
| `campaignLabel` | `String?` | Optional campaign/label, max 80 characters |
| `salesOwnerId` | `String?` → `OpsAdmin` | Optional owner inherited by future leads |
| `internalNote` | `String? @db.Text` | Internal-only, bounded to 500 characters in API |
| `status` | `AcquisitionInviteStatus @default(ACTIVE)` | Enable/disable without deletion |
| `createdAt` | `DateTime @default(now())` | Invite creation time |
| `updatedAt` | `DateTime @updatedAt` | Operational state changes |

Indexes/relations:

- `@@index([status, createdAt])`
- `@@index([salesOwnerId, status])`
- relations to `OpsAdmin`, `SalesLead[]`, and `AcquisitionInviteVisit[]`.

Rules:

- Code is generated server-side with `crypto.randomBytes`, retried on unique collision, never edited, never reused, and never sequential.
- Changing the invite's owner/campaign affects only future leads. Existing lead snapshots stay locked.
- Delete is not exposed in V0.1; only ACTIVE/INACTIVE.

### 4.3 `AcquisitionInviteVisit` — new

| Field | Shape | Why |
|---|---|---|
| `id` | `String @id @default(cuid())` | Visit record |
| `acquisitionInviteId` | required relation | Funnel grouping |
| `visitorId` | random browser-local UUID | Pseudonymous browser continuity, following the existing `/m` visitor pattern; not a fingerprint |
| `eventKey` | `String @unique` | Makes a single page-view write idempotent under React/network retries |
| `createdAt` | `DateTime @default(now())` | Actual visit time |

Indexes:

- `@@index([acquisitionInviteId, createdAt])`
- `@@index([visitorId, createdAt])`

No raw IP, referrer URL, query UTM, phone, or PII is stored in this table. A visit is not a lead. Repeated legitimate page views can create distinct events; `eventKey` only removes duplicate delivery of the same event.

### 4.4 `SalesLead` — new

| Field | Shape | Source/reason |
|---|---|---|
| `id` | `String @id @default(cuid())` | Internal lead ID; not returned from public APIs |
| `storeName` | `String` | Required valid form data; existing `StoreApplication.storeName` semantics reused |
| `ownerName` | `String` | Required valid form data; existing application semantics reused |
| `normalizedPhone` | `String` | Only canonical normalized number is stored; no phone uniqueness |
| `storeAddress` | `String? @db.Text` | Optional, cleaned with existing location helper rules |
| `storeLat` | `Float?` | Optional; valid only with longitude |
| `storeLng` | `Float?` | Optional; valid only with latitude |
| `acquisitionInviteId` | `String?` relation | Null only for direct/legacy or historical-compatible flows |
| `firstSourceChannel` | `AcquisitionSourceChannel` | Immutable first-touch snapshot |
| `firstCampaign` | `String?` | Immutable campaign snapshot |
| `initialSalesOwnerId` | `String?` → `OpsAdmin` | Immutable inherited owner; null renders `UNASSIGNED` |
| `telegramId` | `String? @unique` | Stable identity after bridge; one first-store lead per Telegram identity in V0.1 |
| `telegramUsername` | `String?` | Display only; never a key |
| `telegramFirstName` | `String?` | Verified initData display snapshot |
| `telegramLastName` | `String?` | Verified initData display snapshot |
| `telegramBoundAt` | `DateTime?` | Telegram-bound funnel timestamp |
| `status` | `SalesLeadStatus` | Minimal lifecycle |
| `createdAt` | `DateTime @default(now())` | Lead/first-contact time |
| `lastActivityAt` | `DateTime @default(now())` | Updated only for meaningful lead events |
| `updatedAt` | `DateTime @updatedAt` | Technical update time |

Relations:

- optional `AcquisitionInvite`;
- optional immutable `initialSalesOwner: OpsAdmin`;
- one optional `StoreApplication` through `StoreApplication.salesLeadId`;
- many one-time context tokens.

Indexes/constraints:

- `telegramId @unique` is acceptable only because multi-store application is explicitly deferred. It is the post-Telegram application guard, not a global E-Shop ban.
- **Do not** make `normalizedPhone` unique.
- `@@index([acquisitionInviteId, normalizedPhone, createdAt])` supports the pre-Telegram dedup window.
- `@@index([normalizedPhone, createdAt])` supports the cautious cross-invite same-business first-touch check.
- `@@index([status, lastActivityAt])` supports Ops list ordering.
- `@@index([initialSalesOwnerId, status, lastActivityAt])` supports owner filtering.

No `storeId` is duplicated on `SalesLead`. Exact conversion is derived through `SalesLead → StoreApplication → createdStore`.

### 4.5 `SalesLeadContextToken` — new

| Field | Shape | Why |
|---|---|---|
| `id` | `String @id @default(cuid())` | Internal record |
| `salesLeadId` | required relation | Context target |
| `purpose` | `SalesLeadTokenPurpose` | Prevents support token from submitting an application |
| `supportStage` | `SalesLeadSupportStage?` | For SUPPORT tokens, records which of the three frozen screens issued the help action; null for APPLICATION_OPEN |
| `tokenHash` | `String @unique` | SHA-256 of raw random token; raw token is never stored |
| `expiresAt` | `DateTime` | Application token: 72 hours; support token: 24 hours |
| `consumedAt` | `DateTime?` | First successful verified claim |
| `consumedByTelegramId` | `String?` | Same-identity replay/resume test |
| `revokedAt` | `DateTime?` | Superseded token invalidation |
| `createdAt` | `DateTime @default(now())` | Audit/lifecycle |

Indexes:

- `@@index([salesLeadId, purpose, expiresAt])`
- `@@index([expiresAt])`

Raw token design:

- 16 random bytes from Node `crypto.randomBytes(16)` encoded base64url: 128 bits, normally 22 characters.
- Telegram payloads are `open_<22 chars>` and `support_<22 chars>`; both remain below the repository-enforced 64-character cap and use only `[A-Za-z0-9_-]`.
- Server hashes the raw token before lookup and uses constant-shape errors. Logs use the existing redaction approach and never log raw tokens.

Lifecycle:

- Issuing a fresh token revokes prior unconsumed tokens for the same lead/purpose in a serializable transaction.
- First verified identity claim sets `consumedAt` and `consumedByTelegramId`.
- Replay by the same Telegram ID returns the existing lead/application state idempotently.
- Replay by a different Telegram ID returns a generic invalid-context response and support entry; it never rebinds the lead.
- Expired, revoked, malformed, or unknown tokens do not disclose whether a lead exists.
- A SUPPORT token resolves Lead → Invite/source/campaign plus its allowlisted `supportStage`; none of those values are embedded in the URL.

### 4.6 `ApplicationBlock` — new

| Field | Shape | Why |
|---|---|---|
| `id` | `String @id @default(cuid())` | Internal record |
| `telegramId` | `String @unique` | Stable block identity |
| `telegramUsername` | `String?` | Display snapshot only |
| `reason` | `String` | Required bounded reason |
| `note` | `String? @db.Text` | Optional bounded operational context |
| `createdBy` | `String` | `checkOpsAuthContext().userId`, including supported legacy ops identity |
| `createdAt` | `DateTime @default(now())` | First/current ban time |
| `unblockedBy` | `String?` | Ops actor that removed the block |
| `unblockedAt` | `DateTime?` | Null means currently blocked |
| `updatedAt` | `DateTime @updatedAt` | Re-ban/unban changes |

Rules:

- One row per Telegram identity; re-ban updates reason/note/actor/time and clears unblock fields.
- Block only prevents `StoreApplication` creation. It does not prevent `/start support_<token>`, Merchant Bot messages, or Ops reply.
- `username` is never used for lookup or enforcement.
- `Reject` changes only application status. `Reject + Ban` performs both writes in one transaction. They are never implicit synonyms.

### 4.7 `SalesLeadGuardAttempt` — new

This table is intentionally specific to the two public writes. No general anti-fraud platform is introduced.

| Field | Shape | Why |
|---|---|---|
| `id` | `String @id @default(cuid())` | Attempt record |
| `action` | `SalesLeadGuardAction` | Lead form or formal application |
| `acquisitionInviteId` | `String?` | Invite-level threshold |
| `ipKey` | `String?` | HMAC of normalized client IP |
| `phoneKey` | `String?` | HMAC of normalized phone |
| `telegramKey` | `String?` | HMAC of Telegram ID |
| `accepted` | `Boolean` | Accepted/rejected attempt observation |
| `createdAt` | `DateTime @default(now())` | Sliding-window query |

Indexes:

- `[action, ipKey, createdAt]`
- `[action, acquisitionInviteId, createdAt]`
- `[action, phoneKey, createdAt]`
- `[action, telegramKey, createdAt]`
- `[createdAt]`

Raw IP/phone/Telegram values are not stored here. Keys use HMAC-SHA-256 with a dedicated `SALES_LEAD_GUARD_SECRET` and domain separation. Rows older than 30 days are eligible for bounded opportunistic deletion during write traffic; no scheduler is added.

### 4.8 Existing `StoreApplication` — nullable extensions

| Proposed field | Shape | Why |
|---|---|---|
| `salesLeadId` | `String? @unique` → `SalesLead` | One formal application per V0.1 lead; nullable for historical rows |
| `createdStoreId` | `String? @unique` → `Store` | Direct, provable conversion result |

Add `@@index([telegramId, status])` for the Telegram application guard.

Continue reusing existing fields:

- `storeName`, `ownerName`, `telegramId`, `telegramUsername` remain the formal application snapshot.
- `status` remains the existing `PENDING | APPROVED | REJECTED` string; do not create a second application state model in V0.1.
- `createdAt` is Applied At; `approvedAt` is Approved At.
- `tenantId` remains the approved Tenant relation/evidence.
- `note` stores a bounded rejection note for the minimal reject action; no notes platform is added.

`Store` gets only the inverse optional application relation. Historical applications and stores remain null/unlinked; the migration must not guess.

### 4.9 First-touch and mutation policy

The create transaction is the only writer of:

- `acquisitionInviteId`
- `firstSourceChannel`
- `firstCampaign`
- `initialSalesOwnerId`
- `createdAt`

Later invite visits, token reissues, Telegram binding, application confirmation, and Ops status updates must not include those fields in update payloads. Ops APIs use explicit allowlists rather than spreading request bodies into Prisma.

`lastActivityAt` is touched only by meaningful Lead events: valid lead create/restore, verified Telegram bind, contextual support start, inbound Merchant Bot message for a bound Lead, successful Ops reply, manual lead-status action, application create/reject, and approval. `TelegramMessage.createdAt` remains the source of truth for exact Last Message; the Lead field is not a replacement message timestamp.

Timestamp meanings stay minimal:

- First Seen / valid first contact: `SalesLead.createdAt`; an earlier anonymous hit is available from `AcquisitionInviteVisit.createdAt`.
- Last Seen / lead activity: `SalesLead.lastActivityAt`.
- Last Message: max `TelegramMessage.createdAt` for the bound `telegramId`.
- Applied At: existing `StoreApplication.createdAt`.
- Approved / Activated At: existing `StoreApplication.approvedAt` together with non-null `createdStoreId`; no duplicate activation timestamp is added.

## 5. State Machines

### 5.1 Invite

```text
                 Ops disable
ACTIVE ─────────────────────────→ INACTIVE
  ↑                                  │
  └──────────── Ops enable ──────────┘
```

- Code and existing attribution records never change.
- INACTIVE `/j/[code]` renders “当前邀请活动已结束” plus both support methods; it is not a 404 and cannot create a lead or visit-to-lead conversion.

### 5.2 Lead

```text
Valid Web form
  → WAITING_TELEGRAM
       ├─ verified Telegram bind → NEW
       ├─ Ops begins follow-up   → FOLLOWING
       └─ terminal manual result → LOST

Legacy /open confirmed in one transaction
  → APPLIED

NEW / FOLLOWING / WAITING_TELEGRAM
  ├─ formal StoreApplication created → APPLIED
  └─ terminal manual result          → LOST

APPLIED
  ├─ application approved + Store linked → ACTIVATED
  └─ application rejected                → LOST
```

Automatic transitions:

- Web create: `WAITING_TELEGRAM`.
- Telegram bind: `WAITING_TELEGRAM → NEW`; do not downgrade `FOLLOWING`.
- Application create/resume: `APPLIED`.
- Application approval and exact Store link: `ACTIVATED`.
- Application rejection: `LOST`.

Manual V0.1 transitions are limited to starting follow-up (`NEW` or `WAITING_TELEGRAM` to `FOLLOWING`) and marking a non-applied lead `LOST`. `APPLIED`/`ACTIVATED` cannot be manually forged in the lead API.

Assignment display is derived independently:

```text
initialSalesOwnerId is null     → UNASSIGNED
initialSalesOwnerId is present  → ASSIGNED
```

No reassignment workflow is included; changing an invite owner affects future leads only.

### 5.3 Telegram bridge

```text
UNBOUND
  ├─ valid token + verified initData → BOUND
  ├─ invalid / expired / revoked     → INVALID_CONTEXT
  ├─ token consumed by other TG      → REPLAY_REJECTED
  └─ TG already belongs to lead/app  → EXISTING_CONTEXT (resume, no duplicate)
```

`BLOCKED` is a derived application guard after identity is known, not a Telegram-binding status. A blocked user can bind/open support but cannot create a new application.

### 5.4 Context token

```text
ISSUED → CONSUMED
   ├────→ REVOKED
   └────→ EXPIRED (derived from expiresAt)
```

Same-identity consumed-token replay is a read-only resume. Other-identity replay is rejected.

### 5.5 Formal application and block

```text
StoreApplication: PENDING → APPROVED
                          └→ REJECTED

ApplicationBlock: ACTIVE   = unblockedAt is null
                  INACTIVE = unblockedAt is set
                  INACTIVE → ACTIVE on explicit re-ban
```

Existing application statuses are reused. `Reject` does not create a block. Approval must reject blocked or non-PENDING applications.

## 6. Route / API Map

All names are proposed and may be adjusted during Architecture Review. The public response shapes deliberately exclude lead IDs and PII unless the caller has verified Telegram or Ops identity.

### 6.1 New customer page

| Route | Access | Input | Output | Side effect / idempotency |
|---|---|---|---|---|
| `GET /j/[code]` | Public | path `code`, language | Active localized lead form, or inactive/invalid safe state with support | No lead. Client records one visit event after page render. Invalid and inactive responses expose no internal metadata. |

Implementation shape:

- A Server Component resolves the invite and passes only sanitized public fields to a small client form.
- Required: store name, owner name, phone.
- Optional: browser geolocation and manual address.
- Location permission is requested only after explicit user action. Rejection, timeout, unsupported browser, or absent coordinates never disables submit.
- The page always renders the centralized support footer.

### 6.2 New public APIs

| Route | Access | Input | Output | Side effect / idempotency |
|---|---|---|---|---|
| `POST /api/public/acquisition-invites/[code]/visit` | Public | `visitorId`, `eventKey` | `{ ok: true }` | Inserts `AcquisitionInviteVisit` for a real invite whether ACTIVE or INACTIVE; `eventKey @unique` makes retry idempotent. Unknown code returns a safe response and no visit. |
| `POST /api/public/sales-leads` | Public | `inviteCode`, store/owner/phone, optional address/lat/lng, `visitorId` | safe lead state, `telegramOpenUrl`, context-aware `supportUrl`, support display config | Validates ACTIVE invite, rate limit and phone; creates or restores lead, locks first touch, and issues application/support tokens. Dedup transaction is idempotent for same phone+invite within the window. No lead ID/PII returned. |

The lead-create response uses `Cache-Control: no-store`. Error bodies use stable codes such as `INVITE_INACTIVE`, `PHONE_INVALID`, `RATE_LIMITED`, and `TEMPORARILY_UNAVAILABLE`; they never echo normalized phone or token values.

No public “GET lead by ID” or “issue token for lead ID” endpoint is proposed. That would create an avoidable IDOR surface.

### 6.3 Modified `/open` surface

| Route | Access | Input | Output | Side effect / idempotency |
|---|---|---|---|---|
| `GET /open` | Public page, useful only with Telegram WebApp initData | no PII query; reads Telegram SDK context | localized loading/form/pending/rejected/approved/blocked/error state and support footer | Page itself does not create application. |
| `POST /api/open/context` | Verified Merchant Bot initData | `initData`; start payload is read from verified initData | safe prefill, lead/application/store state, localized error code, fresh support URL | Claims valid `APPLICATION_OPEN` token once and binds Telegram identity; same-ID replay resumes. Does not create `StoreApplication`. |
| `POST /api/open` | Verified Merchant Bot initData | `initData`, confirmed store/owner/phone, optional address/lat/lng | existing or newly created application status and store conversion state | Serializable/idempotent application transaction. Existing PENDING/APPROVED/REJECTED result is returned; never creates a second PENDING row. |

`/api/open/context` is separated from `/api/open` so merely opening Telegram can establish identity/resume context without falsely creating an application. Both endpoints share the same extracted Telegram initData verifier; the current dev-mode signature bypass must not be broadened and should remain non-production only.

### 6.4 Modified Telegram routing and Merchant Bot webhook

| Surface | Access | Input | Output/side effect |
|---|---|---|---|
| `TelegramInit` | Client Telegram context | exact `open` or guarded `open_<opaque>` | Routes to `/open` before public-path early return. It does not append the token, source, or PII to the browser URL. Existing `bind_` routing order remains first. |
| `POST /api/webhook/merchant` | Telegram webhook secret | `/start support_<opaque>` | Verifies webhook as today, consumes SUPPORT token, optionally binds lead Telegram identity, upserts `SupportSession.awaiting_human`, writes a sanitized CUSTOMER `TelegramMessage` such as `[申请帮助 · OPEN]`, and responds with localized acknowledgement. It does not create an application. |

Unknown/expired/replayed support payloads receive a generic support response and can still send normal messages. The raw `/start support_<token>` command is not persisted in `TelegramMessage.content`.

### 6.5 New Ops pages and APIs

| Route | Access | Input | Output | Side effect / idempotency |
|---|---|---|---|---|
| `GET /ops/acquisition-invites` | Ops cookie | filters | invite list/create view, one canonical link/QR | None |
| `GET /ops/sales-leads` | Ops cookie | status/source/owner/search/page | minimal lead list | None |
| `GET /ops/sales-leads/[id]` | Ops cookie | lead id | Contact, attribution, owner, Telegram, application, conversion, guard, conversation link | None |
| `GET/POST /api/ops/acquisition-invites` | Ops | filters / source, campaign, owner, note | list / created invite and canonical URL | Create is server-authoritative; code collision retries. |
| `PATCH /api/ops/acquisition-invites/[id]` | Ops | allowed campaign/owner/note/status fields | updated invite | Explicit field allowlist; code immutable. Existing lead first touch unaffected. |
| `GET /api/ops/sales-leads` | Ops | allowlisted filters/pagination | PII-bearing list | Read only; bounded page size. |
| `GET /api/ops/sales-leads/[id]` | Ops | lead id | detail and derived conversion | Read only. |
| `PATCH /api/ops/sales-leads/[id]` | Ops | minimal manual status action | updated status | Only permitted transitions; no attribution/Telegram/application fields writable. |
| `PUT /api/ops/application-blocks/[telegramId]` | OPS_ADMIN+ | reason, note | active block | Upsert/re-ban is idempotent. Username is server-resolved/display only. |
| `DELETE /api/ops/application-blocks/[telegramId]` | OPS_ADMIN+ | none | inactive block | Repeated unban returns current inactive state. |
| `POST /api/ops/applications/[id]/reject` | Ops; `ban=true` requires OPS_ADMIN+ | reason/note, optional `ban` | REJECTED application and optional active block | Transactional. Repeated same action returns current state; APPROVED cannot be rejected. |

Ops navigation is isolated rather than turning `app/ops/page.tsx` into a CRM dashboard. The existing Ops page needs only entry links and small conversation/application actions.

### 6.6 Modified existing Ops APIs

| Existing route | Proposed small extension |
|---|---|
| `GET /api/ops/conversations` | Join `SalesLead` by `telegramId`; return `leadId`, lead status, source/campaign/owner and block flag only to authorized Ops callers |
| `GET /api/ops/conversations/[telegramId]` | Return the same message history plus a bounded lead/application header; no message model change |
| `POST /api/ops/support/[telegramId]/takeover` | Keep existing state semantics; lead sales owner remains the assignment display |
| `POST /api/ops/messages` | Keep the existing Merchant Bot send/persist path; on success touch the matching Lead `lastActivityAt` |
| `GET /api/ops/applications` | Include linked lead summary and created Store conversion state |
| `POST /api/ops/applications/[id]/approve` | Recheck PENDING/block state inside transaction; write `createdStoreId`; update linked lead to ACTIVATED |

Lead Detail “打开现有会话” navigates to `/ops?lead=<leadId>`. The Ops page resolves that lead through an authenticated API and selects the matching existing conversation; raw Telegram ID is not added to the URL.

### 6.7 Authorization matrix

| Operation | SUPER_ADMIN | OPS_ADMIN | BD |
|---|---:|---:|---:|
| View invite/lead/application/conversation | yes | yes | yes; list defaults to own + unassigned leads |
| Create invite | yes | yes | yes |
| Disable invite | yes | yes | no; an OPS_ADMIN+ action in V0.1 |
| Update minimal lead status | yes | yes | assigned own or unassigned lead |
| Reply/take over existing conversation | existing permission | existing permission | existing permission |
| Reject application | yes | yes | yes, consistent with current approval access pending later role hardening |
| Ban/unban application identity | yes | yes | no |
| Approve application | retain current behavior | retain current behavior | retain current behavior; role-hardening is a separate review decision |

All routes call `checkOpsAuthContext`, not only the UI. `hasOpsRole` enforces blocklist mutations. The existing broader approval permission is documented rather than silently changed in this feature.

## 7. End-to-End Sequences

Legend: **[existing]** is reused repository behavior; **[new]** is a proposed minimal addition; **[small extension]** modifies an existing surface.

### Scenario A — TikTok link

```text
1. TikTok → GET https://elifekh.com/j/TK83K2
   identity: anonymous browser
   DB: none yet
   capability: [new] AcquisitionInvite lookup

2. /j/TK83K2 renders valid ACTIVE invite
   identity: random local visitorId
   DB: [new] AcquisitionInviteVisit via idempotent visit API

3. Customer submits valid storeName + ownerName + phone; location/address optional
   guard: scoped phone validator + DB rate limit + 30-day phone/invite dedup
   DB: [new] SalesLead with invite relation and immutable TikTok/campaign/owner snapshots

4. Server issues APPLICATION_OPEN token
   URL: [existing helper] https://t.me/<merchant_bot>?startapp=open_<opaque>
   DB: token hash/TTL only; no PII in URL

5. Telegram opens Merchant Mini App → TelegramInit → /open
   identity: verified Telegram initData
   DB: token consumed; SalesLead telegram fields and telegramBoundAt set

6. /open/context returns Lead prefill; customer confirms
   DB: [small extension] StoreApplication PENDING linked to SalesLead; Lead APPLIED

7. Ops approves
   DB: [existing] Tenant + Store + User + UserStoreRole;
       [small extension] StoreApplication.createdStoreId + Lead ACTIVATED

8. Conversion query follows Invite → Lead → StoreApplication → Store
```

TikTok never needs to survive as a loose query parameter after step 3; it is locked in the Lead record.

### Scenario B — QR

```text
Ops Acquisition Invite UI
  → canonical URL = publicUrl('/j/TK83K2')                  [existing helper]
  → QRCode.value = canonical URL                            [existing dependency/pattern]
  → Copy Link copies the same canonical URL                 [existing pattern]
  → scan follows Scenario A from /j/TK83K2                  [new flow]
```

There is no QR table, QR token, or QR-specific source. A Poster invite is simply `sourceChannel=POSTER` behind the same link.

### Scenario C — Lead created but Telegram abandoned

```text
/j form valid
  → SalesLead WAITING_TELEGRAM created immediately
  → Ops list shows store, owner, phone, source, campaign, owner/UNASSIGNED
  → salesperson can call phone and set FOLLOWING
  → token may expire; revisiting same invite + phone within 30 days restores the Lead
  → a fresh token is issued without changing first touch
```

No `StoreApplication` exists. Funnel counts Valid Lead but not Telegram Bound or Application Submitted.

### Scenario D — Contact Support

Before Lead exists:

```text
/j support footer → plain https://t.me/<merchant_bot>
```

After Lead exists:

```text
support footer → https://t.me/<merchant_bot>?start=support_<opaque>
  → Merchant webhook verifies support token
  → resolves Lead + Invite + Campaign + supportStage from DB
  → binds same Telegram identity if safe
  → SupportSession awaiting_human
  → sanitized TelegramMessage CUSTOMER row
  → existing Ops current conversation
  → existing takeover and /api/ops/messages reply via Merchant Bot
```

The support token cannot be accepted by `/api/open` as an application token. Contact Support never creates `StoreApplication`, including for a blocked user.

### Scenario E — Legacy `startapp=open`

```text
Existing QR/link → https://t.me/<merchant_bot>?startapp=open
  → TelegramInit exact-open behavior preserved
  → /open verifies Telegram identity
  → context checks User / existing application / existing lead / block
  → new user sees store name, owner name, phone, optional address/location
  → explicit confirm transaction creates or reuses DIRECT_TELEGRAM SalesLead
  → same transaction creates linked StoreApplication PENDING and sets Lead APPLIED
  → existing Ops review/approval path
```

There is no `AcquisitionInvite`; `firstSourceChannel=DIRECT_TELEGRAM`, `firstCampaign=null`, `initialSalesOwnerId=null`. The fixed old QR remains valid and now participates in the same Lead → Application → Store proof chain.

### Scenario F — Duplicate Telegram application

```text
verified /open submit
  → transaction checks active User by telegramId
  → checks SalesLead.telegramId unique identity
  → checks StoreApplication where telegramId + PENDING
  → checks StoreApplication.salesLeadId unique

if PENDING exists:
  return existing submitted/waiting state; no insert

if APPROVED + createdStoreId exists or active User owns Store:
  return activated/existing-store state; no form and no insert

if REJECTED exists:
  return rejected/support state; no automatic second application
```

The database constraints and transaction enforce idempotency; a disabled button is only UX.

### Scenario G — Blocked Telegram

```text
/open/context can identify user and show block state
  → support footer remains enabled
  → POST /api/open rechecks active ApplicationBlock inside transaction
  → returns APPLICATION_BLOCKED; no StoreApplication insert

/start support_<token>
  → remains permitted
  → existing support conversation and Ops reply continue
```

Block is application-specific. It does not disable Telegram auth, existing merchant accounts, orders, or global E-Shop access.

### Scenario H — Approved to Store conversion

```text
Ops approve request
  → authenticate Ops                                       [existing]
  → transaction re-reads PENDING application              [small extension]
  → transaction rechecks active ApplicationBlock          [new guard]
  → create Tenant                                          [existing]
  → create Store                                           [existing]
  → create OWNER User with telegramId                      [existing]
  → create UserStoreRole                                   [existing]
  → create trial subscription                              [existing]
  → update StoreApplication:
       status=APPROVED, approvedAt, tenantId,
       createdStoreId=created Store                        [small extension]
  → update linked SalesLead:
       status=ACTIVATED, lastActivityAt                    [small extension]
  → COMMIT all or ROLLBACK all
  → send Telegram notification outside transaction        [existing]
```

No Store ID or ACTIVE Lead can survive if tenant/store/user/role/subscription/application writes roll back.

## 8. Guards and Security

### 8.1 Phone guard

Create a narrowly scoped `lib/sales-lead-phone.ts` rather than changing `normalizeMemberPhone` globally.

Server-authoritative algorithm:

1. Accept string only; trim; reject raw input over 32 characters.
2. Permit only common phone presentation characters (`+`, digits, spaces, parentheses, dot, hyphen); reject letters and control characters.
3. Reuse the Cambodia normalization behavior from `normalizeMemberPhone`: `00855…` → `855…`, local `0…` → `855…`, and 8–10 digit local numbers → `855…`.
4. Store digits only.
5. General E.164-compatible bound: 8–15 digits.
6. Cambodia-specific bound: when prefixed `855`, require 8–10 subscriber digits after `855`.
7. Reject obvious placeholders: every digit identical, all zero, and a small explicit denylist such as sequential demo values. Do not infer carrier validity.
8. Client uses the same helper-compatible rules for immediate three-language feedback; server repeats all checks.

No SMS, OTP, carrier lookup, Twilio, or identity claim is implied. A valid format means contactable-looking data, not verified ownership.

### 8.2 Anonymous dedup and restore

- Primary restore key: `normalizedPhone + acquisitionInviteId + createdAt within 30 days`.
- First-touch cross-invite guard: within the same 30 days, if the phone, Unicode-normalized/case-folded store name, and normalized owner name all exactly match an earlier non-ACTIVATED Lead, restore the earliest Lead even when the new link has a different invite. This handles the obvious “same prospect clicked another campaign” case without overwriting first touch.
- If only the phone matches but store/owner identity differs, do not merge; shared-family phones and multi-business owners remain valid.
- No fuzzy name matching is introduced.
- Execute candidate lookup/create/token issue in a Prisma serializable transaction with bounded retry on serialization conflict.
- A restored Lead updates only mutable contact/location fields and `lastActivityAt`, and issues fresh tokens. It never changes first-touch snapshots.
- `LOST` may be restored to `WAITING_TELEGRAM` only after an explicit new valid form submission within the same invite; record remains the same.
- `APPLIED` returns application status; `ACTIVATED` returns existing conversion/support state and does not reopen onboarding.
- A different invite with different business identity, or a submission outside the window, may create a new Lead because one phone can represent multiple stores, shared households, or later applications.
- Phone is indexed, not unique.

After Telegram identity appears, `telegramId` is the stable key. If it is already bound to another Lead, V0.1 does **not** destructively auto-merge attribution rows. The existing Telegram-bound lead/application wins for resume; the new token claim returns `IDENTITY_CONFLICT`, leaves both first-touch records intact, creates no application, and offers support. Automated cross-invite merge and manual merge UI are deferred because choosing a canonical business/store record is not safely inferable.

### 8.3 Telegram application guard

Inside the same serializable `/api/open` transaction, in this order:

1. Verify Merchant Bot initData and derive `telegramId` server-side.
2. Apply DB-backed rate limit.
3. Reject an active `ApplicationBlock` for application creation only.
4. Check active `User` under active Tenant. Return existing-store state; multi-store path is deferred.
5. Check PENDING application by `telegramId`; return it.
6. Check the resolved lead's linked application of any status; return its state.
7. Validate/persist confirmed contact/location data.
8. Create exactly one `StoreApplication` using unique `salesLeadId` and set Lead `APPLIED`.

Unique constraints and transaction conflict handling convert duplicate races into a read of the existing state, never a second row.

### 8.4 Lightweight rate limit

Initial constants, subject to Architecture Review and production observation:

| Action | Dimension | Proposed threshold |
|---|---|---|
| Lead create | IP HMAC | 10 attempts / 15 minutes |
| Lead create | invite | 100 attempts / hour |
| Lead create | normalized-phone HMAC | 5 attempts / 24 hours |
| Application submit | IP HMAC | 20 attempts / 15 minutes |
| Application submit | Telegram-ID HMAC | 5 attempts / 15 minutes |

The first V0.1 objective is obvious bot suppression, not fraud scoring. Threshold checks plus attempt insert use a serializable transaction. A 429 response retains phone/Telegram support. No device fingerprint, ML model, external vendor, or risk score is added.

### 8.5 Security boundary checklist

| Review item | Design result |
|---|---|
| Phone in URL | **NO**; request body/database only |
| Owner name in URL | **NO** |
| GPS/address in URL | **NO** |
| Campaign/invite metadata in Telegram payload | **NO**; opaque token only |
| Telegram payload PII | **NO** |
| Token entropy | 128 random bits; base64url |
| Token at rest | SHA-256 hash only; raw token returned once |
| Token expiry | 72h application / 24h support |
| Replay | same Telegram ID resumes; different ID rejected; support/application purpose separated |
| IDOR | no public lead-by-ID route; `/open` requires verified initData + token/identity; Ops routes require Ops cookie |
| Ops authorization | `checkOpsAuthContext` on every API; UI hiding is not enforcement |
| Blocklist authorization | `hasOpsRole(..., 'OPS_ADMIN')` for ban/unban and Reject+Ban |
| Sales Lead PII | never returned by public resolve APIs; Ops only; `Cache-Control: no-store`; no verbose request logging |
| Public invite enumeration | 10-char random non-sequential code; invalid code reveals no metadata; inactive code reveals only the required ended state; no public list/search API |
| Duplicate submission race | serializable transaction + unique Telegram/lead/application relations + conflict retry |
| Mass assignment | explicit input/output field allowlists; attribution and conversion fields never accepted from clients |
| Open redirect | no caller-supplied redirect target; links built by `publicUrl` and sanitized Bot username helpers |
| Location consent | explicit optional action; denial does not block submit; no background collection |

### 8.6 Support configuration

No existing repository source combines a platform support phone with the Merchant Bot. `ELifeSupportModal` points to the Customer Bot and has no phone, so it must not be reused for this sales channel.

Add one server-only helper, conceptually `lib/sales-lead-support.ts`:

- phone source: new `PLATFORM_SUPPORT_PHONE` environment value;
- Telegram source: existing `TELEGRAM_BOT_USERNAME` (Merchant Bot);
- output: sanitized display phone, `tel:` target, plain Merchant Bot URL, and tokenized support URL when a Lead context is available;
- no settings table or Settings Platform.

One shared support-footer component consumes that sanitized view model and is fixed at the bottom of all three required stages: `/j/[code]` lead form, `/open` confirmation, and `/open` submitted/waiting-approval state. It always shows the phone, a `tel:` action, and a Telegram action. Once a Lead exists, the Telegram action uses a SUPPORT token carrying the allowlisted stage in the database; before a Lead exists it opens the same Merchant Bot without context.

Add health-check coverage. Feature enablement/deployment must be blocked until both values are valid, because the frozen UI requires both phone and Telegram support on inactive/error/submitted screens.

### 8.7 Three-language boundary

Use `app/components/LangProvider.tsx` and add keys to all three existing files:

- `lib/i18n/zh.ts`
- `lib/i18n/en.ts`
- `lib/i18n/km.ts`

The current `/open` directly imports zh/km and its English entries are not fully translated. V0.1 should move `/open` to `useLocale()` and supply real English, not add another translation object.

Coverage includes form, validation, optional location/denial, Telegram bridge, duplicate/resume, pending, approved, rejected, blocked, inactive invite, support, rate limit, invalid/expired token, and generic error states. Error APIs return stable codes; pages localize them client-side.

## 9. Ops UI and Funnel

### 9.1 Minimal Ops UI

`Sales Lead List` shows only:

- Store Name
- Owner Name
- Phone
- Source
- Campaign
- Invite
- Sales Owner or UNASSIGNED
- Telegram Binding
- Lead Status
- Application Status
- Last Activity

`Lead Detail` shows only:

- Contact: store, owner, normalized phone, optional address/map link
- Attribution: immutable source/campaign/invite/created time
- Sales Owner: inherited owner or UNASSIGNED
- Telegram: bound state, display identity
- Application: status and applied/approved times
- Conversion: linked Store/Tenant or not activated
- Guard: active block, Ban/Unban for authorized roles
- Existing Conversation Link

Allowed actions are open existing conversation, minimal status transition, Ban, and Unban. There are no tags, tasks, arbitrary timeline, activity composer, commission, scoring, automation, or notes platform.

Conversation and Application surfaces add only:

- Current Conversation: lead badge/link and authorized “Ban Application”.
- StoreApplication: `Reject` and separately `Reject + Ban`.
- Existing approve/notify behavior remains visible.

### 9.2 Reliable funnel derivation

| Funnel stage | Source of truth | Definition |
|---|---|---|
| Invite Visit | `AcquisitionInviteVisit` | Count rows by invite/time; not a Lead |
| Valid Lead | `SalesLead` | Required validated store/owner/phone exists; acquisition invite relation for attributed cohort |
| Telegram Bound | `SalesLead.telegramBoundAt` | Non-null verified binding |
| Application Submitted | `StoreApplication.salesLeadId` | Linked formal application exists; applied time is `StoreApplication.createdAt` |
| Approved | linked application | `status=APPROVED` and `approvedAt` non-null |
| Store Activated | `StoreApplication.createdStoreId` | Direct Store relation exists; Lead status is ACTIVATED |

No aggregate counters are copied onto Invite or Lead. Queries group actual rows and relations. Duplicate attempts and invalid forms do not count as Leads. Direct legacy leads are reportable under `DIRECT_TELEGRAM` but do not contribute to an acquisition-invite cohort.

## 10. Legacy Compatibility

### 10.1 Must remain unchanged

- `bind_<token>` OWNER/STAFF deep links and `/bind` precedence.
- Existing fixed `startapp=open` QR/link.
- Existing Merchant Bot authentication and message routing outside the two new prefixes.
- Existing Customer Bot `bind_STORECODE[_ORDERNO]`, customer ordering, membership binding, and `ConversationLog`.
- Existing `/m/[storeCode]`, `/menu`, `/invite`, `/table-qrcodes`, `/cashier`, `/records`, OWNER multi-store, product discounts, printing, Customer Display, and Telegram member binding.
- Existing StoreApplication PENDING/APPROVED/REJECTED semantics.
- Existing approval creation order and post-commit Telegram notification.

### 10.2 Compatibility rules

- Parser ordering stays `bind_` first, then exact/tokenized `open`; support is processed only by Merchant Bot `/start` webhook.
- `open_` and `support_` parsers accept only their exact purpose and safe character/length envelope.
- Unknown payloads retain today's default onboarding/support behavior rather than being treated as acquisition.
- Historical StoreApplication rows have null `salesLeadId`/`createdStoreId`; Ops displays “Legacy / unlinked”, never a guessed Store.
- New direct `open` users receive a `DIRECT_TELEGRAM` Lead in the application transaction.
- Existing approved merchants opening `/open` are sent to the existing-account state, not a new application.
- OWNER multi-store new-store application is **DEFERRED**; V0.1 does not repurpose first-store onboarding.

## 11. Migration Plan

Design only; no migration is created or executed in this phase.

### 11.1 Proposed schema migration

One reviewed migration should add:

1. Six enums listed in section 4.1.
2. Six new tables:
   - `AcquisitionInvite`
   - `AcquisitionInviteVisit`
   - `SalesLead`
   - `SalesLeadContextToken`
   - `ApplicationBlock`
   - `SalesLeadGuardAttempt`
3. Nullable `StoreApplication.salesLeadId` with unique index/FK.
4. Nullable `StoreApplication.createdStoreId` with unique index/FK.
5. Composite `StoreApplication(telegramId, status)` index.
6. Inverse Prisma relations on `OpsAdmin` and `Store`; no new columns on those tables.

### 11.2 Nullability and existing rows

- Both new StoreApplication foreign keys are nullable.
- No acquisition data is backfilled.
- No historical Store is inferred from tenant membership, timestamps, name, or Telegram identity.
- Existing PENDING/APPROVED/REJECTED rows continue to work and appear as legacy/unlinked.
- Existing fixed `startapp=open` creates linked Lead/Application records only after the feature release.

### 11.3 Deployment order for a later implementation phase

1. Architecture Review approval.
2. Add schema/migration and generate Prisma Client in an implementation lane.
3. Deploy backward-compatible nullable schema first.
4. Deploy APIs/helpers with new flow disabled by one narrowly scoped feature flag.
5. Validate legacy `open`, Merchant Bot, approval, and conversion transaction on Preview/test DB.
6. Enable Ops invite creation, then public `/j` entry.
7. Observe errors/rate limits; only then enable links operationally.

No Production step is authorized by this document.

### 11.4 Rollback

- Before public use: application rollback is sufficient because all additions are nullable/new.
- After real leads exist: disable invites/feature flag and roll back application code first. Do not drop lead/token/block/visit data until exported and retention is approved.
- A schema rollback may remove new nullable FKs and new tables only after code rollback and data-preservation approval.
- The approval transaction provides natural rollback: `createdStoreId` and Lead ACTIVATED are in the same transaction as Tenant/Store/User/role/subscription/application writes.

### 11.5 Production risk

**Medium.** New tables are additive, but `/open`, Merchant Bot start routing, PII handling, and the critical approval transaction are production-sensitive. The design deliberately avoids changes to customer ordering, checkout, printing, and merchant binding.

## 12. Test Matrix

The repository uses build plus focused TypeScript/runtime/static tests and manual Telegram verification. The implementation phase should add focused `tests/*.test.ts` scripts consistent with existing tests and run `npm run build`.

| Area | Required cases |
|---|---|
| Attribution | Invite source/campaign/owner snapshots exactly once; later invite edits/visits never overwrite first touch; DIRECT_TELEGRAM correct |
| Invite | random unique code; canonical `/j` link; QR and copied link byte-identical; ACTIVE create allowed; INACTIVE safe page/support/no lead; invalid code constant-shape |
| Visit funnel | valid page event inserted; retry same eventKey one row; Visit not counted as Lead |
| Lead creation | three required fields; optional address/location; location denial/timeout still submits; invalid coordinates discarded/rejected without making location mandatory |
| Phone | Cambodian `0…`, `+855…`, `00855…`, spaces/hyphens; min/max; letters; repeated/placeholder digits; server/client agreement |
| Dedup | same phone+invite restores; cross-invite same phone+exact business identity preserves earliest first touch; shared-phone different business stays separate; token refresh; LOST/APPLIED/ACTIVATED behavior; phone not unique |
| Dedup race | concurrent identical submissions produce one applicable lead; serialization retry returns same result |
| Telegram token | 128-bit format; only hash stored; application/support purpose separation; expiry; revoke; same-ID replay; other-ID replay; raw token absent logs/DB error bodies |
| Telegram parsing | existing `bind_` tests unchanged; exact `open`; `open_<token>`; malformed/oversized payload; public-path redirect order; no token in browser URL |
| Legacy `/open` | old `startapp=open` works; required phone added; Direct Lead + application; no invite; no duplicate on repeat |
| Application idempotency | repeated click/network retry/PENDING resume; unique lead relation; active User existing-store state; rejected/approved state; no frontend-only guarantee |
| Application → Store | approved transaction writes exact `createdStoreId`, tenant link and Lead ACTIVATED; injected failure rolls all DB writes back; notification failure does not roll back |
| Ban/unban | Telegram ID key; username changes irrelevant; blocked application denied; support allowed; unban/re-ban audit fields; Reject differs from Reject+Ban; role enforcement |
| Contact Support | pre-lead plain Merchant Bot; post-lead support token; sanitized TelegramMessage; SupportSession awaiting; Ops takeover/reply uses Merchant Bot; no application side effect |
| Conversation | lead join by Telegram ID; existing current/archive/message count behavior; lead-detail navigation; no Customer Bot cross-channel reply |
| Rate limit | each dimension/window; HMAC only in DB; 429 support; race; old attempt cleanup bounded; normal retry not incorrectly blocked |
| Success/resume | PENDING screen, REJECTED screen, APPROVED/Store screen, current status and support; returning user never gets endless blank forms |
| i18n | every new key in zh/en/km; real English content; Khmer renders; validation/pending/approved/blocked/inactive/support/error coverage |
| Authorization | public cannot fetch Lead PII; STAFF/OWNER cannot access Ops APIs; BD matrix; OPS_ADMIN block rights; IDOR attempts; mass-assignment rejection |
| Privacy | phone/name/GPS absent from short link, Telegram payload, token log, browser navigation and analytics event fields |
| Regression: merchant | Existing Merchant Bot messages, FAQ/import/KHQR routes, member auth, OWNER binding, fixed open, StoreApplication approve/notify |
| Regression: customer | `/m`, `/menu`, H5 ordering, Customer Bot, Telegram member binding, campaign order attribution |
| Regression: store ops | OWNER multi-store, product discount, cashier, Printing, Customer Display, records, subscription/trial creation |

Manual device matrix must include iOS Telegram, Android Telegram, ordinary mobile browser for `/j`, location allow/deny, expired token, returning PENDING user, Merchant Bot support message, and an end-to-end approval on a non-production database.

## 13. Expected Change Scope

This is an estimate for the later implementation, not work performed in this design phase.

| Category | Estimate | Notes |
|---|---:|---|
| New Prisma models | 6 | invite, visit, lead, context token, application block, guard attempt |
| Existing model extensions | 2 fields + inverse relations/index | StoreApplication only gets two nullable links; Store/OpsAdmin inverse relations |
| Migration files | 1 | additive, reviewed migration |
| New pages | 4 | `/j/[code]`, Ops invite page, Ops lead list and lead detail routes |
| Modified pages | 2–3 | `/open`, Ops shell/conversation/application actions, possibly Ops navigation |
| New API route files | approximately 9–11 | public visit/lead, Ops invite/lead/block/reject surfaces |
| Modified API/Bot route files | approximately 5–7 | open/context, TelegramInit, merchant webhook, conversation/application/approval |
| New focused helpers/components | approximately 6–8 | phone, tokens, support config, rate guard, lead service, reusable QR/copy/support footer |
| New test files | approximately 8–12 | static/unit/runtime groupings; not one file per case |
| Existing i18n files modified | 3 | zh/en/km |
| Total new files | approximately 22–28 including tests/migration | Still one bounded vertical slice |
| Total modified files | approximately 12–18 | Primarily onboarding/Ops/support surfaces |

This is near the upper edge of a minimal vertical slice because the frozen requirements include traceable visits, secure tokens, dedup, blocklist, rate limiting, Ops management, and three-language UI. It does not justify dozens of models, a CRM framework, a second Bot, or a general settings/analytics platform. Implementation should be split into reviewable commits inside the same approved lane, not broadened in scope.

## 14. Risks and Open Decisions

### 14.1 Decisions required at Architecture Review

1. **Support phone value:** the repository has no authoritative platform sales-support phone. Confirm the production value for `PLATFORM_SUPPORT_PHONE` before implementation can be enabled.
2. **Dedup window:** this design recommends 30 days. Confirm this business window; phone remains non-unique regardless.
3. **Initial rate thresholds:** confirm the conservative values in section 8.4. They are code constants for V0.1, not a Settings Platform.
4. **Ops role scope:** current application approval accepts all Ops roles. Confirm whether V0.1 preserves this exactly or separately hardens approval to OPS_ADMIN+. This design does not silently alter it.
5. **BD lead visibility:** recommendation is own + unassigned by default, with admin all-view. Confirm before PII UI implementation.
6. **Token TTL:** recommendation is 72 hours for application and 24 hours for support. Re-entry through dedup can issue a fresh token.
7. **Rejected reapplication:** recommendation is no automatic second application in V0.1; display status and support. A later manual reopen policy is deferred.

None of these changes the frozen architecture; they tune policy values/permissions before implementation.

### 14.2 Main implementation risks

| Risk | Mitigation |
|---|---|
| Telegram start payload routed after public-path early return | Add parser tests and route exact/tokenized open before early return while preserving bind precedence |
| Token leaked to logs | Hash at rest, redact helper, sanitized webhook message, no request-body logging |
| Duplicate lead/application under concurrency | Serializable transaction, bounded retry, unique TG/lead/application relations |
| Wrong cross-invite merge destroys first touch | No automatic destructive merge in V0.1; identity conflict goes to support |
| Merchant/Customer Bot cross-send | Freeze Merchant Bot for sales; no Customer Bot conversation changes |
| Historical Store inferred incorrectly | Nullable direct relation and explicit “Legacy / unlinked”; no guessed backfill |
| Approval creates Store but linkage update fails | All DB changes in the existing approval transaction |
| Location permission blocks conversion | Optional explicit request; absence never fails lead/application |
| PII exposed to ordinary merchant users | Ops-only APIs and no public lead lookup |
| `/open` regression | legacy exact-open tests plus real Telegram device regression before enablement |

## 15. Explicitly Deferred

- CRM Platform
- AI Sales / AI reply / AI follow-up
- scheduler and automated chasing
- lead scoring
- tags, timeline, task and notes platforms
- sales commission or performance routing
- round robin / capacity assignment
- Facebook Messenger API
- TikTok Messaging / DM API
- WhatsApp API
- advertising API and marketing automation
- SMS OTP / Twilio / real-name verification
- device fingerprint
- ML anti-fraud / risk score
- CDP
- multi-touch attribution
- complex BI or copied funnel counters
- general Settings Platform
- second/new support Bot
- automatic cross-invite Lead merge
- multi-store application workflow
- historical heuristic Application → Store backfill

## 16. Recommended Implementation Order After Approval

If Architecture Review approves V0.1, the smallest safe order is:

1. Add the additive schema, relationships, scoped phone/token/rate/support helpers, and data-layer tests.
2. Make legacy `/open` create/link a DIRECT_TELEGRAM Lead and enforce idempotency/block guard without changing the old entry URL.
3. Add Acquisition Invite + `/j` + pre-Telegram Lead creation and opaque application bridge.
4. Add support token handling on the existing Merchant Bot and lead joins in existing Ops conversations.
5. Add minimal Ops invite/lead/block/reject UI and APIs.
6. Extend approval transaction with exact Store linkage and funnel queries.
7. Run build, focused tests, non-production migration, and the complete real-device regression matrix.

No implementation, migration, Preview, or Production action is authorized until Architecture Review explicitly approves the design and resolves section 14.1.

## 17. Design Result

The proposed design closes the smallest provable path:

```text
Link / QR                 PRESENT through canonical AcquisitionInvite URL
Attribution               PRESENT through locked Lead snapshots
Identity                  PRESENT through opaque token + verified Telegram ID
Conversation              PRESENT through existing Merchant Bot / TelegramMessage / SupportSession
Sales Follow-up           PRESENT minimally through owner + phone + lead state + existing conversation
Application               PRESENT through existing /open and StoreApplication
Approval                  PRESENT through existing Ops transaction
Store                     PRESENT through existing Store creation
Conversion                PRESENT through new direct createdStoreId relation
```

**DESIGN COMPLETE — WAITING FOR ARCHITECTURE REVIEW**
