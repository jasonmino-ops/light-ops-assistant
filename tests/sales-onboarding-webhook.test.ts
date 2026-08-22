import assert from 'node:assert/strict'
import fs from 'node:fs'

const route = fs.readFileSync('app/api/webhook/sales-onboarding/route.ts', 'utf8')
const telegram = fs.readFileSync('lib/telegram.ts', 'utf8')
const merchant = fs.readFileSync('app/api/webhook/merchant/route.ts', 'utf8')
const customer = fs.readFileSync('app/api/webhook/customer/route.ts', 'utf8')

assert.match(route, /SALES_ONBOARDING_BOT_TOKEN/)
assert.match(route, /SALES_ONBOARDING_WEBHOOK_SECRET/)
assert.match(route, /x-telegram-bot-api-secret-token/)
assert.match(route, /parseSupportStartCommand/)
assert.match(route, /consumeSupportContextToken/)
assert.match(route, /channel: 'SALES_ONBOARDING'/)
assert.match(route, /salesLeadId: input\.salesLeadId/)
assert.match(route, /resolveUnlinkedInquiryOwner/)
assert.match(route, /salesInquiryOwnerId: input\.salesInquiryOwnerId/)
assert.match(route, /'\[SUPPORT_ENTRY\]'/)
assert.doesNotMatch(route, /SupportSession|supportSession/)
assert.doesNotMatch(route, /SalesLead\.telegramId|salesLead\.update/)
assert.doesNotMatch(route, /KHQR|ProductImport|Membership|open_/)
assert.match(telegram, /channel\?: 'MERCHANT' \| 'SALES_ONBOARDING'/)
assert.match(telegram, /salesLeadId\?: string \| null/)
assert.match(telegram, /salesInquiryOwnerId\?: string \| null/)
assert.doesNotMatch(merchant, /SALES_ONBOARDING_BOT_TOKEN/)
assert.doesNotMatch(customer, /SALES_ONBOARDING_BOT_TOKEN/)

console.log('sales onboarding webhook tests passed')
