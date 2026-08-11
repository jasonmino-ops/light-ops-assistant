import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { createDesktopDeviceToken } from '../lib/desktop-activation/crypto'
import { PUT as putBinding } from '../app/api/store-runtime/printer-binding/route'
import { POST as createTask } from '../app/api/store-runtime/print-tasks/route'
import { POST as bootstrapRuntime } from '../app/api/store-runtime/runtime/bootstrap/route'
import { POST as claimTask } from '../app/api/store-runtime/runtime/tasks/claim/route'
import { POST as updateTask } from '../app/api/store-runtime/runtime/tasks/[taskId]/status/route'

if (process.env.STORE_RUNTIME_TEST_DATABASE !== '1') {
  throw new Error('STORE_RUNTIME_TEST_DATABASE=1 is required for Store Runtime database tests')
}
if (!process.env.DATABASE_URL || !process.env.DESKTOP_DEVICE_TOKEN_SECRET || !process.env.DESKTOP_ACTIVATION_PIN_SECRET) {
  throw new Error('Store Runtime database and Desktop activation secrets are required')
}

function accountRequest(input: {
  url: string
  method: 'POST' | 'PUT'
  tenantId: string
  storeId: string
  userId: string
  body: unknown
}) {
  return new NextRequest(input.url, {
    method: input.method,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': input.tenantId,
      'x-store-id': input.storeId,
      'x-user-id': input.userId,
      'x-role': 'OWNER',
    },
    body: JSON.stringify(input.body),
  })
}

