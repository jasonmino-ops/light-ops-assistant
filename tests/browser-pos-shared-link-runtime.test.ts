import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import { authorizeBrowserPosDevice } from '../lib/browser-pos-device'
import { openBrowserPosBindingDelivery } from '../lib/browser-pos-binding-delivery'
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
  await prisma.browserPosBindingDelivery.deleteMany({ where: { tenantId: fixture.tenantId } })
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

function bindingAttemptId() {
  return `attempt-${randomUUID()}`
}

async function bind(requestId: string, deviceId: string, attemptId: string, deviceName = '收银台 A') {
  return bindSharedLink(
    request(`/api/cashier/device-authorization/${requestId}/bind`, { deviceId, deviceName, bindingAttemptId: attemptId }),
    { params: Promise.resolve({ requestId }) },
  )
}

async function testDeliverySecretConfigurationFailsBeforeIssuance() {
  assert.ok(fixture)
  const link = await createLink()
  const deviceId = `missing-delivery-secret-${randomUUID()}`
  const originalAuthSecret = process.env.AUTH_SECRET
  delete process.env.AUTH_SECRET
  try {
    const response = await bind(link.requestId, deviceId, bindingAttemptId())
    assert.equal(response.status, 503, 'missing AUTH_SECRET must reject binding before token issuance')
    assert.equal((await response.json()).error, 'DELIVERY_NOT_CONFIGURED')
    assert.equal(
      await prisma.browserPosDevice.count({ where: { tenantId: fixture.tenantId, browserDeviceId: deviceId } }),
      0,
      'missing delivery configuration must not create or activate a BrowserPosDevice',
    )
    const challenge = await prisma.operationLog.findFirstOrThrow({ where: { requestId: link.requestId } })
    assert.equal(challenge.status, 'FAILED', 'missing delivery configuration must not consume the challenge')
  } finally {
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalAuthSecret
  }
}

