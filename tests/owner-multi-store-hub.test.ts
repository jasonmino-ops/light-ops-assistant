import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildOwnerStoreHub,
  canExtendOwnerAcrossTenant,
  findAuthorizedOwnerStore,
  getActiveOwnerStoresByTelegramId,
  getOwnerLandingPath,
  getTrustedOwnerTelegramId,
  type OwnerStoreAccess,
} from '../lib/owner-store-hub'
import { signSession, verifySession } from '../lib/session'

type ResolverDb = NonNullable<Parameters<typeof getActiveOwnerStoresByTelegramId>[1]>
type OverviewDb = NonNullable<Parameters<typeof buildOwnerStoreHub>[2]>

const createdAt = new Date('2026-08-17T00:00:00.000Z')
const resolverRows = [
  {
    tenantId: 'tenant-a', userId: 'owner-a', storeId: 'store-a', createdAt,
    user: { tenantId: 'tenant-a' },
    store: { id: 'store-a', tenantId: 'tenant-a', name: 'Mino Pet Shop', currencyCode: 'USD' },
  },
  {
    tenantId: 'tenant-a', userId: 'owner-a', storeId: 'store-b', createdAt,
    user: { tenantId: 'tenant-a' },
    store: { id: 'store-b', tenantId: 'tenant-a', name: 'Mewmew Pet Shop', currencyCode: 'USD' },
  },
  {
    tenantId: 'tenant-b', userId: 'owner-b', storeId: 'store-c', createdAt,
    user: { tenantId: 'tenant-b' },
    store: { id: 'store-c', tenantId: 'tenant-b', name: 'Mimi Coffee', currencyCode: 'USD' },
  },
  // Malformed cross-tenant membership must never enter the authorized set.
  {
    tenantId: 'tenant-a', userId: 'owner-a', storeId: 'store-foreign', createdAt,
    user: { tenantId: 'tenant-a' },
    store: { id: 'store-foreign', tenantId: 'tenant-x', name: 'Foreign Store', currencyCode: 'USD' },
  },
]

const resolverQueries: Array<Record<string, unknown>> = []
const resolverDb = {
  userStoreRole: {
    findMany: async (query: Record<string, unknown>) => {
      resolverQueries.push(query)
      return resolverRows
    },
  },
} as unknown as ResolverDb

