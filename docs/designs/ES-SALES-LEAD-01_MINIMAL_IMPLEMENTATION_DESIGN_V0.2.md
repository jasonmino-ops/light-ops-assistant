# ES-SALES-LEAD-01 Minimal Implementation Design V0.2

- Design date: 2026-08-19
- Development lane: `codex/e-shop-sales-lead-attribution-v01`
- Audit base / current `origin/main` / Production: `0164842299f39d582ab4040ef59bb98fd68314fe`
- Audit commit: `ac2a6239c11d9f46f5b5da6ba7c318bebc6c9347`
- Design V0.1 commit: `63bd6f43d1fafe9bdef6a27f5e3bed383d0df487`
- Audit evidence: `docs/audits/ES-SALES-LEAD-01_REPOSITORY_AUDIT_V0.1.md`
- Supersedes for implementation planning: `docs/designs/ES-SALES-LEAD-01_MINIMAL_IMPLEMENTATION_DESIGN_V0.1.md`
- Classification: architecture design / minimal implementation design revision
- Scope: **DESIGN REVISION ONLY**
- Business code, Prisma schema, migration, UI, Bot, Preview, Production changed by this revision: **NO**
- Required next gate: Architecture Board approval, then a separate Schema/Migration Gate before implementation

## 1. Lineage Gate

| Check | Evidence | Result |
|---|---|---|
| Current worktree | `/private/tmp/e-shop-sales-lead-attribution-v01.EBV61h` | isolated worktree recovered from Git; present |
| Current branch | `codex/e-shop-sales-lead-attribution-v01` | correct independent lane |
| HEAD before V0.2 document | `63bd6f43d1fafe9bdef6a27f5e3bed383d0df487` | Design V0.1 commit |
| `origin/main` after fetch | `0164842299f39d582ab4040ef59bb98fd68314fe` | unchanged |
| Production | `0164842299f39d582ab4040ef59bb98fd68314fe` | `npm run vercel:current`; Production deployment `READY` |
| Working tree before V0.2 | clean | no carried business changes |
| Audit commit | `ac2a6239c11d9f46f5b5da6ba7c318bebc6c9347` | object and branch ancestor both present |
| Design V0.1 commit | `63bd6f43d1fafe9bdef6a27f5e3bed383d0df487` | object and current HEAD both present |
| Merge base | `0164842299f39d582ab4040ef59bb98fd68314fe` | exact audited base |
| Ahead / behind | 2 ahead / 0 behind | only Audit V0.1 and Design V0.1 before this document |
| `origin/main` changed since V0.1 | NO | main commit time precedes Design V0.1 and SHA is identical |
| Release lineage script | `RESULT: PASS` | safe base confirmed |

No rebase, merge, or product-goal change was performed. The dirty primary worktree at `/Users/jason/light-ops-assistant` remains outside this lane and untouched.

**Lineage Gate: PASS**

## 2. V0.2 Architecture Summary

V0.2 keeps one minimal vertical slice:

```text
AcquisitionInvite
  → /lead/[code] Public Lead Landing
  → valid storeName + ownerName + normalizedPhone
  → SalesLead with immutable first touch
  → APPLICATION opaque token
  → existing Merchant Bot startapp=open_<token>
  → existing /open
  → verified Telegram initData + full-phone applicant proof
  → canonical Telegram claim
  → existing Merchant TelegramMessage / SupportSession / Ops conversation
  → explicit StoreApplication confirmation
  → existing Ops review
  → existing approval transaction
  → StoreApplication.createdStoreId
  → SalesLead ACTIVATED
```

Architecture boundaries:

1. The invite link is the attribution source of truth. QR renders the exact same link and has no separate attribution storage.
2. A valid Lead exists before Telegram. Telegram abandonment still leaves a phone-contactable Lead.
3. `/open` is the sole formal application endpoint. `SalesLead` is not a `StoreApplication`.
4. The Merchant Bot is the only sales/support Bot. The Customer Bot remains outside this flow.
5. First touch never expires and is never overwritten. There is no 30-day attribution or dedup rule.
6. A Lead can have multiple historical applications, but one Telegram can have only one `PENDING` application at a time.
7. A Telegram ID is not globally unique on `SalesLead`; only an in-flight first-store flow is unique.
8. A forwarded application token cannot bind a different Telegram without an additional applicant proof.
9. Visit analytics are aggregate counters, not anonymous identity or unique-visitor analytics.
10. Five new focused models are sufficient. No CRM, event platform, settings platform, or third message system is introduced.

## 3. Changes From Design V0.1

### 3.1 Removed

- `StoreApplication.salesLeadId @unique`.
- `SalesLead.telegramId @unique` as a lifelong/global rule.
- The 30-day Lead dedup/attribution window from all write and restore semantics.
- `AcquisitionInviteVisit` and all claims of anonymous or unique visitors.
- `SalesLeadGuardAttempt` unbounded attempt rows.
- `/j/[code]` as the preferred public path; real route/auth evidence favors `/lead/[code]`.
- Last-four-phone as a sufficient applicant proof.
- Any implication that all production DDL must be manually executed in Supabase.
- A separate waiting-approval page.
- A sixth new data model and any future-proof event/timeline infrastructure.

### 3.2 Modified

- Lead→Application cardinality is now **1:N**.
- `PENDING` uniqueness and in-flight Telegram Lead uniqueness use Postgres partial unique indexes.
- REJECTED explicitly allows reapplication when no `PENDING`, no active block, and rate guard passes.
- Visits use bounded aggregate fields on `AcquisitionInvite`.
- Guard attempts use a bounded, DB-backed window counter.
- IP is stored only as a domain-separated HMAC key and never as raw IP or bare SHA-256.
- Applicant claim now requires application token + verified Telegram initData + full normalized phone match.
- `APPLICATION` and `SUPPORT` tokens share one table but have non-interchangeable semantics.
- `support_<token>` requires a sanitized early Merchant webhook handler before generic slash-command return/logging.
- Ban/Unban requires an active FK-backed OpsAdmin with `OPS_ADMIN` or `SUPER_ADMIN`; BD and legacy-only identities cannot mutate the blocklist.
- Approval/reject race handling is transaction-authoritative, not pre-read-authoritative.
- The schema plan now explicitly follows the repository's Gate and Prisma migration governance.

### 3.3 Retained

- Invite code + source + campaign + optional sales owner + note + active/inactive.
- One canonical short link and a QR that contains that same link.
- Lead before Telegram.
- Optional GPS/address; location permission is never a submit requirement.
- First-touch source/invite/campaign/initial owner lock.
- `startapp=open` backward compatibility and `DIRECT_TELEGRAM` attribution.
- Existing `/open`, `StoreApplication`, approval transaction, Merchant Bot conversation, Ops takeover/reply, i18n, QR library, public URL helper, phone normalization, and location validation.
- Support phone + one-click dial + Telegram support on Landing, `/open`, and submitted/waiting states.
- Reject ≠ Ban; blocked users may always contact support.
- Exact Application→Store relation written inside approval.

## 4. Repository Evidence and Reuse Matrix

