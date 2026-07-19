import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
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

function request(url: string, init?: NextRequestInit) {
  return new NextRequest(url, init)
}

async function opsRequest(role: 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD', init?: NextRequestInit) {
  const suffix = randomUUID().slice(0, 8)
  const admin = await prisma.opsAdmin.create({
    data: {
      name: `${role} ${suffix}`,
      username: `ops-${role.toLowerCase()}-${suffix}`,
      role,
      status: 'ACTIVE',
    },
  })
  const token = signSession({
    tenantId: '_ops',
    userId: admin.id,
    storeId: '',
    role: 'OWNER',
    opsRole: role,
    opsSessionVersion: admin.sessionVersion,
  })
  return request('http://localhost/api/ops/desktop-activation', {
    ...init,
    headers: {
      cookie: `auth-session=${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function merchantOwnerRequest(input: { tenantId: string; storeId: string; userId: string }) {
  return request('http://localhost/api/ops/desktop-activation', {
    headers: {
      'x-tenant-id': input.tenantId,
      'x-store-id': input.storeId,
      'x-user-id': input.userId,
      'x-role': 'OWNER',
    },
  })
}

async function seedStore(subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED') {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: {
      name: `pin-console tenant ${suffix}`,
      status: 'ACTIVE',
      tier: 'STANDARD',
    },
  })
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
  await prisma.userStoreRole.create({
    data: {
      tenantId: tenant.id,
      userId: owner.id,
      storeId: store.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })
  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      status: subscriptionStatus,
    },
  })
  return { tenant, store, owner }
}

async function lookup(storeCode: string, role: 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD' = 'OPS_ADMIN') {
  const req = await opsRequest(role)
  return GET(new NextRequest(`http://localhost/api/ops/desktop-activation?storeCode=${encodeURIComponent(storeCode)}`, {
    headers: req.headers,
  }))
}

async function issue(storeCode: string, role: 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD' = 'OPS_ADMIN') {
  return POST(await opsRequest(role, {
    method: 'POST',
    body: JSON.stringify({ storeCode }),
  }))
}

async function testAuthorizationAndLookup() {
  const { tenant, store, owner } = await seedStore('ACTIVE')

  const unauth = await GET(request(`http://localhost/api/ops/desktop-activation?storeCode=${store.code}`))
  assert.equal(unauth.status, 403)
  assert.equal(unauth.headers.get('cache-control'), 'no-store, max-age=0')

  const merchant = await GET(await merchantOwnerRequest({ tenantId: tenant.id, storeId: store.id, userId: owner.id }))
  assert.equal(merchant.status, 403, 'merchant OWNER must not access ops PIN console API')

  const bd = await lookup(store.code, 'BD')
  assert.equal(bd.status, 403, 'BD role must not generate activation PINs')

  const invalid = await lookup('bad code')
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error, 'INVALID_STORE_CODE')

  const missing = await lookup(`NO-${randomUUID().slice(0, 8)}`)
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error, 'STORE_NOT_FOUND')

  const found = await lookup(store.code)
  assert.equal(found.status, 200)
  assert.equal(found.headers.get('cache-control'), 'no-store, max-age=0')
  const body = await found.json()
  assert.equal(body.store.code, store.code)
  assert.equal(body.tenant.name, tenant.name)
  assert.equal(body.subscription.status, 'ACTIVE')
  assert.equal(body.activePin, null)
}

async function testIssuePinAndRevokePrevious() {
  const { tenant, store } = await seedStore('TRIAL')

  const first = await issue(store.code)
  assert.equal(first.status, 201)
  assert.equal(first.headers.get('cache-control'), 'no-store, max-age=0')
  const firstBody = await first.json()
  assert.match(firstBody.pin, /^\d{6}$/)
  assert.equal('deviceToken' in firstBody, false)
  assert.equal('tokenHash' in firstBody, false)
  assert.equal('pinHash' in firstBody, false)
  assert.equal(firstBody.subscription.status, 'TRIAL')
  assert.equal(firstBody.replacedActivePin, false)

  const firstRow = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: firstBody.pinId } })
  assert.notEqual(firstRow.pinHash, firstBody.pin, 'database must not store raw PIN')
  assert.equal(firstRow.status, 'ACTIVE')
  assert.equal(firstRow.activeSlot, 'ACTIVE')

  const firstAudit = await prisma.desktopActivationAudit.findFirst({
    where: { tenantId: tenant.id, storeId: store.id, pinId: firstBody.pinId, eventType: 'PIN_CREATED' },
  })
  assert.ok(firstAudit, 'PIN_CREATED audit should be written')
  assert.equal(firstAudit.reasonCode, 'OPS_ISSUED')
  assert.equal(JSON.stringify(firstAudit.metadata ?? {}).includes(firstBody.pin), false, 'audit metadata must not contain raw PIN')

  const second = await issue(store.code)
  assert.equal(second.status, 201)
  const secondBody = await second.json()
  assert.equal(secondBody.replacedActivePin, true)

  const revokedFirstRow = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: firstBody.pinId } })
  assert.equal(revokedFirstRow.status, 'REVOKED')
  assert.equal(revokedFirstRow.activeSlot, null)

  const activePins = await prisma.desktopActivationPin.findMany({
    where: { storeId: store.id, activeSlot: 'ACTIVE' },
  })
  assert.equal(activePins.length, 1, 'only one active PIN should remain')
  assert.equal(activePins[0].id, secondBody.pinId)
}

async function testSubscriptionBlocks() {
  for (const subscriptionStatus of ['EXPIRED', 'CANCELLED'] as const) {
    const { tenant, store } = await seedStore(subscriptionStatus)
    const response = await issue(store.code)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
    const body = await response.json()
    assert.equal(body.error, 'SUBSCRIPTION_BLOCKED')
    assert.equal(body.subscription.status, subscriptionStatus)

    const activePins = await prisma.desktopActivationPin.findMany({
      where: { storeId: store.id, activeSlot: 'ACTIVE' },
    })
    assert.equal(activePins.length, 0)

    const audit = await prisma.desktopActivationAudit.findFirst({
      where: { tenantId: tenant.id, storeId: store.id, eventType: 'PIN_CREATE_DENIED' },
    })
    assert.ok(audit, 'blocked PIN creation should be audited')
    assert.equal(audit.reasonCode, 'SUBSCRIPTION_BLOCKED')
  }
}

async function main() {
  await testAuthorizationAndLookup()
  await testIssuePinAndRevokePrevious()
  await testSubscriptionBlocks()
  console.log('desktop activation PIN console API database tests passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
