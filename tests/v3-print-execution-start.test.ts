import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { isPrintOriginAfterStart, readPrintExecutionStart, printStartId } from '../lib/v3-print-execution-start'
import { canonicalV3PrintEffectKey } from '../lib/v3-print-identity'

test('replacement settings require a live store owner and recent human Telegram presence for the same account', async t => {
  const { NextRequest } = await import('next/server')
  const { createHmac } = await import('node:crypto')
  const { prisma } = await import('../lib/prisma')
  const { signSession } = await import('../lib/session')
  const { printReplacementOwner } = await import('../lib/v3-print-replacement-owner')
  const { GET, POST } = await import('../app/api/owner/v3-print-control-plane/route')
  const originalAuth = process.env.AUTH_SECRET
  const originalBot = process.env.TELEGRAM_BOT_TOKEN
  const bot = 'print-replacement-test-fixture'
  process.env.TELEGRAM_BOT_TOKEN = bot
  process.env.AUTH_SECRET = 'print-replacement-cookie-test-fixture'
  t.after(() => {
    if (originalAuth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = originalAuth
    if (originalBot === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = originalBot
  })
  function stub(model: any, key: string, fn: (...args: any[]) => unknown) {
    const initial = model[key]
    model[key] = fn
    t.after(() => { model[key] = initial })
  }
  stub(prisma.tenant, 'findUnique', async () => ({ status: 'ACTIVE' }))
  stub(prisma.user, 'findUnique', async () => ({ status: 'ACTIVE' }))
  stub(prisma.userStoreRole, 'findFirst', async ({ where }: any) =>
    where.storeId === 'store' && where.tenantId === 'tenant' && where.userId === 'owner' && where.user.telegramId === '777' &&
    where.status === 'ACTIVE' && where.store.tenant.status === 'ACTIVE' ? { userId: 'owner' } : null)
  const session = { tenantId: 'tenant', storeId: 'store', userId: 'owner', role: 'OWNER' as const }
  const path = 'https://example.test/api/owner/v3-print-control-plane'
  function request(id: string, offset = 0, cookie = signSession(session), origin = 'https://example.test') {
    const presence = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) + offset), user: JSON.stringify({ id }) })
    const check = [...presence.entries()].map(([k, v]) => k + '=' + v).join('\n')
    const key = createHmac('sha256', 'WebAppData').update(bot).digest()
    presence.set('hash', createHmac('sha256', key).update(check).digest('hex'))
    return new NextRequest(path, { method: 'POST', headers: { cookie: 'auth-session=' + cookie,
      origin, 'content-type': 'application/json', 'x-telegram-init-data': presence.toString() },
      body: JSON.stringify({ action: 'REPLACE_PRINT_COMPUTER', expectedStateVersion: 9 }) })
  }
  assert.deepEqual(await printReplacementOwner(request('777')), session)
  assert.equal(await printReplacementOwner(request('778')), null)
  assert.equal(await printReplacementOwner(request('777', -1000)), null)
  assert.equal(await printReplacementOwner(request('777', 0, signSession({ ...session, role: 'STAFF' }))), null)
  assert.equal(await printReplacementOwner(request('777', 0, signSession({ ...session, opsRole: 'SUPER_ADMIN' }))), null)
  assert.equal(await printReplacementOwner(request('777', 0, signSession({ ...session, storeId: 'other-store' }))), null)
  assert.equal((await POST(request('777', 0, signSession(session), 'https://other.test'))).status, 403)
  assert.equal((await POST(request('777'))).status, 400)
  stub(prisma.v3PrintControlPlane, 'findUnique', async () => null)
  stub(prisma.v3PrintControlPlane, 'findFirst', async () => ({ mode: 'V3_ACTIVE', ownerEpoch: 9, ownerDeviceId: 'new' }))
  stub(prisma.operationLog, 'findFirst', async ({ where }: any) => where.requestId === 'chosen' && where.tenantId === 'tenant' &&
    where.storeId === 'store' && where.userId === 'owner' && where.message === 'HANDOFF_CONFIRMED' && where.status === 'SUCCESS' ?
    { payloadSnapshot: { replacement: true, intendedOwnerDeviceId: 'new', ownerEpoch: 9 } } : null)
  const recovered = await GET(new NextRequest(path + '?confirmationId=chosen', { headers: request('777').headers }))
  assert.deepEqual(await recovered.json(), { storeId: 'store', targets: [], plane: { mode: 'V3_ACTIVE', ownerEpoch: 9, ownerDeviceId: 'new' },
    confirmed: { deviceId: 'new', epoch: 9 } })
  const deviceOnly = new NextRequest(path, { headers: { cookie: 'auth-session=' + signSession(session) } })
  assert.equal((await GET(deviceOnly)).status, 403)
})

