import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { createActivationPin, hashActivationPin } from '../lib/desktop-activation/crypto'
import { issueDesktopActivationPin } from '../lib/desktop-activation/pin-issuance'
import { signSession } from '../lib/session'
import { POST as activateDesktop } from '../app/api/desktop/activate/route'
import { POST as merchantIssue } from '../app/api/desktop/activation-pins/route'
import { GET, POST } from '../app/api/ops/desktop-activation/route'

if (process.env.DESKTOP_ACTIVATION_TEST_DATABASE !== '1') {
  throw new Error('DESKTOP_ACTIVATION_TEST_DATABASE=1 is required for real database activation PIN console tests')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for real database activation PIN console tests')
}
if (!process.env.DESKTOP_DEVICE_TOKEN_SECRET || !process.env.DESKTOP_ACTIVATION_PIN_SECRET) {
  throw new Error('Desktop activation test secrets are required')
}

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1]
type OpsRole = 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD'
type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'

const createdTenantIds = new Set<string>(['hist-tenant-06c'])
const createdOpsAdminIds = new Set<string>()

function request(url: string, init?: NextRequestInit) {
  return new NextRequest(url, init)
}

async function makeOpsSession(role: OpsRole, init?: NextRequestInit) {
  const suffix = randomUUID().slice(0, 8)
  const admin = await prisma.opsAdmin.create({
    data: {
      name: `${role} ${suffix}`,
      username: `ops-${role.toLowerCase()}-${suffix}`,
      role,
      status: 'ACTIVE',
    },
  })
  createdOpsAdminIds.add(admin.id)
  const token = signSession({
    tenantId: '_ops',
    userId: admin.id,
    storeId: '',
    role: 'OWNER',
    opsRole: role,
    opsSessionVersion: admin.sessionVersion,
  })
  const req = request('http://localhost/api/ops/desktop-activation', {
    ...init,
    headers: {
      cookie: `auth-session=${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  return { admin, req }
}

function merchantRequest(input: { tenantId: string; storeId: string; userId: string; body?: unknown }) {
  return request('http://localhost/api/desktop/activation-pins', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': input.tenantId,
      'x-store-id': input.storeId,
      'x-user-id': input.userId,
      'x-role': 'OWNER',
    },
    body: JSON.stringify(input.body ?? { storeId: input.storeId }),
  })
}

function staffOpsApiRequest(input: { tenantId: string; storeId: string; userId: string }) {
  return request('http://localhost/api/ops/desktop-activation', {
    headers: {
      'x-tenant-id': input.tenantId,
      'x-store-id': input.storeId,
      'x-user-id': input.userId,
      'x-role': 'STAFF',
    },
  })
}

async function seedStore(subscriptionStatus: SubscriptionStatus) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: {
      name: `pin-console tenant ${suffix}`,
      status: 'ACTIVE',
      tier: 'STANDARD',
    },
  })
  createdTenantIds.add(tenant.id)
  const store = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      code: `PIN-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: `PIN store ${suffix}`,
      status: 'ACTIVE',
    },
  })
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `owner-${suffix}`,
      displayName: 'Owner',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })
  const staff = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `staff-${suffix}`,
      displayName: 'Staff',
      role: 'STAFF',
      status: 'ACTIVE',
    },
  })
  await prisma.userStoreRole.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, storeId: store.id, role: 'OWNER', status: 'ACTIVE' },
      { tenantId: tenant.id, userId: staff.id, storeId: store.id, role: 'STAFF', status: 'ACTIVE' },
    ],
  })
  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      status: subscriptionStatus,
    },
  })
  return { tenant, store, owner, staff }
}

async function opsLookup(storeCode: string, role: OpsRole = 'OPS_ADMIN') {
  const { req } = await makeOpsSession(role)
  return GET(new NextRequest(`http://localhost/api/ops/desktop-activation?storeCode=${encodeURIComponent(storeCode)}`, {
    headers: req.headers,
  }))
}

async function opsIssue(storeCode: string, role: OpsRole = 'OPS_ADMIN', extraBody: Record<string, unknown> = {}) {
  const { admin, req } = await makeOpsSession(role, {
    method: 'POST',
    body: JSON.stringify({ storeCode, ...extraBody }),
  })
  return { admin, response: await POST(req) }
}