async function main() {
const resolved = await getActiveOwnerStoresByTelegramId('telegram-owner', resolverDb)
assert.deepEqual(resolved.map((store) => store.storeId), ['store-a', 'store-b', 'store-c'])
assert.equal(resolved.filter((store) => store.tenantId === 'tenant-a').length, 2, 'same-tenant OWNER should resolve both explicit stores')
assert.equal(resolved.filter((store) => store.tenantId === 'tenant-b').length, 1, 'cross-tenant OWNER should retain the other tenant store')
assert.equal(findAuthorizedOwnerStore(resolved, 'store-c')?.userId, 'owner-b')
assert.equal(findAuthorizedOwnerStore(resolved, 'store-not-owned'), null, 'unowned store selection must be rejected')
const resolverQuery = resolverQueries[0]
assert.deepEqual(
  ((resolverQuery.where as { user: { is: { telegramId: string; role: string; status: string } } }).user.is),
  { telegramId: 'telegram-owner', role: 'OWNER', status: 'ACTIVE', tenant: { is: { status: 'ACTIVE' } } },
  'resolver must scope from Telegram identity through an active OWNER User',
)
assert.deepEqual(
  (resolverQuery.where as { role: string; status: string }).role,
  'OWNER',
  'resolver must require OWNER memberships',
)

assert.equal(getOwnerLandingPath(1), '/home', 'single-store OWNER must keep the existing landing')
assert.equal(getOwnerLandingPath(2), '/my-stores', 'multi-store OWNER must enter the hub')

let trustedUserLookupCount = 0
const identityDb = {
  user: {
    findFirst: async () => {
      trustedUserLookupCount += 1
      return { telegramId: 'telegram-owner' }
    },
  },
} as unknown as ResolverDb
assert.equal(
  await getTrustedOwnerTelegramId({ tenantId: 'tenant-a', userId: 'owner-a', role: 'OWNER' }, identityDb),
  'telegram-owner',
)
assert.equal(
  await getTrustedOwnerTelegramId({ tenantId: 'tenant-a', userId: 'staff-a', role: 'STAFF' }, identityDb),
  null,
  'STAFF must not resolve cross-store identity',
)
assert.equal(trustedUserLookupCount, 1, 'STAFF should be rejected before any identity lookup')

assert.equal(canExtendOwnerAcrossTenant(['OWNER'], 'OWNER'), true)
assert.equal(canExtendOwnerAcrossTenant(['OWNER', 'OWNER'], 'OWNER'), true)
assert.equal(canExtendOwnerAcrossTenant(['STAFF'], 'OWNER'), false, 'STAFF → OWNER must remain blocked')
assert.equal(canExtendOwnerAcrossTenant(['OWNER'], 'STAFF'), false, 'OWNER → STAFF must remain blocked')
assert.equal(canExtendOwnerAcrossTenant(['STAFF'], 'STAFF'), false, 'cross-tenant STAFF must remain blocked')

const overviewStores: OwnerStoreAccess[] = [resolved[0], resolved[2]]
const overviewQueries: Array<Record<string, unknown>> = []
const overviewDb = {
  saleRecord: {
    groupBy: async (query: Record<string, unknown>) => {
      overviewQueries.push(query)
      const by = query.by as string[]
      if (by.includes('orderNo')) {
        return [
          { tenantId: 'tenant-a', storeId: 'store-a', orderNo: 'A-1' },
          { tenantId: 'tenant-a', storeId: 'store-a', orderNo: 'A-2' },
          { tenantId: 'tenant-b', storeId: 'store-c', orderNo: 'C-1' },
        ]
      }
      return [
        { tenantId: 'tenant-a', storeId: 'store-a', _sum: { lineAmount: 100 } },
        { tenantId: 'tenant-b', storeId: 'store-c', _sum: { lineAmount: 200 } },
      ]
    },
  },
  customerOrder: {
    groupBy: async (query: Record<string, unknown>) => {
      overviewQueries.push(query)
      return [
        { tenantId: 'tenant-a', storeId: 'store-a', _sum: { totalAmount: 20 }, _count: { _all: 1 } },
        { tenantId: 'tenant-b', storeId: 'store-c', _sum: { totalAmount: 30 }, _count: { _all: 2 } },
      ]
    },
  },
} as unknown as OverviewDb

const hub = await buildOwnerStoreHub(overviewStores, new Date('2026-08-17T12:00:00.000Z'), overviewDb)
assert.equal(hub.date, '2026-08-17')
assert.deepEqual(hub.stores.map((store) => [store.id, store.todaySalesAmount, store.todayOrderCount]), [
  ['store-a', 120, 3],
  ['store-c', 230, 3],
])
assert.deepEqual(hub.overview, {
  salesAmount: 350,
  orderCount: 6,
  averageOrderValue: 58.33,
  currencyCode: 'USD',
  totalsByCurrency: [{ currencyCode: 'USD', salesAmount: 350, orderCount: 6, averageOrderValue: 58.33 }],
})
for (const query of overviewQueries) {
  const scope = (query.where as { OR: Array<{ tenantId: string; storeId: string }> }).OR
  assert.deepEqual(scope, [
    { tenantId: 'tenant-a', storeId: 'store-a' },
    { tenantId: 'tenant-b', storeId: 'store-c' },
  ], 'overview queries must use only the server-derived OWNER scope')
}

const mixedCurrencyHub = await buildOwnerStoreHub(
  [{ ...overviewStores[0] }, { ...overviewStores[1], currencyCode: 'XAF' }],
  new Date('2026-08-17T12:00:00.000Z'),
  overviewDb,
)
assert.equal(mixedCurrencyHub.overview.salesAmount, null, 'different currencies must not be numerically merged')
assert.equal(mixedCurrencyHub.overview.averageOrderValue, null)
assert.equal(mixedCurrencyHub.overview.totalsByCurrency.length, 2)

const session = verifySession(signSession({
  tenantId: 'tenant-b',
  userId: 'owner-b',
  storeId: 'store-c',
  role: 'OWNER',
}))
assert.deepEqual(session, {
  tenantId: 'tenant-b',
  userId: 'owner-b',
  storeId: 'store-c',
  role: 'OWNER',
}, 'store selection must keep the existing single-store session shape')

const authRoute = fs.readFileSync('app/api/auth/telegram/route.ts', 'utf8')
const telegramInit = fs.readFileSync('app/components/TelegramInit.tsx', 'utf8')
const bindRoute = fs.readFileSync('app/api/bind/route.ts', 'utf8')
const storesRoute = fs.readFileSync('app/api/owner/stores/route.ts', 'utf8')
const selectRoute = fs.readFileSync('app/api/owner/stores/select/route.ts', 'utf8')
const myStoresPage = fs.readFileSync('app/my-stores/page.tsx', 'utf8')
const homePage = fs.readFileSync('app/home/page.tsx', 'utf8')
const sessionSource = fs.readFileSync('lib/session.ts', 'utf8')
const contextSource = fs.readFileSync('lib/context.ts', 'utf8')

assert.match(authRoute, /user\.role === 'OWNER'[\s\S]*getOwnerLandingPath/, 'only OWNER auth should use multi-store landing')
assert.match(telegramInit, /body\.nextPath === '\/my-stores' \? '\/my-stores' : '\/home'/, 'client must whitelist the server landing')
assert.match(bindRoute, /findMany\([\s\S]*canExtendOwnerAcrossTenant/, 'bind must inspect all active identities before OWNER extension')
assert.match(storesRoute, /getTrustedOwnerTelegramId\(ctx\)[\s\S]*getActiveOwnerStoresByTelegramId/, 'hub API must derive scope from trusted session identity')
assert.doesNotMatch(storesRoute, /searchParams|req\.json\(/, 'hub GET must not accept tenant/store authorization input')
assert.match(selectRoute, /findAuthorizedOwnerStore\(stores, storeId\)/, 'selection must re-check the server-derived store set')
assert.match(selectRoute, /STORE_OWNER_ACCESS_DENIED[\s\S]*status: 403/, 'unauthorized store selection must return 403')
assert.match(selectRoute, /signSession\(\{[\s\S]*tenantId: selected\.tenantId[\s\S]*storeId: selected\.storeId[\s\S]*role: 'OWNER'/)
assert.match(homePage, /href="\/my-stores"/, 'OWNER home must expose return to My Stores')
assert.match(myStoresPage, /api\/owner\/stores\/select/, 'hub must select through the authorized API')
assert.doesNotMatch(myStoresPage, /auth\/logout|sessionStorage\.clear|localStorage\.clear/, 'returning to My Stores must not log out')
assert.doesNotMatch(sessionSource, /storeIds|activeTenant|tenantIds/, 'session format must remain single-store')
assert.doesNotMatch(contextSource, /storeIds|activeTenant|tenantIds/, 'RequestContext must remain single-store')

console.log('owner multi-store hub tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
