import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  addNaturalMonthsClamped,
  computeRenewal,
  SUBSCRIPTION_STATUS,
  validateRenewalInput,
} from '../lib/subscription'

function utc(value: string) {
  return new Date(value)
}

function iso(date: Date) {
  return date.toISOString()
}

const trialSubscription = {
  id: 'sub_trial',
  tenantId: 'tenant_1',
  status: SUBSCRIPTION_STATUS.TRIAL,
  trialStartedAt: utc('2026-07-13T10:00:00.000Z'),
  trialEndsAt: utc('2026-08-13T10:00:00.000Z'),
  currentPeriodStartedAt: null,
  currentPeriodEndsAt: null,
}

assert.equal(
  iso(addNaturalMonthsClamped(utc('2026-01-31T08:30:00.000Z'), 1)),
  '2026-02-28T08:30:00.000Z',
  'Jan 31 + 1 natural month should clamp to Feb 28 in 2026',
)
assert.equal(
  iso(addNaturalMonthsClamped(utc('2028-01-31T08:30:00.000Z'), 1)),
  '2028-02-29T08:30:00.000Z',
  'Jan 31 + 1 natural month should clamp to Feb 29 in leap year',
)
assert.equal(
  iso(addNaturalMonthsClamped(utc('2026-02-28T08:30:00.000Z'), 1)),
  '2026-03-28T08:30:00.000Z',
  'Feb 28 + 1 natural month should land on Mar 28',
)
assert.equal(
  iso(addNaturalMonthsClamped(utc('2028-02-29T08:30:00.000Z'), 1)),
  '2028-03-29T08:30:00.000Z',
  'Feb 29 + 1 natural month should land on Mar 29',
)
assert.equal(
  iso(addNaturalMonthsClamped(utc('2026-03-31T08:30:00.000Z'), 1)),
  '2026-04-30T08:30:00.000Z',
  'Mar 31 + 1 natural month should clamp to Apr 30',
)
assert.equal(
  iso(addNaturalMonthsClamped(utc('2026-12-31T08:30:00.000Z'), 1)),
  '2027-01-31T08:30:00.000Z',
  'Dec + 1 natural month should cross year',
)
assert.equal(
  iso(addNaturalMonthsClamped(utc('2026-01-31T08:30:00.000Z'), 3)),
  '2026-04-30T08:30:00.000Z',
  'multiple natural months should clamp only against target month',
)

const trialActivation = computeRenewal(trialSubscription, 1, utc('2026-08-20T10:00:00.000Z'))
assert.equal(trialActivation.nextStatus, SUBSCRIPTION_STATUS.ACTIVE)
assert.equal(iso(trialActivation.currentPeriodStartedAt), '2026-08-20T10:00:00.000Z')
assert.equal(iso(trialActivation.nextPeriodEndsAt), '2026-09-20T10:00:00.000Z')

const trialEarlyPayment = computeRenewal(trialSubscription, 1, utc('2026-07-20T10:00:00.000Z'))
assert.equal(iso(trialEarlyPayment.nextPeriodEndsAt), '2026-09-13T10:00:00.000Z')

const activeSubscription = {
  id: 'sub_active',
  tenantId: 'tenant_1',
  status: SUBSCRIPTION_STATUS.ACTIVE,
  trialStartedAt: null,
  trialEndsAt: null,
  currentPeriodStartedAt: utc('2026-07-01T00:00:00.000Z'),
  currentPeriodEndsAt: utc('2026-08-31T00:00:00.000Z'),
}
const activeEarlyRenewal = computeRenewal(activeSubscription, 2, utc('2026-08-01T00:00:00.000Z'))
assert.equal(iso(activeEarlyRenewal.nextPeriodEndsAt), '2026-10-31T00:00:00.000Z')

const activeExpiredRenewal = computeRenewal(activeSubscription, 1, utc('2026-09-15T00:00:00.000Z'))
assert.equal(iso(activeExpiredRenewal.nextPeriodEndsAt), '2026-10-15T00:00:00.000Z')

assert.equal(validateRenewalInput({ months: 0, idempotencyKey: 'k' }).ok, false)
assert.equal(validateRenewalInput({ months: 13, idempotencyKey: 'k' }).ok, false)
assert.equal(validateRenewalInput({ months: 1, amount: '10.001', idempotencyKey: 'k' }).ok, false)
assert.equal(validateRenewalInput({ months: 1, amount: '10.00', currency: 'usd', idempotencyKey: 'k' }).ok, true)

const renewRoute = fs.readFileSync('app/api/ops/tenants/[tenantId]/subscription/renew/route.ts', 'utf8')
assert.match(renewRoute, /checkOpsAuthContext/, 'renew API should use server-side Ops auth')
assert.match(renewRoute, /ops\.role === 'BD'/, 'BD should not be allowed to renew subscriptions')
assert.match(renewRoute, /idempotencyKey/, 'renew API should require idempotencyKey')
assert.match(renewRoute, /findUnique\(\{\s*where: \{\s*idempotencyKey/s, 'renew API should check prior idempotency key')
assert.match(renewRoute, /FOR UPDATE/, 'renew API should lock the subscription row')
assert.match(renewRoute, /tx\.tenant\.findUnique/, 'renew API should verify tenant existence server-side')

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
assert.match(schema, /model TenantSubscription/, 'schema should include TenantSubscription')
assert.match(schema, /model SubscriptionEvent/, 'schema should include SubscriptionEvent')
assert.match(schema, /idempotencyKey\s+String\s+@unique/, 'SubscriptionEvent should enforce unique idempotencyKey')

for (const forbiddenPath of [
  'app/api/sales/route.ts',
  'app/api/orders/[orderNo]/checkout/route.ts',
  'app/api/products/route.ts',
  'app/api/members/route.ts',
  'app/api/cashier/device-token/route.ts',
  'app/api/auth/telegram/route.ts',
]) {
  const source = fs.readFileSync(forbiddenPath, 'utf8')
  assert.doesNotMatch(source, /TenantSubscription|SubscriptionEvent|subscription\/renew/, `${forbiddenPath} should not enforce subscription lifecycle`)
}

console.log('subscription lifecycle tests passed')
