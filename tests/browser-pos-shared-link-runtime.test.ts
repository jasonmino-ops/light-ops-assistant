import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import { authorizeBrowserPosDevice } from '../lib/browser-pos-device'
import { POST as createSharedLink, GET as listBrowserDevices } from '../app/api/cashier/browser-devices/route'
import { POST as bindSharedLink } from '../app/api/cashier/device-authorization/[requestId]/bind/route'
import { POST as startQrAuthorization } from '../app/api/cashier/device-authorization/start/route'
import { POST as approveQrAuthorization } from '../app/api/cashier/device-authorization/[requestId]/route'
import { GET as pollQrAuthorization } from '../app/api/cashier/device-authorization/status/route'
import { POST as revokeBrowserDevice } from '../app/api/cashier/browser-devices/[id]/revoke/route'

if (process.env.BROWSER_POS_LINK_AUTH_TEST_DATABASE !== '1') {
  throw new Error('BROWSER_POS_LINK_AUTH_TEST_DATABASE=1 is required for Browser POS shared-link database tests')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Browser POS shared-link database tests')
}

type Fixture = {
  tenantId: string
  storeAId: string
  storeACode: string
  storeBId: string
  storeBCode: string
  ownerAId: string
  ownerBId: string
  staffAId: string
}

let fixture: Fixture | null = null

function sessionHeaders(userId: string, storeId: string, role: 'OWNER' | 'STAFF') {
  assert.ok(fixture)
  return {
    cookie: `auth-session=${signSession({
      tenantId: fixture.tenantId,
      userId,
      storeId,
      role,
    })}`,
  }
}

function ownerAHeaders() {
  assert.ok(fixture)
  return sessionHeaders(fixture.ownerAId, fixture.storeAId, 'OWNER')
}

function ownerBHeaders() {
  assert.ok(fixture)
  return sessionHeaders(fixture.ownerBId, fixture.storeBId, 'OWNER')
}

function staffAHeaders() {
  assert.ok(fixture)
  return sessionHeaders(fixture.staffAId, fixture.storeAId, 'STAFF')
}

function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://link-auth.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined
      ? { 'user-agent': 'browser-pos-shared-link-runtime-test', ...headers }
      : { 'content-type': 'application/json', 'user-agent': 'browser-pos-shared-link-runtime-test', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function seedFixture(): Promise<Fixture> {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({ data: { name: `Browser link ${suffix}`, status: 'ACTIVE', tier: 'STANDARD' } })
  const storeA = await prisma.store.create({
    data: { tenantId: tenant.id, code: `LINK-${suffix}`, name: 'Browser link store', status: 'ACTIVE' },
  })
  const storeB = await prisma.store.create({
    data: { tenantId: tenant.id, code: `LINK-B-${suffix}`, name: 'Browser link store B', status: 'ACTIVE' },
  })
  const ownerA = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `browser-link-owner-${suffix}`,
      displayName: 'Browser Link Owner',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })
  const ownerB = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `browser-link-owner-b-${suffix}`,
      displayName: 'Browser Link Owner B',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })
  const staffA = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `browser-link-staff-${suffix}`,
      displayName: 'Browser Link Staff A',
      role: 'STAFF',
      status: 'ACTIVE',
    },
  })
  await prisma.userStoreRole.create({
    data: { tenantId: tenant.id, storeId: storeA.id, userId: ownerA.id, role: 'OWNER', status: 'ACTIVE' },
  })
  await prisma.userStoreRole.create({
    data: { tenantId: tenant.id, storeId: storeB.id, userId: ownerB.id, role: 'OWNER', status: 'ACTIVE' },
  })
  await prisma.userStoreRole.create({
    data: { tenantId: tenant.id, storeId: storeA.id, userId: staffA.id, role: 'STAFF', status: 'ACTIVE' },
  })
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'ACTIVE' } })
  return {
    tenantId: tenant.id,
    storeAId: storeA.id,
    storeACode: storeA.code,
    storeBId: storeB.id,
    storeBCode: storeB.code,
    ownerAId: ownerA.id,
    ownerBId: ownerB.id,
    staffAId: staffA.id,
  }
}

async function cleanupFixture() {
  if (!fixture) return
  await prisma.operationLog.deleteMany({ where: { tenantId: fixture.tenantId } })
  await prisma.browserPosDevice.deleteMany({ where: { tenantId: fixture.tenantId } })
  await prisma.userStoreRole.deleteMany({ where: { tenantId: fixture.tenantId } })
  await prisma.tenantSubscription.deleteMany({ where: { tenantId: fixture.tenantId } })
  await prisma.user.deleteMany({ where: { tenantId: fixture.tenantId } })
  await prisma.store.deleteMany({ where: { tenantId: fixture.tenantId } })
  await prisma.tenant.deleteMany({ where: { id: fixture.tenantId } })
}

