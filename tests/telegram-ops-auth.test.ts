import assert from 'node:assert/strict'
import crypto, { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { checkOpsAuthContext, getFkBackedOpsAdminIdentity } from '../lib/ops-auth'
import { signSession, verifySession } from '../lib/session'

if (process.env.DESKTOP_ACTIVATION_TEST_DATABASE !== '1') {
  throw new Error('DESKTOP_ACTIVATION_TEST_DATABASE=1 is required for Telegram Ops auth tests')
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Telegram Ops auth tests')

const BOT_TOKEN = 'c0-test-ops-bot-token'
const TELEGRAM_ID = '900000001'
const UNBOUND_TELEGRAM_ID = '900000002'

process.env.OPS_BOT_TOKEN = BOT_TOKEN
delete process.env.OPS_TG_IDS

function initData(telegramId: string) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `c0-${randomUUID()}`,
    user: JSON.stringify({ id: Number(telegramId), first_name: 'C0 Test' }),
  })
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return params.toString()
}

function cookieFrom(response: Response) {
  const value = response.headers.get('set-cookie')?.match(/auth-session=([^;]+)/)?.[1]
  assert.ok(value, 'Telegram Ops login must issue auth-session')
  return value
}

function assertNoTelegramId(value: unknown, telegramId: string) {
  assert.equal(JSON.stringify(value).includes(telegramId), false, 'full Telegram ID must not be exposed')
}

async function main() {
  const [{ PATCH: bindTelegram }, { GET: listAdmins }, { POST: telegramLogin }] = await Promise.all([
    import('../app/api/ops/admins/[id]/route'),
    import('../app/api/ops/admins/route'),
    import('../app/api/auth/telegram-ops/route'),
  ])

  const suffix = randomUUID().slice(0, 8)
  const existingOpsTenant = await prisma.tenant.findUnique({ where: { id: '_ops' } })
  if (!existingOpsTenant) {
    await prisma.tenant.create({
      data: { id: '_ops', name: 'C0 Ops Audit Test Tenant', status: 'ACTIVE', tier: 'LITE' },
    })
  }
  const admin = await prisma.opsAdmin.create({
    data: {
      name: `C0 Founder Binding ${suffix}`,
      username: `c0-founder-${suffix}`,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  })

  try {
    const superToken = signSession({
      tenantId: '_ops',
      userId: admin.id,
      storeId: '',
      role: 'OWNER',
      opsRole: 'SUPER_ADMIN',
      opsSessionVersion: admin.sessionVersion,
    })
    const bindResponse = await bindTelegram(new NextRequest(`http://localhost/api/ops/admins/${admin.id}`, {
      method: 'PATCH',
      headers: {
        cookie: `auth-session=${superToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ telegramId: TELEGRAM_ID }),
    }), { params: Promise.resolve({ id: admin.id }) })
    assert.equal(bindResponse.status, 200)
    assertNoTelegramId(await bindResponse.json(), TELEGRAM_ID)

    const boundAdmin = await prisma.opsAdmin.findUniqueOrThrow({ where: { id: admin.id } })
    assert.equal(boundAdmin.telegramId, TELEGRAM_ID)
    assert.equal(boundAdmin.sessionVersion, admin.sessionVersion + 1)

    const bindingAudit = await prisma.operationLog.findFirstOrThrow({
      where: { targetId: admin.id, actionType: 'OPS_TG_REBIND' },
      orderBy: { createdAt: 'desc' },
    })
    assertNoTelegramId(bindingAudit.message, TELEGRAM_ID)
    assertNoTelegramId(bindingAudit.payloadSnapshot, TELEGRAM_ID)
    assert.equal(JSON.stringify(bindingAudit.payloadSnapshot).includes('telegramId'), false)

    const currentToken = signSession({
      tenantId: '_ops',
      userId: boundAdmin.id,
      storeId: '',
      role: 'OWNER',
      opsRole: 'SUPER_ADMIN',
      opsSessionVersion: boundAdmin.sessionVersion,
    })
    const repeatedBind = await bindTelegram(new NextRequest(`http://localhost/api/ops/admins/${admin.id}`, {
      method: 'PATCH',
      headers: {
        cookie: `auth-session=${currentToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ telegramId: TELEGRAM_ID }),
    }), { params: Promise.resolve({ id: admin.id }) })
    assert.equal(repeatedBind.status, 200)
    assert.equal((await prisma.opsAdmin.findUniqueOrThrow({ where: { id: admin.id } })).sessionVersion, boundAdmin.sessionVersion)
    assert.equal(await prisma.operationLog.count({
      where: { targetId: admin.id, actionType: 'OPS_TG_REBIND' },
    }), 1)

    const listResponse = await listAdmins(new NextRequest('http://localhost/api/ops/admins', {
      headers: { cookie: `auth-session=${currentToken}` },
    }))
    assert.equal(listResponse.status, 200)
    const listed = (await listResponse.json()).find((item: { id: string }) => item.id === admin.id)
    assert.equal(listed.telegramBound, true)
    assert.equal('telegramId' in listed, false)
    assertNoTelegramId(listed, TELEGRAM_ID)

    const loginResponse = await telegramLogin(new NextRequest('http://localhost/api/auth/telegram-ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData(TELEGRAM_ID) }),
    }))
    assert.equal(loginResponse.status, 200)
    const sessionToken = cookieFrom(loginResponse)
    const session = verifySession(sessionToken)
    assert.equal(session?.userId, admin.id)
    assert.equal(session?.opsRole, 'SUPER_ADMIN')
    assert.equal(session?.opsSessionVersion, boundAdmin.sessionVersion)

    const authenticatedRequest = new NextRequest('http://localhost/ops', {
      headers: { cookie: `auth-session=${sessionToken}` },
    })
    const ops = await checkOpsAuthContext(authenticatedRequest)
    assert.ok(ops)
    assert.equal(ops.userId, admin.id)
    const actor = await getFkBackedOpsAdminIdentity(authenticatedRequest, ops)
    assert.ok(actor)
    assert.equal(actor.id, admin.id)

    const loginAudit = await prisma.operationLog.findFirstOrThrow({
      where: { targetId: admin.id, actionType: 'OPS_TG_LOGIN_OK' },
      orderBy: { createdAt: 'desc' },
    })
    assertNoTelegramId(loginAudit.message, TELEGRAM_ID)
    assertNoTelegramId(loginAudit.payloadSnapshot, TELEGRAM_ID)
    assert.equal(JSON.stringify(loginAudit.payloadSnapshot).includes('telegramId'), false)

    const unboundResponse = await telegramLogin(new NextRequest('http://localhost/api/auth/telegram-ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData(UNBOUND_TELEGRAM_ID) }),
    }))
    assert.equal(unboundResponse.status, 403)
    assertNoTelegramId(await unboundResponse.json(), UNBOUND_TELEGRAM_ID)
  } finally {
    await prisma.operationLog.deleteMany({ where: { targetId: admin.id } })
    await prisma.opsAdmin.deleteMany({ where: { id: admin.id } })
    if (!existingOpsTenant) await prisma.tenant.deleteMany({ where: { id: '_ops' } })
  }
}

main()
  .then(() => console.log('Telegram Ops FK identity and privacy tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