| Capability | Existing evidence | Verdict | V0.2 action |
|---|---|---|---|
| Canonical public URL | `lib/public-url.ts` | **REUSE AS-IS** | `publicUrl('/lead/' + code)` |
| QR + copy link pattern | `app/invite/page.tsx`, `react-qr-code` | **REUSE AS-IS PATTERN** | Ops Invite UI renders/copies one exact URL; stable `/invite` is untouched |
| Existing bind links | `app/api/admin/bind-tokens/route.ts` | **REUSE AS-IS OUTSIDE SCOPE** | Acquisition Invite does not reuse `BindToken` business semantics |
| Telegram Mini App link | `lib/telegram-link.ts` | **SMALL EXTENSION** | Keep `buildTelegramStartAppLink`; add narrow same-bot chat `start` builder |
| Telegram payload resolution | `lib/telegram-start-param.ts` | **SMALL EXTENSION** | Typed strict `open_` parser and redaction; preserve `bind_` |
| Public-path boot | `app/layout.tsx`, `app/components/TelegramInit.tsx` | **SMALL EXTENSION** | Add `/lead` to both duplicated public-prefix lists |
| Middleware | `middleware.ts` | **REUSE AS-IS** | `/lead` is not owner-only; zero middleware change |
| `/open` page | `app/open/page.tsx` | **SMALL EXTENSION** | Claim, prefill, explicit confirm, resume, optional address/location, support footer |
| Telegram verification | `lib/verify-tg-init-data.ts` | **REUSE AS-IS** | `/open` stops using its private duplicate verifier and calls the shared helper |
| Formal application API | `app/api/open/route.ts` | **SMALL EXTENSION** | Idempotent linked application creation with block/rate/store guards |
| Merchant support pipeline | `app/api/webhook/merchant/route.ts` | **SMALL EXTENSION** | Sanitized `support_` early handler; current Customer Bot is untouched |
| Conversation persistence | `TelegramMessage`, `SupportSession` | **REUSE AS-IS** | No `SalesMessage`, `SalesChat`, or third Bot |
| Ops conversation | `app/api/ops/conversations/*`, `app/api/ops/messages/route.ts`, `app/api/ops/support/*`, `app/ops/page.tsx` | **SMALL EXTENSION** | Lead context join/link and block action only |
| Application review | `app/api/ops/applications/*`, `app/ops/page.tsx` | **SMALL EXTENSION** | Add reject and reject+ban; retain approve/notify |
| Approval transaction | `app/api/ops/applications/[id]/approve/route.ts` | **SMALL EXTENSION** | Atomic status claim, `createdStoreId`, Lead `ACTIVATED` |
| Ops identity | `lib/ops-auth.ts`, `OpsAdmin` | **SMALL EXTENSION** | FK-backed high-risk actor helper; no Sales RBAC platform |
| Phone normalization | `lib/member-phone.ts` | **REUSE AS-IS CORE** | Strict validator wraps `normalizeMemberPhone()`; no second normalizer |
| Location validation | `lib/store-location.ts` | **REUSE AS-IS** | Optional clean/range checks |
| i18n | `LangProvider`, `lib/i18n/{zh,en,km}.ts` | **SMALL EXTENSION** | Only new copy is added in all three dictionaries |
| Support config | `.env.example`, `TELEGRAM_BOT_USERNAME` | **NEW MINIMAL CAPABILITY** | One server helper + `PLATFORM_SUPPORT_PHONE`; no Settings table |
| Invite/Lead/token/block/rate persistence | Prisma | **NEW MINIMAL CAPABILITY** | Five models only |
| CRM/AI/multi-touch/unique visitors | none required | **DEFERRED** | No implementation in V0.1 product slice |

## 5. Final Data Model Proposal

This section is design only. The schema and migrations are unchanged in this revision.

### 5.1 Enums

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
  APPLICATION
  SUPPORT
}

enum SalesLeadRateAction {
  LEAD_SUBMIT
  APPLICANT_CLAIM
  APPLICATION_SUBMIT
}

enum SalesLeadRateScope {
  PHONE
  TELEGRAM
  INVITE
  IP
  APPLICATION_TOKEN
}
```

`DIRECT_TELEGRAM` is system-only. Invite-management validation must reject it as an Ops-selectable Invite channel.

### 5.2 `AcquisitionInvite` — new

```prisma
model AcquisitionInvite {
  id             String                   @id @default(cuid())
  code           String                   @unique
  sourceChannel  AcquisitionSourceChannel
  campaignLabel  String?
  salesOwnerId   String?
  internalNote   String?                  @db.Text
  status         AcquisitionInviteStatus  @default(ACTIVE)
  visitCount     Int                      @default(0)
  firstVisitAt   DateTime?
  lastVisitAt    DateTime?
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt

  salesOwner OpsAdmin?   @relation("AcquisitionInviteSalesOwner", fields: [salesOwnerId], references: [id], onDelete: SetNull)
  leads      SalesLead[]

  @@index([status, createdAt])
  @@index([salesOwnerId, status])
}
```

Decisions:

- `code` is an immutable random 12-character uppercase Crockford/Base32 value (about 60 random bits), with DB collision retry. It is not a sequential ID.
- Public lookup returns only safe display/state/support data. It never returns `internalNote`, sales owner identity, internal IDs, or Lead counts.
- A Landing bootstrap `POST` atomically increments `visitCount`, sets `firstVisitAt` only when null, and always updates `lastVisitAt`.
- Counters mean **Visits**. Reloads, prefetches, and bots may be counted. The system does not claim Unique Visitors.
- `INACTIVE` still returns an inactive tri-language page and support methods; it cannot create a Lead.
- There is no visit event table and no V0.1 day-trend model.

### 5.3 `SalesLead` — new

```prisma
model SalesLead {
  id                    String           @id @default(cuid())
  storeName             String
  ownerName             String
  normalizedPhone       String
  address               String?          @db.Text
  latitude              Float?
  longitude             Float?

  firstInviteId         String?
  firstSourceChannel    AcquisitionSourceChannel
  firstCampaign         String?
  initialSalesOwnerId   String?

  telegramId            String?
  telegramUsername      String?
  telegramFirstName     String?
  telegramLastName      String?
  telegramBoundAt       DateTime?

  status                SalesLeadStatus  @default(WAITING_TELEGRAM)
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt
  lastActivityAt        DateTime         @default(now())

  firstInvite       AcquisitionInvite?       @relation(fields: [firstInviteId], references: [id], onDelete: Restrict)
  initialSalesOwner OpsAdmin?                 @relation("SalesLeadInitialOwner", fields: [initialSalesOwnerId], references: [id], onDelete: SetNull)
  tokens            SalesLeadContextToken[]
  applications      StoreApplication[]

  @@index([normalizedPhone])
  @@index([telegramId])
  @@index([firstInviteId, createdAt])
  @@index([initialSalesOwnerId, status])
  @@index([status, lastActivityAt])
  @@unique(
    [telegramId],
    map: "SalesLead_one_inflight_per_telegram",
    where: raw("\"telegramId\" IS NOT NULL AND \"status\" IN ('NEW','FOLLOWING','WAITING_TELEGRAM','APPLIED')")
  )
}
```

Decisions:

- `normalizedPhone` is indexed but **not unique**.
- `telegramId` is indexed but **not globally unique**.
- The partial unique index permits only one in-flight first-store Lead per Telegram while allowing historical `ACTIVATED`/`LOST` Leads and future multi-store work.
- First-touch fields are server snapshots. Normal Lead update services never accept them in a writable DTO.
- `firstInviteId` is nullable for `DIRECT_TELEGRAM` legacy flow.
- `initialSalesOwnerId = null` renders as `UNASSIGNED`; it does not create a new Lead status.
- Application and conversion status are primarily derived from related records; `status` is a minimal operational state, not a CRM pipeline.

### 5.4 `SalesLeadContextToken` — new

```prisma
model SalesLeadContextToken {
  id                     String                @id @default(cuid())
  salesLeadId            String
  purpose                SalesLeadTokenPurpose
  tokenHash              String                @unique
  contextStage           String?
  expiresAt              DateTime
  consumedAt             DateTime?
  consumedByTelegramId   String?
  revokedAt              DateTime?
  createdAt              DateTime              @default(now())

  salesLead SalesLead @relation(fields: [salesLeadId], references: [id], onDelete: Cascade)

  @@index([salesLeadId, purpose, expiresAt])
  @@index([purpose, consumedByTelegramId, consumedAt])
  @@index([expiresAt])
}
```

Decisions:

- Raw token: 16 cryptographically random bytes minimum (128-bit entropy), encoded base64url without padding.
- Total Telegram payload is bounded to 64 characters; `open_` plus a 22-character 128-bit base64url token and `support_` plus the same token both stay within that limit.
- DB stores `SHA-256(rawToken)` only. Logs, analytics, errors, `TelegramMessage`, and Ops UI never store/display raw tokens.
- `purpose` is checked before every resolve; an `APPLICATION` token cannot enter support and a `SUPPORT` token cannot claim an applicant.
- `APPLICATION` default TTL: 72 hours, loaded from documented server config. It is one-time claim capability.
- `SUPPORT` TTL is independently configurable; recommended default 24 hours, not an architecture invariant.
- Expired/revoked/old-consumed tokens are pruned opportunistically with a bounded retention window; no scheduler platform is required.
- For `SUPPORT`, `consumedByTelegramId` is conversation context only and never becomes canonical `SalesLead.telegramId`.

### 5.5 `ApplicationBlock` — new

```prisma
model ApplicationBlock {
  id                       String    @id @default(cuid())
  telegramId               String    @unique
  telegramUsername         String?
  reason                   String
  note                     String?   @db.Text
  blockedByOpsAdminId      String
  blockedAt                DateTime  @default(now())
  unblockedByOpsAdminId    String?
  unblockedAt              DateTime?
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt

  blockedBy   OpsAdmin  @relation("ApplicationBlockCreatedBy", fields: [blockedByOpsAdminId], references: [id], onDelete: Restrict)
  unblockedBy OpsAdmin? @relation("ApplicationBlockClearedBy", fields: [unblockedByOpsAdminId], references: [id], onDelete: SetNull)

  @@index([unblockedAt, blockedAt])
}
```

Decisions:

- Active iff `unblockedAt IS NULL`.
- Re-ban updates the same bounded identity row: new reason/note/operator/time and clears unblock fields. V0.1 does not build an audit-history platform.
- The only block key is `telegramId`. Username is display-only.
- Block prevents new `StoreApplication` creation only. It does not block Lead viewing, existing Store use, or support.
- Only active, FK-backed `OPS_ADMIN`/`SUPER_ADMIN` actors may Ban/Unban. `BD`, `_ops_admin`, or env-whitelist-only identities without an `OpsAdmin` row cannot perform these high-risk writes.

### 5.6 `SalesLeadRateCounter` — new

```prisma
model SalesLeadRateCounter {
  id             String                @id @default(cuid())
  action         SalesLeadRateAction
  scopeType      SalesLeadRateScope
  scopeKeyHash   String
  windowStart    DateTime
  count          Int                   @default(0)
  expiresAt      DateTime
  updatedAt      DateTime              @updatedAt

  @@unique([action, scopeType, scopeKeyHash, windowStart])
  @@index([expiresAt])
}
```

Decisions:

- Atomic `upsert` + increment makes the counter serverless-safe.
- Each action uses a small number of fixed windows. Expired rows are deleted opportunistically before/after writes, keeping data bounded to live windows plus short cleanup grace.
- `scopeKeyHash = HMAC-SHA256(SALES_LEAD_RATE_LIMIT_SECRET, action + ':' + scopeType + ':' + canonicalValue)`.
- Raw IP is never persisted or logged by this subsystem. Bare SHA-256 of IPv4 is forbidden because its search space is enumerable.
- Secret is stable, server-only, environment-managed, and domain-separated from session/token secrets. Rotation intentionally resets short-lived buckets; dual-secret migration is unnecessary.
- IP is a rate signal only, never identity or dedup evidence.
- IP input comes only from the deployment platform's trusted proxy boundary. If that boundary cannot be established, omit the IP dimension rather than trusting an arbitrary client-supplied forwarding header.

### 5.7 Existing `StoreApplication` — minimal extension

```prisma
model StoreApplication {
  // existing fields stay intact
  salesLeadId    String?
  createdStoreId String? @unique

  salesLead    SalesLead? @relation(fields: [salesLeadId], references: [id], onDelete: SetNull)
  createdStore Store?     @relation(fields: [createdStoreId], references: [id], onDelete: SetNull)

  @@index([salesLeadId, createdAt])
  @@index([telegramId, status])
  @@unique(
    [telegramId],
    map: "StoreApplication_one_pending_per_telegram",
    where: { status: "PENDING" }
  )
}
```

- `salesLeadId` is a normal nullable FK and index. It is explicitly **not unique**.
- `createdStoreId` is unique because a Store is created by at most one formal application.
- Historical applications retain null Lead/Store links; there is no speculative backfill.
- Prisma relation-only back fields are added to `Store` and `OpsAdmin` as required by Prisma; no extra database column is needed on those models.

### 5.8 Data model verdict

| Item | V0.2 verdict |
|---|---|
| New models | exactly 5 |
| Existing model with new DB fields | `StoreApplication` only |
| Relation-only existing schema blocks | `Store`, `OpsAdmin` |
| Lead→Application | 1:N |
| Phone uniqueness | none |
| Telegram lifetime uniqueness | none |
| Telegram in-flight Lead uniqueness | partial unique index |
| Telegram `PENDING` Application uniqueness | partial unique index |
| Visit events | removed |
| Attempt logs | removed |

## 6. Lead / Application Cardinality and Concurrency

### 6.1 Cardinality and reapply policy

```text
SalesLead 1
  ├─ StoreApplication #1 REJECTED
  ├─ StoreApplication #2 PENDING
  └─ StoreApplication #2 APPROVED → createdStoreId
