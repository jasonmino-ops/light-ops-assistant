import assert from 'node:assert/strict'
import fs from 'node:fs'

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(
  'prisma/migrations/20260822143000_add_unlinked_sales_inquiry_owner/migration.sql',
  'utf8',
)
const inquiries = fs.readFileSync('app/api/sales/inquiries/route.ts', 'utf8')
const messages = fs.readFileSync('app/api/sales/messages/route.ts', 'utf8')
const webhook = fs.readFileSync('app/api/webhook/sales-onboarding/route.ts', 'utf8')
const telegram = fs.readFileSync('lib/telegram.ts', 'utf8')
const merchantWebhook = fs.readFileSync('app/api/webhook/merchant/route.ts', 'utf8')
const page = fs.readFileSync('app/ops/sales/page.tsx', 'utf8')

assert.match(schema, /salesInquiryOwnerId\s+String\?/)
assert.match(schema, /@relation\("SalesInquiryOwner"[^\n]+onDelete: SetNull\)/)
assert.doesNotMatch(schema, /model (SalesInquiry|SalesChat|SalesMessage)\b/)
assert.match(migration, /ADD COLUMN "salesInquiryOwnerId" TEXT/)
assert.match(migration, /REFERENCES "OpsAdmin"\("id"\)/)
assert.match(migration, /ON DELETE SET NULL/)
assert.doesNotMatch(migration, /UPDATE "TelegramMessage"|INSERT INTO|DELETE FROM/)

assert.match(inquiries, /channel: 'SALES_ONBOARDING'/)
assert.match(inquiries, /salesLeadId: null/)
assert.match(inquiries, /sentBy: 'CUSTOMER'/)
assert.match(inquiries, /take: 1000/)
assert.match(inquiries, /if \(!actor\.isManager[\s\S]+salesInquiryOwnerId !== actor\.userId/)
assert.match(inquiries, /const canSeeIdentity = actor\.isManager \|\| message\.salesInquiryOwnerId === actor\.userId/)
assert.match(inquiries, /senderUsername: canSeeIdentity \? message\.senderUsername : null/)
assert.match(inquiries, /req\.nextUrl\.searchParams\.get\('q'\)/)
assert.match(inquiries, /updateMany\([\s\S]+salesInquiryOwnerId: null[\s\S]+salesInquiryOwnerId: admin\.id/)
assert.match(inquiries, /ALREADY_CLAIMED/)

assert.match(messages, /inquiryId\?: unknown/)
assert.match(messages, /anchor\.salesInquiryOwnerId !== actor\.userId/)
assert.match(messages, /recipientTelegramId = anchor\.recipientTelegramId/)
assert.doesNotMatch(messages, /body\?\.recipientTelegramId|recipientTelegramId\?: unknown/)
assert.match(messages, /salesInquiryOwnerId,/)

assert.match(webhook, /resolveUnlinkedInquiryOwner/)
assert.match(webhook, /salesInquiryOwnerId: input\.salesInquiryOwnerId/)
assert.doesNotMatch(webhook, /salesLead\.update|SalesLead\.telegramId/)
assert.match(telegram, /salesInquiryOwnerId\?: string \| null/)
assert.doesNotMatch(merchantWebhook, /salesInquiryOwnerId|SALES_ONBOARDING/)

assert.match(page, /salesWorkspace\.unlinkedInquiries/)
assert.match(page, /salesWorkspace\.claimInquiry/)
assert.match(page, /inquiryId: selectedInquiry!\.id/)
assert.doesNotMatch(page, /recipientTelegramId/)

console.log('sales unlinked inquiry tests passed')
