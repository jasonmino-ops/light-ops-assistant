/**
 * ES-DESKTOP-OWNER-WEB-SESSION-01 — route rejection matrix, success cookie and audit.
 *
 * Runs the real route handler and the real token/session crypto. Prisma model
 * delegates are replaced by an in-memory fixture store (no database access).
 */
import assert from 'node:assert/strict'
import { NextRequest, type NextResponse } from 'next/server'

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'owner-web-session-test-secret'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as { gt?: Date }
      if (condition.gt instanceof Date) return actual instanceof Date && actual.getTime() > condition.gt.getTime()
      return false
    }
    return actual === expected
  })
}

function pick(row: Row | undefined, select?: Record<string, boolean>) {
  if (!row) return null
  if (!select) return { ...row }
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
}

async function main() {
  const { prisma } = await import('../lib/prisma')
  const { signPosDeviceToken, hashPosDeviceToken } = await import('../lib/desktop-pos-auth')
  const { verifySession, signSession } = await import('../lib/session')
  const route = await import('../app/api/pos-session/owner-web-session/route')
  const lib = await import('../lib/desktop-owner-web-session')

  const db = {
    store: [] as Row[],
    desktopDevice: [] as Row[],
    tenant: [] as Row[],
    tenantSubscription: [] as Row[],
    browserPosDevice: [] as Row[],
    userStoreRole: [] as Row[],
    user: [] as Row[],
    audits: [] as Row[],
    failAudit: false,
  }
  const p = prisma as unknown as Record<string, Record<string, unknown>>
  p.store.findUnique = async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
    pick(db.store.find((row) => matches(row, where)), select)
  p.desktopDevice.findUnique = async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
    pick(db.desktopDevice.find((row) => matches(row, where)), select)
  p.tenant.findUnique = async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
    pick(db.tenant.find((row) => matches(row, where)), select)
  p.tenantSubscription.findUnique = async ({ where }: { where: Where }) =>
    pick(db.tenantSubscription.find((row) => matches(row, where)))
  p.tenantSubscription.create = async () => { throw new Error('fixture subscription must exist') }
  p.browserPosDevice.findFirst = async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
    pick(db.browserPosDevice.find((row) => matches(row, where)), select)
  p.userStoreRole.findFirst = async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
    pick(db.userStoreRole.find((row) => matches(row, where)), select)
  p.user.findUnique = async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
    pick(db.user.find((row) => matches(row, where)), select)
  p.desktopActivationAudit.create = async ({ data }: { data: Row }) => {
    if (db.failAudit) throw new Error('audit unavailable')
    db.audits.push(data)
    return data
  }

  const DAY = 86_400_000
  let seq = 0

  function reset() {
    db.store.length = 0; db.desktopDevice.length = 0; db.tenant.length = 0
    db.tenantSubscription.length = 0; db.browserPosDevice.length = 0
    db.userStoreRole.length = 0; db.user.length = 0; db.audits.length = 0
    db.failAudit = false
  }

  function fixture(overrides: {
    issuedBy?: string
    withSession?: boolean
    browserDeviceId?: string
  } = {}) {
    seq += 1
    const tenantId = `tenant${seq}`
    const storeId = `store${seq}`
    const storeCode = `S${seq}`
    const desktopDeviceId = `dev${seq}`
    const ownerId = `owner${seq}`
    const browserDeviceId = overrides.browserDeviceId ?? `desktop-${desktopDeviceId}`
    const sessionId = `session${seq}`
    db.tenant.push({ id: tenantId, status: 'ACTIVE' })
    db.tenantSubscription.push({ id: `sub${seq}`, tenantId, status: 'ACTIVE' })
    db.store.push({ id: storeId, tenantId, code: storeCode, status: 'ACTIVE' })
    db.desktopDevice.push({
      id: desktopDeviceId, tenantId, storeId, status: 'ACTIVE', activeSlot: 'ACTIVE',
      tokenExpiresAt: new Date(Date.now() + 30 * DAY),
    })
    db.user.push({ id: ownerId, tenantId, role: 'OWNER', status: 'ACTIVE' })
    db.userStoreRole.push({ tenantId, storeId, userId: ownerId, role: 'OWNER', status: 'ACTIVE' })
    const token = signPosDeviceToken({
      tenantId, storeId, storeCode, deviceId: browserDeviceId,
      issuedBy: overrides.issuedBy ?? 'DESKTOP_DEVICE',
      ...(overrides.withSession === false ? {} : { browserPosSessionId: sessionId }),
    })
    db.browserPosDevice.push({
      id: sessionId, tenantId, storeId, browserDeviceId, tokenHash: hashPosDeviceToken(token),
      status: 'ACTIVE', activeSlot: 'ACTIVE', tokenExpiresAt: new Date(Date.now() + 30 * DAY),
    })
    return { tenantId, storeId, storeCode, desktopDeviceId, ownerId, browserDeviceId, sessionId, token }
  }

  function request(headers: Record<string, string>) {
    return new NextRequest('https://elifekh.com/api/pos-session/owner-web-session', {
      method: 'POST',
      headers,
    })
  }

  const headersFor = (f: ReturnType<typeof fixture>, extra: Record<string, string> = {}) => ({
    'x-pos-device-token': f.token,
    'x-pos-device-id': f.browserDeviceId,
    ...extra,
  })

  let cases = 0
  async function test(name: string, run: () => Promise<void>) {
    reset()
    await run()
    cases += 1
    console.log(`PASS ${name}`)
  }

  async function expectUnauthorized(req: NextRequest) {
    const res = await route.POST(req)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'DESKTOP_OWNER_SESSION_UNAUTHORIZED' })
    assert.equal(res.headers.get('set-cookie'), null)
    assert.equal(db.audits.length, 0, 'unattributable rejections are not audited')
  }

  async function expectDenied(req: NextRequest, reason: string, deviceId: string | null) {
    const res = await route.POST(req)
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'DESKTOP_OWNER_SESSION_DENIED' })
    assert.equal(res.headers.get('set-cookie'), null)
    assert.equal(db.audits.length, 1, 'attributable rejection must be audited')
    const audit = db.audits[0]
    assert.equal(audit.eventType, 'DESKTOP_OWNER_WEB_SESSION_DENIED')
    assert.equal(audit.result, 'DENIED')
    assert.equal(audit.reasonCode, reason)
    assert.equal(audit.deviceId, deviceId)
    assert.equal(audit.actorUserId, null)
  }

  await test('success issues a 12h OWNER auth-session for the Desktop-bound store and audits it', async () => {
    const f = fixture()
    const res = await route.POST(request(headersFor(f, { 'user-agent': 'E-Shop Desktop' })))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0')
    const body = await res.json() as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'ok'])
    assert.equal(body.ok, true)
    const expiresIn = Date.parse(String(body.expiresAt)) - Date.now()
    assert.ok(expiresIn > 11.9 * 3600_000 && expiresIn <= 12 * 3600_000)
    assert.ok(!JSON.stringify(body).includes(f.token))
    const cookie = (res as NextResponse).cookies.get('auth-session')
    assert.ok(cookie, 'auth-session cookie must be set')
    assert.equal(cookie.httpOnly, true)
    assert.equal(cookie.path, '/')
    assert.equal(cookie.maxAge, 12 * 60 * 60)
    const session = verifySession(cookie.value)
    assert.deepEqual(session, { tenantId: f.tenantId, userId: f.ownerId, storeId: f.storeId, role: 'OWNER' })
    assert.equal(db.audits.length, 1)
    const audit = db.audits[0]
    assert.equal(audit.eventType, 'DESKTOP_OWNER_WEB_SESSION_ISSUED')
    assert.equal(audit.result, 'SUCCESS')
    assert.equal(audit.tenantId, f.tenantId)
    assert.equal(audit.storeId, f.storeId)
    assert.equal(audit.deviceId, f.desktopDeviceId)
    assert.equal(audit.actorUserId, f.ownerId)
    const serialized = JSON.stringify(audit)
    assert.ok(!serialized.includes(f.token) && !serialized.includes(cookie.value), 'audit must not contain token or cookie')
    assert.deepEqual(Object.keys(audit.metadata as Row).sort(), ['eventVersion', 'expiresAt'])
  })

  await test('production cookie attributes match the existing login cookie (Secure, SameSite=None)', async () => {
    const original = process.env.NODE_ENV
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    try {
      assert.deepEqual(lib.ownerWebSessionCookieOptions(), {
        httpOnly: true, sameSite: 'none', secure: true, maxAge: 43200, path: '/',
      })
    } finally {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = original
    }
  })

  await test('R1 missing token or device id is rejected generically', async () => {
    const f = fixture()
    await expectUnauthorized(request({}))
    await expectUnauthorized(request({ 'x-pos-device-token': f.token }))
    await expectUnauthorized(request({ 'x-pos-device-id': f.browserDeviceId }))
  })

  await test('Desktop marker headers, storeCode and Desktop flags alone never authorize', async () => {
    const f = fixture()
    await expectUnauthorized(request({
      'x-lightops-client': 'desktop-pos',
      'x-pos-operator-source': 'DEVICE',
      'x-pos-store-code': f.storeCode,
      'x-eshop-desktop': '1',
    }))
  })

  await test('an existing auth-session cookie is neither trusted nor renewed without a Desktop token', async () => {
    const f = fixture()
    const ownerCookie = signSession({ tenantId: f.tenantId, userId: f.ownerId, storeId: f.storeId, role: 'OWNER' })
    await expectUnauthorized(request({ cookie: `auth-session=${ownerCookie}` }))
  })

  await test('R3 tampered signature, device-id mismatch and unknown or mismatched store are rejected generically', async () => {
    const f = fixture()
    const [encoded, sig] = [f.token.slice(0, f.token.lastIndexOf('.')), f.token.slice(f.token.lastIndexOf('.') + 1)]
    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, 'base64url').toString()), storeId: 'other' })).toString('base64url')
    await expectUnauthorized(request({ 'x-pos-device-token': `${tampered}.${sig}`, 'x-pos-device-id': f.browserDeviceId }))
    await expectUnauthorized(request(headersFor(f, { 'x-pos-device-id': 'desktop-someone-else' })))
    db.store[0].code = 'RENAMED'
    await expectUnauthorized(request(headersFor(f)))
    db.store[0].code = f.storeCode
    db.store[0].tenantId = 'another-tenant'
    await expectUnauthorized(request(headersFor(f)))
    db.store.length = 0
    await expectUnauthorized(request(headersFor(f)))
  })

  await test('R2 inactive store is denied and audited', async () => {
    const f = fixture()
    db.store[0].status = 'DISABLED'
    await expectDenied(request(headersFor(f)), 'STORE_INACTIVE', null)
  })

  await test('R4 legacy POS token without a managed session id cannot become OWNER', async () => {
    const f = fixture({ withSession: false })
    await expectDenied(request(headersFor(f)), 'NOT_DESKTOP_SESSION', null)
  })

  await test('R5 ordinary Browser POS managed token (issued by a user) cannot become OWNER', async () => {
    const f = fixture({ issuedBy: 'user-staff-1', browserDeviceId: 'pos-browser-1' })
    await expectDenied(request(headersFor(f)), 'NOT_DESKTOP_SESSION', null)
  })

  await test('R5 Browser POS token using a desktop-like device id is still rejected by issuer', async () => {
    const f = fixture({ issuedBy: 'computer-binding' })
    await expectDenied(request(headersFor(f)), 'NOT_DESKTOP_SESSION', null)
  })

  await test('R6 Desktop issuer with a non-desktop device id is rejected', async () => {
    const f = fixture({ browserDeviceId: 'pos-browser-2' })
    await expectDenied(request(headersFor(f)), 'NOT_DESKTOP_SESSION', null)
  })

  await test('R8 missing or cross-store DesktopDevice is rejected', async () => {
    const f = fixture()
    db.desktopDevice.length = 0
    await expectDenied(request(headersFor(f)), 'DESKTOP_DEVICE_UNAUTHORIZED', null)
    db.audits.length = 0
    db.desktopDevice.push({ id: f.desktopDeviceId, tenantId: f.tenantId, storeId: 'other-store', status: 'ACTIVE', activeSlot: 'ACTIVE', tokenExpiresAt: new Date(Date.now() + DAY) })
    await expectDenied(request(headersFor(f)), 'DESKTOP_DEVICE_UNAUTHORIZED', null)
    db.audits.length = 0
    db.desktopDevice[0].storeId = f.storeId
    db.desktopDevice[0].tenantId = 'other-tenant'
    await expectDenied(request(headersFor(f)), 'DESKTOP_DEVICE_UNAUTHORIZED', null)
  })

  await test('R8 revoked, replaced or expired DesktopDevice is rejected', async () => {
    const f = fixture()
    db.desktopDevice[0].status = 'REVOKED'
    await expectDenied(request(headersFor(f)), 'DESKTOP_DEVICE_REVOKED', f.desktopDeviceId)
    db.audits.length = 0
    db.desktopDevice[0].status = 'ACTIVE'
    db.desktopDevice[0].activeSlot = null
    await expectDenied(request(headersFor(f)), 'DESKTOP_DEVICE_REVOKED', f.desktopDeviceId)
    db.audits.length = 0
    db.desktopDevice[0].activeSlot = 'ACTIVE'
    db.desktopDevice[0].tokenExpiresAt = new Date(Date.now() - 1000)
    await expectDenied(request(headersFor(f)), 'DESKTOP_TOKEN_EXPIRED', f.desktopDeviceId)
  })

  await test('R9 inactive tenant is rejected', async () => {
    const f = fixture()
    db.tenant[0].status = 'ARCHIVED'
    await expectDenied(request(headersFor(f)), 'TENANT_INACTIVE', f.desktopDeviceId)
  })

  await test('R10 blocked subscription is rejected', async () => {
    const f = fixture()
    db.tenantSubscription[0].status = 'EXPIRED'
    await expectDenied(request(headersFor(f)), 'SUBSCRIPTION_BLOCKED', f.desktopDeviceId)
  })

  await test('R7 revoked, replaced, expired or hash-mismatched BrowserPosDevice is rejected', async () => {
    const f = fixture()
    for (const mutate of [
      (row: Row) => { row.status = 'REVOKED' },
      (row: Row) => { row.activeSlot = null },
      (row: Row) => { row.tokenExpiresAt = new Date(Date.now() - 1000) },
      (row: Row) => { row.tokenHash = 'different' },
    ]) {
      db.audits.length = 0
      const original = { ...db.browserPosDevice[0] }
      mutate(db.browserPosDevice[0])
      await expectDenied(request(headersFor(f)), 'POS_SESSION_INVALID', f.desktopDeviceId)
      db.browserPosDevice[0] = original
    }
  })

  await test('R11/R12 missing, disabled, non-OWNER or foreign owner is rejected', async () => {
    const f = fixture()
    db.userStoreRole[0].status = 'DISABLED'
    await expectDenied(request(headersFor(f)), 'OWNER_NOT_FOUND', f.desktopDeviceId)
    db.userStoreRole[0].status = 'ACTIVE'
    for (const mutate of [
      (row: Row) => { row.status = 'DISABLED' },
      (row: Row) => { row.role = 'STAFF' },
      (row: Row) => { row.tenantId = 'other-tenant' },
    ]) {
      db.audits.length = 0
      const original = { ...db.user[0] }
      mutate(db.user[0])
      await expectDenied(request(headersFor(f)), 'OWNER_NOT_FOUND', f.desktopDeviceId)
      db.user[0] = original
    }
  })

  await test('session is always scoped to the token store, never a sibling store of the tenant', async () => {
    const f = fixture()
    db.store.push({ id: 'sibling', tenantId: f.tenantId, code: 'SIB', status: 'ACTIVE' })
    const res = await route.POST(request(headersFor(f, { cookie: `auth-session=${signSession({ tenantId: f.tenantId, userId: f.ownerId, storeId: 'sibling', role: 'OWNER' })}` })))
    assert.equal(res.status, 200)
    assert.equal(verifySession((res as NextResponse).cookies.get('auth-session')!.value)?.storeId, f.storeId)
  })

  await test('success-path audit failure fails closed without a cookie', async () => {
    const f = fixture()
    db.failAudit = true
    const res = await route.POST(request(headersFor(f)))
    assert.equal(res.status, 500)
    assert.equal(res.headers.get('set-cookie'), null)
  })

  await test('route exposes POST only', async () => {
    assert.deepEqual(Object.keys(route).filter((key) => /^[A-Z]+$/.test(key)), ['POST'])
  })

  console.log(`desktop-owner-web-session.test.ts: ${cases} cases PASS`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