function activationRequest(input: { storeCode: string; pin: string; installationId?: string }) {
  return request('http://localhost/api/desktop/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      storeCode: input.storeCode,
      pin: input.pin,
      installationId: input.installationId ?? `installation-${randomUUID()}`,
    }),
  })
}

async function assertCatalogObjects() {
  const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
    SELECT conname
    FROM pg_constraint
    WHERE conname IN (
      'DesktopActivationPin_exactly_one_creator_check',
      'DesktopActivationPin_createdByOpsAdminId_fkey',
      'DesktopActivationAudit_actorOpsAdminId_fkey'
    )
  `
  assert.deepEqual(
    new Set(constraints.map((row) => row.conname)),
    new Set([
      'DesktopActivationPin_exactly_one_creator_check',
      'DesktopActivationPin_createdByOpsAdminId_fkey',
      'DesktopActivationAudit_actorOpsAdminId_fkey',
    ]),
    'migration constraints and FKs must exist',
  )

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE indexname IN (
      'DesktopActivationPin_createdByOpsAdminId_idx',
      'DesktopActivationAudit_actorOpsAdminId_idx'
    )
  `
  assert.deepEqual(
    new Set(indexes.map((row) => row.indexname)),
    new Set(['DesktopActivationPin_createdByOpsAdminId_idx', 'DesktopActivationAudit_actorOpsAdminId_idx']),
    'migration indexes must exist',
  )
}

async function assertHistoricalFixtureCompatible() {
  const row = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: 'hist-pin-06c' } })
  assert.equal(row.createdByUserId, 'hist-owner-06c', 'historical merchant PIN must keep merchant creator')
  assert.equal(row.createdByOpsAdminId, null, 'historical merchant PIN must not gain ops creator')
  assert.equal(row.activeSlot, 'ACTIVE', 'historical active PIN must remain valid after migration')
}

async function assertCreatorCheck(input: { tenantId: string; storeId: string; ownerId: string; opsAdminId: string }) {
  const pin = createActivationPin()
  const pinHash = hashActivationPin({ tenantId: input.tenantId, storeId: input.storeId, pin })
  await assert.rejects(
    () => prisma.desktopActivationPin.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        pinHash,
        pinHashVersion: 1,
        status: 'ACTIVE',
        activeSlot: 'check-null',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdByUserId: null,
        createdByOpsAdminId: null,
      },
    }),
    'CHECK should reject rows with no creator',
  )
  await assert.rejects(
    () => prisma.desktopActivationPin.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        pinHash,
        pinHashVersion: 1,
        status: 'ACTIVE',
        activeSlot: 'check-both',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdByUserId: input.ownerId,
        createdByOpsAdminId: input.opsAdminId,
      },
    }),
    'CHECK should reject rows with both creator types',
  )
}

async function testAuthorizationLookupAndNoStore() {
  const { tenant, store, owner, staff } = await seedStore('ACTIVE')

  const unauth = await GET(request(`http://localhost/api/ops/desktop-activation?storeCode=${store.code}`))
  assert.equal(unauth.status, 403)
  assert.equal(unauth.headers.get('cache-control'), 'no-store, max-age=0')

  const merchantOwner = await GET(request(`http://localhost/api/ops/desktop-activation?storeCode=${store.code}`, {
    headers: {
      'x-tenant-id': tenant.id,
      'x-store-id': store.id,
      'x-user-id': owner.id,
      'x-role': 'OWNER',
    },
  }))
  assert.equal(merchantOwner.status, 403, 'merchant OWNER must not access ops PIN console API')

  const staffResponse = await GET(staffOpsApiRequest({ tenantId: tenant.id, storeId: store.id, userId: staff.id }))
  assert.equal(staffResponse.status, 403, 'STAFF must not access ops PIN console API')

  const bd = await opsLookup(store.code, 'BD')
  assert.equal(bd.status, 403, 'BD role must not generate activation PINs')

  const disabled = await makeOpsSession('OPS_ADMIN')
  await prisma.opsAdmin.update({ where: { id: disabled.admin.id }, data: { status: 'DISABLED' } })
  const disabledResponse = await GET(new NextRequest(`http://localhost/api/ops/desktop-activation?storeCode=${store.code}`, {
    headers: disabled.req.headers,
  }))
  assert.equal(disabledResponse.status, 403, 'disabled OpsAdmin sessions must be rejected')

  const invalid = await opsLookup('bad code')
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error, 'INVALID_STORE_CODE')

  const missing = await opsLookup(`NO-${randomUUID().slice(0, 8)}`)
  assert.equal(missing.status, 404)
  assert.equal(missing.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal((await missing.json()).error, 'STORE_NOT_FOUND')

  const found = await opsLookup(store.code)
  assert.equal(found.status, 200)
  assert.equal(found.headers.get('cache-control'), 'no-store, max-age=0')
  const body = await found.json()
  assert.equal(body.store.code, store.code)
  assert.equal(body.tenant.name, tenant.name)
  assert.equal(body.subscription.status, 'ACTIVE')
  assert.equal(body.activePin, null)
}

