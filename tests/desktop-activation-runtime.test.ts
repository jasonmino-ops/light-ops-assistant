import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { createActivationPin, hashActivationPin, hashDesktopDeviceToken } from '../lib/desktop-activation/crypto'
import { activateDesktopDevice } from '../lib/desktop-activation/service'
import { getDesktopDeviceContext } from '../lib/desktop-activation/auth'
import { POST as revokeDevice } from '../app/api/desktop/devices/[id]/revoke/route'

if (process.env.DESKTOP_ACTIVATION_TEST_DATABASE !== '1') {
  throw new Error('DESKTOP_ACTIVATION_TEST_DATABASE=1 is required for real database activation tests')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for real database activation tests')
}
if (!process.env.DESKTOP_DEVICE_TOKEN_SECRET || !process.env.DESKTOP_ACTIVATION_PIN_SECRET) {
  throw new Error('Desktop activation test secrets are required')
}

const createdTenantIds = new Set<string>()

function activationRequest() {
  return new NextRequest('http://localhost/api/desktop/activate', {
    headers: {
      'user-agent': 'desktop-activation-runtime-test',
      'x-real-ip': '127.0.0.1',
    },
  })
}

function bearerRequest(token: string) {
  return new NextRequest('http://localhost/api/desktop/auth/verify', {
    headers: {
      authorization: `Bearer ${token}`,
      'user-agent': 'desktop-activation-runtime-test',
    },
  })
}

function ownerRequest(input: { tenantId: string; storeId: string; userId: string; body?: unknown }) {
  return new NextRequest('http://localhost/api/desktop/devices/revoke', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': input.tenantId,
      'x-store-id': input.storeId,
      'x-user-id': input.userId,
      'x-role': 'OWNER',
    },
    body: JSON.stringify(input.body ?? {}),
  })
}

async function seedTenant(prefix: string) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: {
      name: `${prefix} tenant ${suffix}`,
      status: 'ACTIVE',
      tier: 'STANDARD',
    },
  })
  createdTenantIds.add(tenant.id)
  const store = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      code: `${prefix}-${suffix}`,
      name: `${prefix} store`,
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
      status: 'ACTIVE',
    },
  })
  return { tenant, store, owner }
}

async function createPin(input: { tenantId: string; storeId: string; ownerId: string; pin?: string }) {
  const pin = input.pin ?? createActivationPin()
  const row = await prisma.desktopActivationPin.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      pinHash: hashActivationPin({ tenantId: input.tenantId, storeId: input.storeId, pin }),
      pinHashVersion: 1,
      status: 'ACTIVE',
      activeSlot: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdByUserId: input.ownerId,
    },
  })
  return { pin, row }
}