function runtimeRequest(url: string, deviceToken: string, body?: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deviceToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function receipt(storeCode: string, suffix: string, total = 2.5) {
  return {
    schemaVersion: '1',
    receiptId: `receipt-${suffix}`,
    orderNumber: `ORDER-${suffix}`,
    storeName: 'E-Shop Runtime Test',
    storeCode,
    timestamp: '2026-08-11T00:00:00.000Z',
    currencyCode: 'USD',
    items: [{ name: '咖啡 / Coffee / កាហ្វេ', quantity: 1, unitPrice: total, lineTotal: total }],
    subtotal: total,
    total,
  }
}

async function run() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: { name: `store-runtime-${suffix}`, status: 'ACTIVE', tier: 'STANDARD' },
  })
  try {
    const store = await prisma.store.create({
      data: { tenantId: tenant.id, code: `SR-${suffix}`, name: 'Store Runtime Test', status: 'ACTIVE' },
    })
    const owner = await prisma.user.create({
      data: { tenantId: tenant.id, username: `owner-${suffix}`, displayName: 'Owner', role: 'OWNER', status: 'ACTIVE' },
    })
    await prisma.userStoreRole.create({
      data: { tenantId: tenant.id, storeId: store.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    })
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'ACTIVE' } })
    const token = createDesktopDeviceToken()
    const device = await prisma.desktopDevice.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        installationIdHash: `installation-${suffix}`,
        status: 'ACTIVE',
        activeSlot: 'ACTIVE',
        tokenHash: token.tokenHash,
        tokenHashVersion: token.tokenHashVersion,
        tokenVersion: 1,
        tokenIssuedAt: token.tokenIssuedAt,
        tokenExpiresAt: token.tokenExpiresAt,
      },
    })

    const bindingResponse = await putBinding(accountRequest({
      url: 'http://localhost/api/store-runtime/printer-binding',
      method: 'PUT',
      tenantId: tenant.id,
      storeId: store.id,
      userId: owner.id,
      body: { targetType: 'WINDOWS_QUEUE', printerName: 'EPSON TM-T82', enabled: true },
    }))
    assert.equal(bindingResponse.status, 200)
    const bindingBody = await bindingResponse.json() as { binding: { id: string; version: number; printerName: string } }
    assert.equal(bindingBody.binding.printerName, 'EPSON TM-T82')
    assert.equal(bindingBody.binding.version, 1)

    const bootstrapResponse = await bootstrapRuntime(runtimeRequest(
      'http://localhost/api/store-runtime/runtime/bootstrap',
      token.token,
    ))
    assert.equal(bootstrapResponse.status, 200)
    const bootstrapBody = await bootstrapResponse.json() as { runtime: { device: { deviceId: string; storeId: string } }; binding: { id: string } }
    assert.equal(bootstrapBody.runtime.device.deviceId, device.id)
    assert.equal(bootstrapBody.runtime.device.storeId, store.id)
    assert.equal(bootstrapBody.binding.id, bindingBody.binding.id)

    const input = {
      taskType: 'PRINT_RECEIPT',
      schemaVersion: 1,
      idempotencyKey: `receipt:${suffix}`,
      receipt: receipt(store.code, suffix),
    }
    const firstCreate = await createTask(accountRequest({
      url: 'http://localhost/api/store-runtime/print-tasks',
      method: 'POST',
      tenantId: tenant.id,
      storeId: store.id,
      userId: owner.id,
      body: input,
    }))
    assert.equal(firstCreate.status, 201)
    const firstBody = await firstCreate.json() as { created: boolean; task: { id: string; status: string } }
    assert.equal(firstBody.created, true)
    assert.equal(firstBody.task.status, 'PENDING')

    const duplicateCreate = await createTask(accountRequest({
      url: 'http://localhost/api/store-runtime/print-tasks',
      method: 'POST',
      tenantId: tenant.id,
      storeId: store.id,
      userId: owner.id,
      body: input,
    }))
    assert.equal(duplicateCreate.status, 200)
    const duplicateBody = await duplicateCreate.json() as { created: boolean; task: { id: string } }
    assert.equal(duplicateBody.created, false)
    assert.equal(duplicateBody.task.id, firstBody.task.id)

    const conflictCreate = await createTask(accountRequest({
      url: 'http://localhost/api/store-runtime/print-tasks',
      method: 'POST',
      tenantId: tenant.id,
      storeId: store.id,
      userId: owner.id,
      body: { ...input, receipt: receipt(store.code, suffix, 9.99) },
    }))
    assert.equal(conflictCreate.status, 409)
    assert.equal((await conflictCreate.json() as { error: string }).error, 'STORE_RUNTIME_IDEMPOTENCY_CONFLICT')

    const invalidCreate = await createTask(accountRequest({
      url: 'http://localhost/api/store-runtime/print-tasks',
      method: 'POST',
      tenantId: tenant.id,
      storeId: store.id,
      userId: owner.id,
      body: { ...input, taskType: 'RUN_SCRIPT', idempotencyKey: `invalid:${suffix}` },
    }))
    assert.equal(invalidCreate.status, 400)
    assert.equal((await invalidCreate.json() as { error: string }).error, 'STORE_RUNTIME_UNSUPPORTED_TASK')

    const claimedResponse = await claimTask(runtimeRequest(
      'http://localhost/api/store-runtime/runtime/tasks/claim',
      token.token,
    ))
    assert.equal(claimedResponse.status, 200)
    const claimedBody = await claimedResponse.json() as { task: { id: string; status: string; claimedByDeviceId: string; attemptCount: number } }
    assert.equal(claimedBody.task.id, firstBody.task.id)
    assert.equal(claimedBody.task.status, 'ACCEPTED')
    assert.equal(claimedBody.task.claimedByDeviceId, device.id)
    assert.equal(claimedBody.task.attemptCount, 1)

    const executing = await updateTask(
      runtimeRequest(
        `http://localhost/api/store-runtime/runtime/tasks/${firstBody.task.id}/status`,
        token.token,
        { state: 'EXECUTING' },
      ),
      { params: Promise.resolve({ taskId: firstBody.task.id }) },
    )
    assert.equal(executing.status, 200)
    assert.equal((await executing.json() as { task: { status: string } }).task.status, 'EXECUTING')

    const result = {
      state: 'SUCCEEDED',
      resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
      message: 'Windows accepted the print job; physical paper output is not confirmed.',
      effectBoundary: 'CROSSED',
      physicalCompletionKnown: false,
    }
    const completed = await updateTask(
      runtimeRequest(
        `http://localhost/api/store-runtime/runtime/tasks/${firstBody.task.id}/status`,
        token.token,
        result,
      ),
      { params: Promise.resolve({ taskId: firstBody.task.id }) },
    )
    assert.equal(completed.status, 200)
    const completedBody = await completed.json() as { task: { status: string; result: { code: string; physicalCompletionKnown: boolean } } }
    assert.equal(completedBody.task.status, 'SUCCEEDED')
    assert.equal(completedBody.task.result.code, 'SUBMITTED_TO_WINDOWS_SPOOLER')
    assert.equal(completedBody.task.result.physicalCompletionKnown, false)

    const duplicateResult = await updateTask(
      runtimeRequest(
        `http://localhost/api/store-runtime/runtime/tasks/${firstBody.task.id}/status`,
        token.token,
        result,
      ),
      { params: Promise.resolve({ taskId: firstBody.task.id }) },
    )
    assert.equal(duplicateResult.status, 200)

    const conflictingResult = await updateTask(
      runtimeRequest(
        `http://localhost/api/store-runtime/runtime/tasks/${firstBody.task.id}/status`,
        token.token,
        { ...result, state: 'FAILED', resultCode: 'CONFLICTING_RESULT' },
      ),
      { params: Promise.resolve({ taskId: firstBody.task.id }) },
    )
    assert.equal(conflictingResult.status, 409)
    assert.equal((await conflictingResult.json() as { error: string }).error, 'STORE_RUNTIME_RESULT_CONFLICT')

    const emptyClaim = await claimTask(runtimeRequest(
      'http://localhost/api/store-runtime/runtime/tasks/claim',
      token.token,
    ))
    assert.equal(emptyClaim.status, 200)
    assert.equal((await emptyClaim.json() as { task: unknown }).task, null)
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

run()
  .then(async () => {
    console.log('Store Runtime Cloud ingress integration tests passed')
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
