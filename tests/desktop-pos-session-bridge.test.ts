import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { createDesktopDeviceToken, hashInstallationId } from '../lib/desktop-activation/crypto'
import { verifyPosDeviceRequest, verifyPosDeviceToken } from '../lib/desktop-pos-auth'
import { POST as issueDesktopPosSession } from '../app/api/pos-session/desktop/route'
import { POST as revokeDesktopDevice } from '../app/api/desktop/devices/[id]/revoke/route'

if (process.env.DESKTOP_ACTIVATION_TEST_DATABASE !== '1') {
  throw new Error('DESKTOP_ACTIVATION_TEST_DATABASE=1 is required for real database bridge tests')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for real database bridge tests')
}
if (!process.env.DESKTOP_DEVICE_TOKEN_SECRET || !process.env.DESKTOP_ACTIVATION_PIN_SECRET || !process.env.AUTH_SECRET) {
  throw new Error('Desktop activation and POS session test secrets are required')
}

function sessionRequest(token: string, forgedScope?: { tenantId: string; storeId: string }) {
  return new NextRequest('http://localhost/api/pos-session/desktop', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(forgedScope ? {
        'x-tenant-id': forgedScope.tenantId,
        'x-store-id': forgedScope.storeId,
      } : {}),
    },
    body: forgedScope ? JSON.stringify({ ...forgedScope, storeCode: 'FORGED' }) : undefined,
  })
}

function ownerRevokeRequest(input: { tenantId: string; storeId: string; userId: string }) {
  return new NextRequest('http://localhost/api/desktop/devices/revoke', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': input.tenantId,
      'x-store-id': input.storeId,
      'x-user-id': input.userId,
      'x-role': 'OWNER',
    },
    body: JSON.stringify({ reason: 'bridge runtime test' }),
  })
}

async function seedDesktopDevice(prefix: string) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: { name: `${prefix} tenant ${suffix}`, status: 'ACTIVE', tier: 'STANDARD' },
  })
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
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'ACTIVE' } })

  const credential = createDesktopDeviceToken()
  const device = await prisma.desktopDevice.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      installationIdHash: hashInstallationId(`installation-${randomUUID()}`),
      status: 'ACTIVE',
      activeSlot: 'ACTIVE',
      tokenHash: credential.tokenHash,
      tokenHashVersion: credential.tokenHashVersion,
      tokenVersion: 1,
      tokenIssuedAt: credential.tokenIssuedAt,
      tokenExpiresAt: credential.tokenExpiresAt,
    },
  })
  return { tenant, store, owner, device, token: credential.token }
}

async function issue(token: string, forgedScope?: { tenantId: string; storeId: string }) {
  const response = await issueDesktopPosSession(sessionRequest(token, forgedScope))
  return { response, body: await response.json() as Record<string, unknown> }
}

async function testValidContextAndReplacement() {
  const seeded = await seedDesktopDevice('bridge-valid')
  const expectedDeviceId = `desktop-${seeded.device.id}`

  const first = await issue(seeded.token, { tenantId: 'forged-tenant', storeId: 'forged-store' })
  assert.equal(first.response.status, 200)
  assert.equal(first.body.browserDeviceId, expectedDeviceId)
  assert.equal(first.body.storeCode, seeded.store.code)
  assert.equal(typeof first.body.token, 'string')

  const firstPayload = verifyPosDeviceToken(String(first.body.token))
  assert.ok(firstPayload)
  assert.equal(firstPayload.tenantId, seeded.tenant.id)
  assert.equal(firstPayload.storeId, seeded.store.id)
  assert.equal(firstPayload.storeCode, seeded.store.code)
  assert.equal(firstPayload.deviceId, expectedDeviceId)
  assert.equal(firstPayload.issuedBy, 'DESKTOP_DEVICE')

  const persisted = await prisma.browserPosDevice.findUniqueOrThrow({
    where: { id: firstPayload.browserPosSessionId },
  })
  assert.equal(persisted.status, 'ACTIVE')
  assert.equal(persisted.activeSlot, 'ACTIVE')
  assert.equal(persisted.issuedByUserId, null, 'Desktop bridge must not invent operator attribution')

  const probe = new NextRequest('http://localhost/api/cashier/access', {
    headers: {
      'x-pos-device-token': String(first.body.token),
      'x-pos-device-id': expectedDeviceId,
    },
  })
  assert.ok(await verifyPosDeviceRequest(probe, {
    tenantId: seeded.tenant.id,
    storeId: seeded.store.id,
    storeCode: seeded.store.code,
  }))

  const second = await issue(seeded.token)
  assert.equal(second.response.status, 200)
  assert.notEqual(second.body.token, first.body.token)
  const rows = await prisma.browserPosDevice.findMany({
    where: { storeId: seeded.store.id, browserDeviceId: expectedDeviceId },
    orderBy: { createdAt: 'asc' },
  })
  assert.equal(rows.length, 2)
  assert.equal(rows.filter((row) => row.status === 'ACTIVE' && row.activeSlot === 'ACTIVE').length, 1)
  assert.equal(rows.filter((row) => row.revocationReason === 'SESSION_REPLACED').length, 1)
}