async function testIdempotentBindingAndDeliveryReplay() {
  assert.ok(fixture)
  const link = await createLink()
  const deviceId = `browser-${randomUUID()}`
  const attemptId = bindingAttemptId()
  const [first, second] = await Promise.all([
    bind(link.requestId, deviceId, attemptId),
    bind(link.requestId, deviceId, attemptId),
  ])
  assert.equal(first.status, 200, 'first idempotent request must bind')
  const secondFailure = second.status === 200 ? null : await second.clone().json()
  assert.equal(second.status, 200, `same attemptId concurrent retry must replay: ${JSON.stringify(secondFailure)}`)
  const initiallyBound = await first.json()
  const bound = await second.json()
  assert.equal(initiallyBound.status, 'BOUND')
  assert.equal(bound.status, 'BOUND')
  assert.match(bound.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(bound.token, initiallyBound.token, 'same attemptId must return the exact original credential')
  assert.equal(first.headers.get('set-cookie'), null, 'shared binding must not establish an OWNER session')
  assert.equal(second.headers.get('set-cookie'), null, 'delivery replay must not establish an OWNER session')

  // Deliberately discard the initial response result, then retry with the same
  // attemptId: this is the actual lost-response recovery contract.
  const replay = await bind(link.requestId, deviceId, attemptId)
  assert.equal(replay.status, 200)
  const replayed = await replay.json()
  assert.equal(replayed.token, initiallyBound.token, 'lost-response retry must not rotate or invalidate the first token')

  const wrongDevice = await bind(link.requestId, `other-browser-${randomUUID()}`, attemptId)
  assert.equal(wrongDevice.status, 409, 'a different browserDeviceId must never replay delivery')
  const wrongAttempt = await bind(link.requestId, deviceId, bindingAttemptId())
  assert.equal(wrongAttempt.status, 409, 'a different bindingAttemptId cannot claim the challenge')

  const challenge = await prisma.operationLog.findFirstOrThrow({
    where: { requestId: link.requestId, actionType: 'POS_DEVICE_AUTH_REQUEST' },
  })
  assert.equal(challenge.status, 'SUCCESS', 'consumed challenge must be persisted as successful only with the bind')
  assert.equal(challenge.targetId, deviceId)
  const payloadText = JSON.stringify(challenge.payloadSnapshot)
  assert.doesNotMatch(payloadText, new RegExp(initiallyBound.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'initial raw token must never be persisted in challenge audit data')
  assert.doesNotMatch(payloadText, /tokenHash/i, 'challenge audit data must not expose a token hash')

  const devices = await prisma.browserPosDevice.findMany({
    where: { tenantId: fixture.tenantId, storeId: fixture.storeAId, browserDeviceId: deviceId },
  })
  assert.equal(devices.length, 1, 'idempotent bind and replay must leave exactly one BrowserPosDevice')
  assert.equal(devices[0].status, 'ACTIVE')
  assert.equal(devices[0].displayName, '收银台 A')
  assert.ok(devices[0].browserInfo, 'server should retain minimal browser information for owner device management')
  assert.notEqual(devices[0].tokenHash, bound.token, 'only a token hash may be stored')
  assert.ok(devices[0].tokenHash.length >= 32)
  const delivery = await prisma.browserPosBindingDelivery.findUniqueOrThrow({ where: { requestId: link.requestId } })
  assert.equal(delivery.browserDeviceId, deviceId)
  assert.equal(delivery.bindingAttemptId, attemptId)
  assert.equal(delivery.browserPosDeviceId, devices[0].id)
  assert.equal(delivery.status, 'READY')
  assert.doesNotMatch(delivery.encryptedResult, new RegExp(bound.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'raw token must be encrypted at rest')
  assert.doesNotMatch(delivery.encryptedResult, /tokenHash/i, 'delivery record must not contain token hashes')
  const decrypted = openBrowserPosBindingDelivery(delivery.encryptedResult, {
    requestId: link.requestId,
    tenantId: fixture.tenantId,
    storeId: fixture.storeAId,
    browserDeviceId: deviceId,
    bindingAttemptId: attemptId,
  })
  assert.equal(decrypted?.token, bound.token)
  assert.equal(openBrowserPosBindingDelivery(delivery.encryptedResult, {
    requestId: `${link.requestId}-other`,
    tenantId: fixture.tenantId,
    storeId: fixture.storeAId,
    browserDeviceId: deviceId,
    bindingAttemptId: attemptId,
  }), null, 'delivery ciphertext must be bound to its original challenge')
  assert.equal(openBrowserPosBindingDelivery(delivery.encryptedResult, {
    requestId: link.requestId,
    tenantId: fixture.tenantId,
    storeId: fixture.storeBId,
    browserDeviceId: deviceId,
    bindingAttemptId: attemptId,
  }), null, 'delivery ciphertext must not replay across stores')

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

  const listed = await listBrowserDevices(request('/api/cashier/browser-devices', undefined, ownerAHeaders()))
  assert.equal(listed.status, 200)
  const listText = JSON.stringify(await listed.json())
  assert.doesNotMatch(listText, new RegExp(bound.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'device management must not expose raw device tokens')
  assert.match(listText, /收银台 A/)

  await prisma.browserPosBindingDelivery.update({
    where: { id: delivery.id },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  })
  const expiredDelivery = await bind(link.requestId, deviceId, attemptId)
  assert.equal(expiredDelivery.status, 409, 'expired delivery cannot be replayed indefinitely')
  assert.equal((await expiredDelivery.json()).error, 'DELIVERY_EXPIRED')
  const clearedDelivery = await prisma.browserPosBindingDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
  assert.equal(clearedDelivery.status, 'EXPIRED')
  assert.equal(clearedDelivery.encryptedResult, '', 'expired delivery clears its ciphertext on access')
  assert.equal(openBrowserPosBindingDelivery(clearedDelivery.encryptedResult, {
    requestId: link.requestId,
    tenantId: fixture.tenantId,
    storeId: fixture.storeAId,
    browserDeviceId: deviceId,
    bindingAttemptId: attemptId,
  }), null, 'cleared delivery ciphertext cannot be decrypted or replayed')

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

async function testDifferentAttemptConcurrentSingleWinner() {
  assert.ok(fixture)
  const link = await createLink()
  const deviceId = `concurrent-${randomUUID()}`
  const [first, second] = await Promise.all([
    bind(link.requestId, deviceId, bindingAttemptId()),
    bind(link.requestId, deviceId, bindingAttemptId()),
  ])
  const responses = [first, second]
  const successful = responses.filter((response) => response.status === 200)
  const rejected = responses.filter((response) => response.status === 409)
  assert.equal(successful.length, 1, 'different binding attempts must have exactly one challenge winner')
  assert.equal(rejected.length, 1, 'losing binding attempt must be rejected without token rotation')
  const winner = await successful[0].json() as { token: string }
  const delivery = await prisma.browserPosBindingDelivery.findUniqueOrThrow({ where: { requestId: link.requestId } })
  assert.ok(delivery.bindingAttemptId, 'winning binding attempt must be recorded')
  assert.doesNotMatch(delivery.encryptedResult, new RegExp(winner.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const devices = await prisma.browserPosDevice.findMany({
    where: { tenantId: fixture.tenantId, storeId: fixture.storeAId, browserDeviceId: deviceId },
  })
  assert.equal(devices.length, 1, 'different attempts must not create a second BrowserPosDevice')
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
  const expiredResponse = await bind(expired.requestId, expiredDeviceId, bindingAttemptId())
  assert.equal(expiredResponse.status, 410, 'expired link must not bind a device')
  assert.equal(await prisma.browserPosDevice.count({ where: { tenantId: fixture.tenantId, browserDeviceId: expiredDeviceId } }), 0)

  const used = await createLink()
  const usedDeviceId = `used-${randomUUID()}`
  const first = await bind(used.requestId, usedDeviceId, bindingAttemptId())
  assert.equal(first.status, 200)
  const second = await bind(used.requestId, usedDeviceId, bindingAttemptId())
  assert.equal(second.status, 409, 'a consumed link cannot be claimed by a second binding operation')
}

async function testChallengeExpiryDeterministicallyClearsDelivery() {
  assert.ok(fixture)

  const challengeExpired = await createLink()
  const challengeExpiredDeviceId = `expired-challenge-${randomUUID()}`
  const challengeExpiredAttemptId = bindingAttemptId()
  assert.equal((await bind(challengeExpired.requestId, challengeExpiredDeviceId, challengeExpiredAttemptId)).status, 200)
  const readyDelivery = await prisma.browserPosBindingDelivery.findUniqueOrThrow({ where: { requestId: challengeExpired.requestId } })
  assert.equal(readyDelivery.status, 'READY')
  assert.notEqual(readyDelivery.encryptedResult, '', 'unexpired delivery must remain replayable')
  assert.ok(readyDelivery.expiresAt > new Date(), 'test starts with a delivery TTL that has not expired')
  const challengeRow = await prisma.operationLog.findFirstOrThrow({ where: { requestId: challengeExpired.requestId } })
  await prisma.operationLog.update({
    where: { id: challengeRow.id },
    data: {
      payloadSnapshot: {
        ...(challengeRow.payloadSnapshot as Record<string, unknown>),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    },
  })
  const challengeExpiredReplay = await bind(challengeExpired.requestId, challengeExpiredDeviceId, challengeExpiredAttemptId)
  assert.equal(challengeExpiredReplay.status, 410, 'expired challenge must reject a replay')
  assert.equal((await challengeExpiredReplay.json()).error, 'CHALLENGE_EXPIRED')
  const clearedForChallengeExpiry = await prisma.browserPosBindingDelivery.findUniqueOrThrow({ where: { id: readyDelivery.id } })
  assert.equal(clearedForChallengeExpiry.status, 'EXPIRED')
  assert.equal(clearedForChallengeExpiry.encryptedResult, '', 'challenge expiry must clear an otherwise READY delivery')

  const bothExpired = await createLink()
  const bothExpiredDeviceId = `expired-both-${randomUUID()}`
  const bothExpiredAttemptId = bindingAttemptId()
  assert.equal((await bind(bothExpired.requestId, bothExpiredDeviceId, bothExpiredAttemptId)).status, 200)
  const bothDelivery = await prisma.browserPosBindingDelivery.findUniqueOrThrow({ where: { requestId: bothExpired.requestId } })
  const bothChallenge = await prisma.operationLog.findFirstOrThrow({ where: { requestId: bothExpired.requestId } })
  await prisma.browserPosBindingDelivery.update({
    where: { id: bothDelivery.id },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  })
  await prisma.operationLog.update({
    where: { id: bothChallenge.id },
    data: {
      payloadSnapshot: {
        ...(bothChallenge.payloadSnapshot as Record<string, unknown>),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    },
  })
  const bothExpiredReplay = await bind(bothExpired.requestId, bothExpiredDeviceId, bothExpiredAttemptId)
  assert.equal(bothExpiredReplay.status, 410, 'expired challenge and delivery must reject a replay')
  const clearedBothExpired = await prisma.browserPosBindingDelivery.findUniqueOrThrow({ where: { id: bothDelivery.id } })
  assert.equal(clearedBothExpired.status, 'EXPIRED')
  assert.equal(clearedBothExpired.encryptedResult, '', 'expired challenge and delivery must clear ciphertext deterministically')
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
  const replayed = await pollQrAuthorization(request(
    `/api/cashier/device-authorization/status?requestId=${encodeURIComponent(startBody.requestId)}&deviceId=${encodeURIComponent(deviceId)}`,
  ))
  assert.equal(replayed.status, 200)
  const replayedBody = await replayed.json()
  assert.equal(replayedBody.token, body.token, 'QR polling must reuse the same idempotent delivery result')
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
  const boundB = await bind(linkB.requestId, deviceBId, bindingAttemptId(), '收银台 B')
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
    await testDeliverySecretConfigurationFailsBeforeIssuance()
    await testIdempotentBindingAndDeliveryReplay()
    await testDifferentAttemptConcurrentSingleWinner()
    await testExpiredAndRepeatedLinksDoNotBind()
    await testChallengeExpiryDeterministicallyClearsDelivery()
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
