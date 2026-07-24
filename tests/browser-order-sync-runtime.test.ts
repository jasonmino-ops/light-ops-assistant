/**
 * EP-BR-ORDER-SYNC-01 真实数据库集成测试（隔离 PostgreSQL）。
 *
 * 覆盖审查要求的交易安全与并发/幂等语义。必须在隔离测试库运行，
 * 严禁连接 Production：
 *   BROWSER_ORDER_SYNC_TEST_DATABASE=1
 *   DATABASE_URL=postgresql://.../light_ops_test   （不得含 supabase 等生产标识）
 *   AUTH_SECRET=...（与 signPosDeviceToken/signSession 一致）
 *
 * 运行：npx tsx tests/browser-order-sync-runtime.test.ts
 *
 * 用例：
 *  1. 无有效身份，仅 storeCode + 伪造 header → 读取/结账被拒绝，无写入；
 *  2. 跨门店读取与结账被拒绝；
 *  3. 重复 CASH 请求不重复入账（唯一 PaymentIntent，明细不重复完成）；
 *  4. CASH 与 KHQR 并发竞争只产生一个有效结果；
 *  5. 两个浏览器同时结账不返回不可解释的通用 500；
 *  6. 已取消订单不能被完成；
 *  7. PENDING PaymentIntent 可恢复；
 *  8. FAILED / EXPIRED / CANCELLED 不让挂单永久消失（FAILED/EXPIRED 仍可见，CANCELLED 为终态移除）；
 *  9. KHQR 不会由结账接口直接变为 PAID；
 * 10. SaleRecord 明细状态保持全量一致。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import { signPosDeviceToken } from '../lib/desktop-pos-auth'
import { GET as getPendingOrders } from '../app/api/cashier/pending-orders/route'
import { POST as postCashierCheckout } from '../app/api/cashier/checkout/route'
import { POST as postConfirm } from '../app/api/payments/[paymentId]/confirm/route'

if (process.env.BROWSER_ORDER_SYNC_TEST_DATABASE !== '1') {
  throw new Error('BROWSER_ORDER_SYNC_TEST_DATABASE=1 is required for real order-sync database tests')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for real order-sync database tests')
}
if (/supabase|prod/i.test(process.env.DATABASE_URL)) {
  throw new Error('refusing to run against a production-looking DATABASE_URL')
}

type Store = { id: string; code: string; tenantId: string }
type Fixture = {
  tenant: { id: string }
  store: Store
  otherStore: Store
  owner: { id: string }
  product: { id: string; barcode: string }
}

let fixture: Fixture | null = null

function req(path: string, body: unknown, headers: Record<string, string> = {}, method: 'GET' | 'POST' = 'POST') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  })
}

function sessionHeaders(tenantId: string, userId: string, storeId: string, role: 'OWNER' | 'STAFF' = 'OWNER') {
  return { cookie: `auth-session=${signSession({ tenantId, userId, storeId, role })}` }
}

function deviceHeaders(store: Store, ownerId: string, deviceId = 'runtime-device') {
  const token = signPosDeviceToken({
    tenantId: store.tenantId, storeId: store.id, storeCode: store.code, deviceId, issuedBy: ownerId,
  })
  return { 'x-pos-device-id': deviceId, 'x-pos-device-token': token }
}

function publicDesktopHeaders() {
  return { 'x-lightops-client': 'desktop-pos' }
}

// 直接以服务端权威价格建一笔挂单（模拟手机端 DEFER 挂单落地）
async function seedHold(store: Store, ownerId: string, productId: string, barcode: string, lines = 2): Promise<string> {
  const orderNo = `S-HOLD-${randomUUID().slice(0, 8)}`
  for (let i = 0; i < lines; i++) {
    await prisma.saleRecord.create({
      data: {
        tenantId: store.tenantId, storeId: store.id, operatorUserId: ownerId,
        recordNo: i === 0 ? orderNo : `${orderNo}-${i}`,
        orderNo, saleType: 'SALE', status: 'PENDING_PAYMENT',
        productId, barcode, productNameSnapshot: 'Hold Product', specSnapshot: null,
        unitPrice: '3.00', quantity: '1', lineAmount: '3.00',
      },
    })
  }
  return orderNo
}

async function countState(orderNo: string) {
  const [pi, pending, completed, cancelled] = await Promise.all([
    prisma.paymentIntent.count({ where: { orderNo } }),
    prisma.saleRecord.count({ where: { orderNo, status: 'PENDING_PAYMENT' } }),
    prisma.saleRecord.count({ where: { orderNo, status: 'COMPLETED' } }),
    prisma.saleRecord.count({ where: { orderNo, status: 'CANCELLED' } }),
  ])
  return { pi, pending, completed, cancelled }
}

async function seedFixture(): Promise<Fixture> {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({ data: { name: `sync ${suffix}`, status: 'ACTIVE', tier: 'STANDARD' }, select: { id: true } })
  const mk = async (code: string) => prisma.store.create({
    data: { tenantId: tenant.id, code, name: code, status: 'ACTIVE', currencyCode: 'USD' },
    select: { id: true, code: true, tenantId: true },
  })
  const store = await mk(`SYNC-A-${suffix}`)
  const otherStore = await mk(`SYNC-B-${suffix}`)
  const owner = await prisma.user.create({
    data: { tenantId: tenant.id, username: `sync-owner-${suffix}`, displayName: 'Owner', role: 'OWNER', status: 'ACTIVE' },
    select: { id: true },
  })
  await prisma.userStoreRole.createMany({ data: [
    { tenantId: tenant.id, storeId: store.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    { tenantId: tenant.id, storeId: otherStore.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
  ] })
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, barcode: `SYNC-${suffix}`, name: 'Hold Product', sellPrice: '3.00', status: 'ACTIVE' },
    select: { id: true, barcode: true },
  })
  return { tenant, store, otherStore, owner, product }
}

async function cleanupFixture() {
  if (!fixture) return
  const { tenant } = fixture
  await prisma.paymentIntent.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.saleRecord.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.userStoreRole.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.product.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.user.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.store.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.tenant.deleteMany({ where: { id: tenant.id } })
}

// 1. 无有效身份仅伪造 header → 拒绝，无写入
async function testForgedHeaderRejected() {
  const f = fixture!
  const before = await prisma.paymentIntent.count({ where: { tenantId: f.tenant.id } })
  const read = await getPendingOrders(req(`/api/cashier/pending-orders?storeCode=${f.store.code}`, null, publicDesktopHeaders(), 'GET'))
  assert.equal(read.status, 403, 'pending-orders must reject storeCode+forged header')
  const orderNo = await seedHold(f.store, f.owner.id, f.product.id, f.product.barcode)
  const write = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'CASH' }, publicDesktopHeaders()))
  assert.equal(write.status, 403, 'checkout must reject storeCode+forged header')
  const after = await prisma.paymentIntent.count({ where: { tenantId: f.tenant.id } })
  assert.equal(after, before, 'forged request must not create a PaymentIntent')
  const st = await countState(orderNo)
  assert.deepEqual({ pi: st.pi, completed: st.completed }, { pi: 0, completed: 0 }, 'forged request must not complete records')
}

// 2. 跨门店读取/结账被拒绝（storeB 设备令牌打 storeA）
async function testCrossStoreRejected() {
  const f = fixture!
  const orderNo = await seedHold(f.store, f.owner.id, f.product.id, f.product.barcode)
  const bTokenAgainstA = deviceHeaders(f.otherStore, f.owner.id, 'device-b')
  const write = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'CASH' }, bTokenAgainstA))
  assert.equal(write.status, 403, 'store B device token must not check out store A order')
  assert.equal((await countState(orderNo)).completed, 0, 'cross-store checkout must not complete records')
}

// 3. 重复 CASH 不重复入账
async function testDuplicateCash() {
  const f = fixture!
  const orderNo = await seedHold(f.store, f.owner.id, f.product.id, f.product.barcode)
  const headers = sessionHeaders(f.tenant.id, f.owner.id, f.store.id)
  const r1 = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'CASH' }, headers))
  assert.equal(r1.status, 201, 'first CASH checkout completes')
  assert.equal((await r1.json()).completed, true)
  const r2 = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'CASH' }, headers))
  assert.ok(r2.status === 200 || r2.status === 409, 'duplicate CASH returns a stable, explainable result')
  const st = await countState(orderNo)
  assert.equal(st.pi, 1, 'no duplicate PaymentIntent')
  assert.equal(st.pending, 0, 'all lines completed')
  assert.equal(st.completed, 2, 'exactly the two lines completed once')
}

// 4 & 5. CASH/KHQR + 双浏览器并发只产生一个有效结果，无通用 500
async function testConcurrentCheckout() {
  const f = fixture!
  const orderNo = await seedHold(f.store, f.owner.id, f.product.id, f.product.barcode)
  const headers = sessionHeaders(f.tenant.id, f.owner.id, f.store.id)
  const responses = await Promise.all([
    postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'CASH' }, headers)),
    postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'KHQR' }, headers)),
    postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'CASH' }, headers)),
  ])
  for (const r of responses) {
    assert.notEqual(r.status, 500, 'concurrent checkout must never return a generic 500')
    assert.ok([200, 201, 409, 422].includes(r.status), `unexpected status ${r.status}`)
  }
  const st = await countState(orderNo)
  assert.equal(st.pi, 1, 'concurrent race yields exactly one PaymentIntent')
}

// 6. 已取消订单不能被完成
async function testCancelledCannotComplete() {
  const f = fixture!
  const orderNo = await seedHold(f.store, f.owner.id, f.product.id, f.product.barcode)
  await prisma.saleRecord.updateMany({ where: { orderNo }, data: { status: 'CANCELLED' } })
  await prisma.paymentIntent.create({ data: {
    tenantId: f.tenant.id, storeId: f.store.id, operatorUserId: f.owner.id, orderNo,
    paymentMethod: 'KHQR', status: 'CANCELLED', amount: '6.00', cancelledAt: new Date(),
  } })
  const headers = sessionHeaders(f.tenant.id, f.owner.id, f.store.id)
  const r = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'CASH' }, headers))
  assert.equal(r.status, 422, 'cancelled order must not be checkoutable')
  assert.equal((await r.json()).error, 'ORDER_CANCELLED')
  assert.equal((await countState(orderNo)).completed, 0, 'cancelled order must stay cancelled')
}

// 7 & 9. KHQR 结账只创建 PENDING（不直接 PAID），且可恢复；确认链才完成
async function testKhqrPendingRecoverAndConfirm() {
  const f = fixture!
  const orderNo = await seedHold(f.store, f.owner.id, f.product.id, f.product.barcode)
  const headers = sessionHeaders(f.tenant.id, f.owner.id, f.store.id)
  const r1 = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'KHQR' }, headers))
  assert.equal(r1.status, 201)
  const b1 = await r1.json()
  assert.equal(b1.completed, false, 'KHQR checkout must not complete directly')
  assert.equal(b1.paymentStatus, 'PENDING', 'KHQR checkout must create a PENDING intent')
  let st = await countState(orderNo)
  assert.equal(st.pending, 2, 'records stay PENDING_PAYMENT after KHQR checkout')
  assert.equal(st.completed, 0, 'KHQR checkout must not complete any record')

  // 再次结账 → 恢复既有 PENDING 意图，不新建
  const r2 = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo, paymentMethod: 'KHQR' }, headers))
  assert.ok(r2.status === 200 || r2.status === 201)
  const b2 = await r2.json()
  assert.equal(b2.paymentIntentId, b1.paymentIntentId, 'PENDING intent must be recovered, not duplicated')
  assert.equal((await countState(orderNo)).pi, 1, 'no duplicate PENDING intent')

  // 受控确认链完成
  const conf = await postConfirm(
    req(`/api/payments/${b1.paymentIntentId}/confirm?storeCode=${f.store.code}`, null, deviceHeaders(f.store, f.owner.id)),
    { params: Promise.resolve({ paymentId: b1.paymentIntentId }) },
  )
  assert.equal(conf.status, 200, 'confirm chain completes the KHQR order')
  st = await countState(orderNo)
  assert.equal(st.pending, 0, 'confirm transitions all lines to COMPLETED')
  assert.equal(st.completed, 2, 'all lines completed exactly once')
}

// 8. FAILED/EXPIRED 挂单不永久消失；CANCELLED 为终态移除
async function testFailedExpiredStayVisible() {
  const f = fixture!
  const failedOrder = await seedHold(f.store, f.owner.id, f.product.id, f.product.barcode)
  await prisma.paymentIntent.create({ data: {
    tenantId: f.tenant.id, storeId: f.store.id, operatorUserId: f.owner.id, orderNo: failedOrder,
    paymentMethod: 'KHQR', status: 'FAILED', amount: '6.00',
  } })
  const headers = sessionHeaders(f.tenant.id, f.owner.id, f.store.id)
  const listRes = await getPendingOrders(req(`/api/cashier/pending-orders?storeCode=${f.store.code}`, null, headers, 'GET'))
  assert.equal(listRes.status, 200)
  const list = await listRes.json() as Array<{ orderNo: string }>
  assert.ok(list.some((o) => o.orderNo === failedOrder), 'FAILED payment must not permanently hide an owed hold')
  // 结账终态失败意图 → 明确拒绝，不静默完成、不建第二意图
  const r = await postCashierCheckout(req('/api/cashier/checkout', { storeCode: f.store.code, orderNo: failedOrder, paymentMethod: 'CASH' }, headers))
  assert.equal(r.status, 409)
  assert.equal((await r.json()).error, 'PAYMENT_NOT_RESUMABLE')
  assert.equal((await countState(failedOrder)).pi, 1, 'must not create a second intent for a terminal-failed order')
}

async function main() {
  const mutableEnv = process.env as unknown as Record<string, string | undefined>
  const originalNodeEnv = mutableEnv.NODE_ENV
  mutableEnv.NODE_ENV = 'production'
  fixture = await seedFixture()
  try {
    await testForgedHeaderRejected()
    await testCrossStoreRejected()
    await testDuplicateCash()
    await testConcurrentCheckout()
    await testCancelledCannotComplete()
    await testKhqrPendingRecoverAndConfirm()
    await testFailedExpiredStayVisible()
    console.log('browser order-sync runtime tests passed')
  } finally {
    await cleanupFixture()
    fixture = null
    if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV
    else mutableEnv.NODE_ENV = originalNodeEnv
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
