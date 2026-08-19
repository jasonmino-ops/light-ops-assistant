import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  salesLeadPhonesMatch,
  validateSalesLeadPhone,
} from '../lib/sales-lead-phone'
import {
  generateSalesLeadContextToken,
  hashSalesLeadContextToken,
  isSalesLeadRawToken,
  salesLeadTokenTtlMs,
} from '../lib/sales-lead-token'
import {
  consumeSalesLeadRateLimit,
  getSalesLeadRatePolicy,
  getSalesLeadRateScopeHash,
  getSalesLeadRateWindowStart,
} from '../lib/sales-lead-rate'

async function main() {
const localPhone = validateSalesLeadPhone('012 345 678')
const internationalPhone = validateSalesLeadPhone('+855 12 345 678')
assert.deepEqual(localPhone, { ok: true, normalizedPhone: '85512345678' })
assert.deepEqual(internationalPhone, { ok: true, normalizedPhone: '85512345678' })
assert.deepEqual(validateSalesLeadPhone(''), { ok: false, error: 'PHONE_REQUIRED' })
assert.deepEqual(validateSalesLeadPhone('0000000000'), { ok: false, error: 'PHONE_INVALID' })
assert.deepEqual(validateSalesLeadPhone('1111111111'), { ok: false, error: 'PHONE_INVALID' })
assert.equal(salesLeadPhonesMatch('85512345678', '85512345678'), true)
assert.equal(salesLeadPhonesMatch('85512345678', '85512345679'), false)

const fixedNow = new Date('2026-08-19T00:00:00.000Z')
const tokenEnv = {
  SALES_LEAD_APPLICATION_TOKEN_TTL_HOURS: '72',
  SALES_LEAD_SUPPORT_TOKEN_TTL_HOURS: '12',
} as NodeJS.ProcessEnv
const applicationToken = generateSalesLeadContextToken('APPLICATION', fixedNow, tokenEnv)
const supportToken = generateSalesLeadContextToken('SUPPORT', fixedNow, tokenEnv)
assert.equal(applicationToken.rawToken.length, 22)
assert.equal(isSalesLeadRawToken(applicationToken.rawToken), true)
assert.equal(applicationToken.tokenHash, hashSalesLeadContextToken(applicationToken.rawToken))
assert.notEqual(applicationToken.rawToken, applicationToken.tokenHash)
assert.equal(applicationToken.expiresAt.toISOString(), '2026-08-22T00:00:00.000Z')
assert.equal(supportToken.expiresAt.toISOString(), '2026-08-19T12:00:00.000Z')
assert.equal(salesLeadTokenTtlMs('APPLICATION', tokenEnv), 72 * 60 * 60 * 1000)
assert.equal(isSalesLeadRawToken('phone_85512345678'), false)

const rateSecret = 'test-secret-with-at-least-32-characters'
const rateHash = getSalesLeadRateScopeHash({
  secret: rateSecret,
  action: 'LEAD_SUBMIT',
  scopeType: 'IP',
  value: '203.0.113.8',
})
assert.equal(rateHash.length, 64)
assert.equal(rateHash.includes('203.0.113.8'), false)
assert.throws(() => getSalesLeadRateScopeHash({
  secret: 'short',
  action: 'LEAD_SUBMIT',
  scopeType: 'PHONE',
  value: '85512345678',
}), /SALES_LEAD_RATE_LIMIT_SECRET_MISSING/)
assert.equal(
  getSalesLeadRateWindowStart(new Date('2026-08-19T00:07:59.000Z'), 300).toISOString(),
  '2026-08-19T00:05:00.000Z',
)
assert.deepEqual(getSalesLeadRatePolicy('LEAD_SUBMIT', 'PHONE', {}), {
  windowSeconds: 3600,
  limit: 6,
  hard: true,
})

let observedCreate: Record<string, unknown> | undefined
const fakeClient = {
  salesLeadRateCounter: {
    deleteMany: async () => ({ count: 0 }),
    upsert: async (args: { create: Record<string, unknown> }) => {
      observedCreate = args.create
      return { count: 7 }
    },
  },
}
const limited = await consumeSalesLeadRateLimit({
  action: 'LEAD_SUBMIT',
  scopeType: 'PHONE',
  value: '85512345678',
  now: fixedNow,
  client: fakeClient as never,
  env: { SALES_LEAD_RATE_LIMIT_SECRET: rateSecret },
})
assert.equal(limited.allowed, false)
assert.equal(limited.exceeded, true)
assert.equal(limited.limit, 6)
assert.equal(observedCreate?.scopeKeyHash, getSalesLeadRateScopeHash({
  secret: rateSecret,
  action: 'LEAD_SUBMIT',
  scopeType: 'PHONE',
  value: '85512345678',
}))

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(
  'prisma/migrations/20260819083000_add_sales_lead_attribution_v01/migration.sql',
  'utf8',
)
const supportChannelMigration = fs.readFileSync(
  'prisma/migrations/20260819210000_add_sales_support_channel/migration.sql',
  'utf8',
)
const leadService = fs.readFileSync('lib/sales-lead-service.ts', 'utf8')

for (const model of [
  'AcquisitionInvite',
  'SalesLead',
  'SalesLeadContextToken',
  'ApplicationBlock',
  'SalesLeadRateCounter',
]) {
  assert.match(schema, new RegExp(`model ${model} \\{`))
}
assert.doesNotMatch(schema, /salesLeadId\s+String\?\s+@unique/)
assert.doesNotMatch(schema, /telegramId\s+String\?\s+@unique[\s\S]*model SalesLeadContextToken/)
assert.match(schema, /createdStoreId\s+String\?\s+@unique/)
assert.match(migration, /StoreApplication_one_pending_per_telegram/)
assert.match(migration, /WHERE "status" = 'PENDING'/)
assert.match(migration, /SalesLead_one_inflight_per_telegram/)
assert.match(migration, /'NEW', 'FOLLOWING', 'WAITING_TELEGRAM', 'APPLIED'/)
assert.match(migration, /duplicate telegramId groups: 0/)
assert.match(migration, /REVOKE ALL ON public\."SalesLead" FROM anon/)
assert.match(schema, /salesOwnerId\s+String\?/)
assert.match(schema, /channel\s+String\s+@default\("MERCHANT"\)/)
assert.match(schema, /salesLeadId\s+String\?/)
assert.match(schema, /@@index\(\[channel, recipientTelegramId, createdAt\]\)/)
assert.match(schema, /@@index\(\[channel, salesLeadId, createdAt\]\)/)
assert.match(supportChannelMigration, /ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'MERCHANT'/)
assert.match(supportChannelMigration, /ADD COLUMN "salesLeadId" TEXT/)
assert.match(supportChannelMigration, /SET "salesOwnerId" = "initialSalesOwnerId"/)
assert.doesNotMatch(supportChannelMigration, /UPDATE "TelegramMessage"[\s\S]*"salesLeadId"/)
assert.match(leadService, /initialSalesOwnerId: input\.invite\.salesOwnerId,[\s\S]*salesOwnerId: input\.invite\.salesOwnerId/)
assert.match(leadService, /pg_advisory_xact_lock\([\s\S]*\) IS NULL AS "ignored"/)
assert.doesNotMatch(leadService, /SELECT pg_advisory_xact_lock\([^\n]+\)`/)

console.log('sales lead data-layer tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