async function testOpsIssuanceAttributionAndPinLifecycle() {
  const { tenant, store, owner } = await seedStore('TRIAL')
  const { admin: checkAdmin } = await makeOpsSession('OPS_ADMIN')
  await assertCreatorCheck({ tenantId: tenant.id, storeId: store.id, ownerId: owner.id, opsAdminId: checkAdmin.id })

  const first = await opsIssue(store.code, 'OPS_ADMIN', {
    operatorRole: 'SUPER_ADMIN',
    actorOpsAdminId: 'forged',
    createdByOpsAdminId: 'forged',
  })
  assert.equal(first.response.status, 201)
  assert.equal(first.response.headers.get('cache-control'), 'no-store, max-age=0')
  const firstBody = await first.response.json()
  assert.match(firstBody.pin, /^\d{6}$/)
  assert.equal('deviceToken' in firstBody, false)
  assert.equal('tokenHash' in firstBody, false)
  assert.equal('pinHash' in firstBody, false)
  assert.equal(firstBody.subscription.status, 'TRIAL')
  assert.equal(firstBody.replacedActivePin, false)

  const firstRow = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: firstBody.pinId } })
  assert.notEqual(firstRow.pinHash, firstBody.pin, 'database must not store raw PIN')
  assert.equal(firstRow.createdByUserId, null)
  assert.equal(firstRow.createdByOpsAdminId, first.admin.id)
  assert.equal(firstRow.status, 'ACTIVE')
  assert.equal(firstRow.activeSlot, 'ACTIVE')

  const firstAudit = await prisma.desktopActivationAudit.findFirstOrThrow({
    where: { tenantId: tenant.id, storeId: store.id, pinId: firstBody.pinId, eventType: 'PIN_CREATED' },
  })
  assert.equal(firstAudit.actorUserId, null)
  assert.equal(firstAudit.actorOpsAdminId, first.admin.id)
  assert.equal(firstAudit.reasonCode, 'OPS_ISSUED')
  assert.deepEqual(firstAudit.metadata, {
    expiresAt: firstBody.expiresAt,
    accessState: 'ALLOWED',
    status: 'TRIAL',
    operatorRole: 'OPS_ADMIN',
    issuanceSource: 'OPS_CONSOLE',
  })
  const firstAuditText = JSON.stringify(firstAudit.metadata ?? {})
  assert.equal(firstAuditText.includes(firstBody.pin), false, 'audit metadata must not contain raw PIN')
  assert.equal(firstAuditText.includes(firstRow.pinHash), false, 'audit metadata must not contain PIN hash')
  assert.equal(firstAuditText.includes('secret'), false, 'audit metadata must not contain secret material')

  const second = await opsIssue(store.code, 'SUPER_ADMIN')
  assert.equal(second.response.status, 201)
  const secondBody = await second.response.json()
  assert.equal(secondBody.replacedActivePin, true)

  const secondAudit = await prisma.desktopActivationAudit.findFirstOrThrow({
    where: { pinId: secondBody.pinId, eventType: 'PIN_CREATED' },
  })
  assert.equal(secondAudit.actorOpsAdminId, second.admin.id)
  assert.equal((secondAudit.metadata as { operatorRole?: string })?.operatorRole, 'SUPER_ADMIN')

  const revokedFirstRow = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: firstBody.pinId } })
  assert.equal(revokedFirstRow.status, 'REVOKED')
  assert.equal(revokedFirstRow.activeSlot, null)

  const activePins = await prisma.desktopActivationPin.findMany({
    where: { storeId: store.id, activeSlot: 'ACTIVE' },
  })
  assert.equal(activePins.length, 1, 'only one active PIN should remain')
  assert.equal(activePins[0].id, secondBody.pinId)

  const activation = await activateDesktop(activationRequest({
    storeCode: store.code,
    pin: secondBody.pin,
    installationId: `ops-activation-${randomUUID()}`,
  }))
  assert.equal(activation.status, 201, 'ops-issued PIN should be consumable by desktop activation API')
  const activationBody = await activation.json()
  assert.equal(typeof activationBody.deviceToken, 'string')

  const reuse = await activateDesktop(activationRequest({
    storeCode: store.code,
    pin: secondBody.pin,
    installationId: `ops-reuse-${randomUUID()}`,
  }))
  assert.notEqual(reuse.status, 201, 'used PIN must not be reusable')

  const usedPin = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: secondBody.pinId } })
  assert.equal(usedPin.status, 'USED')
  assert.equal(usedPin.activeSlot, null)

  await assert.rejects(
    () => prisma.opsAdmin.delete({ where: { id: second.admin.id } }),
    'hard-deleting an attributed OpsAdmin should not erase PIN creator attribution',
  )
}

