import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createDesktopDeviceToken } from '../lib/desktop-activation/crypto'
import { issuePosDeviceSession } from '../lib/desktop-pos-auth'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'

const runtime = new URL(process.env.NATIVE_INVENTORY_UI_TEST_URL ?? 'http://invalid')
const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
const loopback = (url: URL) => ['127.0.0.1', 'localhost'].includes(url.hostname)
if (process.env.NATIVE_INVENTORY_TEST_DATABASE !== '1' || !loopback(runtime) || !loopback(database) ||
    !/^\/native_inventory_test_[a-z0-9_]+$/.test(database.pathname)) {
  throw new Error('An isolated loopback runtime and native_inventory_test_* database are required')
}

test('shared application role preserves catalog, V3 and dining recovery, including permission failure', async (t) => {
  t.after(() => prisma.$disconnect())
  const tenant = await prisma.tenant.create({ data: { name: 'Runtime boundary fixture' } })
  const otherTenant = await prisma.tenant.create({ data: { name: 'Other runtime boundary tenant' } })
  for (const tenantId of [tenant.id, otherTenant.id]) {
    await prisma.tenantSubscription.create({ data: { tenantId, status: 'ACTIVE' } })
  }
  async function fixture(tenantId: string) {
    const store = await prisma.store.create({
      data: { tenantId, code: randomUUID(), name: 'Runtime test store', businessType: 'FOOD' },
    })
    const scope = { tenantId, storeId: store.id }
    const person = await prisma.user.create({
      data: { tenantId, username: randomUUID(), role: 'OWNER', displayName: 'Runtime test owner' },
    })
    await prisma.userStoreRole.create({ data: { ...scope, userId: person.id, role: 'OWNER' } })
    const { token, ...credential } = createDesktopDeviceToken()
    const device = await prisma.desktopDevice.create({ data: { ...scope, installationIdHash: randomUUID(), ...credential } })
    const browserId = 'desktop-' + device.id
    const session = await prisma.$transaction((tx) => issuePosDeviceSession(tx, {
      ...scope, storeCode: store.code, browserDeviceId: browserId, issuedBy: 'DESKTOP_DEVICE',
      issuedByUserId: null, displayName: 'Runtime test desktop',
    }))
    return {
      scope, store, device, token, userId: person.id,
      headers: {
        cookie: 'auth-session=' + signSession({ ...scope, userId: person.id, role: 'OWNER' }),
        'x-lightops-client': 'desktop-pos', 'x-pos-device-id': browserId,
        'x-pos-device-token': session.token, 'x-pos-operator-source': 'ACCOUNT',
      },
    }
  }
  const a = await fixture(tenant.id)
  const b = await fixture(otherTenant.id)
  const peer = await fixture(tenant.id)
  async function request(path: string, status: number, headers: Record<string, string> = a.headers, method = 'GET', body?: object) {
    const response = await fetch(new URL(path, runtime), {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const raw = await response.text()
    assert.equal(response.status, status, method + ' ' + path + ' ' + raw.slice(0, 500))
    return JSON.parse(raw)
  }

  const barcode = randomUUID()
  const product = await request('/api/products', 201, a.headers, 'POST', { barcode, name: 'Catalog fixture', sellPrice: 12 })
  const productPath = '/api/products/' + product.id
  await request(productPath, 404, b.headers, 'PATCH', { name: 'Cross-tenant edit' })
  await request(productPath, 200, a.headers, 'PATCH', { name: 'Edited catalog fixture', sellPrice: 13 })
  const found = await request('/api/products?barcode=' + barcode, 200)
  assert.equal(found.name, 'Edited catalog fixture')
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).sellPrice.toString(), '13')

  const v3 = '/api/desktop/v3-print-control-plane'
  const device = { authorization: 'Bearer ' + a.token }
  const initial = await request(v3, 200, device)
  assert.equal(initial.controlPlane.mode, 'V2_ACTIVE')
  await prisma.v3PrintControlPlane.update({ where: { storeId: a.store.id }, data: { mode: 'V3_ACTIVE' } })
  const acquired = await request(v3, 200, device, 'POST', { action: 'ACQUIRE' })
  assert.equal(acquired.controlPlane.ownerDeviceId, a.device.id)
  const { ownerEpoch, stateVersion, leaseId } = acquired.controlPlane
  const renew = { action: 'RENEW', ownerEpoch, stateVersion, leaseId }
  for (const outsider of [b, peer]) {
    const denied = await request(v3, 409, { authorization: 'Bearer ' + outsider.token }, 'POST', renew)
    assert.equal(denied.error, 'AUTHORITY_STALE_OR_EXPIRED')
  }
  const renewed = await request(v3, 200, device, 'POST', renew)
  assert.equal(renewed.controlPlane.stateVersion, stateVersion + 1)
  assert.equal(renewed.controlPlane.storeId, a.store.id)

  const eligibility = '/api/dine-in/eligibility?storeCode=' + a.store.code
  const tables = '/api/dine-in/tables?storeCode=' + a.store.code
  await request(eligibility, 403, b.headers)
  // Same-tenant owner accounts intentionally span stores; the physical
  // device credential must remain bound to its assigned store.
  await request(eligibility, 403, { ...peer.headers, cookie: '', 'x-pos-operator-source': 'DEVICE' })
  assert.equal((await request(eligibility, 200)).hasActiveMeals, false)
  assert.deepEqual((await request(tables, 200)).recoverable.items, [])
  const table = await request(tables, 201, a.headers, 'POST', { name: 'Runtime table', areaKind: 'HALL' })
  const opened = await request('/api/dine-in/sessions?storeCode=' + a.store.code, 201, a.headers, 'POST', {
    tableId: table.table.id, guestCount: 2, requestKey: randomUUID(),
  })
  assert.equal((await request(eligibility, 200)).hasActiveMeals, true)

  const billNo = 'BILL-' + randomUUID()
  const digest = 'f'.repeat(64)
  await prisma.diningMeal.update({ where: { id: opened.mealId }, data: {
    state: 'VOIDED', billNo, endedAt: new Date(), endedByUserId: a.userId,
    endRequestKey: randomUUID(), endRequestDigest: digest,
  } })
  await prisma.diningBatch.create({ data: {
    ...a.scope, mealId: opened.mealId, seq: 1, kind: 'VOID', reason: 'Fixture notice',
    operatorUserId: a.userId, requestKey: randomUUID(), requestDigest: digest,
    noticeRequired: true, noticeClaimedAt: new Date(), noticeClaimedByUserId: a.userId,
    noticeContentDigest: digest,
  } })
  await prisma.v3PrintControlPlane.update({ where: { storeId: a.store.id }, data: { mode: 'V2_ACTIVE' } })
  const pending = await request(eligibility, 200)
  assert.deepEqual([pending.eligible, pending.hasActiveMeals], [false, true])
  const recovery = (await request(tables, 200)).recoverable
  assert.deepEqual(recovery.items.map((entry: { mealId: string; voidNoticeSeqs: number[] }) => [entry.mealId, entry.voidNoticeSeqs]),
    [[opened.mealId, [1]]])
  const idempotencyKey = 'network:' + createHash('sha256').update('cashier-network-v2:' + billNo + '.1:KITCHEN').digest('hex')
  await prisma.eshopTrayPrintJob.create({ data: {
    ...a.scope, idempotencyKey, requestHash: digest, schemaVersion: 3, payload: {},
    status: 'SUCCEEDED', expiresAt: new Date(Date.now() + 60_000), completedAt: new Date(),
    effectBoundary: 'CROSSED', resultStatus: 'CROSSED', resultCode: 'FIXTURE',
  } })
  assert.equal((await request(eligibility, 200)).hasActiveMeals, false)
  assert.deepEqual((await request(tables, 200)).recoverable.items, [])

  // Run the negative case on an empty store. The app uses a distinct login,
  // while this test's fixture connection owns the disposable database.
  const empty = '/api/dine-in/eligibility?storeCode=' + peer.store.code
  const emptyTables = '/api/dine-in/tables?storeCode=' + peer.store.code
  await prisma.$executeRaw`REVOKE SELECT ON TABLE public."DiningBatch" FROM eshop_app_runtime`
  try {
    const unknown = await request(empty, 200, peer.headers)
    assert.equal(unknown.hasActiveMeals, null)
    assert.equal(unknown.recoveryAvailable, true)
    assert.equal((await request(emptyTables, 200, peer.headers)).recoverable, null)
  } finally {
    await prisma.$executeRaw`GRANT SELECT ON TABLE public."DiningBatch" TO eshop_app_runtime`
  }
  assert.equal((await request(empty, 200, peer.headers)).hasActiveMeals, false)
})