```

REJECTED reapplication is allowed when all are true:

1. Verified applicant Telegram has no `PENDING` `StoreApplication`.
2. No active `ApplicationBlock` exists for that Telegram.
3. Existing active Store/User guard does not indicate an already active merchant.
4. Conservative application rate guard passes.

No cooldown, retry quota, rejection count state, or automatic Ban is introduced. A rejected application remains history on the same Lead. Lead status remains `APPLIED` until a manual `LOST`, a new in-flight step, or `ACTIVATED`; the UI derives the latest application status from the relation.

### 6.2 DB-level `PENDING` idempotency

Application code must not rely on `findFirst`:

1. `/api/open` verifies initData and resolves the one in-flight claimed Lead.
2. It checks active User/Store, block, rate, and an existing `PENDING` row.
3. A transaction attempts `StoreApplication.create` with `status='PENDING'` and `salesLeadId`.
4. The Postgres partial unique index is the final concurrent arbiter.
5. If Prisma reports `P2002` (or the adapter exposes Postgres `23505`) for the named pending index, the API reads and returns the winning `PENDING` application as an idempotent 200 response.
6. Other uniqueness/database errors are not swallowed.

This produces one row under serverless double-click, two tabs, retry, or parallel function execution.

### 6.3 In-flight Lead claim concurrency

Two forwarded tokens may race to bind the same Telegram:

1. Both calls verify their separate applicant proof.
2. Each transaction tries to set `SalesLead.telegramId` while the Lead has an in-flight status.
3. `SalesLead_one_inflight_per_telegram` allows one winner.
4. The loser catches the named unique violation, loads the canonical in-flight Lead for that Telegram, and returns a conflict/resume decision without rewriting either first touch.
5. No automatic cross-Lead merge is performed when identity is ambiguous.

### 6.4 Historical data audit before the pending index

Implementation is blocked until Production is audited using a read-only query through the approved migration workflow:

```sql
SELECT "telegramId", COUNT(*) AS pending_count
FROM "StoreApplication"
WHERE "status" = 'PENDING'
GROUP BY "telegramId"
HAVING COUNT(*) > 1;
```

If rows are returned:

- Stop the migration.
- Take/verify backup.
- Human review chooses the canonical pending application.
- Resolve extra rows explicitly (normally `REJECTED`) in a separately approved data repair; never auto-delete or infer from row order.
- Re-run the audit and only then create the partial unique index.

There are no historical `SalesLead` rows before this feature, so its partial uniqueness has no legacy-data conflict.

## 7. Identity Claim Design

### 7.1 Identity state machine

```text
Anonymous Visit
  │ no browser/visitor identity
  ▼
Lead with normalized phone + immutable first touch
  │ APPLICATION token issued; telegramId still null
  ▼
Telegram Claim Pending
  │ /open + verifyTgInitData + token resolve + full-phone proof
  ▼
Verified Applicant Telegram
  │ canonical SalesLead.telegramId written; token consumed
  ▼
Explicit /open confirmation
  ▼
StoreApplication PENDING
  │ Ops approval transaction
  ▼
