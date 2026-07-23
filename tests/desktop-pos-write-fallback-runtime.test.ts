import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import { signPosDeviceToken } from '../lib/desktop-pos-auth'
import { POST as postCashierSale } from '../app/api/cashier/sales/route'
import { POST as postMemberBalancePay } from '../app/api/cashier/member-balance-pay/route'
import { POST as postOfflineSync } from '../app/api/cashier/offline-sync/route'
import { PATCH as patchCashierOrder } from '../app/api/cashier/orders/[id]/route'
import { POST as revokeBrowserDevice } from '../app/api/cashier/browser-devices/[id]/revoke/route'

if (process.env.CASHIER_SECURITY_TEST_DATABASE !== '1') {
  throw new Error('CASHIER_SECURITY_TEST_DATABASE=1 is required for real cashier security database tests')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for real cashier security database tests')
}

type Fixture = {
  tenant: { id: string }
  store: { id: string; code: string }
  owner: { id: string }
  staff: { id: string }
  product: { id: string; barcode: string; sellPrice: { toString(): string } }
  member: { id: string; balance: { toString(): string } }
  order: { id: string }
}

type WriteState = {
  saleCount: number
  paymentIntentCount: number
  offlineSyncMapCount: number
  ledgerCount: number
  memberBalance: string
  orderStatus: string
  productUpdatedAt: string
}

let fixture: Fixture | null = null

function makeRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  method: 'POST' | 'PATCH' = 'POST',
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function sessionHeaders(userId: string, role: 'OWNER' | 'STAFF') {
  assert.ok(fixture)
  return {
    cookie: `auth-session=${signSession({
      tenantId: fixture.tenant.id,
      userId,
      storeId: fixture.store.id,
      role,
    })}`,
  }
}

function publicDesktopHeaders() {
  return { 'x-lightops-client': 'desktop-pos' }
}

function validDeviceHeaders(deviceId = 'runtime-device') {
  assert.ok(fixture)
  const token = signPosDeviceToken({
    tenantId: fixture.tenant.id,
    storeId: fixture.store.id,
    storeCode: fixture.store.code,
    deviceId,
    issuedBy: fixture.owner.id,
  })
  return { 'x-pos-device-id': deviceId, 'x-pos-device-token': token }
}

