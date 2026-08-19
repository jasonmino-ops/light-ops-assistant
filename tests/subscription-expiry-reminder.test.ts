import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  computeSubscriptionReminder,
  SUBSCRIPTION_GRACE_DAYS,
  SUBSCRIPTION_REMINDER_DAYS,
} from '../lib/subscription-reminder'

const NOW = new Date('2026-08-19T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function atDaysFromNow(days: number) {
  return new Date(NOW.getTime() + days * DAY_MS)
}

function active(expiry: Date | null) {
  return {
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEndsAt: expiry,
  }
}

assert.equal(SUBSCRIPTION_REMINDER_DAYS, 15)
assert.equal(SUBSCRIPTION_GRACE_DAYS, 3)

assert.equal(
  computeSubscriptionReminder(active(atDaysFromNow(15.01)), NOW).displayState,
  'NORMAL',
  'ACTIVE more than 15 days from expiry should be NORMAL',
)
assert.equal(
  computeSubscriptionReminder(active(atDaysFromNow(15)), NOW).displayState,
  'REMIND',
  'ACTIVE exactly 15 days from expiry should REMIND',
)
assert.equal(
  computeSubscriptionReminder(active(atDaysFromNow(0.25)), NOW).displayState,
  'REMIND',
  'ACTIVE close to expiry should REMIND',
)
assert.equal(
  computeSubscriptionReminder(active(NOW), NOW).displayState,
  'GRACE',
  'the exact expiry instant should start GRACE',
)
assert.equal(
  computeSubscriptionReminder(active(atDaysFromNow(-2)), NOW).displayState,
  'GRACE',
  'two days after expiry should remain GRACE',
)
assert.equal(
  computeSubscriptionReminder(active(atDaysFromNow(-3)), NOW).displayState,
  'EXPIRED',
  'exactly three days after expiry should be EXPIRED',
)

const trialResult = computeSubscriptionReminder({
  status: 'TRIAL',
  trialEndsAt: atDaysFromNow(4),
  currentPeriodEndsAt: atDaysFromNow(40),
}, NOW)
assert.equal(trialResult.displayState, 'REMIND', 'TRIAL should use trialEndsAt')
assert.equal(trialResult.expiry, atDaysFromNow(4).toISOString())

const activeResult = computeSubscriptionReminder({
  status: 'ACTIVE',
  trialEndsAt: atDaysFromNow(-30),
  currentPeriodEndsAt: atDaysFromNow(4),
}, NOW)
assert.equal(activeResult.displayState, 'REMIND', 'ACTIVE should use currentPeriodEndsAt')
assert.equal(activeResult.expiry, atDaysFromNow(4).toISOString())

assert.equal(
  computeSubscriptionReminder(active(null), NOW).displayState,
  'NORMAL',
  'legacy ACTIVE without an expiry should remain NORMAL',
)
assert.equal(
  computeSubscriptionReminder(active(atDaysFromNow(45)), NOW).displayState,
  'NORMAL',
  'a renewed subscription with a sufficiently distant expiry should return to NORMAL',
)

const cancelledInput = {
  status: 'CANCELLED',
  trialEndsAt: null,
  currentPeriodEndsAt: atDaysFromNow(30),
}
const cancelledResult = computeSubscriptionReminder(cancelledInput, NOW)
assert.equal(cancelledResult.storedStatus, 'CANCELLED')
assert.equal(cancelledResult.displayState, 'EXPIRED')
assert.equal(cancelledInput.status, 'CANCELLED', 'special stored status must not be changed to ACTIVE')

assert.deepEqual(computeSubscriptionReminder(null, NOW), {
  storedStatus: null,
  displayState: 'NORMAL',
  expiry: null,
  graceEndsAt: null,
})

const apiRoute = fs.readFileSync('app/api/subscription/reminder/route.ts', 'utf8')
const homePage = fs.readFileSync('app/home/page.tsx', 'utf8')
const reminderCard = fs.readFileSync('app/home/SubscriptionReminderCard.tsx', 'utf8')
const subscriptionHelper = fs.readFileSync('lib/subscription-reminder.ts', 'utf8')

