import assert from 'node:assert/strict'
import fs from 'node:fs'
import zh from '../lib/i18n/zh'
import en from '../lib/i18n/en'
import km from '../lib/i18n/km'

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(
  'prisma/migrations/20260822170000_add_telegram_message_sender_username/migration.sql',
  'utf8',
)
const webhook = fs.readFileSync('app/api/webhook/sales-onboarding/route.ts', 'utf8')
const leads = fs.readFileSync('app/api/sales/leads/route.ts', 'utf8')
const inquiries = fs.readFileSync('app/api/sales/inquiries/route.ts', 'utf8')
const conversations = fs.readFileSync('app/api/sales/conversations/route.ts', 'utf8')
const messages = fs.readFileSync('app/api/sales/messages/route.ts', 'utf8')
const merchantWebhook = fs.readFileSync('app/api/webhook/merchant/route.ts', 'utf8')
const page = fs.readFileSync('app/ops/sales/page.tsx', 'utf8')

// One historical-compatible field; no new conversation or CRM model.
assert.match(schema, /senderUsername\s+String\?/)
assert.doesNotMatch(schema, /model (SalesInquiry|SalesChat|SalesMessage|Conversation)\b/)
assert.match(migration, /ALTER TABLE "TelegramMessage"\s+ADD COLUMN "senderUsername" TEXT;/)
assert.doesNotMatch(migration, /NOT NULL|UPDATE|INSERT|DELETE|DROP/)

// Telegram support identity is captured without touching canonical applicant identity.
assert.match(webhook, /senderUsername: senderUsername\(input\.message\.from\)/)
assert.doesNotMatch(webhook, /salesLead\.update|telegramId:\s*input\.telegramId/)

// Search scope is established before filters; unassigned search never includes PII.
assert.match(leads, /const currentOwnerWhere:[\s\S]+salesOwnerId: actor\.userId/)
assert.match(leads, /initialSalesOwnerId: actor\.userId/)
assert.match(leads, /normalizedPhone: \{ contains: query \}/)
assert.match(leads, /telegramUsername: \{ contains: query/)
const unassignedSearch = leads.slice(leads.indexOf('const unassignedWhere'), leads.indexOf('const [\n    leads'))
assert.match(unassignedSearch, /storeName: \{ contains: query/)
assert.doesNotMatch(unassignedSearch, /ownerName|normalizedPhone|telegramUsername/)

// Unclaimed BD sees summary only; claimed owner/manager receives username and history.
assert.match(inquiries, /const canSeeIdentity = actor\.isManager \|\| message\.salesInquiryOwnerId === actor\.userId/)
assert.match(inquiries, /senderUsername: canSeeIdentity \? message\.senderUsername : null/)
assert.match(inquiries, /anchor\.salesInquiryOwnerId !== actor\.userId/)
assert.match(inquiries, /updateMany\([\s\S]+salesInquiryOwnerId: null[\s\S]+salesInquiryOwnerId: admin\.id/)
assert.match(conversations, /canAccessOwnedSalesLead/)

// Reply never accepts a Telegram target from the browser and stays on onboarding channel.
assert.match(messages, /recipientTelegramId = (conversation|anchor)\.recipientTelegramId/)
assert.doesNotMatch(messages, /body\?\.recipientTelegramId|recipientTelegramId\?: unknown/)
assert.match(messages, /channel: 'SALES_ONBOARDING'/)
assert.match(merchantWebhook, /TELEGRAM_BOT_TOKEN/)
assert.doesNotMatch(merchantWebhook, /SALES_ONBOARDING/)

// Three-column desktop UX, safe identity presentation, and mobile rules.
assert.match(page, /queue-column/)
assert.match(page, /list-column/)
assert.match(page, /detail-column/)
assert.match(page, /grid-template-columns:minmax\(180px,220px\) minmax\(300px,370px\) minmax\(360px,1fr\)/)
assert.match(page, /中文/)
assert.match(page, /English/)
assert.match(page, /ខ្មែរ/)
assert.match(page, /telegramUsername \? `@\$\{[^}]+\}`/)
assert.match(page, /salesWorkspace\.noTelegramUsername/)
assert.doesNotMatch(page, /recipientTelegramId|telegram numeric|Telegram ID/)
assert.match(page, /@media\(max-width:720px\)/)
assert.match(page, /@media\(max-width:360px\)/)
assert.match(page, /grid-template-columns:minmax\(0,1fr\)/)
assert.match(page, /font-size:16px/)
assert.match(page, /min-height:44px/)

// This feature's dictionaries must have exact zh/en/km key parity.
const keys = (value: Record<string, string>) => Object.keys(value).sort()
assert.deepEqual(keys(en.salesWorkspace), keys(zh.salesWorkspace))
assert.deepEqual(keys(km.salesWorkspace), keys(zh.salesWorkspace))
for (const dictionary of [zh.salesWorkspace, en.salesWorkspace, km.salesWorkspace]) {
  for (const [key, value] of Object.entries(dictionary)) {
    assert.ok(value.trim(), `salesWorkspace.${key} must not be empty`)
  }
}

console.log('sales workspace UX tests passed')