Store + SalesLead ACTIVATED
```

`/start support_<token>` never crosses from “Lead with phone” to “Verified Applicant Telegram”. It records only contextual support consumption on the token.

### 7.2 Candidate proof comparison

| Candidate | Security/UX | Verdict |
|---|---|---|
| A. Re-enter full phone and compare canonical normalized value | Works when the Facebook/TikTok browser and Telegram WebView do not share cookies; significantly larger secret space than last four; one extra field | **RECOMMENDED V0.2** |
| B. Enter last four digits | Only 10,000 combinations, easily observed/guessed, unsuitable for a flow that can culminate in OWNER creation | **REJECTED** |
| C. Server-side browser claim/session | Same-browser continuity can be safe, but Facebook/TikTok/Safari and Telegram WebView often do not share cookies; forwarding a browser secret makes it transferable; would introduce anonymous identity state | **NOT PRIMARY PROOF / DEFERRED** |

Recommended UX:

1. Tokenized `/open` initially shows a generic “confirm applicant” form with a full phone field; it does not reveal Lead PII before proof.
2. The server normalizes with the existing `normalizeMemberPhone()` and exact-matches `SalesLead.normalizedPhone`.
3. Success binds verified Telegram and returns the existing store/owner/address data for confirmation.
4. Failure returns a generic mismatch message, rate-counts phone/token/Telegram, reveals no digits or Lead existence, and always offers support.

Residual risk: this is not phone ownership verification. A person who has both the forwarded token and the applicant's full phone can still pass. SMS OTP is explicitly deferred; Ops human review remains a defense before OWNER activation. Full phone is the strongest frozen-scope proof that works cross-browser without a third-party service.

### 7.3 Applicant identity write transaction

Canonical `SalesLead.telegramId` is written only when all four conditions are true:

1. Request is handled by `/open` through `POST /api/open/claim`.
2. Shared `verifyTgInitData()` succeeds with the Merchant Bot token and yields the Telegram ID.
3. An unexpired, unrevoked `APPLICATION` token resolves to the Lead.
4. Full submitted phone normalizes and exactly equals the Lead phone.

The same transaction then:

- checks active User/Store conflict;
- checks the in-flight Telegram Lead constraint;
- records Telegram username/name and `telegramBoundAt`;
- changes `WAITING_TELEGRAM` to `NEW` (manual `FOLLOWING` is not overwritten);
- sets token `consumedAt` and `consumedByTelegramId` conditionally while still unconsumed;
- updates `lastActivityAt`.

If any check fails, neither the Lead identity nor token consumption is written.

### 7.4 Legacy exact `startapp=open`

Legacy has no incoming token. `/open` retains the existing form and adds phone plus optional location/address:

1. Verified initData + form submission creates/restores a `DIRECT_TELEGRAM` Lead.
2. The server creates an `APPLICATION` token internally and immediately routes it through the same claim transaction using the submitted full phone; raw token is not placed in a URL.
3. The page displays the populated confirmation state.
4. Explicit confirmation calls the same idempotent `/api/open` application endpoint.

Thus legacy behavior remains one fixed QR/link and one `/open` screen, while the persisted chain becomes `SalesLead → StoreApplication → Store`.

## 8. Dedup and Permanent First-Touch Rules

### 8.1 Canonical phone and validation

- `normalizeMemberPhone()` in `lib/member-phone.ts` is the sole normalizer.
- A thin Lead validator may reject missing values, implausible digit length, all-identical digits, all-zero values, and clearly invalid Cambodian shapes after normalization.
- It accepts common Cambodia forms such as `0xx...`, `855xx...`, `+855...`, spaces, and hyphens according to the existing helper.
- No phone global unique constraint is created.

### 8.2 Pre-Telegram restore

Invite is never part of the dedup key. On valid public form submit:

1. Normalize phone.
2. Query a bounded set of Leads by `normalizedPhone`, newest activity first.
3. Compare normalized owner name in application code; no fuzzy-matching platform is added.
4. Exactly one compatible non-activated Lead is restored regardless of Invite or elapsed time.
5. Multiple plausible shared-phone candidates are not destructively merged. Return a safe ambiguity/support path or create a distinct Lead only when owner identity is materially different.
6. A matching `ACTIVATED` Lead is not reset; return a generic “existing E-Shop merchant / contact support” response without exposing Store details to an anonymous caller.

Phone formatting corrections that normalize to the same value are accepted. A material phone replacement is allowed only after verified applicant Telegram claim or an authorized Ops edit; an anonymous caller cannot mutate a Lead to a different phone merely by knowing its public Invite.

### 8.3 State-based restore, no time window

| Existing Lead state | Submit/return behavior |
|---|---|
| `NEW` / `WAITING_TELEGRAM` | Restore same Lead; update allowed contact/form fields; issue/reissue token; first touch unchanged |
| `FOLLOWING` | Restore same Lead; do not reset manual follow-up state; first touch unchanged |
| `APPLIED` + `PENDING` | Show existing application state; do not create another application |
| `APPLIED` + latest `REJECTED` | Allow explicit reapply after block/rate/pending guards |
| `ACTIVATED` | Show existing-merchant message and support; V0.1 does not enter second-store application |
| `LOST` | Restore the same Lead; system sets `WAITING_TELEGRAM` if unbound or `NEW` if already verified; first touch unchanged |

Thirty days may appear only as an Ops “stale Lead” filter. It never changes identity, dedup, attribution, or write behavior.

### 8.4 Post-Telegram identity

Telegram is the more stable signal after claim, but not a lifetime unique key:

- Resolve the one in-flight Lead using the partial unique rule.
- If an active merchant User/Store already exists, do not open the first-store workflow.
- If another in-flight Lead already owns the Telegram identity, that canonical Lead wins; do not overwrite first touch or silently merge.
- Future second-store applications remain deferred and are not blocked at the data-model level by a global Lead uniqueness constraint.

## 9. Token Design

### 9.1 Application token

| Property | Decision |
|---|---|
| Telegram format | `https://t.me/<merchant_bot>?startapp=open_<base64url-token>` |
| Entropy | at least 128 bits |
| DB storage | SHA-256 hash only |
| Default TTL | configurable; documented default 72 hours |
| PII in payload | none |
| First consumption | conditional update while `consumedAt IS NULL`, after proof succeeds |
| Same-Telegram replay | resume existing claim/application/store state; no new identity or application |
| Different-Telegram replay | reject without PII; never rebind; offer support |
| Expired/revoked | no claim; restore Lead to issue a fresh token or contact support |
| Logging | strict redaction only; no raw URL/payload |

The raw token is an applicant context capability, not applicant identity. It is insufficient without verified initData and full-phone proof.

### 9.2 Support token

| Property | Decision |
|---|---|
| Telegram format | `https://t.me/<merchant_bot>?start=support_<base64url-token>` |
| Purpose | attach Lead/Invite/Campaign/stage context to existing Merchant/Ops support |
| Identity effect | never writes canonical `SalesLead.telegramId` |
| TTL | independently configurable; recommended default 24 hours |
| Valid first use | conditionally records `consumedAt` + sender Telegram on token; opens `SupportSession.awaiting_human` |
| Invalid/expired/reused | sanitize and fall back to context-free support; never block support |
| Persistence | store a safe marker such as `[SUPPORT_ENTRY]`, never the `/start` text or token |

Ops conversation context is derived by joining the latest consumed `SUPPORT` token for `recipientTelegramId`, not by adding a new conversation/message model.

## 10. Public Route and Telegram Parser Compatibility

### 10.1 Public Landing route verdict

**Chosen route: `/lead/[code]`.**

Evidence:

- `middleware.ts` owner-only prefixes include `/invite` and `/ops`, but not `/lead`; therefore middleware can remain unchanged.
- `/invite/...` is unsuitable because it is explicitly OWNER-only.
- `app/layout.tsx` and `app/components/TelegramInit.tsx` maintain separate `PUBLIC_PATH_PREFIXES`; neither currently includes `/lead`.
- Without both minimal additions, a non-Telegram Facebook/TikTok/Safari/Chrome visit may be treated as protected and redirected to `/relogin`.

Required later implementation change:

- Append `/lead` in the two public-prefix arrays only.
- Do not change `middleware.ts`.
- Add regression tests proving direct non-Telegram visits do not call merchant auth or redirect to `/relogin`.

### 10.2 `startapp` parser order

Current `TelegramInit.tsx` recognizes `bind_<token>` before public short-circuit and recognizes only exact `open` after `USER_NOT_FOUND`. Therefore `open_<token>` currently falls through or stalls.

V0.2 parser order:

```text
resolveTelegramStartParam(all existing sources)
  1. strict bind_<token> → existing /bind behavior, unchanged
  2. exact open         → /open legacy
  3. strict open_<token>→ /open tokenized claim
  4. public path short-circuit
  5. existing Merchant/Ops auth behavior
  6. default /start fallback
```

