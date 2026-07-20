import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { createDesktopDeviceToken, hashInstallationId } from '../lib/desktop-activation/crypto'
import { signSession } from '../lib/session'
import { GET as managementGet } from '../app/api/ops/desktop-management/route'
import { POST as managementRevoke } from '../app/api/ops/desktop-management/devices/[id]/revoke/route'
import { POST as verifyDesktop } from '../app/api/desktop/auth/verify/route'
import { GET as desktopStatus } from '../app/api/desktop/device/status/route'

if (process.env.DESKTOP_ACTIVATION_TEST_DATABASE !== '1') {
  throw new Error('DESKTOP_ACTIVATION_TEST_DATABASE=1 is required for Desktop management database tests')
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Desktop management database tests')
if (!process.env.DESKTOP_DEVICE_TOKEN_SECRET || !process.env.DESKTOP_ACTIVATION_PIN_SECRET) {
  throw new Error('Desktop activation test secrets are required')
}

type OpsRole = 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD'
type Admin = { id: string; role: OpsRole; sessionVersion: number }

const tenantIds = new Set<string>()
const adminIds = new Set<string>()
const rollbackTrigger = 'test_fail_ops_desktop_revoke_audit'
const rollbackFunction = 'test_fail_ops_desktop_revoke_audit_fn'

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init)
}

function sessionToken(admin: Admin, overrides: { version?: number; role?: OpsRole } = {}) {
  return signSession({
    tenantId: '_ops',
    userId: admin.id,
    storeId: '',
    role: 'OWNER',
    opsRole: overrides.role ?? admin.role,
    opsSessionVersion: overrides.version ?? admin.sessionVersion,
  })
}

function legacyToken() {
  return signSession({ tenantId: '_ops', userId: '_ops_admin', storeId: '', role: 'OWNER' })
}

function ownerToken(userId: string) {
  return signSession({ tenantId: 'merchant', userId, storeId: '', role: 'OWNER' })
}

function cookie(token: string) {
  return { cookie: `auth-session=${token}` }
}

function managementRequest(view: string, token?: string, query = '') {
  return request(`http://localhost/api/ops/desktop-management?view=${view}${query}`, {
    headers: token ? cookie(token) : undefined,
  })
}

