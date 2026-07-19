import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { assertStagingPreviewDatabase } from './staging-preview-guard'

const TENANT_ID = 'preview-e1-tenant'
const STORE_ID = 'preview-e1-store'
const STORE_CODE = 'PREV06C'
const OWNER_ID = 'preview-e1-owner'
const OWNER_ROLE_ID = 'preview-e1-owner-role'
const SUBSCRIPTION_ID = 'preview-e1-subscription'
const OPS_USERNAME = 'preview-e1-ops-admin'
const TENANT_NAME = '[STAGING] Preview E1 Tenant'
const STORE_NAME = '[STAGING] Preview E1 Store'

async function authenticateOpsAdmin(mode: string) {
  const username = process.env.OPS_USERNAME?.trim()
  const password = process.env.OPS_PASSWORD ?? ''
  if (username !== OPS_USERNAME || !password || password.length < 32) {
    throw new Error('Synthetic ops bootstrap credentials are not configured')
  }
  if (mode === '--bootstrap' && process.env.OPS_AUTO_SEED !== 'true') {
    throw new Error('OPS_AUTO_SEED=true is required for first bootstrap')
  }

  const [{ POST: login }, { checkOpsAuthContext }, { prisma }] = await Promise.all([
    import('../app/api/ops/login/route'),
    import('../lib/ops-auth'),
    import('../lib/prisma'),
  ])
  const response = await login(new NextRequest('http://localhost/api/ops/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }))
  if (response.status !== 200) throw new Error(`Ops bootstrap authentication failed (${response.status})`)

  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (!cookie) throw new Error('Ops bootstrap did not return a session cookie')
  const ops = await checkOpsAuthContext(new NextRequest('http://localhost/ops', {
    headers: { cookie },
  }))
  if (!ops || ops.userId === '_ops_admin') throw new Error('Ops session is not FK-backed')

  const admin = await prisma.opsAdmin.findUnique({ where: { id: ops.userId } })
  if (!admin) throw new Error('OpsAdmin row is missing')
  assert.equal(admin.status, 'ACTIVE')
  assert.equal(admin.role, ops.role)
  assert.equal(admin.sessionVersion >= 0, true)
  assert.equal(admin.lockedUntil, null)
  assert.equal(admin.id, ops.userId)
  return { prisma, admin }
}

async function assertSyntheticNamespaceAvailable(prisma: typeof import('../lib/prisma').prisma) {
  const [tenant, store, storeByCode, owner, subscription, sales, members, orders] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: TENANT_ID } }),
    prisma.store.findUnique({ where: { id: STORE_ID } }),
    prisma.store.findUnique({ where: { code: STORE_CODE } }),
    prisma.user.findUnique({ where: { id: OWNER_ID } }),
    prisma.tenantSubscription.findUnique({ where: { tenantId: TENANT_ID } }),
    prisma.saleRecord.count({ where: { tenantId: TENANT_ID } }),
    prisma.member.count({ where: { tenantId: TENANT_ID } }),
    prisma.customerOrder.count({ where: { tenantId: TENANT_ID } }),
  ])
  if (tenant && tenant.name !== TENANT_NAME) throw new Error('Synthetic tenant ID is already owned by different data')
  if (store && (store.tenantId !== TENANT_ID || store.code !== STORE_CODE)) {
    throw new Error('Synthetic store ID is already owned by different data')
  }
  if (storeByCode && storeByCode.id !== STORE_ID) throw new Error('PREV06C is already owned by a different staging store')
  if (owner && (owner.tenantId !== TENANT_ID || owner.telegramId !== null)) {
    throw new Error('Synthetic owner ID is already owned by different data')
  }
  if (subscription && subscription.tenantId !== TENANT_ID) throw new Error('Synthetic subscription is owned by different data')
  if (sales !== 0 || members !== 0 || orders !== 0) throw new Error('Synthetic namespace contains business data')
}

