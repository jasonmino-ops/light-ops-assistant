import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseSupportStartCommand } from '../lib/sales-lead-support-context'
import { buildTelegramStartLink } from '../lib/telegram-link'

const rawToken = 'abcdefghijklmnopqrstuv'
assert.deepEqual(parseSupportStartCommand(`/start support_${rawToken}`), {
  attempted: true,
  rawToken,
})
assert.deepEqual(parseSupportStartCommand(`/start@eshop_onboarding_support_bot support_${rawToken}`), {
  attempted: true,
  rawToken,
})
assert.deepEqual(parseSupportStartCommand('/start support_too-short'), {
  attempted: true,
  rawToken: null,
})
assert.deepEqual(parseSupportStartCommand('/start support_bad token'), {
  attempted: true,
  rawToken: null,
})
assert.deepEqual(parseSupportStartCommand('/start'), {
  attempted: false,
  rawToken: null,
})
assert.equal(
  buildTelegramStartLink('@eshop_onboarding_support_bot', `support_${rawToken}`),
  `https://t.me/eshop_onboarding_support_bot?start=support_${rawToken}`,
)

const webhook = fs.readFileSync('app/api/webhook/sales-onboarding/route.ts', 'utf8')
const merchantWebhook = fs.readFileSync('app/api/webhook/merchant/route.ts', 'utf8')
const supportContext = fs.readFileSync('lib/sales-lead-support-context.ts', 'utf8')
const conversations = fs.readFileSync('app/api/ops/conversations/route.ts', 'utf8')
const opsMessages = fs.readFileSync('app/api/ops/messages/route.ts', 'utf8')
const publicLeadApi = fs.readFileSync('app/api/public/sales-leads/route.ts', 'utf8')

assert.doesNotMatch(webhook, /JSON\.stringify\(update\)/)
assert.ok(webhook.indexOf('parseSupportStartCommand(text)') < webhook.indexOf('logIncomingMessage({'))
assert.match(webhook, /'\[SUPPORT_ENTRY\]'/)
assert.match(webhook, /channel: 'SALES_ONBOARDING'/)
assert.doesNotMatch(webhook, /SalesLead\.telegramId|salesLead\.update/)
assert.doesNotMatch(webhook, /supportStart\.rawToken[^\n]*content/)
assert.doesNotMatch(merchantWebhook, /parseSupportStartCommand|consumeSupportContextToken/)
assert.match(supportContext, /purpose !== 'SUPPORT'/)
assert.match(supportContext, /consumedByTelegramId: input\.telegramId/)
assert.doesNotMatch(supportContext, /salesLead\.update|telegramId:\s*input\.telegramId[\s\S]*salesLead/)
assert.match(conversations, /identitySource: 'SUPPORT'/)
assert.match(conversations, /consumedByTelegramId: \{ in: telegramIds \}/)
assert.match(opsMessages, /lastActivityAt: now/)
assert.match(publicLeadApi, /getLeadSupportConfig/)

console.log('sales lead support context tests passed')