function revokeRequest(deviceRef: string, token?: string, body: unknown = { reason: 'Founder closure test' }) {
  return request(`http://localhost/api/ops/desktop-management/devices/${deviceRef}/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? cookie(token) : {}),
    },
    body: JSON.stringify(body),
  })
}

function bearerRequest(path: string, token: string, method: 'GET' | 'POST') {
  return request(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  })
}

async function createAdmin(role: OpsRole, status = 'ACTIVE') {
  const suffix = randomUUID().slice(0, 8)
  const admin = await prisma.opsAdmin.create({
    data: {
      name: `${role} ${suffix}`,
      username: `mgmt-${role.toLowerCase()}-${suffix}`,
      role,
      status,
    },
  })
  adminIds.add(admin.id)
  return admin as Admin
}

async function createTenant(prefix: string) {
  const suffix = randomUUID().slice(0, 8)
  const tenant = await prisma.tenant.create({
    data: { name: `${prefix} Tenant ${suffix}`, status: 'ACTIVE', tier: 'STANDARD' },
  })
  tenantIds.add(tenant.id)
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `${prefix}-owner-${suffix}`,
      displayName: `${prefix} Owner`,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'ACTIVE' } })
  return { tenant, owner }
}

async function createStore(tenantId: string, prefix: string) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
  return prisma.store.create({
    data: { tenantId, code: `${prefix}${suffix}`, name: `${prefix} Store ${suffix}`, status: 'ACTIVE' },
  })
}

async function createDevice(input: {
  tenantId: string
  storeId: string
  id?: string
  status?: 'ACTIVE' | 'REVOKED'
  lastSeenAt?: Date | null
}) {
  const now = new Date()
  const credential = createDesktopDeviceToken(now)
  const status = input.status ?? 'ACTIVE'
  const device = await prisma.desktopDevice.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      tenantId: input.tenantId,
      storeId: input.storeId,
      installationIdHash: hashInstallationId(`management-installation-${randomUUID()}`),
      status,
      activeSlot: status === 'ACTIVE' ? 'ACTIVE' : null,
      tokenHash: credential.tokenHash,
      tokenHashVersion: credential.tokenHashVersion,
      tokenIssuedAt: credential.tokenIssuedAt,
      tokenExpiresAt: credential.tokenExpiresAt,
      lastSeenAt: input.lastSeenAt === undefined ? now : input.lastSeenAt,
      revokedAt: status === 'REVOKED' ? now : null,
      revocationReason: status === 'REVOKED' ? 'Existing revocation' : null,
    },
  })
  return { device, token: credential.token, tokenHash: credential.tokenHash }
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys))
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}

function assertSafeBody(body: unknown, forbiddenValues: string[]) {
  const forbiddenKeys = ['pinHash', 'tokenHash', 'deviceToken', 'installationIdHash', 'metadata', 'cookie', 'connectionString']
  const keys = collectKeys(body)
  for (const key of forbiddenKeys) assert.equal(keys.has(key), false, `response must not contain ${key}`)
  const serialized = JSON.stringify(body)
  for (const value of forbiddenValues) assert.equal(serialized.includes(value), false, 'response leaked protected fixture material')
}

async function assertAuthMatrix(view: string, input: {
  ownerId: string
  opsToken: string
  superToken: string
  disabledToken: string
  staleToken: string
  lockedToken: string
}) {
  const cases = [
    { name: 'unauthenticated', token: undefined, status: 403 },
    { name: 'merchant owner', token: ownerToken(input.ownerId), status: 403 },
    { name: 'OPS_ADMIN', token: input.opsToken, status: 200 },
    { name: 'SUPER_ADMIN', token: input.superToken, status: 200 },
    { name: 'disabled OpsAdmin', token: input.disabledToken, status: 403 },
    { name: 'stale OpsAdmin', token: input.staleToken, status: 403 },
    { name: 'locked OpsAdmin', token: input.lockedToken, status: 403 },
    { name: 'legacy read identity', token: legacyToken(), status: 200 },
  ]
  for (const testCase of cases) {
    const response = await managementGet(managementRequest(view, testCase.token))
    assert.equal(response.status, testCase.status, `${view}: ${testCase.name}`)
    assertNoStore(response)
  }
}

async function seedManagementFixture(actorId: string) {
  const primary = await createTenant('Desktop Management')
  const firstStore = await createStore(primary.tenant.id, 'MGTA')
  const secondStore = await createStore(primary.tenant.id, 'MGTB')
  const firstDevice = await createDevice({
    tenantId: primary.tenant.id,
    storeId: firstStore.id,
    lastSeenAt: new Date(Date.now() - 5 * 60 * 1000),
  })
  await createDevice({ tenantId: primary.tenant.id, storeId: secondStore.id, lastSeenAt: null })
  const protectedMetadataValue = `metadata-secret-${randomUUID()}`
  await prisma.desktopActivationPin.create({
    data: {
      tenantId: primary.tenant.id,
      storeId: firstStore.id,
      pinHash: `pin-hash-${randomUUID()}`,
      pinHashVersion: 1,
      status: 'ACTIVE',
      activeSlot: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdByOpsAdminId: actorId,
    },
  })
  await prisma.desktopActivationAudit.create({
    data: {
      tenantId: primary.tenant.id,
      storeId: firstStore.id,
      deviceId: firstDevice.device.id,
      actorOpsAdminId: actorId,
      eventType: 'DEVICE_ACTIVATED',
      result: 'SUCCESS',
      reasonCode: 'TEST_FIXTURE',
      metadata: { secret: protectedMetadataValue, token: firstDevice.token },
    },
  })
  return { primary, firstStore, secondStore, firstDevice, protectedMetadataValue }
}

async function testManagementViews() {
  const ops = await createAdmin('OPS_ADMIN')
  const superAdmin = await createAdmin('SUPER_ADMIN')
  const disabled = await createAdmin('OPS_ADMIN')
  const stale = await createAdmin('OPS_ADMIN')
  const locked = await createAdmin('OPS_ADMIN')
  const disabledToken = sessionToken(disabled)
  const staleToken = sessionToken(stale)
  const lockedToken = sessionToken(locked)
  await prisma.opsAdmin.update({ where: { id: disabled.id }, data: { status: 'DISABLED' } })
  await prisma.opsAdmin.update({ where: { id: stale.id }, data: { sessionVersion: { increment: 1 } } })
  await prisma.opsAdmin.update({ where: { id: locked.id }, data: { lockedUntil: new Date(Date.now() + 60 * 60 * 1000) } })

  const fixture = await seedManagementFixture(ops.id)
  const auth = {
    ownerId: fixture.primary.owner.id,
    opsToken: sessionToken(ops),
    superToken: sessionToken(superAdmin),
    disabledToken,
    staleToken,
    lockedToken,
  }
  for (const view of ['activation', 'devices', 'audit', 'runtime']) await assertAuthMatrix(view, auth)

  const protectedValues = [fixture.firstDevice.token, fixture.firstDevice.tokenHash, fixture.protectedMetadataValue, fixture.firstDevice.device.id]
  const activation = await managementGet(managementRequest(
    'activation',
    auth.opsToken,
    `&query=${encodeURIComponent(fixture.primary.tenant.name)}&page=1&pageSize=1`,
  ))
  assert.equal(activation.status, 200)
  assertNoStore(activation)
  const activationBody = await activation.json()
  assert.equal(activationBody.pageSize, 1)
  assert.equal(activationBody.total, 2)
  assert.equal(activationBody.stores.length, 1)
  assert.equal(activationBody.stores[0].tenantName, fixture.primary.tenant.name)
  assert.equal(activationBody.stores[0].currentPinStatus, 'ACTIVE')
  assertSafeBody(activationBody, protectedValues)

  const pageBoundary = await managementGet(managementRequest('activation', auth.opsToken, '&pageSize=999'))
  const pageBoundaryBody = await pageBoundary.json()
  assert.equal(pageBoundaryBody.pageSize, 50, 'pageSize must be capped')

  const devices = await managementGet(managementRequest(
    'devices',
    auth.opsToken,
    `&query=${encodeURIComponent(fixture.firstStore.code)}&status=ACTIVE&page=1&pageSize=1`,
  ))
  const devicesBody = await devices.json()
  assertNoStore(devices)
  assert.equal(devicesBody.devices.length, 1)
  assert.equal(devicesBody.devices[0].storeCode, fixture.firstStore.code)
  assert.equal(devicesBody.devices[0].desktopVersion, null)
  assert.equal(devicesBody.devices[0].windowsVersion, null)
  assert.equal('lastHeartbeat' in devicesBody.devices[0], false)
  assertSafeBody(devicesBody, protectedValues)

  const audit = await managementGet(managementRequest(
    'audit',
    auth.superToken,
    `&query=${encodeURIComponent(fixture.firstStore.code)}&page=1&pageSize=20`,
  ))
  const auditBody = await audit.json()
  assertNoStore(audit)
  assert.ok(auditBody.events.some((event: { eventType: string; derived: boolean }) => event.eventType === 'DEVICE_ACTIVATED' && event.derived === false))
  assert.ok(auditBody.events.some((event: { eventType: string; derived: boolean }) => event.eventType === 'DESKTOP_VERIFIED' && event.derived === true))
  assertSafeBody(auditBody, protectedValues)

  const runtime = await managementGet(managementRequest(
    'runtime',
    auth.opsToken,
    `&query=${encodeURIComponent(fixture.firstStore.code)}`,
  ))
  const runtimeBody = await runtime.json()
  assertNoStore(runtime)
  assert.equal(runtimeBody.deviceCount, 1)
  assert.equal(runtimeBody.desktopTelemetry, 'NOT_REPORTED')
  assert.equal(runtimeBody.windowsTelemetry, 'NOT_REPORTED')
  assertSafeBody(runtimeBody, protectedValues)

  const unknown = await managementGet(managementRequest('not-a-view', auth.opsToken))
  assert.equal(unknown.status, 400)
  assertNoStore(unknown)
}

async function installRollbackTrigger() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "${rollbackFunction}"() RETURNS trigger AS $$
    BEGIN
      IF NEW."eventType" = 'DEVICE_REVOKED' THEN
        RAISE EXCEPTION 'forced test audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${rollbackTrigger}"
    BEFORE INSERT ON "DesktopActivationAudit"
    FOR EACH ROW EXECUTE FUNCTION "${rollbackFunction}"()
  `)
}