function expiredDeviceToken(deviceId: string) {
  assert.ok(fixture)
  const payload = Buffer.from(JSON.stringify({
    v: 'pos-device-v1',
    tenantId: fixture.tenant.id,
    storeId: fixture.store.id,
    storeCode: fixture.store.code,
    deviceId,
    issuedBy: fixture.owner.id,
    iat: Date.now() - 181 * 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const secret = process.env.AUTH_SECRET ?? 'dev-secret-change-in-production'
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function salePayload(paymentMethod: 'CASH' | 'KHQR' = 'CASH', manualPaymentConfirmed?: boolean) {
  assert.ok(fixture)
  return {
    storeCode: fixture.store.code,
    items: [{ barcode: fixture.product.barcode, quantity: 1 }],
    paymentMethod,
    ...(manualPaymentConfirmed === undefined ? {} : { manualPaymentConfirmed }),
  }
}

function offlinePayload(offlineOrderId = `offline-${randomUUID()}`) {
  assert.ok(fixture)
  const now = Date.now()
  return {
    storeId: fixture.store.id,
    storeCode: fixture.store.code,
    deviceId: 'offline-runtime-device',
    orders: [{
      offlineOrderId,
      tenantId: fixture.tenant.id,
      storeId: fixture.store.id,
      storeCode: fixture.store.code,
      operatorUserId: fixture.owner.id,
      deviceId: 'offline-runtime-device',
      createdAtLocal: new Date(now).toISOString(),
      createdAtClientTimestamp: now,
      items: [{
        productId: fixture.product.id,
        barcode: fixture.product.barcode,
        quantity: 1,
        lineTotal: 7.5,
      }],
      subtotal: 7.5,
      discountAmount: 0,
      totalAmount: 7.5,
      paymentMethod: 'CASH',
      paymentStatus: 'PAID_OFFLINE',
      syncStatus: 'PENDING',
    }],
  }
}

async function captureWriteState(): Promise<WriteState> {
  assert.ok(fixture)
  const [saleCount, paymentIntentCount, offlineSyncMapCount, ledgerCount, member, order, product] = await Promise.all([
    prisma.saleRecord.count({ where: { tenantId: fixture.tenant.id } }),
    prisma.paymentIntent.count({ where: { tenantId: fixture.tenant.id } }),
    prisma.offlineSaleSyncMap.count({ where: { tenantId: fixture.tenant.id } }),
    prisma.memberBalanceLedger.count({ where: { tenantId: fixture.tenant.id } }),
    prisma.member.findUniqueOrThrow({ where: { id: fixture.member.id }, select: { balance: true } }),
    prisma.customerOrder.findUniqueOrThrow({ where: { id: fixture.order.id }, select: { status: true } }),
    prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id }, select: { updatedAt: true } }),
  ])
  return {
    saleCount,
    paymentIntentCount,
    offlineSyncMapCount,
    ledgerCount,
    memberBalance: member.balance.toString(),
    orderStatus: order.status,
    productUpdatedAt: product.updatedAt.toISOString(),
  }
}

async function expectForbiddenWithoutWrites(label: string, action: () => Promise<Response>) {
  const before = await captureWriteState()
  const response = await action()
  assert.ok(response.status === 401 || response.status === 403, `${label} must fail closed`)
  const after = await captureWriteState()
  assert.deepEqual(after, before, `${label} must not write or change state`)
}

async function seedFixture(): Promise<Fixture> {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: { name: `sec-fix tenant ${suffix}`, status: 'ACTIVE', tier: 'STANDARD' },
    select: { id: true },
  })
  const store = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      code: `SECFIX-${suffix}`,
      name: 'Security runtime store',
      status: 'ACTIVE',
      currencyCode: 'USD',
    },
    select: { id: true, code: true },
  })
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `sec-fix-owner-${suffix}`,
      displayName: 'Security Owner',
      role: 'OWNER',
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  const staff = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      username: `sec-fix-staff-${suffix}`,
      displayName: 'Security Staff',
      role: 'STAFF',
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  await prisma.userStoreRole.createMany({
    data: [
      { tenantId: tenant.id, storeId: store.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
      { tenantId: tenant.id, storeId: store.id, userId: staff.id, role: 'STAFF', status: 'ACTIVE' },
    ],
  })
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      barcode: `SEC-${suffix}`,
      name: 'Security Test Product',
      sellPrice: '7.50',
      status: 'ACTIVE',
    },
    select: { id: true, barcode: true, sellPrice: true },
  })
  const member = await prisma.member.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      memberCode: `SEC-${suffix}`,
      name: 'Security Test Member',
      balance: '100.00',
      status: 'ACTIVE',
    },
    select: { id: true, balance: true },
  })
  const order = await prisma.customerOrder.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      storeCode: store.code,
      orderNo: `SEC-${suffix}`,
      itemsJson: '[]',
      totalAmount: '7.50',
      status: 'PENDING',
    },
    select: { id: true },
  })
  return { tenant, store, owner, staff, product, member, order }
}

async function cleanupFixture() {
  if (!fixture) return
  const { tenant, store, member, product, owner, staff, order } = fixture
  await prisma.paymentIntent.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.memberBalanceLedger.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.offlineSaleSyncMap.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.saleRecord.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.customerOrder.deleteMany({ where: { id: order.id } })
  await prisma.member.deleteMany({ where: { id: member.id } })
  await prisma.product.deleteMany({ where: { id: product.id } })
  await prisma.userStoreRole.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, staff.id] } } })
  await prisma.store.deleteMany({ where: { id: store.id } })
  await prisma.tenant.deleteMany({ where: { id: tenant.id } })
}