async function testSubscriptionBlocksAndDeniedAudit() {
  for (const subscriptionStatus of ['EXPIRED', 'CANCELLED'] as const) {
    const { tenant, store } = await seedStore(subscriptionStatus)
    const { admin, response } = await opsIssue(store.code)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
    const body = await response.json()
    assert.equal(body.error, 'SUBSCRIPTION_BLOCKED')
    assert.equal(body.subscription.status, subscriptionStatus)

    const activePins = await prisma.desktopActivationPin.findMany({
      where: { storeId: store.id, activeSlot: 'ACTIVE' },
    })
    assert.equal(activePins.length, 0)

    const audit = await prisma.desktopActivationAudit.findFirstOrThrow({
      where: { tenantId: tenant.id, storeId: store.id, eventType: 'PIN_CREATE_DENIED' },
    })
    assert.equal(audit.actorUserId, null)
    assert.equal(audit.actorOpsAdminId, admin.id)
    assert.equal(audit.reasonCode, 'SUBSCRIPTION_BLOCKED')
    assert.deepEqual(audit.metadata, {
      accessState: 'BLOCKED',
      status: subscriptionStatus,
      operatorRole: 'OPS_ADMIN',
      issuanceSource: 'OPS_CONSOLE',
    })
  }
}

async function testActiveAndMerchantRegression() {
  const activeStore = await seedStore('ACTIVE')
  const activeIssue = await opsIssue(activeStore.store.code)
  assert.equal(activeIssue.response.status, 201, 'ACTIVE subscription should allow ops issuance')
  await activeIssue.response.json()

  const merchantStore = await seedStore('ACTIVE')
  const merchantResponse = await merchantIssue(merchantRequest({
    tenantId: merchantStore.tenant.id,
    storeId: merchantStore.store.id,
    userId: merchantStore.owner.id,
  }))
  assert.equal(merchantResponse.status, 201)
  assert.equal(merchantResponse.headers.get('cache-control'), 'no-store, max-age=0')
  const merchantBody = await merchantResponse.json()

  const merchantPin = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: merchantBody.pinId } })
  assert.equal(merchantPin.createdByUserId, merchantStore.owner.id)
  assert.equal(merchantPin.createdByOpsAdminId, null)
  assert.notEqual(merchantPin.pinHash, merchantBody.pin)

  const merchantAudit = await prisma.desktopActivationAudit.findFirstOrThrow({
    where: { pinId: merchantBody.pinId, eventType: 'PIN_CREATED' },
  })
  assert.equal(merchantAudit.actorUserId, merchantStore.owner.id)
  assert.equal(merchantAudit.actorOpsAdminId, null)
  assert.deepEqual(merchantAudit.metadata, {
    expiresAt: merchantBody.expiresAt,
    accessState: 'ALLOWED',
    status: 'ACTIVE',
  }, 'merchant PIN_CREATED metadata shape must match frozen 06A semantics')
}

