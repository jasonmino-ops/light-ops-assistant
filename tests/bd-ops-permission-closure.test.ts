import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { hasOpsRole } from '../lib/ops-auth'
import { signSession } from '../lib/session'
import { GET as getOpsCheck } from '../app/api/ops/check/route'
import { GET as getTenants, POST as createTenant } from '../app/api/ops/tenants/route'
import { GET as getTenant, PATCH as updateTenant } from '../app/api/ops/tenants/[tenantId]/route'
import { POST as broadcast } from '../app/api/ops/broadcast/route'
import { GET as getApplications } from '../app/api/ops/applications/route'
import { POST as notifyApplication } from '../app/api/ops/applications/[id]/notify/route'
import { GET as getOverview } from '../app/api/ops/overview/route'
import { POST as refreshSummaries } from '../app/api/ops/summaries/refresh/route'
import { GET as getOpsHealth } from '../app/api/ops/health/route'
import { POST as createBindToken } from '../app/api/ops/tenants/[tenantId]/tokens/route'
import { GET as getSubscription } from '../app/api/ops/tenants/[tenantId]/subscription/route'
import { GET as getBizView } from '../app/api/ops/tenants/[tenantId]/bizview/route'
import { PATCH as updateFeaturedStore } from '../app/api/ops/stores/[storeId]/e-life-featured/route'
import { GET as getStoreCustomers } from '../app/api/ops/stores/[storeId]/customers/route'
import { PATCH as updateStoreCustomer } from '../app/api/ops/stores/[storeId]/customers/[telegramId]/route'
import { POST as approveApplication } from '../app/api/ops/applications/[id]/approve/route'
import { POST as rejectApplication } from '../app/api/ops/applications/[id]/reject/route'
import { POST as changeApplicationBlock } from '../app/api/ops/sales-leads/[id]/block/route'
import { GET as getMerchantConversations } from '../app/api/ops/conversations/route'
import { POST as sendMerchantReply } from '../app/api/ops/messages/route'
import { POST as takeOverMerchantConversation } from '../app/api/ops/support/[telegramId]/takeover/route'
import { PATCH as updateSupportConfig } from '../app/api/ops/sales-lead-support/route'

type TestRole = 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD'

const mutablePrisma = prisma as unknown as {
  opsAdmin: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>
  }
}
const originalFindUnique = mutablePrisma.opsAdmin.findUnique
let activeRole: TestRole = 'BD'

function request(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) {
  const session = signSession({
    tenantId: '_ops',
    userId: 'ops-permission-test',
    storeId: '_ops',
    role: 'OWNER',
    opsRole: activeRole,
    opsSessionVersion: 7,
  })
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      cookie: `auth-session=${session}`,
      'content-type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
}

async function expectForbidden(label: string, response: Promise<Response>) {
  assert.equal((await response).status, 403, `${label} must reject BD with 403`)
}

const protectedRouteSources = [
  'app/api/ops/tenants/route.ts',
  'app/api/ops/tenants/[tenantId]/route.ts',
  'app/api/ops/broadcast/route.ts',
  'app/api/ops/applications/route.ts',
  'app/api/ops/applications/[id]/notify/route.ts',
  'app/api/ops/overview/route.ts',
  'app/api/ops/summaries/refresh/route.ts',
  'app/api/ops/health/route.ts',
  'app/api/ops/tenants/[tenantId]/tokens/route.ts',
  'app/api/ops/tenants/[tenantId]/subscription/route.ts',
  'app/api/ops/tenants/[tenantId]/bizview/route.ts',
  'app/api/ops/stores/[storeId]/e-life-featured/route.ts',
  'app/api/ops/stores/[storeId]/customers/route.ts',
  'app/api/ops/stores/[storeId]/customers/[telegramId]/route.ts',
]

for (const path of protectedRouteSources) {
  const source = fs.readFileSync(path, 'utf8')
  assert.match(source, /hasOpsRole/)
  assert.match(source, /'OPS_ADMIN'/)
  assert.match(source, /status: 403/)
}