async function testInvalidRevokedAndExpiredDenied() {
  const invalid = await issue(`edt_v1_${'x'.repeat(43)}`)
  assert.equal(invalid.response.status, 401)

  const expired = await seedDesktopDevice('bridge-expired')
  await prisma.desktopDevice.update({
    where: { id: expired.device.id },
    data: { tokenExpiresAt: new Date(Date.now() - 1_000) },
  })
  const expiredResult = await issue(expired.token)
  assert.equal(expiredResult.response.status, 401)
  assert.equal(expiredResult.body.error, 'DESKTOP_TOKEN_EXPIRED')

  const revoked = await seedDesktopDevice('bridge-revoked')
  await prisma.desktopDevice.update({
    where: { id: revoked.device.id },
    data: { status: 'REVOKED', activeSlot: null, revokedAt: new Date() },
  })
  const revokedResult = await issue(revoked.token)
  assert.equal(revokedResult.response.status, 403)
  assert.equal(revokedResult.body.error, 'DESKTOP_DEVICE_REVOKED')
}

async function testRevokeCascade() {
  const seeded = await seedDesktopDevice('bridge-cascade')
  const issued = await issue(seeded.token)
  assert.equal(issued.response.status, 200)

  const response = await revokeDesktopDevice(
    ownerRevokeRequest({
      tenantId: seeded.tenant.id,
      storeId: seeded.store.id,
      userId: seeded.owner.id,
    }),
    { params: Promise.resolve({ id: seeded.device.id }) },
  )
  assert.equal(response.status, 200)

  const session = await prisma.browserPosDevice.findFirstOrThrow({
    where: { browserDeviceId: `desktop-${seeded.device.id}` },
  })
  assert.equal(session.status, 'REVOKED')
  assert.equal(session.activeSlot, null)
  assert.equal(session.revocationReason, 'DESKTOP_DEVICE_REVOKED')
  assert.equal(session.revokedByUserId, seeded.owner.id)
}

async function testIssuanceRevokeRaceFailsClosed() {
  const seeded = await seedDesktopDevice('bridge-race')
  const [issuance, revocation] = await Promise.all([
    issueDesktopPosSession(sessionRequest(seeded.token)),
    revokeDesktopDevice(
      ownerRevokeRequest({
        tenantId: seeded.tenant.id,
        storeId: seeded.store.id,
        userId: seeded.owner.id,
      }),
      { params: Promise.resolve({ id: seeded.device.id }) },
    ),
  ])

  assert.notEqual(issuance.status, 500)
  assert.equal(revocation.status, 200)
  const active = await prisma.browserPosDevice.count({
    where: {
      browserDeviceId: `desktop-${seeded.device.id}`,
      status: 'ACTIVE',
      activeSlot: 'ACTIVE',
    },
  })
  assert.equal(active, 0, 'no usable managed POS session may survive Desktop revocation')

  if (issuance.status === 200) {
    const body = await issuance.json() as { browserDeviceId: string; storeCode: string; token: string }
    const probe = new NextRequest('http://localhost/api/cashier/access', {
      headers: {
        'x-pos-device-token': body.token,
        'x-pos-device-id': body.browserDeviceId,
      },
    })
    assert.equal(await verifyPosDeviceRequest(probe, {
      tenantId: seeded.tenant.id,
      storeId: seeded.store.id,
      storeCode: body.storeCode,
    }), null)
  } else {
    assert.equal(issuance.status, 403)
  }
}

async function main() {
  await testValidContextAndReplacement()
  await testInvalidRevokedAndExpiredDenied()
  await testRevokeCascade()
  await testIssuanceRevokeRaceFailsClosed()
  console.log('desktop POS session bridge runtime database tests passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