async function testPublicStoreCodeWritesFailClosed() {
  const current = fixture
  assert.ok(current)
  const headers = publicDesktopHeaders()
  await expectForbiddenWithoutWrites('sales public storeCode fallback', async () => postCashierSale(
    makeRequest('/api/cashier/sales', salePayload(), headers),
  ))
  await expectForbiddenWithoutWrites('member balance public storeCode fallback', async () => postMemberBalancePay(
    makeRequest('/api/cashier/member-balance-pay', {
      storeCode: current.store.code,
      memberId: current.member.id,
      items: [{ barcode: current.product.barcode, quantity: 1 }],
    }, headers),
  ))
  await expectForbiddenWithoutWrites('offline sync public storeCode fallback', async () => postOfflineSync(
    makeRequest('/api/cashier/offline-sync', offlinePayload(), headers),
  ))
  await expectForbiddenWithoutWrites('order status public storeCode fallback', async () => patchCashierOrder(
    makeRequest(`/api/cashier/orders/${current.order.id}?storeCode=${encodeURIComponent(current.store.code)}`, { status: 'CONFIRMED' }, headers, 'PATCH'),
    { params: Promise.resolve({ id: current.order.id }) },
  ))
}

async function testKhqrConfirmationRejectsWithoutWrites() {
  const current = fixture
  assert.ok(current)
  const headers = sessionHeaders(current.owner.id, 'OWNER')
  for (const confirmation of [undefined, false]) {
    const before = await captureWriteState()
    const response = await postCashierSale(makeRequest('/api/cashier/sales', salePayload('KHQR', confirmation), headers))
    assert.equal(response.status, 409, `KHQR manual confirmation ${String(confirmation)} must return 409`)
    assert.equal((await response.json()).error, 'MANUAL_PAYMENT_CONFIRMATION_REQUIRED')
    assert.deepEqual(await captureWriteState(), before, 'unconfirmed KHQR must not create sales, payments, or state changes')
  }
}

async function testPosDeviceTokenValidation() {
  const current = fixture
  assert.ok(current)
  const runtimeHeaders = validDeviceHeaders('runtime-device')
  const valid = await postCashierSale(makeRequest('/api/cashier/sales', salePayload(), runtimeHeaders))
  assert.equal(valid.status, 201, 'valid pos-device-v1 token must be accepted')
  const device = await prisma.browserPosDevice.findFirstOrThrow({
    where: { tenantId: current.tenant.id, storeId: current.store.id, browserDeviceId: 'runtime-device' },
    select: { id: true, status: true, tokenHash: true, legacyMigratedAt: true },
  })
  assert.equal(device.status, 'ACTIVE', 'first valid legacy token must create an ACTIVE server device')
  assert.ok(device.tokenHash.length >= 32, 'server device must retain a token hash rather than raw token')
  assert.ok(device.legacyMigratedAt, 'first valid legacy token must record its compatibility migration')
  const deviceSale = await prisma.saleRecord.findFirstOrThrow({
    where: { tenantId: current.tenant.id, transactionActorId: device.id },
    select: { transactionActorType: true, transactionActorId: true, authorizedByUserId: true },
  })
  assert.deepEqual(deviceSale, {
    transactionActorType: 'BROWSER_POS_DEVICE',
    transactionActorId: device.id,
    authorizedByUserId: current.owner.id,
  }, 'Browser POS sales must retain the true device actor rather than synthetic OWNER')

  const revoked = await revokeBrowserDevice(
    makeRequest(`/api/cashier/browser-devices/${device.id}/revoke`, { reason: 'runtime test' }, sessionHeaders(current.owner.id, 'OWNER')),
    { params: Promise.resolve({ id: device.id }) },
  )
  assert.equal(revoked.status, 200, 'owner must be able to revoke a Browser POS device')
  await expectForbiddenWithoutWrites('revoked Browser POS device', async () => postCashierSale(
    makeRequest('/api/cashier/sales', salePayload(), runtimeHeaders),
  ))

  const validToken = validDeviceHeaders('tamper-device')['x-pos-device-token']
  const tampered = `${validToken.slice(0, -1)}${validToken.endsWith('A') ? 'B' : 'A'}`
  const invalidCases: Array<{ label: string; headers: Record<string, string> }> = [
    {
      label: 'tampered token',
      headers: { 'x-pos-device-id': 'tamper-device', 'x-pos-device-token': tampered },
    },
    {
      label: 'deviceId mismatch',
      headers: { ...validDeviceHeaders('signed-device'), 'x-pos-device-id': 'different-device' },
    },
    {
      label: 'store mismatch',
      headers: {
        'x-pos-device-id': 'wrong-store-device',
        'x-pos-device-token': signPosDeviceToken({
          tenantId: current.tenant.id,
          storeId: 'wrong-store-id',
          storeCode: 'WRONG-STORE',
          deviceId: 'wrong-store-device',
          issuedBy: current.owner.id,
        }),
      },
    },
    {
      label: 'expired token',
      headers: { 'x-pos-device-id': 'expired-device', 'x-pos-device-token': expiredDeviceToken('expired-device') },
    },
  ]
  for (const invalid of invalidCases) {
    await expectForbiddenWithoutWrites(invalid.label, async () => postCashierSale(
      makeRequest('/api/cashier/sales', salePayload(), invalid.headers),
    ))
  }
}