Rules:

- Implement typed `getOpenTokenFromStartParam()` in `lib/telegram-start-param.ts` with base64url character/length bounds.
- Resolve `open`/`open_` before the public-path early return and mirror it in the `USER_NOT_FOUND` branch.
- `window.location.replace('/open')` removes the token from the normal browser URL; `/open` obtains the start payload from Telegram sources.
- Never use `bind_` for Lead/Application tokens.
- Existing `bind_<token>` OWNER/STAFF precedence and behavior remain byte-for-byte compatible.
- Exact legacy `open` remains distinct from `open_`.

### 10.3 Merchant Bot support start handler

Current `app/api/webhook/merchant/route.ts` logs the first 200 raw update characters, then returns early for every slash command. A new raw `/start support_<token>` would otherwise risk log leakage or be ignored.

Minimal handler placement:

1. Verify Telegram webhook secret as today.
2. Parse update.
3. Log only structural metadata (`update_id`, message type, sender presence); remove raw text logging for this path.
4. Extract sender/chat.
5. Before generic `text.startsWith('/')` return, recognize exact `/start support_<bounded-token>`.
6. Hash/resolve purpose `SUPPORT`; never log or persist raw command.
7. Upsert existing `SupportSession` to `awaiting_human` and persist only `[SUPPORT_ENTRY]` through existing `TelegramMessage` semantics.
8. Valid token gives contextual join; invalid/expired/used gives ordinary context-free support.
9. Return before KHQR/import/FAQ routing.

Other slash commands, KHQR, product import, FAQ, takeover, and ordinary message forwarding retain existing behavior.

## 11. Guard, Rate Limit, and Block

### 11.1 Conservative configurable defaults

The following are implementation starting values, not architecture truths. They live in a small server config module/environment values and can be tuned without migration.

| Scope/action | Type | Starting candidate | Semantics |
|---|---|---:|---|
| Phone / Lead submit | hard | 6 per hour | stop repeated valid-form writes for one phone bucket |
| Phone / Applicant claim | hard | 10 per 15 min | constrain phone guessing against one token context |
| Telegram / Applicant claim | hard | 10 per 15 min | constrain forwarded-token/phone guessing |
| Application token / Claim | hard | 10 per 15 min | constrain token proof attempts |
| Telegram / Application submit | hard | 5 per 15 min | constrain repeated formal submit/reapply |
| IP / public Lead submit | soft signal | 60 per 5 min | shared NAT/Wi-Fi aware; never identity or permanent ban |
| Invite / public Lead submit | soft signal | 300 per 15 min | advertising bursts are legitimate; never auto-disable campaign |

Hard violations return tri-language `429` with retry guidance and support. Soft thresholds add conservative delay/observability or require another hard signal; Invite or IP alone must not disable an Invite, Ban a Telegram, or reject a legitimate advertising burst.

Visits are not treated as valid Leads and are not throttled by phone/TG rules. Platform edge rate limiting may later complement this, but no anti-fraud platform is designed.

### 11.2 Application guards in order

Before creating a `StoreApplication`:

1. Verify Merchant Bot initData.
2. Resolve canonical claimed in-flight Lead by Telegram.
3. Check active User whose Tenant is active; if present, return “already has E-Shop store” and support.
4. Check active `ApplicationBlock`; if present, deny application but return support actions.
5. Check application rate counters.
6. Query existing `PENDING`; return it idempotently.
7. Insert; let the partial unique index resolve a race.

No frontend disabled state is relied upon for safety.

### 11.3 Ban/Unban and Reject

- Lead detail: Ban/Unban.
- Existing conversation: “Ban Application”, not global conversation ban.
- Application: Reject; and a separate “Reject + Ban” confirmation.
- Reject uses a conditional transaction update from `PENDING` to `REJECTED`.
- Reject + Ban performs that conditional transition and ApplicationBlock upsert in one transaction.
- Reject never automatically creates a block.
- Ban does not rewrite an existing application status and does not stop support.
- Unban does not restore or auto-submit an application.

The repository has no current reject-writing Ops endpoint. `POST /api/ops/applications/[id]/reject` is therefore part of this minimal vertical slice, not a review-platform expansion.

## 12. Application → Store Conversion

### 12.1 Application state flow

```text
PENDING ──approve──→ APPROVED ──createdStoreId──→ Store
   │
   └──reject──────→ REJECTED ──reapply guards──→ new PENDING row on same SalesLead
```

The current String statuses (`PENDING | APPROVED | REJECTED`) remain. No second application state machine or review workflow is added.

### 12.2 Minimal approval transaction change

The current route pre-reads `PENDING` outside the transaction and then creates Tenant/Store/User/UserStoreRole. V0.2 makes the transaction authoritative without rewriting its business steps:

1. Inside the existing transaction, conditionally `updateMany({ id, status: 'PENDING' })` to `APPROVED`/`approvedAt`; zero rows means another approve/reject won and the transaction exits with 409.
2. Re-read the application inside the transaction.
3. Run the existing Tenant, Store, OWNER User, UserStoreRole, and trial-subscription operations unchanged.
4. Update the application with `tenantId` and exact `createdStoreId`.
5. If `salesLeadId` is present, update that Lead to `ACTIVATED` and touch `lastActivityAt`.
6. Commit; only then send the existing Telegram approval notification.

If any Store/User/role/subscription/link update fails, the transaction rolls back the status claim, Store creation, conversion link, and Lead activation together. Approve/approve and approve/reject races have one winner.

Historical applications have null `salesLeadId`/`createdStoreId` and continue through the existing approval path. No historical conversion is guessed.

## 13. Route / API Map

### 13.1 New pages

| Route | Access | Purpose | State writes |
|---|---|---|---|
| `/lead/[code]` | public, non-Telegram safe | Invite status, lead form, optional location/address, support | none directly; calls public APIs |
| `/ops/acquisition-invites` | existing Ops auth | list/create/activate/deactivate Invite, render/copy exact URL/QR | Invite only |
| `/ops/sales-leads` | existing Ops auth | list + query-addressable drawer/detail | minimal manual Lead state and block actions through APIs |

There is no new waiting page. Existing `/open` owns claim, confirmation, submitted/waiting, rejected/reapply, approved/store, blocked, and support states.

### 13.2 New APIs

| API | Access | Input | Output | Side effect / idempotency |
|---|---|---|---|---|
| `POST /api/public/acquisition-invites/[code]/landing` | public | code + no PII | safe invite state/label + support config | atomic aggregate Visit increment; one call per rendered load, not unique visitor |
| `POST /api/public/sales-leads` | public | invite code, store/owner/phone, optional address/GPS | created/restored state + `startapp=open_<token>` + contextual support link | normalize/dedup/first-touch lock/rate; retries restore compatible Lead |
| `POST /api/open/claim` | public but verified Telegram | initData, optional application token, full phone; legacy branch also form fields | safe claim state, prefill only after proof, application/resume status, support | one-time token consumption + TG bind transaction; named partial unique race handling |
| `GET, POST /api/ops/acquisition-invites` | Ops; create requires `OPS_ADMIN`+ | filters / create fields | list / new Invite URL | code collision retry; internal note never public |
| `PATCH /api/ops/acquisition-invites/[id]` | Ops; `OPS_ADMIN`+ | active/inactive, label/note/owner | updated Invite | no code or historical-source mutation |
| `GET /api/ops/sales-leads` | Ops | filters/pagination | minimal list/funnel fields | read only |
| `GET, PATCH /api/ops/sales-leads/[id]` | Ops | id; manual state/allowed contact correction | detail/current state | system states/attribution/identity/conversion immutable to generic patch |
| `POST /api/ops/sales-leads/[id]/application-block` | active FK-backed `OPS_ADMIN`+ | action BAN/UNBAN, reason/note | block state | idempotent upsert/update; actor FK required |
| `POST /api/ops/applications/[id]/reject` | existing Ops review auth; Ban option requires FK-backed `OPS_ADMIN`+ | `ban: false|true`, reason/note | REJECTED + optional block | conditional PENDING transaction; repeated call returns current state |

Nine new route files are the upper bound. Collection/member verbs are combined where Next.js route semantics permit; no 10+ API expansion is expected.

