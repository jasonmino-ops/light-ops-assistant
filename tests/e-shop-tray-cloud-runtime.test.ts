import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { createDesktopDeviceToken } from '../lib/desktop-activation/crypto'
import { POST as createTask } from '../app/api/store-runtime/print-tasks/route'
import { POST as bootstrapRuntime } from '../app/api/store-runtime/runtime/bootstrap/route'
import { POST as claimTask } from '../app/api/store-runtime/runtime/tasks/claim/route'
import { POST as updateTask } from '../app/api/store-runtime/runtime/tasks/[taskId]/status/route'
import { claimStoreRuntimePrintTask } from '../lib/store-runtime/service'

if (process.env.ESHOP_TRAY_CLOUD_TEST_DATABASE !== '1') throw new Error('ESHOP_TRAY_CLOUD_TEST_DATABASE=1 is required')

function ownerRequest(url: string, tenantId: string, storeId: string, userId: string, body: unknown, role = 'OWNER') {
  return new NextRequest(url, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-tenant-id': tenantId, 'x-store-id': storeId, 'x-user-id': userId, 'x-role': role,
  }, body: JSON.stringify(body) })
}

function runtimeRequest(url: string, token: string, body?: unknown) {
  return new NextRequest(url, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) })
}

function printInput(suffix: string, changed = false) {
  const bytes = Buffer.from(changed ? [0x1b, 0x40, 0x02] : [0x1b, 0x40, 0x01])
  return {
    taskType: 'PRINT_ESC_POS', schemaVersion: 1,
    idempotencyKey: `eshop-tray:ORDER-${suffix}:request-${suffix}`,
    storeCode: 'ST169E7000', target: { type: 'WINDOWS_QUEUE', name: '前台' }, documentName: `E-Shop ORDER-${suffix}`,
    commandStream: { encoding: 'base64', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') },
  }
}

async function device(tenantId: string, storeId: string, suffix: string) {
  const token = createDesktopDeviceToken()
  const row = await prisma.desktopDevice.create({ data: {
    tenantId, storeId, installationIdHash: `installation-${suffix}`, status: 'ACTIVE', activeSlot: 'ACTIVE',
    tokenHash: token.tokenHash, tokenHashVersion: token.tokenHashVersion, tokenVersion: 1,
    tokenIssuedAt: token.tokenIssuedAt, tokenExpiresAt: token.tokenExpiresAt,
  } })
  return { row, token: token.token }
}

async function main() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({ data: { name: `tray-field-${suffix}`, status: 'ACTIVE', tier: 'STANDARD' } })
  try {
    const fieldStore = await prisma.store.create({ data: { tenantId: tenant.id, code: 'ST169E7000', name: 'FIELD Store', status: 'ACTIVE' } })
    const otherStore = await prisma.store.create({ data: { tenantId: tenant.id, code: `OTHER-${suffix.toUpperCase()}`, name: 'Other Store', status: 'ACTIVE' } })
    const owner = await prisma.user.create({ data: { tenantId: tenant.id, username: `owner-${suffix}`, displayName: 'Owner', role: 'OWNER', status: 'ACTIVE' } })
    await prisma.userStoreRole.createMany({ data: [
      { tenantId: tenant.id, storeId: fieldStore.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
      { tenantId: tenant.id, storeId: otherStore.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    ] })
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'ACTIVE' } })
    const primary = await device(tenant.id, fieldStore.id, `${suffix}-primary`)
    const secondary = await device(tenant.id, fieldStore.id, `${suffix}-secondary`)
    const other = await device(tenant.id, otherStore.id, `${suffix}-other`)

    const bootstrap = await bootstrapRuntime(runtimeRequest('http://localhost/api/store-runtime/runtime/bootstrap', primary.token))
    assert.equal(bootstrap.status, 200)
    assert.equal((await bootstrap.json() as { runtime: { device: { storeCode: string } } }).runtime.device.storeCode, 'ST169E7000')
    const otherBootstrap = await bootstrapRuntime(runtimeRequest('http://localhost/api/store-runtime/runtime/bootstrap', other.token))
    assert.equal(otherBootstrap.status, 404)

    const input = printInput(suffix)
    const created = await createTask(ownerRequest('http://localhost/api/store-runtime/print-tasks', tenant.id, fieldStore.id, owner.id, input))
    assert.equal(created.status, 201)
    const createdBody = await created.json() as { created: boolean; task: { id: string; status: string; storeCode: string } }
    assert.equal(createdBody.created, true)
    assert.equal(createdBody.task.status, 'ACCEPTED')
    assert.equal(createdBody.task.storeCode, 'ST169E7000')

    const duplicate = await createTask(ownerRequest('http://localhost/api/store-runtime/print-tasks', tenant.id, fieldStore.id, owner.id, input))
    assert.equal(duplicate.status, 200)
    assert.equal((await duplicate.json() as { task: { id: string } }).task.id, createdBody.task.id)
    const conflict = await createTask(ownerRequest('http://localhost/api/store-runtime/print-tasks', tenant.id, fieldStore.id, owner.id, printInput(suffix, true)))
    assert.equal(conflict.status, 409)
    const staff = await createTask(ownerRequest('http://localhost/api/store-runtime/print-tasks', tenant.id, fieldStore.id, owner.id, printInput(`${suffix}-staff`), 'STAFF'))
    assert.equal(staff.status, 403)
    const otherStoreCreate = await createTask(ownerRequest('http://localhost/api/store-runtime/print-tasks', tenant.id, otherStore.id, owner.id, { ...printInput(`${suffix}-other`), storeCode: otherStore.code }))
    assert.equal(otherStoreCreate.status, 404)

    const claimed = await claimTask(runtimeRequest('http://localhost/api/store-runtime/runtime/tasks/claim', primary.token))
    assert.equal(claimed.status, 200)
    const claimedTask = (await claimed.json() as { task: { id: string; status: string; claimedByDeviceId: string } }).task
    assert.equal(claimedTask.id, createdBody.task.id)
    assert.equal(claimedTask.status, 'CLAIMED')
    assert.equal(claimedTask.claimedByDeviceId, primary.row.id)

    const executing = await updateTask(runtimeRequest(`http://localhost/api/store-runtime/runtime/tasks/${claimedTask.id}/status`, primary.token, { state: 'EXECUTING' }), { params: Promise.resolve({ taskId: claimedTask.id }) })
    assert.equal(executing.status, 200)
    const result = { state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER', effectBoundary: 'CROSSED', physicalCompletionKnown: false }
    const completed = await updateTask(runtimeRequest(`http://localhost/api/store-runtime/runtime/tasks/${claimedTask.id}/status`, primary.token, result), { params: Promise.resolve({ taskId: claimedTask.id }) })
    assert.equal(completed.status, 200)
    assert.equal((await completed.json() as { task: { status: string } }).task.status, 'SUCCEEDED')
    const repeatedResult = await updateTask(runtimeRequest(`http://localhost/api/store-runtime/runtime/tasks/${claimedTask.id}/status`, primary.token, result), { params: Promise.resolve({ taskId: claimedTask.id }) })
    assert.equal(repeatedResult.status, 200)

    const atomicInput = printInput(`${suffix}-atomic`)
    await createTask(ownerRequest('http://localhost/api/store-runtime/print-tasks', tenant.id, fieldStore.id, owner.id, atomicInput))
    const now = new Date('2026-08-11T10:00:00.000Z')
    const contexts = [primary, secondary].map((entry) => ({ tenantId: tenant.id, storeId: fieldStore.id, deviceId: entry.row.id, tokenHashVersion: 1, tokenVersion: 1, subscription: {} as never }))
    const claims = await Promise.all(contexts.map((context) => claimStoreRuntimePrintTask(context, now)))
    assert.equal(claims.filter((entry) => entry.task !== null).length, 1, 'claim must be atomic')
    const winner = claims.find((entry) => entry.task)?.task as { id: string; attemptCount: number }
    const reclaimed = await claimStoreRuntimePrintTask(contexts[0], new Date(now.getTime() + 31_000))
    assert.equal(reclaimed.task?.id, winner.id)
    assert.equal(reclaimed.task?.attemptCount, 2)
  } finally {
    await prisma.storeRuntimePrintTask.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.storeRuntimePrinterBinding.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.desktopDevice.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.userStoreRole.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.store.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.tenant.delete({ where: { id: tenant.id } })
  }
}

main().then(async () => { console.log('E-Shop Tray Cloud Relay database integration checks passed'); await prisma.$disconnect() })
  .catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1) })