async function testAuthorizedRegressionPaths() {
  const current = fixture
  assert.ok(current)
  const staffCash = await postCashierSale(makeRequest(
    '/api/cashier/sales',
    salePayload(),
    sessionHeaders(current.staff.id, 'STAFF'),
  ))
  assert.equal(staffCash.status, 201, 'active STAFF session must retain CASH sale access')

  const confirmedKhqr = await postCashierSale(makeRequest(
    '/api/cashier/sales',
    salePayload('KHQR', true),
    sessionHeaders(current.owner.id, 'OWNER'),
  ))
  assert.equal(confirmedKhqr.status, 201, 'manually confirmed KHQR must create a sale')
  const khqrBody = await confirmedKhqr.json()
  const khqrIntent = await prisma.paymentIntent.findUniqueOrThrow({
    where: { id: khqrBody.paymentIntentId },
    select: { status: true, paymentMethod: true },
  })
  assert.deepEqual(khqrIntent, { status: 'PAID', paymentMethod: 'KHQR' })

  const memberPay = await postMemberBalancePay(makeRequest('/api/cashier/member-balance-pay', {
    storeCode: current.store.code,
    memberId: current.member.id,
    items: [{ barcode: current.product.barcode, quantity: 1 }],
  }, sessionHeaders(current.owner.id, 'OWNER')))
  assert.equal(memberPay.status, 201, 'authorized member balance payment must remain available')
  const member = await prisma.member.findUniqueOrThrow({ where: { id: current.member.id }, select: { balance: true } })
  assert.equal(member.balance.toString(), '92.5')

  const offline = await postOfflineSync(makeRequest(
    '/api/cashier/offline-sync',
    offlinePayload(),
    sessionHeaders(current.owner.id, 'OWNER'),
  ))
  assert.equal(offline.status, 200, 'authorized offline sync must remain available')
  const offlineBody = await offline.json()
  assert.equal(offlineBody.successCount, 1)
  assert.equal(offlineBody.failedCount, 0)

  const orderUpdate = await patchCashierOrder(
    makeRequest(`/api/cashier/orders/${current.order.id}?storeCode=${encodeURIComponent(current.store.code)}`, { status: 'CONFIRMED' }, sessionHeaders(current.owner.id, 'OWNER'), 'PATCH'),
    { params: Promise.resolve({ id: current.order.id }) },
  )
  assert.equal(orderUpdate.status, 200, 'authorized order status update must remain available')
  assert.equal((await orderUpdate.json()).status, 'CONFIRMED')
}

async function main() {
  const mutableEnv = process.env as unknown as Record<string, string | undefined>
  const originalNodeEnv = mutableEnv.NODE_ENV
  mutableEnv.NODE_ENV = 'production'
  fixture = await seedFixture()
  try {
    await testPublicStoreCodeWritesFailClosed()
    await testKhqrConfirmationRejectsWithoutWrites()
    await testPosDeviceTokenValidation()
    await testAuthorizedRegressionPaths()
    console.log('desktop POS write fallback runtime tests passed')
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