async function testSuccessfulActivationAndRotation() {
  const { tenant, store, owner } = await seedTenant('rt-success')
  const { pin, row: pinRow } = await createPin({ tenantId: tenant.id, storeId: store.id, ownerId: owner.id, pin: '123456' })
  const installationId = `installation-${randomUUID()}`

  const first = await activateDesktopDevice({
    req: activationRequest(),
    store: { id: store.id, code: store.code, tenantId: tenant.id },
    pin,
    installationId,
  })
  assert.equal(first.ok, true, 'first activation should succeed')
  assert.match(first.deviceToken, /^edt_v1_[A-Za-z0-9_-]{40,128}$/)

  const consumedPin = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: pinRow.id } })
  assert.equal(consumedPin.status, 'USED')
  assert.equal(consumedPin.activeSlot, null)
  assert.equal(consumedPin.usedByDeviceId, first.device.id)

  const device = await prisma.desktopDevice.findUniqueOrThrow({ where: { id: first.device.id } })
  assert.equal(device.status, 'ACTIVE')
  assert.equal(device.tokenHash, hashDesktopDeviceToken(first.deviceToken))
  assert.notEqual(device.tokenHash, first.deviceToken)
  assert.equal(device.tokenHashVersion, 1)
  assert.equal(device.tokenVersion, 1)

  const verify = await getDesktopDeviceContext(bearerRequest(first.deviceToken))
  assert.equal(verify.ok, true, 'fresh token should verify')

  const activatedAudit = await prisma.desktopActivationAudit.findFirst({
    where: { tenantId: tenant.id, deviceId: device.id, eventType: 'DEVICE_ACTIVATED' },
  })
  assert.ok(activatedAudit, 'DEVICE_ACTIVATED audit should be written')
  assert.deepEqual(activatedAudit.metadata, {
    credentialVersion: 1,
    reusedDevice: false,
    replacesDeviceId: null,
  })

  const { pin: rotatePin } = await createPin({ tenantId: tenant.id, storeId: store.id, ownerId: owner.id, pin: '654321' })
  const rotated = await activateDesktopDevice({
    req: activationRequest(),
    store: { id: store.id, code: store.code, tenantId: tenant.id },
    pin: rotatePin,
    installationId,
  })
  assert.equal(rotated.ok, true, 'same-store reactivation should succeed')
  assert.equal(rotated.device.id, device.id)
  assert.notEqual(rotated.deviceToken, first.deviceToken)

  const rotatedDevice = await prisma.desktopDevice.findUniqueOrThrow({ where: { id: device.id } })
  assert.equal(rotatedDevice.tokenHashVersion, 1)
  assert.equal(rotatedDevice.tokenVersion, 2)
  assert.equal(rotatedDevice.tokenHash, hashDesktopDeviceToken(rotated.deviceToken))

  for (const eventType of ['DEVICE_REACTIVATED', 'TOKEN_ROTATED']) {
    const audit = await prisma.desktopActivationAudit.findFirst({
      where: { tenantId: tenant.id, deviceId: device.id, eventType },
    })
    assert.ok(audit, `${eventType} audit should be written`)
    const metadata = audit.metadata as { credentialVersion?: number } | null
    assert.equal(metadata?.credentialVersion, 2)
  }

  const secondStore = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      code: `rt-cross-${randomUUID().slice(0, 8)}`,
      name: 'Cross store',
      status: 'ACTIVE',
    },
  })
  const { pin: crossStorePin } = await createPin({ tenantId: tenant.id, storeId: secondStore.id, ownerId: owner.id })
  const crossStore = await activateDesktopDevice({
    req: activationRequest(),
    store: { id: secondStore.id, code: secondStore.code, tenantId: tenant.id },
    pin: crossStorePin,
    installationId,
  })
  assert.equal(crossStore.ok, false)
  assert.equal(crossStore.status, 409)
  assert.equal(crossStore.error, 'INSTALLATION_BOUND_TO_OTHER_STORE')

  const revokeResponse = await revokeDevice(
    ownerRequest({ tenantId: tenant.id, storeId: store.id, userId: owner.id, body: { reason: 'runtime test' } }),
    { params: Promise.resolve({ id: device.id }) },
  )
  assert.equal(revokeResponse.status, 200)
  const revokedDevice = await prisma.desktopDevice.findUniqueOrThrow({ where: { id: device.id } })
  assert.equal(revokedDevice.status, 'REVOKED')
  assert.equal(revokedDevice.activeSlot, null)
  assert.equal(revokedDevice.tokenHash, hashDesktopDeviceToken(rotated.deviceToken))

  const revokedVerify = await getDesktopDeviceContext(bearerRequest(rotated.deviceToken))
  assert.equal(revokedVerify.ok, false)
  assert.equal(revokedVerify.status, 403)
  assert.equal(revokedVerify.error, 'DESKTOP_DEVICE_REVOKED')
}

async function testConcurrentActivation() {
  const { tenant, store, owner } = await seedTenant('rt-concurrent')
  const { pin, row: pinRow } = await createPin({ tenantId: tenant.id, storeId: store.id, ownerId: owner.id, pin: '222222' })

  const [one, two] = await Promise.all([
    activateDesktopDevice({
      req: activationRequest(),
      store: { id: store.id, code: store.code, tenantId: tenant.id },
      pin,
      installationId: `installation-${randomUUID()}`,
    }),
    activateDesktopDevice({
      req: activationRequest(),
      store: { id: store.id, code: store.code, tenantId: tenant.id },
      pin,
      installationId: `installation-${randomUUID()}`,
    }),
  ])

  const results = [one, two]
  const successes = results.filter((result) => result.ok)
  const failures = results.filter((result) => !result.ok)
  assert.equal(successes.length, 1, 'exactly one concurrent activation should succeed')
  assert.equal(failures.length, 1, 'exactly one concurrent activation should fail')
  assert.notEqual((failures[0] as { status: number }).status, 500)

  const activeDevices = await prisma.desktopDevice.findMany({
    where: { tenantId: tenant.id, storeId: store.id, status: 'ACTIVE' },
  })
  assert.equal(activeDevices.length, 1, 'only one active device should be created')

  const consumedPin = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: pinRow.id } })
  assert.equal(consumedPin.status, 'USED')
  assert.equal(consumedPin.activeSlot, null)

  const tokens = successes.map((result) => result.deviceToken)
  assert.equal(new Set(tokens).size, 1, 'only one token should be issued')
}

async function cleanupRuntimeFixtures() {
  const tenantIds = Array.from(createdTenantIds)
  if (tenantIds.length === 0) return

  await prisma.$transaction(async (tx) => {
    await tx.desktopActivationAudit.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.desktopActivationPin.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.desktopDevice.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.subscriptionEvent.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.tenantSubscription.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.userStoreRole.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.customerOrder.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.product.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.store.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } })
  })

  const residualCount = await prisma.tenant.count({ where: { id: { in: tenantIds } } })
  assert.equal(residualCount, 0, 'runtime test cleanup must remove every tracked tenant')
}

async function main() {
  await testSuccessfulActivationAndRotation()
  await testConcurrentActivation()
  console.log('desktop activation runtime database tests passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await cleanupRuntimeFixtures()
    } finally {
      await prisma.$disconnect()
    }
  })