async function main() {
  mutablePrisma.opsAdmin.findUnique = async () => ({
    id: 'ops-permission-test',
    name: 'Permission Test',
    role: activeRole,
    status: 'ACTIVE',
    sessionVersion: 7,
    lockedUntil: null,
  })

  try {
  activeRole = 'BD'
  const tenantParams = { params: Promise.resolve({ tenantId: 'tenant-test' }) }
  const applicationParams = { params: Promise.resolve({ id: 'application-test' }) }
  const leadParams = { params: Promise.resolve({ id: 'lead-test' }) }
  const storeParams = { params: Promise.resolve({ storeId: 'store-test' }) }
  const customerParams = { params: Promise.resolve({ storeId: 'store-test', telegramId: '12345' }) }
  const telegramParams = { params: Promise.resolve({ telegramId: '12345' }) }

  await expectForbidden('tenant list', getTenants(request('/api/ops/tenants')))
  await expectForbidden('tenant create', createTenant(request('/api/ops/tenants', 'POST')))
  await expectForbidden('tenant detail', getTenant(request('/api/ops/tenants/tenant-test'), tenantParams))
  await expectForbidden('tenant update', updateTenant(request('/api/ops/tenants/tenant-test', 'PATCH'), tenantParams))
  await expectForbidden('broadcast', broadcast(request('/api/ops/broadcast', 'POST')))
  await expectForbidden('application list', getApplications(request('/api/ops/applications')))
  await expectForbidden('application notify', notifyApplication(request('/api/ops/applications/application-test/notify', 'POST'), applicationParams))
  await expectForbidden('ops overview', getOverview(request('/api/ops/overview')))
  await expectForbidden('summary refresh', refreshSummaries(request('/api/ops/summaries/refresh', 'POST')))
  await expectForbidden('ops health', getOpsHealth(request('/api/ops/health')))
  await expectForbidden('bind token create', createBindToken(request('/api/ops/tenants/tenant-test/tokens', 'POST'), tenantParams))
  await expectForbidden('subscription detail', getSubscription(request('/api/ops/tenants/tenant-test/subscription'), tenantParams))
  await expectForbidden('business view', getBizView(request('/api/ops/tenants/tenant-test/bizview'), tenantParams))
  await expectForbidden('featured store update', updateFeaturedStore(request('/api/ops/stores/store-test/e-life-featured', 'PATCH'), storeParams))
  await expectForbidden('merchant customer list', getStoreCustomers(request('/api/ops/stores/store-test/customers'), storeParams))
  await expectForbidden('merchant customer update', updateStoreCustomer(request('/api/ops/stores/store-test/customers/12345', 'PATCH'), customerParams))

  await expectForbidden('application approve', approveApplication(request('/api/ops/applications/application-test/approve', 'POST'), applicationParams))
  await expectForbidden('application reject', rejectApplication(request('/api/ops/applications/application-test/reject', 'POST'), applicationParams))
  await expectForbidden('application reject and ban', rejectApplication(request('/api/ops/applications/application-test/reject', 'POST', { ban: true }), applicationParams))
  await expectForbidden('application ban', changeApplicationBlock(request('/api/ops/sales-leads/lead-test/block', 'POST', { action: 'BAN' }), leadParams))
  await expectForbidden('application unban', changeApplicationBlock(request('/api/ops/sales-leads/lead-test/block', 'POST', { action: 'UNBAN' }), leadParams))
  await expectForbidden('merchant conversations', getMerchantConversations(request('/api/ops/conversations')))
  await expectForbidden('merchant reply', sendMerchantReply(request('/api/ops/messages', 'POST')))
  await expectForbidden('merchant takeover', takeOverMerchantConversation(request('/api/ops/support/12345/takeover', 'POST'), telegramParams))
  await expectForbidden('support config write', updateSupportConfig(request('/api/ops/sales-lead-support', 'PATCH')))

  assert.equal((await getOpsCheck(request('/api/ops/check'))).status, 200, 'BD ops login check must remain available')

  for (const role of ['OPS_ADMIN', 'SUPER_ADMIN'] as const) {
    activeRole = role
    const tenantResponse = await createTenant(request('/api/ops/tenants', 'POST', {}))
    assert.notEqual(tenantResponse.status, 403, `${role} must pass tenant administration role gate`)
    assert.equal(tenantResponse.status, 400, `${role} invalid tenant input should reach validation`)
  }

  assert.equal(hasOpsRole('BD', 'OPS_ADMIN'), false)
  assert.equal(hasOpsRole('OPS_ADMIN', 'OPS_ADMIN'), true)
  assert.equal(hasOpsRole('SUPER_ADMIN', 'OPS_ADMIN'), true)
  } finally {
    mutablePrisma.opsAdmin.findUnique = originalFindUnique
  }

  console.log('BD ops permission closure tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