### 13.3 Modified APIs/routes

| Existing route | Minimal change | Idempotency/security |
|---|---|---|
| `POST /api/open` | create formal application from canonical claimed Lead; return submitted/resume state | DB partial unique, P2002/23505 winner return, block/store/rate guards |
| `POST /api/ops/applications/[id]/approve` | transaction-authoritative status claim + Store/Lead linkage | one race winner; full rollback |
| `GET /api/ops/applications` | include Lead/created Store summary | Ops only; no new write |
| Ops conversations/detail | join Lead context by canonical TG or consumed support token | no Support token can bind applicant identity |
| `POST /api/ops/messages` | after successful existing reply, touch matching Lead activity | message send remains source of truth; touch failure must not duplicate send |
| `POST /api/webhook/merchant` | sanitized `support_` early handler | never store/log raw token; fallback always supports |

## 14. End-to-End and Security Sequences

### 14.1 Product sequences

#### A — TikTok link

```text
TikTok → https://elifekh.com/lead/TK83K2...
→ POST landing (Invite Visit counter)
→ valid Lead POST (SalesLead, TikTok first touch locked)
→ Merchant Bot startapp=open_<token>
→ /open claim proof
→ explicit application
→ Ops approval → exact Store
```

#### B — QR

The QR encodes the exact same `/lead/<code>` URL. From scan onward it is identical to A. There is no QR model or alternative source chain.

#### C — Lead created, Telegram abandoned

Valid public form creates/restores `SalesLead(WAITING_TELEGRAM)` before redirect. No application or canonical Telegram exists. Ops can call the stored phone and use existing support after the customer contacts the Merchant Bot.

#### D — Contact support

Before Lead, a direct Merchant Bot link opens context-free support. After Lead, `support_<token>` enters the Merchant webhook early handler, marks existing `SupportSession.awaiting_human`, writes only `[SUPPORT_ENTRY]`, and lets Ops derive Lead context. It never claims applicant identity.

#### E — Legacy `startapp=open`

Exact `open` routes to existing `/open`; verified Telegram fills store/owner/phone and optional location/address; server creates/restores `DIRECT_TELEGRAM` Lead and internally uses the common claim logic; confirmation creates one pending application.

#### F — Duplicate Telegram application

Resume check returns existing PENDING. If two creates still race, the partial unique index admits one; the loser returns the winner.

#### G — Blocked Telegram

Claim may identify the applicant, but formal application guard returns BLOCKED and support methods. No new application is written.

#### H — Approved conversion

Approval transaction writes Tenant + Store + OWNER + UserStoreRole + application `createdStoreId` + Lead `ACTIVATED`. The relation proves Invite→Lead→Application→Store.

### 14.2 Security sequences

#### Security A — Normal Application token

```text
APPLICATION token valid
+ verifyTgInitData succeeds
+ full normalized phone matches
+ no identity/store/block conflict
→ atomic canonical Telegram claim
→ token consumed by same TG
→ explicit application guarded by pending unique index
```

#### Security B — Token forwarded to another Telegram

Telegram B has valid initData but the token alone is insufficient. Before full-phone match, no Lead PII is returned. Wrong proof increments token/Telegram/phone counters; no token consume and no `SalesLead.telegramId` write. Support remains available.

#### Security C — Support token forwarded

The receiver may open a contextual support session, but consumption remains on the token context row only. It cannot write canonical Telegram identity or create an application. Used/expired tokens degrade to context-free support.

#### Security D — Application token replay

- Same Telegram: return/resume existing Lead/application/store state.
- Different Telegram: reject; never transfer Lead.
- Concurrent first consume: conditional consume plus in-flight unique index yields one winner.

#### Security E — Expired Application token

No Lead data or claim. The customer can restore the Lead through the public flow to receive a fresh token, or contact support. Expiry never deletes the Lead or changes first touch.

#### Security F — Blocked Telegram

Block guard runs before every new application insert/reapply. It returns a blocked state with phone and Telegram support. It does not block messages.

#### Security G — Concurrent duplicate PENDING

Both serverless calls may pass a read. The named Postgres partial unique index permits one insert. The losing API recognizes only that constraint, fetches the winner, and responds idempotently.

### 14.3 Direct security checklist

| Risk | Boundary |
|---|---|
| phone/name/GPS/address in URL | forbidden; only opaque token in Telegram payload |
| token entropy | 128-bit minimum |
| token DB disclosure | hashes only |
| replay | purpose + expiry + conditional consume + consumed Telegram rules |
| applicant takeover | full-phone proof in addition to token/initData; no PII before proof |
| IDOR | public APIs resolve opaque code/token; Ops IDs require Ops auth and server-side field allowlists |
| public Invite enumeration | random ~60-bit code, safe public response, generic inactive/not-found distinction where appropriate |
| PII authorization | all Lead list/detail APIs use existing Ops auth; no public Lead lookup by ID/phone |
| Ban authorization | active FK-backed `OPS_ADMIN`/`SUPER_ADMIN` only |
| duplicate races | two named DB partial unique indexes + transaction error handling |
| raw IP | never stored; HMAC rate key only |
| raw support/application token logging | strict redaction; Merchant webhook raw update logging removed/sanitized for start handler |

## 15. Ops UI, Support Config, i18n, and Funnel

### 15.1 Minimal Ops UI

Invite management shows code/link/QR, source, campaign label, initial sales owner, status, visits, Lead count, created time, and copy/download actions. It does not become Campaign Scheduling.

Sales Lead list shows:

- Store Name, Owner Name, Phone
- Source, Campaign, Invite
- Sales Owner or `UNASSIGNED`
- Telegram binding
- Lead status and latest application status
- Last activity

Lead detail is a drawer/section in the same page and shows Contact, Attribution, Sales Owner, Telegram, Application history, Conversion Store, Block state, and a link that opens the existing Ops conversation. Allowed actions are open conversation, minimal manual state (`NEW`/`FOLLOWING`/`LOST`), Ban/Unban, and existing application review. No tags, notes platform, tasks, timeline platform, or automation is added.

### 15.2 Support config

- Reuse existing `TELEGRAM_BOT_USERNAME` because the frozen support channel is the Merchant Bot.
- Add one server-only `PLATFORM_SUPPORT_PHONE` environment value following existing uppercase env naming.
- A small server helper validates/normalizes presentation and returns safe display phone, `tel:` URL, direct Merchant Bot link, or Lead-context support link.
- Do not add a database Settings model or scatter page constants.
- Do not add another `NEXT_PUBLIC_*` value; server pages/APIs expose only the already-public contact result.
- Missing phone: render tri-language “phone temporarily unavailable” and keep Telegram support.
- Missing Bot username: keep phone support and return no invalid `t.me` URL.
- If both are missing, health/config readiness fails for enabling/creating acquisition Invites, but existing legacy `/open` must not crash.

### 15.3 Three-language boundary

All new form, validation, location, Telegram claim, duplicate, pending, approved, rejected/reapply, blocked, inactive Invite, support, rate, and generic error copy is added to existing `lib/i18n/zh.ts`, `en.ts`, and `km.ts` and consumed through `LangProvider`. V0.2 does not broadly rewrite old `/open` wording outside this vertical slice.

### 15.4 Minimal reliable funnel

| Funnel step | Source of truth |
|---|---|
| Invite Visits | `AcquisitionInvite.visitCount` |
| Valid Leads | `SalesLead.firstInviteId` / direct source relation |
| Telegram Bound | `SalesLead.telegramBoundAt IS NOT NULL` |
| Applications | related `StoreApplication` rows |
| Approved | `StoreApplication.status='APPROVED'` |
| Stores | `StoreApplication.createdStoreId IS NOT NULL` |

The word is **Visits**, never Unique Visitors. Other stages are relational queries; duplicate counters are not added. Daily trends and complex BI are deferred.

## 16. Database Governance Evidence and Migration Plan

### 16.1 What the repository actually requires