async function createLink(input?: { storeCode: string; headers: Record<string, string> }) {
  assert.ok(fixture)
  const response = await createSharedLink(request(
    '/api/cashier/browser-devices',
    { storeCode: input?.storeCode ?? fixture.storeACode },
    input?.headers ?? ownerAHeaders(),
  ))
  assert.equal(response.status, 201, 'owner should create a shared Browser POS link')
  const body = await response.json()
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i)
  assert.match(body.shareUrl, /\/cashier\/authorize\?requestId=/)
  assert.doesNotMatch(body.shareUrl, /pos-device-v1|x-pos-device-token|auth-session/i, 'shared link must not transport a long-lived credential or owner session')
  return body as { requestId: string; shareUrl: string; expiresAt: string }
}

async function bind(requestId: string, deviceId: string, deviceName = '收银台 A') {
  return bindSharedLink(
    request(`/api/cashier/device-authorization/${requestId}/bind`, { deviceId, deviceName }),
    { params: Promise.resolve({ requestId }) },
  )
}

async function testOneTimeAtomicBindingAndDeliveryRecovery() {
  assert.ok(fixture)
  const link = await createLink()
  const deviceId = `browser-${randomUUID()}`
  const [first, second] = await Promise.all([bind(link.requestId, deviceId), bind(link.requestId, deviceId)])
  const responses = [first, second]
  const successful = responses.filter((response) => response.status === 200)
  const rejected = responses.filter((response) => response.status === 409)
  assert.equal(successful.length, 1, 'only one concurrent shared-link redemption may succeed')
  assert.equal(rejected.length, 1, 'the second concurrent redemption must be rejected as used')

  // Deliberately do not save the first response token: this simulates a lost
  // HTTP response after the atomic bind transaction has committed.
  const initiallyBound = await successful[0].json()
  assert.equal(initiallyBound.status, 'BOUND')
  assert.match(initiallyBound.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(successful[0].headers.get('set-cookie'), null, 'shared binding must not establish an OWNER session')

  const initialChallenge = await prisma.operationLog.findFirstOrThrow({
    where: { requestId: link.requestId, actionType: 'POS_DEVICE_AUTH_REQUEST' },
  })
  assert.equal(initialChallenge.status, 'SUCCESS', 'consumed challenge must be persisted as successful only with the bind')
  assert.equal(initialChallenge.targetId, deviceId)
  // A retry is only admitted after the server-side concurrency grace. The
  // original response is intentionally discarded above, so this is the real
  // lost-delivery path rather than a fixture mutation.
  await new Promise((resolve) => setTimeout(resolve, 3_100))

  const wrongDevice = await bind(link.requestId, `other-browser-${randomUUID()}`)
  assert.equal(wrongDevice.status, 409, 'a different browserDeviceId must never recover a lost delivery')

  const recovery = await bind(link.requestId, deviceId)
  assert.equal(recovery.status, 200, 'the same bound browser must recover a lost token delivery once')
  const bound = await recovery.json()
  assert.equal(bound.status, 'BOUND')
  assert.match(bound.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.notEqual(bound.token, initiallyBound.token, 'recovery must rotate the browser credential')
  assert.equal(recovery.headers.get('set-cookie'), null, 'token recovery must not establish an OWNER session')

  const third = await bind(link.requestId, deviceId)
  assert.equal(third.status, 409, 'the controlled recovery path may only be used once')

  const challenge = await prisma.operationLog.findFirstOrThrow({ where: { id: initialChallenge.id } })
  const payloadText = JSON.stringify(challenge.payloadSnapshot)
  assert.equal((challenge.payloadSnapshot as { deliveryRecoveryCount?: number }).deliveryRecoveryCount, 1)
  assert.doesNotMatch(payloadText, new RegExp(initiallyBound.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'initial raw token must never be persisted in challenge audit data')
  assert.doesNotMatch(payloadText, new RegExp(bound.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'recovered raw token must never be persisted in challenge audit data')
  assert.doesNotMatch(payloadText, /tokenHash/i, 'challenge audit data must not expose a token hash')

  const devices = await prisma.browserPosDevice.findMany({
    where: { tenantId: fixture.tenantId, storeId: fixture.storeAId, browserDeviceId: deviceId },
  })
  assert.equal(devices.length, 1, 'initial bind and recovery must leave exactly one BrowserPosDevice')
  assert.equal(devices[0].status, 'ACTIVE')
  assert.equal(devices[0].displayName, '收银台 A')
  assert.ok(devices[0].browserInfo, 'server should retain minimal browser information for owner device management')
  assert.notEqual(devices[0].tokenHash, bound.token, 'only a token hash may be stored')
  assert.ok(devices[0].tokenHash.length >= 32)

  const transactionAuth = await authorizeBrowserPosDevice(
    request('/api/cashier/sales', undefined, {
      'x-pos-device-id': deviceId,
      'x-pos-device-token': bound.token,
    }),
    { tenantId: fixture.tenantId, storeId: fixture.storeAId, storeCode: fixture.storeACode },
    'POS_SALE_CREATE',
  )
  assert.equal(transactionAuth.ok, true, 'the bound token must enter the existing BrowserPosDevice transaction authorization path')
  if (transactionAuth.ok) {
    assert.equal(transactionAuth.authorization.principalId, devices[0].id)
    assert.equal(transactionAuth.authorization.authorizedByUserId, fixture.ownerAId)
    assert.equal('role' in transactionAuth.authorization, false, 'Browser device authorization must not synthesize an OWNER role')
  }

  const staleTokenAuth = await authorizeBrowserPosDevice(
    request('/api/cashier/sales', undefined, {
      'x-pos-device-id': deviceId,
      'x-pos-device-token': initiallyBound.token,
    }),
    { tenantId: fixture.tenantId, storeId: fixture.storeAId, storeCode: fixture.storeACode },
    'POS_SALE_CREATE',
  )
  assert.equal(staleTokenAuth.ok, false, 'recovery rotates the lost-response credential')

  const listed = await listBrowserDevices(request('/api/cashier/browser-devices', undefined, ownerAHeaders()))
  assert.equal(listed.status, 200)
  const listText = JSON.stringify(await listed.json())
  assert.doesNotMatch(listText, new RegExp(bound.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'device management must not expose raw device tokens')
  assert.match(listText, /收银台 A/)

  const revoked = await revokeBrowserDevice(
    request(`/api/cashier/browser-devices/${devices[0].id}/revoke`, { reason: 'shared-link test' }, ownerAHeaders()),
    { params: Promise.resolve({ id: devices[0].id }) },
  )
  assert.equal(revoked.status, 200, 'owner should revoke a shared-link BrowserPosDevice')
  const afterRevoke = await authorizeBrowserPosDevice(
    request('/api/cashier/sales', undefined, {
      'x-pos-device-id': deviceId,
      'x-pos-device-token': bound.token,
    }),
    { tenantId: fixture.tenantId, storeId: fixture.storeAId, storeCode: fixture.storeACode },
    'POS_SALE_CREATE',
  )
  assert.equal(afterRevoke.ok, false)
  if (!afterRevoke.ok) assert.equal(afterRevoke.error, 'BROWSER_DEVICE_REVOKED')
}

async function testExpiredAndRepeatedLinksDoNotBind() {
  assert.ok(fixture)
  const expired = await createLink()
  const row = await prisma.operationLog.findFirstOrThrow({ where: { requestId: expired.requestId } })
  await prisma.operationLog.update({
    where: { id: row.id },
    data: {
      payloadSnapshot: {
        ...(row.payloadSnapshot as Record<string, unknown>),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    },
  })
  const expiredDeviceId = `expired-${randomUUID()}`
  const expiredResponse = await bind(expired.requestId, expiredDeviceId)
  assert.equal(expiredResponse.status, 410, 'expired link must not bind a device')
  assert.equal(await prisma.browserPosDevice.count({ where: { tenantId: fixture.tenantId, browserDeviceId: expiredDeviceId } }), 0)

  const used = await createLink()
  const first = await bind(used.requestId, `used-${randomUUID()}`)
  assert.equal(first.status, 200)
  const second = await bind(used.requestId, `used-again-${randomUUID()}`)
  assert.equal(second.status, 409, 'a consumed link cannot bind a second browser')
}

async function testExistingQrChallengeRemainsAvailable() {
  assert.ok(fixture)
  const deviceId = `qr-${randomUUID()}`
  const started = await startQrAuthorization(request('/api/cashier/device-authorization/start', {
    storeCode: fixture.storeACode,
    deviceId,
    deviceName: 'QR 收银台',
  }))
  assert.equal(started.status, 201, 'existing QR challenge must remain available')
  const startBody = await started.json() as { requestId: string }

  const approved = await approveQrAuthorization(
    request(`/api/cashier/device-authorization/${startBody.requestId}`, { deviceName: 'QR 收银台' }, ownerAHeaders()),
    { params: Promise.resolve({ requestId: startBody.requestId }) },
  )
  assert.equal(approved.status, 200, 'owner approval must not require a new Browser Device system')

  const polled = await pollQrAuthorization(request(
    `/api/cashier/device-authorization/status?requestId=${encodeURIComponent(startBody.requestId)}&deviceId=${encodeURIComponent(deviceId)}`,
  ))
  assert.equal(polled.status, 200)
  const body = await polled.json()
  assert.equal(body.status, 'APPROVED')
  assert.ok(body.token, 'the requesting browser alone should receive the raw QR credential')
  const challenge = await prisma.operationLog.findFirstOrThrow({
    where: { requestId: startBody.requestId, actionType: 'POS_DEVICE_AUTH_REQUEST' },
  })
  assert.equal(challenge.status, 'SUCCESS')
  assert.equal(challenge.targetId, deviceId)
  assert.doesNotMatch(JSON.stringify(challenge.payloadSnapshot), new RegExp(body.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

async function testStoreScopedOwnerDeviceManagement() {
  assert.ok(fixture)
  const linkB = await createLink({ storeCode: fixture.storeBCode, headers: ownerBHeaders() })
  const deviceBId = `browser-b-${randomUUID()}`
  const boundB = await bind(linkB.requestId, deviceBId, '收银台 B')
  assert.equal(boundB.status, 200)
  const boundBBody = await boundB.json() as { token: string }
  const deviceB = await prisma.browserPosDevice.findFirstOrThrow({
    where: { tenantId: fixture.tenantId, storeId: fixture.storeBId, browserDeviceId: deviceBId },
  })

  const listedA = await listBrowserDevices(request('/api/cashier/browser-devices', undefined, ownerAHeaders()))
  assert.equal(listedA.status, 200)
  const listedABody = await listedA.json() as { devices: Array<{ id: string; storeCode: string }> }
  assert.ok(listedABody.devices.every((device) => device.storeCode === fixture!.storeACode), 'store A owner may only list store A devices')
  assert.equal(listedABody.devices.some((device) => device.id === deviceB.id), false, 'store A owner must not see store B device')

  const crossList = await listBrowserDevices(request(
    '/api/cashier/browser-devices',
    undefined,
    sessionHeaders(fixture.ownerAId, fixture.storeBId, 'OWNER'),
  ))
  assert.equal(crossList.status, 403, 'cross-store OWNER context without active membership must be rejected')

  const staffList = await listBrowserDevices(request('/api/cashier/browser-devices', undefined, staffAHeaders()))
  assert.equal(staffList.status, 403, 'STAFF must not manage Browser POS devices')
  const anonymousList = await listBrowserDevices(request('/api/cashier/browser-devices'))
  assert.equal(anonymousList.status, 401, 'unauthenticated callers must not manage Browser POS devices')
  const deviceTokenList = await listBrowserDevices(request('/api/cashier/browser-devices', undefined, {
    'x-pos-device-id': deviceBId,
    'x-pos-device-token': boundBBody.token,
  }))
  assert.equal(deviceTokenList.status, 401, 'Browser device credentials must not manage devices')

  const crossRevoke = await revokeBrowserDevice(
    request(`/api/cashier/browser-devices/${deviceB.id}/revoke`, { reason: 'cross-store attempt' }, ownerAHeaders()),
    { params: Promise.resolve({ id: deviceB.id }) },
  )
  assert.equal(crossRevoke.status, 404, 'store A owner must not revoke store B device')
  const afterCrossRevoke = await prisma.browserPosDevice.findUniqueOrThrow({ where: { id: deviceB.id } })
  assert.equal(afterCrossRevoke.status, 'ACTIVE')

  const staffRevoke = await revokeBrowserDevice(
    request(`/api/cashier/browser-devices/${deviceB.id}/revoke`, { reason: 'staff attempt' }, staffAHeaders()),
    { params: Promise.resolve({ id: deviceB.id }) },
  )
  assert.equal(staffRevoke.status, 403)
  const anonymousRevoke = await revokeBrowserDevice(
    request(`/api/cashier/browser-devices/${deviceB.id}/revoke`, { reason: 'anonymous attempt' }),
    { params: Promise.resolve({ id: deviceB.id }) },
  )
  assert.equal(anonymousRevoke.status, 401)

  const revokeB = await revokeBrowserDevice(
    request(`/api/cashier/browser-devices/${deviceB.id}/revoke`, { reason: 'store B owner' }, ownerBHeaders()),
    { params: Promise.resolve({ id: deviceB.id }) },
  )
  assert.equal(revokeB.status, 200, 'same-store owner can still revoke one device without affecting other devices')
}

async function main() {
  const mutableEnv = process.env as unknown as Record<string, string | undefined>
  const originalNodeEnv = mutableEnv.NODE_ENV
  mutableEnv.NODE_ENV = 'production'
  fixture = await seedFixture()
  try {
    await testOneTimeAtomicBindingAndDeliveryRecovery()
    await testExpiredAndRepeatedLinksDoNotBind()
    await testExistingQrChallengeRemainsAvailable()
    await testStoreScopedOwnerDeviceManagement()
    console.log('Browser POS shared-link runtime database tests passed')
  } finally {
    await cleanupFixture()
    fixture = null
    if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV
    else mutableEnv.NODE_ENV = originalNodeEnv
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