async function removeRollbackTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "DesktopActivationAudit"`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"()`)
}

async function testRevoke() {
  const admin = await createAdmin('OPS_ADMIN')
  const token = sessionToken(admin)
  const primary = await createTenant('Revoke Primary')
  const primaryStore = await createStore(primary.tenant.id, 'RVKA')
  const target = await createDevice({ tenantId: primary.tenant.id, storeId: primaryStore.id })
  const other = await createTenant('Revoke Other')
  const otherStore = await createStore(other.tenant.id, 'RVKB')
  const otherDevice = await createDevice({ tenantId: other.tenant.id, storeId: otherStore.id })
  const targetRef = target.device.id.slice(-8).toUpperCase()
  const reason = 'Founder review closure'

  const response = await managementRevoke(
    revokeRequest(targetRef, token, { reason, tenantId: other.tenant.id }),
    { params: Promise.resolve({ id: targetRef }) },
  )
  assert.equal(response.status, 200)
  assertNoStore(response)
  const body = await response.json()
  assert.deepEqual(Object.keys(body).sort(), ['deviceRef', 'ok', 'status'])
  assert.equal(body.status, 'REVOKED')

  const revoked = await prisma.desktopDevice.findUniqueOrThrow({ where: { id: target.device.id } })
  assert.equal(revoked.status, 'REVOKED')
  assert.equal(revoked.activeSlot, null)
  assert.equal(revoked.revocationReason, reason)
  assert.equal((await prisma.desktopDevice.findUniqueOrThrow({ where: { id: otherDevice.device.id } })).status, 'ACTIVE')
  const revokeAudits = await prisma.desktopActivationAudit.findMany({
    where: { deviceId: target.device.id, eventType: 'DEVICE_REVOKED' },
  })
  assert.equal(revokeAudits.length, 1)
  assert.equal(revokeAudits[0].actorOpsAdminId, admin.id)
  assert.equal(revokeAudits[0].reasonCode, 'OPS_REVOKED')

  const verify = await verifyDesktop(bearerRequest('/api/desktop/auth/verify', target.token, 'POST'))
  assert.equal(verify.status, 403)
  assert.equal((await verify.json()).error, 'DESKTOP_DEVICE_REVOKED')
  const status = await desktopStatus(bearerRequest('/api/desktop/device/status', target.token, 'GET'))
  assert.equal(status.status, 403)
  assert.equal((await status.json()).error, 'DESKTOP_DEVICE_REVOKED')

  const repeat = await managementRevoke(
    revokeRequest(targetRef, token, { reason: 'Must not replace original reason' }),
    { params: Promise.resolve({ id: targetRef }) },
  )
  assert.equal(repeat.status, 200)
  assert.equal(await prisma.desktopActivationAudit.count({ where: { deviceId: target.device.id, eventType: 'DEVICE_REVOKED' } }), 1)
  assert.equal((await prisma.desktopDevice.findUniqueOrThrow({ where: { id: target.device.id } })).revocationReason, reason)

  const nonOps = await managementRevoke(
    revokeRequest(otherDevice.device.id.slice(-8), ownerToken(primary.owner.id)),
    { params: Promise.resolve({ id: otherDevice.device.id.slice(-8) }) },
  )
  assert.equal(nonOps.status, 403)
  assertNoStore(nonOps)

  const legacy = await managementRevoke(
    revokeRequest(otherDevice.device.id.slice(-8), legacyToken()),
    { params: Promise.resolve({ id: otherDevice.device.id.slice(-8) }) },
  )
  assert.equal(legacy.status, 403)
  assert.equal((await legacy.json()).error, 'OPS_ADMIN_IDENTITY_REQUIRED')
  assertNoStore(legacy)

  const missingRef = 'ZZZZ9999'
  const missing = await managementRevoke(
    revokeRequest(missingRef, token),
    { params: Promise.resolve({ id: missingRef }) },
  )
  assert.equal(missing.status, 404)
  assertNoStore(missing)

  const missingReason = await managementRevoke(
    revokeRequest(otherDevice.device.id.slice(-8), token, { reason: 'x' }),
    { params: Promise.resolve({ id: otherDevice.device.id.slice(-8) }) },
  )
  assert.equal(missingReason.status, 400)
  assert.equal((await missingReason.json()).error, 'REVOCATION_REASON_REQUIRED')
  assertNoStore(missingReason)

  const ambiguousRef = randomUUID().replaceAll('-', '').slice(0, 8)
  await createDevice({ tenantId: primary.tenant.id, storeId: primaryStore.id, id: `device-one-${ambiguousRef}` })
  await createDevice({ tenantId: other.tenant.id, storeId: otherStore.id, id: `device-two-${ambiguousRef}` })
  const ambiguous = await managementRevoke(
    revokeRequest(ambiguousRef, token),
    { params: Promise.resolve({ id: ambiguousRef }) },
  )
  assert.equal(ambiguous.status, 409)
  assert.equal((await ambiguous.json()).error, 'DEVICE_REFERENCE_AMBIGUOUS')
  assertNoStore(ambiguous)

  const rollbackDevice = await createDevice({ tenantId: primary.tenant.id, storeId: primaryStore.id })
  const rollbackRef = rollbackDevice.device.id.slice(-8)
  await installRollbackTrigger()
  try {
    const rollback = await managementRevoke(
      revokeRequest(rollbackRef, token, { reason: 'Must roll back' }),
      { params: Promise.resolve({ id: rollbackRef }) },
    )
    assert.equal(rollback.status, 500)
    assert.equal((await rollback.json()).error, 'INTERNAL_ERROR')
    assertNoStore(rollback)
  } finally {
    await removeRollbackTrigger()
  }
  const afterRollback = await prisma.desktopDevice.findUniqueOrThrow({ where: { id: rollbackDevice.device.id } })
  assert.equal(afterRollback.status, 'ACTIVE')
  assert.equal(afterRollback.revocationReason, null)
  assert.equal(await prisma.desktopActivationAudit.count({ where: { deviceId: rollbackDevice.device.id, eventType: 'DEVICE_REVOKED' } }), 0)
}

async function cleanup() {
  await removeRollbackTrigger().catch(() => undefined)
  const ids = Array.from(tenantIds)
  if (ids.length > 0) {
    await prisma.desktopActivationAudit.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.desktopActivationPin.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.desktopDevice.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.subscriptionEvent.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.userStoreRole.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.store.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.user.deleteMany({ where: { tenantId: { in: ids } } })
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.opsAdmin.deleteMany({ where: { id: { in: Array.from(adminIds) } } })
}

async function main() {
  await testManagementViews()
  await testRevoke()
  await cleanup()
  console.log('ops desktop management API database tests passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup().catch(() => undefined)
    await prisma.$disconnect()
  })