1. `docs/change-gates/gate-config.json` exists. It lists `prisma/schema.prisma` and `prisma/migrations/` under forbidden paths for Dev-Gate-01A.
2. `docs/change-gates/DEV_GATE_01A_FREEZE.md` describes that gate as a read-only, manual scope guard. It says a match is BLOCKED and requires stopping/reporting; it also says hooks/npm integration are out of scope and `allowed_paths` is informational.
3. This is a real change gate for a future implementation; it is not evidence of a permanent “Prisma can never change” architecture rule. `origin/main` contains authorized schema+migration commits after the gate, including `d8c45ae` on 2026-08-16.
4. `MIGRATIONS.md` requires local Prisma migration creation, a committed migration, and separate production `npm run migrate:prod` using `DIRECT_URL` on port 5432. Build does not migrate.
5. `docs/workflows/STORE_ASSISTANT_DEV_WORKFLOW_SKILL_V1.md` requires a new migration for schema changes, forbids editing migration history/production `db push`/reset, prefers nullable additions, and requires data audit before uniqueness.
6. `docs/SUPABASE_PERMISSIONS_FREEZE_v1.md` explicitly permits `prisma migrate dev --create-only`, review/edit of generated SQL, and application through Prisma. It requires permission GRANT/REVOKE closure for new public-schema tables.
7. Therefore the repository does **not** require all DDL to be manually typed in the Supabase console. Direct/manual SQL is an exceptional governed path, not the default architecture.

### 16.2 Partial index capability

The current worktree uses Prisma 7.6.0. A temporary, out-of-repository schema validation confirmed that `previewFeatures = ["partialIndexes"]` accepts:

- a `StoreApplication` conditional unique on `status='PENDING'`; and
- a raw conditional unique for in-flight `SalesLead` statuses.

Prisma documents partial indexes through the `where` argument, and documents custom migration SQL through `prisma migrate dev --create-only` followed by SQL editing:

- https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes
- https://docs.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations

Preferred implementation after approval:

- Add the `partialIndexes` preview feature and express both indexes in the Prisma schema so schema intent and migration SQL remain aligned.
- Generate with `--create-only`, inspect the exact SQL, and verify the named predicates.
- If Architecture Board rejects the Preview feature, the supported fallback is hand-edited migration SQL with the same named indexes plus explicit drift documentation; it is not a weaker application-only guard.

Expected SQL intent:

```sql
CREATE UNIQUE INDEX "StoreApplication_one_pending_per_telegram"
ON "StoreApplication" ("telegramId")
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "SalesLead_one_inflight_per_telegram"
ON "SalesLead" ("telegramId")
WHERE "telegramId" IS NOT NULL
  AND "status" IN ('NEW','FOLLOWING','WAITING_TELEGRAM','APPLIED');
```

### 16.3 Required future Gate

Before implementation changes `prisma/schema.prisma` or creates a migration:

- Obtain explicit approval to cross the current Schema/Migration forbidden-path Gate for this named lane and bounded migration.
- Do not edit `gate-config.json` to self-authorize.
- Record backup target, data-audit result, generated SQL review, permissions closure, rollout order, rollback limits, and production migration result.

This V0.2 document neither requests nor executes that Gate.

### 16.4 Migration shape

One future Prisma migration would contain:

- 5 new tables and their enums/indexes/FKs.
- Nullable `StoreApplication.salesLeadId` and `createdStoreId`.
- Two partial unique indexes.
- Required explicit permissions for the new system/PII tables according to the repository permission freeze.

Existing rows:

- New model tables start empty.
- Existing applications get null Lead/Store links.
- No backfill is attempted.
- Existing `StoreApplication.status` remains String-compatible.

Rollout order after a future approval:

1. Production read-only duplicate-PENDING audit and backup.
2. Review create-only migration and permission statements.
3. Apply migration separately from build through approved `DIRECT_URL` workflow.
4. Deploy code only after schema readiness.
5. Enable Invite creation only after support/rate secrets are configured.

Rollback:

- Before traffic: code can be rolled back; nullable fields/tables may remain inert.
- After Leads/Applications exist: do not drop tables/columns/indexes as an automatic rollback. Disable Invites, retain data, and roll back application code under a separately reviewed plan.

Production risk is **medium** because of PII and uniqueness; the historical audit and named partial indexes are mandatory.

## 17. Exact Existing Files Impact Map

| Existing file | Purpose today | Minimal later change | Why required | Risk | Regression proof |
|---|---|---|---|---|---|
| `middleware.ts` | owner-only prefixes and request pathname header | **NO CHANGE** | `/lead` avoids owner-only prefixes | low | `/lead/*` next; `/invite` and `/ops` remain protected |
| `app/layout.tsx` | server-side initial protected-path decision | append `/lead` public prefix | prevent non-Telegram relogin shell | medium | Facebook/TikTok/Safari/Chrome direct route |
| `app/components/TelegramInit.tsx` | merchant/ops auth boot and bind/open routing | `/lead` public + strict exact `open`/`open_` before public short-circuit | new Landing and tokenized Telegram entry | high | exact open, open_token, bind_token, no-param matrix |
| `lib/telegram-start-param.ts` | multi-source start-param resolver, bind parser/redaction | typed open parser and purpose-aware redaction | prevent fallback/swallow/log leak | high | malformed/encoded/oversize/prefix tests |
| `lib/telegram-link.ts` | Merchant Mini App startapp link | narrow same-bot `?start=` helper | support must enter Merchant bot chat, not Mini App applicant claim | low | username sanitization and payload encoding |
| `lib/public-url.ts` | canonical public URL | **NO CHANGE** | already correct source | low | URL unit/static test |
| `app/invite/page.tsx` | OWNER/STAFF/customer QR/link UI | **NO CHANGE; reference only** | stable merchant invite flow must not be mixed | high if touched | existing invite regression unchanged |
| `app/open/page.tsx` | legacy store application form/success | claim/full phone, verified prefill, explicit confirm, resume/block/support states | one formal endpoint | high | legacy/new/duplicate/reapply/blocked matrix |
| `app/api/open/route.ts` | verify/init and blind pending create | shared verification + linked, guarded, idempotent application insert | formal application safety | high | P2002 race, block/store/pending tests |
| `lib/verify-tg-init-data.ts` | shared Telegram HMAC verify | **REUSE; no semantic broadening expected** | remove duplicate verifier from `/api/open` | high | valid/invalid/expired initData tests |
| `app/api/webhook/merchant/route.ts` | Merchant import/KHQR/FAQ/support/messages | sanitized `support_` handler before command return/raw logging | context support without token leakage | high | all existing Merchant functions + support payload tests |
| `app/api/ops/conversations/route.ts` | current/history conversation list | optional Lead/context join | existing conversation link | medium | active/history counts unchanged |
| `app/api/ops/conversations/[telegramId]/route.ts` | conversation detail | return safe Lead summary/link | Ops follow-up | medium | message ordering/unread unchanged |
| `app/api/ops/messages/route.ts` | Merchant Bot Ops reply/log | touch Lead activity after successful send | last activity | medium | no duplicate message on touch failure |
| `app/api/ops/applications/route.ts` | application list | include Lead/created Store summary | review/conversion display | low | existing filters |
| `app/api/ops/applications/[id]/approve/route.ts` | Tenant/Store/OWNER/UserStoreRole transaction | status race claim, exact Store link, Lead activation | provable conversion | high | rollback and concurrent approve/reject |
| `app/ops/page.tsx` | applications + current/history conversation Ops UI | links/actions only; navigation to focused Lead pages | reuse existing Ops patterns | medium | current overview/conversation/application UI |
| `lib/ops-auth.ts` | Ops role/session auth | scoped active FK-backed actor resolver | Ban actor FK and high-risk authorization | high | BD/legacy/env-only denied; active admin allowed |
| `lib/member-phone.ts` | Cambodia phone normalization | **NO CHANGE; call from new validator** | one normalization standard | medium | existing membership imports/binding unchanged |
| `lib/store-location.ts` | location/address validation | **NO CHANGE; reuse** | optional location correctness | low | denied permission and invalid coordinates |
| `lib/i18n/zh.ts` | Chinese dictionary | add Lead keys | trilingual customer UI | low | key parity |
| `lib/i18n/en.ts` | English dictionary | add Lead keys | trilingual customer UI | low | key parity and real English copy |
| `lib/i18n/km.ts` | Khmer dictionary | add Lead keys | trilingual customer UI | low | key parity/Khmer render |
| `prisma/schema.prisma` | current data model | five models, nullable StoreApplication relations, relation back-fields, partial-index preview | persistence and DB concurrency | high / gated | validate/generate/migration review |
| `.env.example` | configuration contract | document support phone, token TTLs, rate HMAC secret/defaults | no scattered hardcode | low | missing/valid config tests |
| `app/api/health/route.ts` | env readiness | report acquisition support/rate readiness without breaking legacy health | controlled enablement | low | missing config behavior |

