import assert from 'node:assert/strict'
import fs from 'node:fs'
import en from '../lib/i18n/en'
import km from '../lib/i18n/km'
import zh from '../lib/i18n/zh'
import {
  acquisitionInviteUrl,
  generateAcquisitionInviteCode,
  isPublicAcquisitionSource,
  normalizeAcquisitionInviteCode,
} from '../lib/sales-lead-invite'
import {
  normalizeSalesLeadSupportConfig,
  normalizeTelegramSupportTarget,
} from '../lib/sales-lead-support'

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' ? keys(child, next) : [next]
  })
}

const codes = new Set(Array.from({ length: 500 }, () => generateAcquisitionInviteCode()))
assert.equal(codes.size, 500)
for (const code of codes) {
  assert.equal(code.length, 12)
  assert.equal(normalizeAcquisitionInviteCode(code.toLowerCase()), code)
}
assert.equal(normalizeAcquisitionInviteCode('bad-code'), '')
assert.equal(isPublicAcquisitionSource('FACEBOOK'), true)
assert.equal(isPublicAcquisitionSource('DIRECT_TELEGRAM'), false)
assert.equal(
  acquisitionInviteUrl('23456789ABCD', 'http://127.0.0.1:3000'),
  'http://127.0.0.1:3000/lead/23456789ABCD',
)

assert.deepEqual(normalizeSalesLeadSupportConfig({
  supportPhone: '+855 12 345 678',
  telegramSupportTarget: 'https://t.me/merchant_support_bot',
}), {
  supportPhone: '+855 12 345 678',
  telegramSupportTarget: 'merchant_support_bot',
})
assert.deepEqual(normalizeSalesLeadSupportConfig({ supportPhone: '', telegramSupportTarget: '' }), {
  supportPhone: null,
  telegramSupportTarget: null,
})
assert.equal(normalizeSalesLeadSupportConfig({ supportPhone: 'abc', telegramSupportTarget: 'merchant_bot' }), null)
assert.equal(normalizeSalesLeadSupportConfig({ supportPhone: 123, telegramSupportTarget: 'merchant_bot' }), null)
assert.equal(normalizeTelegramSupportTarget('javascript:alert(1)'), undefined)
assert.equal(normalizeTelegramSupportTarget('https://example.com/merchant_bot'), undefined)
assert.equal(normalizeTelegramSupportTarget('https://t.me/merchant_bot?x=1'), undefined)

assert.deepEqual(keys(zh.salesLead), keys(en.salesLead))
assert.deepEqual(keys(zh.salesLead), keys(km.salesLead))

const layout = fs.readFileSync('app/layout.tsx', 'utf8')
const telegramInit = fs.readFileSync('app/components/TelegramInit.tsx', 'utf8')
const middleware = fs.readFileSync('middleware.ts', 'utf8')
const opsPage = fs.readFileSync('app/ops/acquisition-invites/page.tsx', 'utf8')
const leadPage = fs.readFileSync('app/lead/[code]/page.tsx', 'utf8')
const leadApi = fs.readFileSync('app/api/public/sales-leads/route.ts', 'utf8')
const service = fs.readFileSync('lib/sales-lead-service.ts', 'utf8')

assert.match(layout, /'\/lead'/)
assert.match(telegramInit, /'\/lead'/)
assert.doesNotMatch(middleware, /\/lead/)
assert.match(opsPage, /<QRCode value=\{invite\.url\}/)
assert.match(opsPage, /copy\(invite\.url\)/)
assert.match(opsPage, /\/api\/ops\/sales-lead-support/)
assert.match(leadPage, /navigator\.geolocation/)
assert.match(leadPage, /locationDenied/)
assert.match(leadPage, /\['zh', '中文'\]/)
assert.match(leadPage, /\['en', 'English'\]/)
assert.match(leadPage, /\['km', 'ខ្មែរ'\]/)
assert.match(leadPage, /gridTemplateColumns: 'minmax\(0,1fr\) 44px'/)
assert.match(leadPage, /gridTemplateColumns: 'repeat\(2,minmax\(0,1fr\)\)'/)
assert.match(leadApi, /`open_\$\{result\.rawApplicationToken\}`/)
assert.match(service, /firstInvite\/source\/campaign\/initial owner are intentionally immutable/)
assert.match(service, /pg_advisory_xact_lock/)
assert.match(service, /purpose: 'APPLICATION'/)

const supportHelper = fs.readFileSync('lib/sales-lead-support.ts', 'utf8')
assert.match(supportHelper, /process\.env\.SALES_ONBOARDING_BOT_USERNAME/)
assert.doesNotMatch(supportHelper, /process\.env\.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME/)

console.log('sales lead public invite tests passed')