async function testConcurrencyAndControlledRollback() {
  const { store } = await seedStore('ACTIVE')
  const [one, two] = await Promise.all([
    opsIssue(store.code),
    opsIssue(store.code),
  ])
  const statuses = [one.response.status, two.response.status]
  assert.ok(statuses.every((status) => status === 201 || status === 409), 'concurrent issuance must return success or controlled conflict')
  assert.ok(statuses.includes(201), 'at least one concurrent issuance should succeed')
  await Promise.all([one.response.json().catch(() => ({})), two.response.json().catch(() => ({}))])

  const activePins = await prisma.desktopActivationPin.findMany({
    where: { storeId: store.id, activeSlot: 'ACTIVE' },
  })
  assert.equal(activePins.length, 1, 'concurrent issuance must leave exactly one active PIN')

  const auditCountBefore = await prisma.desktopActivationAudit.count({ where: { storeId: store.id } })
  const pinCountBefore = await prisma.desktopActivationPin.count({ where: { storeId: store.id } })
  const invalid = await issueDesktopActivationPin({
    req: request('http://localhost/api/ops/desktop-activation', { method: 'POST' }),
    store: { id: store.id, tenantId: activePins[0].tenantId },
    createdByUserId: null,
    createdByOpsAdminId: null,
    actorUserId: null,
    actorOpsAdminId: null,
  })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error, 'INVALID_ISSUER')
  const auditCountAfter = await prisma.desktopActivationAudit.count({ where: { storeId: store.id } })
  const pinCountAfter = await prisma.desktopActivationPin.count({ where: { storeId: store.id } })
  assert.equal(auditCountAfter, auditCountBefore, 'controlled rollback path must not leave audit rows')
  assert.equal(pinCountAfter, pinCountBefore, 'controlled rollback path must not leave PIN rows')
}

async function testNoStoreSecretFailure() {
  const { store } = await seedStore('ACTIVE')
  const original = process.env.DESKTOP_ACTIVATION_PIN_SECRET
  try {
    delete process.env.DESKTOP_ACTIVATION_PIN_SECRET
    const { response } = await opsIssue(store.code)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
    const body = await response.json()
    assert.equal(body.error, 'PIN_SECRET_NOT_CONFIGURED')
  } finally {
    if (original === undefined) delete process.env.DESKTOP_ACTIVATION_PIN_SECRET
    else process.env.DESKTOP_ACTIVATION_PIN_SECRET = original
  }
}

async function assertNoResidualActivePins() {
  const count = await prisma.desktopActivationPin.count({
    where: {
      tenantId: { in: Array.from(createdTenantIds) },
      activeSlot: 'ACTIVE',
    },
  })
  assert.equal(count, 0, 'cleanup should leave no active PINs for test tenants')
}

async function cleanup() {
  const tenantIds = Array.from(createdTenantIds)
  const opsAdminIds = Array.from(createdOpsAdminIds)
  if (tenantIds.length > 0) {
    await prisma.desktopActivationAudit.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.desktopActivationPin.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.desktopDevice.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.subscriptionEvent.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.userStoreRole.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.store.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } })
  }
  if (opsAdminIds.length > 0) {
    await prisma.opsAdmin.deleteMany({ where: { id: { in: opsAdminIds } } })
  }
}

async function main() {
  await assertCatalogObjects()
  await assertHistoricalFixtureCompatible()
  await testAuthorizationLookupAndNoStore()
  await testOpsIssuanceAttributionAndPinLifecycle()
  await testSubscriptionBlocksAndDeniedAudit()
  await testActiveAndMerchantRegression()
  await testConcurrencyAndControlledRollback()
  await testNoStoreSecretFailure()
  await cleanup()
  await assertNoResidualActivePins()
  console.log('desktop activation PIN console API database tests passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
  })