Planned new files remain limited to the three pages, up to nine route files, and a small set of scoped helpers/tests. Stable `/invite`, Customer Bot, bind APIs, H5, cashier, printing, display, discounts, and membership files are not modified.

## 18. Legacy Compatibility

Mandatory compatibility matrix:

| Existing flow | V0.2 guarantee |
|---|---|
| `startapp=open` | exact parser remains; `/open` works and now creates a DIRECT_TELEGRAM Lead before formal application |
| `startapp=open_<token>` | new strict path to `/open`; never falls to `/start` |
| `bind_<token>` | parser precedence and `/bind` behavior unchanged |
| Existing `/invite` OWNER/Employee/Customer URLs and QR | untouched |
| Existing Merchant Bot KHQR/import/FAQ/general support/takeover | behavior retained; only sanitized support start is inserted early |
| Customer Bot and membership binding | untouched |
| Existing pending/historical StoreApplication rows | continue to list/approve; nullable new relations |
| OWNER multi-store | no global Telegram Lead uniqueness; existing UserStoreRole behavior untouched |
| Existing `/open` application success | extended in-place; no separate waiting page |
| H5/menu/order/cashier/discount/printing/customer display | outside modified file set and protected by regression tests |

## 19. Test Matrix

| Area | Required tests |
|---|---|
| Lineage/Gate | correct worktree/branch/base; schema change blocked until explicit future Gate |
| Invite | random code collision retry; ACTIVE/INACTIVE; inactive support; exact link equals QR/copy; no internal data public |
| Visits | atomic increment; first/last times; reload counted as Visit; no Unique Visitor claim; no event rows |
| Public route | Facebook/TikTok UA and Safari/Chrome without Telegram do not redirect `/relogin`; `/invite` remains protected |
| Lead form | required fields; optional denied GPS; location range/address cleaning; inactive Invite cannot write |
| Phone | Cambodia forms through `normalizeMemberPhone`; length/bogus guard; no global unique |
| Dedup | same phone+compatible owner across different Invites restores Lead; first touch unchanged; shared-phone ambiguity safe; LOST restore |
| First touch | later Invite never changes source/campaign/initial owner; no time-based overwrite |
| Application token | entropy/format/hash-only/TTL/revoke; no PII URL/log; wrong purpose denied |
| Identity takeover | forwarded token + stranger initData alone cannot read PII or claim; wrong full phone fails; matching full phone claims once |
| Claim concurrency | two Lead tokens for same TG yield one in-flight Lead; named unique error handled |
| Support token | valid context; forwarded token never writes canonical identity; raw token absent from logs/messages; invalid/expired/used still enters ordinary support |
| Parser | exact `open`, strict `open_<token>`, unchanged `bind_<token>`, malformed/encoded/oversize payloads, no fallback swallowing |
| Legacy `/open` | exact open creates/restores DIRECT_TELEGRAM Lead and formal Application; existing UI outcome preserved |
| Application idempotency | same TG concurrent submit creates one PENDING; loser returns winner; repeated click/resume |
| Reapply | REJECTED + no pending/block + rate pass creates new row on same Lead; Reject does not Ban |
| Block | blocked cannot create application but can contact support; unban restores eligibility; username not key |
| Ban auth | BD, legacy `_ops_admin`, env-only identity denied; active FK-backed OPS_ADMIN/SUPER_ADMIN allowed; actor audit fields |
| Reject API | reject-only; reject+ban transaction; approve/reject one winner; repeated state response |
| Approval conversion | transaction writes Tenant/Store/OWNER/UserStoreRole/application Store link/Lead ACTIVATED; injected failure rolls all back |
| Historical compatibility | null Lead/Store application rows continue; duplicate-PENDING audit required before index |
| Rate | atomic upsert under parallel calls; hard vs soft behavior; IP HMAC not raw; expiration cleanup bounded; Invite spike does not auto-disable |
| Ops | Lead list/detail authorization, PII, filters, conversation navigation, minimal status allowlist, funnel relations |
| i18n | every new key present/renderable in zh/en/km; validation/error/inactive/blocked/support paths |
| Merchant Bot regression | KHQR image/config, product import, FAQ, general support, takeover, ordinary persistence/forwarding |
| Protected regressions | OWNER multi-store, discounts, H5/menu, printing, Customer Display, membership binding, existing `/invite`, existing `/open`, Customer Bot |
| Build/static | Prisma validate/generate in implementation lane, focused TS/static/runtime tests, `npm run build` |

No Production smoke or deployment is authorized by this design revision.

## 20. Expected Implementation Scope

Estimated minimal vertical slice after Architecture Board and Schema/Migration Gate approval:

| Category | Estimate |
|---|---:|
| New Prisma models | 5 |
| Existing model with new DB fields | 1 (`StoreApplication`) |
| Relation-only existing model blocks | 2 (`Store`, `OpsAdmin`) |
| Migration files | 1 |
| New customer/Ops pages | 3 |
| New route files | 8–9 |
| Modified existing routes/components/helpers | about 13–17 |
| New small helper modules | about 4–6 (Lead service/phone guard/token/rate/support config) |
| New focused test files | about 8–12 |
| Total likely new files | about 17–23 including migration/tests |
| Total likely modified files | about 15–20 |

This is a medium-size vertical slice because it crosses public acquisition, Telegram identity, formal application, Ops review, and a production uniqueness migration. It is still bounded: five models, three pages, one Bot/channel, one application endpoint, and fewer than ten new route files. If implementation discovers a need for a sixth model, a third Bot, 10+ new business APIs, or broad middleware/auth redesign, it must stop for Architecture Board review rather than expand.

Suggested implementation batches after approval, each separately reviewed:

1. Gated schema/migration + data audit + service-level unit/static tests.
2. Invite/public Landing + Lead/token/rate core.
3. Telegram parser/claim + existing `/open` idempotency.
4. Merchant support context + Ops Lead/Invite/reject/block surfaces.
5. Approval conversion link + full regression/build; deployment remains separately authorized.

## 21. Deferred

- CRM Platform
- AI Sales, AI auto reply, AI follow-up
- Scheduled follow-up
- Lead scoring
- Tags/timeline/tasks/notes platforms
- Commission, sales capacity, round robin, team hierarchy
- Facebook Messenger API, TikTok DM API, WhatsApp API, advertising API
- SMS OTP and account recovery platform
- Marketing automation and CDP
- Device fingerprint, Risk Score, ML anti-fraud
- Multi-touch attribution
- Anonymous/unique visitor tracking and daily visit trend events
- Complex BI/dashboard infrastructure
- Multi-store/second-store application workflow
- Application cooldown/retry quota/review workflow platform
- Phone/IP/device permanent blocklists

## 22. Remaining Open Decisions

Only two decisions require Architecture Board confirmation before implementation:

1. **Applicant proof acceptance:** approve full normalized phone re-entry as the V0.1 proof, with the documented residual risk and no SMS OTP.
2. **Partial index representation:** approve Prisma 7.6 `partialIndexes` Preview representation as preferred; otherwise approve custom create-only migration SQL while retaining the exact DB guarantees.

Route, model count, cardinality, first-touch policy, reapply, Merchant Bot support channel, middleware zero-change, DB uniqueness requirements, and conversion linkage are resolved in this V0.2.

## 23. Recommendation and Design Result

Approve V0.2 as the minimum safe vertical slice, then open a separately scoped implementation line only after the explicit Schema/Migration Gate and Production duplicate-PENDING audit plan are approved. Do not begin implementation from this document commit.

Design-lane verification: `git diff --check` passed, Dev-Gate-01A reported the V0.2 document path `ALLOWED / PASS`, and `npm run build` completed successfully. No application/schema/runtime file was changed.

**DESIGN V0.2 COMPLETE — WAITING FOR ARCHITECTURE BOARD APPROVAL**