const scope = { tenantId: 'fixture-tenant', storeId: 'fixture-store' }
const start = { ownerEpoch: 8, deviceId: 'new', startedAt: '2026-10-01T05:00:00.000Z' }
const cutoff = Date.parse(start.startedAt)
const time = (delta: number) => new Date(cutoff + delta)
const orderNo = 'ORDER-22'
function effect(role: 'FRONT' | 'KITCHEN', no = orderNo) {
  return { orderNo: no, role, printJobId: 'network:' + createHash('sha256').update(canonicalV3PrintEffectKey(no, role)).digest('hex') }
}
function db() {
  return {
    operationLog: { findFirst: async (_query: any): Promise<any> => null },
    customerOrderFulfillmentIntent: { findFirst: async (_query: any): Promise<any> => null },
    customerOrder: { findFirst: async (_query: any): Promise<any> => null },
    diningMeal: { findFirst: async (_query: any): Promise<any> => null },
    diningBatch: { findFirst: async (_query: any): Promise<any> => null },
    paymentIntent: { findFirst: async (q: any): Promise<any> => {
      assert.deepEqual(q.where, { ...scope, orderNo }); return { createdAt: time(1) }
    } },
    saleRecord: { findMany: async (q: any): Promise<any[]> => {
      assert.equal(q.where.tenantId, scope.tenantId); assert.equal(q.where.storeId, scope.storeId)
      return [{ offlineOrderId: null, source: null }]
    } },
  }
}
for (const role of ['FRONT', 'KITCHEN'] as const) {
  for (const delta of [-1, 0, 1]) test(`original ${role} at boundary ${delta} ms uses the committed payment row`, async () => {
    const client = db()
    client.paymentIntent.findFirst = async () => ({ createdAt: time(delta) })
    assert.equal(await isPrintOriginAfterStart(client as any, scope, start, effect(role)), delta > 0)
  })
}
test('late-arriving offline import, unknown effect and wrong role cannot become a new sale', async () => {
  const client = db()
  client.saleRecord.findMany = async () => [{ source: 'CASHIER_OFFLINE', offlineOrderId: 'archived' }]
  assert.equal(await isPrintOriginAfterStart(client as any, scope, start, effect('FRONT')), false)
  assert.equal(await isPrintOriginAfterStart(db() as any, scope, start, { ...effect('FRONT'), role: 'KITCHEN' }), false)
})
test('delayed H5 fulfillment respects its original business time', async () => {
  const client = db()
  client.customerOrderFulfillmentIntent.findFirst = async ({where}) => {
    assert.equal(where.idempotencyKey, 'h5-exact-key'); return { purpose: 'KITCHEN_MAKE', paymentEventAt: null }
  }
  client.customerOrder.findFirst = async () => ({ createdAt: time(-1), paidAt: null })
  assert.equal(await isPrintOriginAfterStart(client as any, scope, start, { ...effect('KITCHEN'), printJobId: 'h5-exact-key' }), false)
})
test('late kitchen claim is dated by the original dining batch, not by the claim', async () => {
  const client = db()
  client.saleRecord.findMany = async () => []
  client.diningBatch.findFirst = async ({where}) => {
    assert.deepEqual(where.meal, { ...scope, billNo: 'BILL' })
    assert.equal(where.seq, 4); assert.equal(where.noticeRequired, true)
    return { createdAt: time(-100) }
  }
  assert.equal(await isPrintOriginAfterStart(client as any, scope, start, effect('KITCHEN', 'BILL.4')), false)
})
test('manual reprint of an old sale requires a new exact in-store role-specific audit', async () => {
  const client = db()
  const printJobId = 'v3-reprint:front:fixture'
  client.operationLog.findFirst = async ({where}) => {
    assert.deepEqual(where, { ...scope, targetType: 'SaleOrder', targetId: orderNo, actionType: 'V3_PRINT_MANUAL_REPRINT_REQUESTED',
      status: 'SUCCESS', requestId: printJobId, createdAt: { gt: time(0) }, payloadSnapshot: { path: ['role'], equals: 'FRONT' } })
    return { id: 'actual-audit' }
  }
  assert.equal(await isPrintOriginAfterStart(client as any, scope, start, { ...effect('FRONT'), printJobId }), true)
  assert.equal(await isPrintOriginAfterStart(db() as any, scope, start, { ...effect('FRONT'), printJobId }), false)
  assert.equal(await isPrintOriginAfterStart(client as any, scope, start, { ...effect('KITCHEN'), printJobId }), false)
})
test('only immutable in-scope completed replacement records supply a start', async () => {
  const client = db()
  assert.equal(await readPrintExecutionStart(client as any, scope), null)
  assert.notEqual(printStartId(scope), printStartId({ ...scope, storeId: 'outside' }))
  assert.ok(printStartId(scope, 9) < printStartId(scope, 10))
  const record = { id: printStartId(scope, 8), actionType: 'V3_PRINT_CONTROLLED_HANDOFF', targetType: 'V3PrintControlPlane',
    status: 'SUCCESS', message: 'HANDOFF_CONFIRMED', payloadSnapshot: { replacement: true, intendedOwnerDeviceId: 'new',
      ownerEpoch: 8, occurredAt: start.startedAt } }
  client.operationLog.findFirst = async ({where, orderBy}) => {
    assert.deepEqual(where.id, { gte: printStartId(scope, 0), lte: printStartId(scope, Number.MAX_SAFE_INTEGER) }); assert.deepEqual(orderBy, { id: 'desc' }); return record
  }
  assert.deepEqual(await readPrintExecutionStart(client as any, scope), start)
  record.message = 'QUARANTINE_STARTED'
  await assert.rejects(readPrintExecutionStart(client as any, scope), /EXECUTION_START_INVALID/)
})