async function upsertSyntheticFixtures(prisma: typeof import('../lib/prisma').prisma) {
  await assertSyntheticNamespaceAvailable(prisma)

  await prisma.$transaction(async (tx) => {
    await tx.tenant.upsert({
      where: { id: TENANT_ID },
      update: { name: TENANT_NAME, status: 'ACTIVE', tier: 'STANDARD' },
      create: { id: TENANT_ID, name: TENANT_NAME, status: 'ACTIVE', tier: 'STANDARD' },
    })
    await tx.store.upsert({
      where: { id: STORE_ID },
      update: { tenantId: TENANT_ID, code: STORE_CODE, name: STORE_NAME, status: 'ACTIVE' },
      create: { id: STORE_ID, tenantId: TENANT_ID, code: STORE_CODE, name: STORE_NAME, status: 'ACTIVE' },
    })
    await tx.user.upsert({
      where: { id: OWNER_ID },
      update: { tenantId: TENANT_ID, username: OWNER_ID, displayName: 'Preview E1 Owner', role: 'OWNER', status: 'ACTIVE', telegramId: null },
      create: { id: OWNER_ID, tenantId: TENANT_ID, username: OWNER_ID, displayName: 'Preview E1 Owner', role: 'OWNER', status: 'ACTIVE' },
    })
    await tx.userStoreRole.upsert({
      where: { userId_storeId: { userId: OWNER_ID, storeId: STORE_ID } },
      update: { tenantId: TENANT_ID, role: 'OWNER', status: 'ACTIVE' },
      create: { id: OWNER_ROLE_ID, tenantId: TENANT_ID, userId: OWNER_ID, storeId: STORE_ID, role: 'OWNER', status: 'ACTIVE' },
    })
    await tx.tenantSubscription.upsert({
      where: { tenantId: TENANT_ID },
      update: { status: 'ACTIVE' },
      create: { id: SUBSCRIPTION_ID, tenantId: TENANT_ID, status: 'ACTIVE' },
    })
  })
}

async function verifySyntheticFixtures(prisma: typeof import('../lib/prisma').prisma) {
  const [tenant, store, owner, role, subscription, sales, members, orders] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: TENANT_ID } }),
    prisma.store.findUnique({ where: { id: STORE_ID } }),
    prisma.user.findUnique({ where: { id: OWNER_ID } }),
    prisma.userStoreRole.findUnique({ where: { userId_storeId: { userId: OWNER_ID, storeId: STORE_ID } } }),
    prisma.tenantSubscription.findUnique({ where: { tenantId: TENANT_ID } }),
    prisma.saleRecord.count({ where: { tenantId: TENANT_ID } }),
    prisma.member.count({ where: { tenantId: TENANT_ID } }),
    prisma.customerOrder.count({ where: { tenantId: TENANT_ID } }),
  ])
  assert.equal(tenant?.status, 'ACTIVE')
  assert.equal(store?.tenantId, TENANT_ID)
  assert.equal(store?.code, STORE_CODE)
  assert.equal(owner?.tenantId, TENANT_ID)
  assert.equal(owner?.telegramId, null)
  assert.equal(role?.role, 'OWNER')
  assert(['ACTIVE', 'TRIAL'].includes(subscription?.status ?? ''))
  assert.equal(sales, 0)
  assert.equal(members, 0)
  assert.equal(orders, 0)
}

async function main() {
  const mode = process.argv[2] ?? '--bootstrap'
  if (mode !== '--bootstrap' && mode !== '--verify-only') throw new Error('Use --bootstrap or --verify-only')
  const target = assertStagingPreviewDatabase()
  const { prisma, admin } = await authenticateOpsAdmin(mode)

  try {
    const identity = await prisma.$queryRaw<Array<{ database_name: string }>>`
      SELECT current_database() AS database_name
    `
    assert.equal(identity[0]?.database_name, 'postgres')
    if (mode === '--bootstrap') await upsertSyntheticFixtures(prisma)
    await verifySyntheticFixtures(prisma)

    console.log(JSON.stringify({
      target: 'eshop-staging',
      projectRefFingerprint: target.projectRefFingerprint,
      mode,
      previewOpsIdentity: 'VALID FK-BACKED',
      opsRole: admin.role,
      opsStatus: admin.status,
      opsUnlocked: admin.lockedUntil === null,
      sessionVersionValid: admin.sessionVersion >= 0,
      syntheticFixtures: {
        tenantId: TENANT_ID,
        storeId: STORE_ID,
        storeCode: STORE_CODE,
        ownerId: OWNER_ID,
        subscription: 'ACTIVE',
      },
      pinGenerated: false,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'staging bootstrap failed')
  process.exitCode = 1
})
