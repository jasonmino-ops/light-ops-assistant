import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
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

async function waitForBlockedDatabaseLocks(expectedAtLeast: number) {
  const monitor = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await monitor.connect()
  const deadline = Date.now() + 5_000
  try {
    while (Date.now() < deadline) {
      const result = await monitor.query<{ count: number }>(`
        SELECT COUNT(*)::int AS "count"
        FROM "pg_locks" AS "locks"
        JOIN "pg_stat_activity" AS "activity" ON "activity"."pid" = "locks"."pid"
        WHERE "activity"."datname" = current_database()
          AND NOT "granted"
          AND "locks"."pid" <> pg_backend_pid()
      `)
      if ((result.rows[0]?.count ?? 0) >= expectedAtLeast) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`timed out waiting for ${expectedAtLeast} blocked database lock(s)`)
  } finally {
    await monitor.end()
  }
}

function holdBrowserSessionLock(sessionId: string) {
  let releaseLock!: () => void
  let markLocked!: () => void
  const release = new Promise<void>((resolve) => { releaseLock = resolve })
  const locked = new Promise<void>((resolve) => { markLocked = resolve })
  const done = (async () => {
    const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await blocker.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT "id" FROM "BrowserPosDevice" WHERE "id" = $1 FOR UPDATE', [sessionId])
      markLocked()
      await release
      await blocker.query('COMMIT')
    } catch (error) {
      await blocker.query('ROLLBACK')
      throw error
    } finally {
      await blocker.end()
    }
  })()
  return { locked, done, release: releaseLock }
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

async function testDerivedSessionCannotOutliveDesktopAuthorization() {
  const seeded = await seedDesktopDevice('bridge-expiry-cap')
  const desktopExpiresAt = new Date(Date.now() + 60_000)
  await prisma.desktopDevice.update({
    where: { id: seeded.device.id },
    data: { tokenExpiresAt: desktopExpiresAt },
  })

  const issued = await issue(seeded.token)
  assert.equal(issued.response.status, 200)
  assert.equal(issued.body.expiresAt, desktopExpiresAt.toISOString())
  const payload = verifyPosDeviceToken(String(issued.body.token))
  assert.ok(payload?.browserPosSessionId)
  const persisted = await prisma.browserPosDevice.findUniqueOrThrow({
    where: { id: payload.browserPosSessionId },
  })
  assert.equal(persisted.tokenExpiresAt.toISOString(), desktopExpiresAt.toISOString())

  await prisma.tenantSubscription.update({
    where: { tenantId: seeded.tenant.id },
    data: { status: 'EXPIRED' },
  })
  const blocked = await issue(seeded.token)
  assert.equal(blocked.response.status, 403)
  assert.equal(blocked.body.error, 'SUBSCRIPTION_BLOCKED')
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
  const issuanceFirst = await seedDesktopDevice('bridge-race-issue-first')
  const initialIssue = await issue(issuanceFirst.token)
  assert.equal(initialIssue.response.status, 200)
  const initialPayload = verifyPosDeviceToken(String(initialIssue.body.token))
  assert.ok(initialPayload?.browserPosSessionId)
  const issueFirstLock = holdBrowserSessionLock(initialPayload.browserPosSessionId)
  await issueFirstLock.locked

  const issuancePromise = issueDesktopPosSession(sessionRequest(issuanceFirst.token))
  try {
    // Issuance owns DesktopDevice and is deliberately blocked replacing the
    // existing BrowserPosDevice. Revocation must queue behind that same row.
    await waitForBlockedDatabaseLocks(1)
    const revocationPromise = revokeDesktopDevice(
      ownerRevokeRequest({
        tenantId: issuanceFirst.tenant.id,
        storeId: issuanceFirst.store.id,
        userId: issuanceFirst.owner.id,
      }),
      { params: Promise.resolve({ id: issuanceFirst.device.id }) },
    )
    await waitForBlockedDatabaseLocks(2)
    issueFirstLock.release()

    const [issuance, revocation] = await Promise.all([
      issuancePromise,
      revocationPromise,
      issueFirstLock.done,
    ])

    assert.equal(issuance.status, 200)
    assert.equal(revocation.status, 200)
    const body = await issuance.json() as { browserDeviceId: string; storeCode: string; token: string }
    const probe = new NextRequest('http://localhost/api/cashier/access', {
      headers: {
        'x-pos-device-token': body.token,
        'x-pos-device-id': body.browserDeviceId,
      },
    })
    assert.equal(await verifyPosDeviceRequest(probe, {
      tenantId: issuanceFirst.tenant.id,
      storeId: issuanceFirst.store.id,
      storeCode: body.storeCode,
    }), null)
  } finally {
    issueFirstLock.release()
    await issueFirstLock.done
  }

  const issueFirstActive = await prisma.browserPosDevice.count({
    where: {
      browserDeviceId: `desktop-${issuanceFirst.device.id}`,
      status: 'ACTIVE',
      activeSlot: 'ACTIVE',
    },
  })
  assert.equal(issueFirstActive, 0, 'revocation queued after issuance must revoke the derived session')

  const revocationFirst = await seedDesktopDevice('bridge-race-revoke-first')
  const initialRevokeFirst = await issue(revocationFirst.token)
  assert.equal(initialRevokeFirst.response.status, 200)
  const revokeFirstPayload = verifyPosDeviceToken(String(initialRevokeFirst.body.token))
  assert.ok(revokeFirstPayload?.browserPosSessionId)
  const revokeFirstLock = holdBrowserSessionLock(revokeFirstPayload.browserPosSessionId)
  await revokeFirstLock.locked

  const revocationPromise = revokeDesktopDevice(
    ownerRevokeRequest({
      tenantId: revocationFirst.tenant.id,
      storeId: revocationFirst.store.id,
      userId: revocationFirst.owner.id,
    }),
    { params: Promise.resolve({ id: revocationFirst.device.id }) },
  )
  try {
    // Revocation owns DesktopDevice and is deliberately blocked cascading to
    // BrowserPosDevice. Issuance must queue, then observe REVOKED after commit.
    await waitForBlockedDatabaseLocks(1)
    const deniedIssuancePromise = issueDesktopPosSession(sessionRequest(revocationFirst.token))
    await waitForBlockedDatabaseLocks(2)
    revokeFirstLock.release()

    const [revocation, deniedIssuance] = await Promise.all([
      revocationPromise,
      deniedIssuancePromise,
      revokeFirstLock.done,
    ])
    assert.equal(revocation.status, 200)
    assert.equal(deniedIssuance.status, 403)
    const deniedBody = await deniedIssuance.json() as { error: string }
    assert.equal(deniedBody.error, 'DESKTOP_DEVICE_REVOKED')
  } finally {
    revokeFirstLock.release()
    await revokeFirstLock.done
  }

  const revokeFirstActive = await prisma.browserPosDevice.count({
    where: {
      browserDeviceId: `desktop-${revocationFirst.device.id}`,
      status: 'ACTIVE',
      activeSlot: 'ACTIVE',
    },
  })
  assert.equal(revokeFirstActive, 0, 'issuance queued after revocation must not create a session')
}

async function main() {
  await testValidContextAndReplacement()
  await testInvalidRevokedAndExpiredDenied()
  await testDerivedSessionCannotOutliveDesktopAuthorization()
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