assert.match(apiRoute, /getContext\(req\)/, 'API must reuse the existing authenticated context')
assert.match(apiRoute, /ctx\.role !== 'OWNER'[\s\S]*status: 403/, 'STAFF must be forbidden by the API')
assert.match(apiRoute, /where: \{ tenantId: ctx\.tenantId \}/, 'subscription lookup must use only the session tenant')
assert.match(apiRoute, /select: \{[\s\S]*status: true[\s\S]*trialEndsAt: true[\s\S]*currentPeriodEndsAt: true/, 'API should select only reminder fields')
assert.doesNotMatch(apiRoute, /SubscriptionEvent|paymentReference|operatorId|\bnote\b/, 'API must not expose audit or payment metadata')

assert.match(homePage, /realRole !== 'OWNER'[\s\S]*setSubscriptionReminder\(null\)/, 'STAFF UI must not fetch or render reminders')
assert.match(homePage, /realRole === 'OWNER' && subscriptionReminder[\s\S]*SubscriptionReminderCard/, 'only OWNER /home should render the reminder card')
assert.match(homePage, /href="\/my-stores"/, 'OWNER return-to-stores entry must remain intact')
assert.match(reminderCard, /displayState === 'NORMAL'\) return null/, 'NORMAL must render no reminder')
assert.doesNotMatch(subscriptionHelper, /prisma|update|create|delete/, 'runtime reminder calculation must remain pure and read-only')

for (const forbiddenPath of [
  'app/sale/page.tsx',
  'app/products/page.tsx',
  'app/records/page.tsx',
  'app/cashier/page.tsx',
  'app/menu/page.tsx',
]) {
  const source = fs.readFileSync(forbiddenPath, 'utf8')
  assert.doesNotMatch(source, /subscription\/reminder|SubscriptionReminderCard/, `${forbiddenPath} must remain outside reminder scope`)
}

async function testReminderApiIsolation() {
  const mutableEnv = process.env as unknown as Record<string, string | undefined>
  const originalNodeEnv = mutableEnv.NODE_ENV
  const originalVercelEnv = mutableEnv.VERCEL_ENV
  const originalDisableDevHeaders = mutableEnv.ESHOP_DISABLE_DEV_HEADERS
  mutableEnv.NODE_ENV = 'test'
  delete mutableEnv.VERCEL_ENV
  delete mutableEnv.ESHOP_DISABLE_DEV_HEADERS
  mutableEnv.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:65432/light_ops_test'

  const [{ NextRequest }, { GET }, { prisma }] = await Promise.all([
    import('next/server'),
    import('../app/api/subscription/reminder/route'),
    import('../lib/prisma'),
  ])
  type MinimalSubscription = {
    status: string
    trialEndsAt: Date | null
    currentPeriodEndsAt: Date | null
  }
  type FindUnique = (query: unknown) => Promise<MinimalSubscription | null>
  const subscriptionModel = prisma.tenantSubscription as unknown as { findUnique: FindUnique }
  const originalFindUnique = subscriptionModel.findUnique
  const queries: unknown[] = []
  subscriptionModel.findUnique = async (query) => {
    queries.push(query)
    return active(atDaysFromNow(4))
  }

  try {
    const ownerResponse = await GET(new NextRequest('https://example.test/api/subscription/reminder', {
      headers: {
        'x-tenant-id': 'tenant-owner-a',
        'x-user-id': 'owner-a',
        'x-store-id': 'store-a',
        'x-role': 'OWNER',
      },
    }))
    assert.equal(ownerResponse.status, 200)
    assert.equal((await ownerResponse.json()).displayState, 'REMIND')
    assert.deepEqual(queries, [{
      where: { tenantId: 'tenant-owner-a' },
      select: { status: true, trialEndsAt: true, currentPeriodEndsAt: true },
    }], 'OWNER lookup must be isolated to the authenticated tenant')

    const staffResponse = await GET(new NextRequest('https://example.test/api/subscription/reminder', {
      headers: {
        'x-tenant-id': 'tenant-owner-a',
        'x-user-id': 'staff-a',
        'x-store-id': 'store-a',
        'x-role': 'STAFF',
      },
    }))
    assert.equal(staffResponse.status, 403, 'STAFF must not receive subscription reminder data')
    assert.equal(queries.length, 1, 'STAFF must be rejected before subscription lookup')
  } finally {
    subscriptionModel.findUnique = originalFindUnique
    if (originalNodeEnv == null) delete mutableEnv.NODE_ENV
    else mutableEnv.NODE_ENV = originalNodeEnv
    if (originalVercelEnv == null) delete mutableEnv.VERCEL_ENV
    else mutableEnv.VERCEL_ENV = originalVercelEnv
    if (originalDisableDevHeaders == null) delete mutableEnv.ESHOP_DISABLE_DEV_HEADERS
    else mutableEnv.ESHOP_DISABLE_DEV_HEADERS = originalDisableDevHeaders
  }
}

testReminderApiIsolation()
  .then(() => console.log('subscription expiry reminder tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
