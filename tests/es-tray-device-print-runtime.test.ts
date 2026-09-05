import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import {
  hashBrowserDeviceId,
  hashClaimSecret,
  hashDeviceSecret,
  hashInstallationId,
} from '../lib/computer-client/crypto'
import {
  hashPosDeviceToken,
  signPosDeviceToken,
} from '../lib/desktop-pos-auth'
import { authenticateDeviceRelayPrincipal } from '../lib/es-tray-relay/device-auth'
import { handleDeviceRelayOrderDetailRequest } from '../lib/es-tray-relay/device-order-route'
import {
  handleDeviceRelayConfigRequest,
  handleDeviceRelayEnqueueRequest,
} from '../lib/es-tray-relay/device-routes'

if (process.env.ES_TRAY_DEVICE_TEST_DATABASE !== '1') {
  throw new Error('ES_TRAY_DEVICE_TEST_DATABASE=1 is required')
}
if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET || !process.env.COMPUTER_CLIENT_TOKEN_SECRET) {
  throw new Error('DATABASE_URL, AUTH_SECRET, and COMPUTER_CLIENT_TOKEN_SECRET are required')
}

type Seed = Awaited<ReturnType<typeof seedDeviceScope>>

function suffix(label: string) {
  return `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

async function seedDeviceScope(label: string) {
  const value = suffix(label)
  const tenant = await prisma.tenant.create({
    data: { name: value, status: 'ACTIVE', tier: 'STANDARD' },
  })
  const store = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      code: value.slice(0, 80),
      name: `${label} store`,
      status: 'ACTIVE',
    },
  })
  const binding = await prisma.computerBinding.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      installationIdHash: hashInstallationId(`installation_${randomUUID().replaceAll('-', '_')}`),
      computerName: `${label}-computer`,
      agentVersion: '0.4.7',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + 86_400_000),
      claimSecretHash: hashClaimSecret(`ecr_v1_${randomUUID().replaceAll('-', '').repeat(2)}`),
      deviceSecretHash: hashDeviceSecret(`ecc_v1_${randomUUID().replaceAll('-', '').repeat(2)}`),
      credentialStatus: 'ACTIVE',
      credentialActivatedAt: new Date(),
      credentialExpiresAt: new Date(Date.now() + 86_400_000),
      boundAt: new Date(),
    },
  })
  const browserDeviceId = `browser_${randomUUID().replaceAll('-', '_')}`
  const sessionId = randomUUID()
  const token = signPosDeviceToken({
    tenantId: tenant.id,
    storeId: store.id,
    storeCode: store.code,
    deviceId: browserDeviceId,
    issuedBy: 'computer-binding',
    browserPosSessionId: sessionId,
  })
  const now = new Date()
  await prisma.browserPosDevice.create({
    data: {
      id: sessionId,
      tenantId: tenant.id,
      storeId: store.id,
      browserDeviceId,
      displayName: binding.computerName,
      status: 'ACTIVE',
      activeSlot: 'ACTIVE',
      tokenHash: hashPosDeviceToken(token),
      tokenHashVersion: 1,
      tokenIssuedAt: now,
      tokenExpiresAt: new Date(now.getTime() + 86_400_000),
      scopes: ['BROWSER_POS'],
      activatedAt: now,
    },
  })
  const launchTicket = await prisma.computerBrowserLaunchTicket.create({
    data: {
      bindingId: binding.id,
      ticketHash: createHash('sha256').update(randomUUID()).digest('hex'),
      expiresAt: new Date(now.getTime() + 60_000),
      usedAt: now,
      browserDeviceIdHash: hashBrowserDeviceId(browserDeviceId),
      browserPosDeviceId: sessionId,
    },
  })
  const order = await prisma.customerOrder.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      storeCode: store.code,
      orderNo: `ORDER-${randomUUID()}`,
      itemsJson: JSON.stringify([{
        name: 'Device Test Item', quantity: 1, price: 1.25, lineAmount: 1.25,
      }]),
      totalAmount: '1.25',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      paidAt: now,
    },
  })
  return { tenant, store, binding, browserDeviceId, sessionId, token, launchTicket, order }
}

function headers(seed: Seed, overrides?: Record<string, string>) {
  return {
    'x-pos-device-id': seed.browserDeviceId,
    'x-pos-device-token': seed.token,
    'x-lightops-client': 'desktop-pos',
    ...overrides,
  }
}

function request(
  path: string,
  seed?: Seed,
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  const requestHeaders = new Headers()
  if (seed) {
    for (const [name, value] of Object.entries(headers(seed))) {
      requestHeaders.set(name, value)
    }
  }
  new Headers(init?.headers).forEach((value, name) => requestHeaders.set(name, value))
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: requestHeaders,
  })
}

function printBody(seed: Seed, overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from([0x1b, 0x40, 0x0a])
  return {
    relayVersion: '0.1',
    requestId: `device-print:${randomUUID()}`,
    orderNo: seed.order.orderNo,
    documentName: `E-Shop ${seed.order.orderNo}`,
    target: { transport: 'windows-queue', queueName: '前台' },
    commandStream: {
      encoding: 'base64',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data: bytes.toString('base64'),
    },
    ...overrides,
  }
}

async function body(response: Response) {
  return await response.json() as Record<string, unknown>
}

let cases = 0
async function test(name: string, run: () => Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await test('DEVICE-ONLY config succeeds with no OWNER cookie', async () => {
    const seed = await seedDeviceScope('device-config')
    const response = await handleDeviceRelayConfigRequest(
      request('/api/es-tray-02/device/config', seed),
    )
    assert.equal(response.status, 200)
    assert.deepEqual(await body(response), {
      fieldOnly: true,
      productionContract: true,
      enabled: true,
    })
  })

  await test('DEVICE-ONLY order detail succeeds only inside the binding store', async () => {
    const seed = await seedDeviceScope('device-detail')
    const response = await handleDeviceRelayOrderDetailRequest(
      request(`/api/es-tray-02/device/orders/${seed.order.orderNo}`, seed),
      seed.order.orderNo,
    )
    assert.equal(response.status, 200)
    const detail = await body(response)
    assert.equal(detail.orderNo, seed.order.orderNo)
    assert.equal(detail.storeName, seed.store.name)
  })

  await test('DEVICE-ONLY reads the real POS SaleRecord receipt shape without an OWNER session', async () => {
    const seed = await seedDeviceScope('device-sale-record')
    const operator = await prisma.user.create({
      data: {
        tenantId: seed.tenant.id,
        username: suffix('cashier-user'),
        displayName: 'Device Cashier',
        role: 'STAFF',
        status: 'ACTIVE',
      },
    })
    const orderNo = `POS-${randomUUID()}`
    await prisma.saleRecord.create({
      data: {
        tenantId: seed.tenant.id,
        storeId: seed.store.id,
        operatorUserId: operator.id,
        recordNo: `REC-${randomUUID()}`,
        saleType: 'SALE',
        status: 'COMPLETED',
        barcode: 'DEVICE-TEST-BARCODE',
        productNameSnapshot: 'POS Device Item',
        unitPrice: '2.50',
        quantity: '2',
        lineAmount: '5.00',
        orderNo,
      },
    })
    await prisma.paymentIntent.create({
      data: {
        tenantId: seed.tenant.id,
        storeId: seed.store.id,
        operatorUserId: operator.id,
        orderNo,
        paymentMethod: 'CASH',
        status: 'PAID',
        amount: '5.00',
        paidAt: new Date(),
      },
    })
    const response = await handleDeviceRelayOrderDetailRequest(
      request(`/api/es-tray-02/device/orders/${orderNo}`, seed),
      orderNo,
    )
    assert.equal(response.status, 200)
    const detail = await body(response)
    assert.equal(detail.operatorDisplayName, operator.displayName)
    assert.equal(detail.totalAmount, 5)
    assert.equal(detail.paymentStatus, 'PAID')
  })

  await test('DEVICE-ONLY enqueue persists a PrintJob in the derived tenant/store', async () => {
    const seed = await seedDeviceScope('device-enqueue')
    const payload = printBody(seed)
    const response = await handleDeviceRelayEnqueueRequest(
      request('/api/es-tray-02/device/print-jobs', seed, {
        method: 'POST', body: JSON.stringify(payload),
      }),
    )
    assert.equal(response.status, 202)
    const responseJson = await body(response)
    const job = await prisma.eshopTrayPrintJob.findUniqueOrThrow({
      where: { id: String(responseJson.jobId) },
    })
    assert.equal(job.tenantId, seed.tenant.id)
    assert.equal(job.storeId, seed.store.id)
    assert.equal(job.idempotencyKey, payload.requestId)
  })

  await test('same device idempotency key and payload returns the original job', async () => {
    const seed = await seedDeviceScope('device-idempotency')
    const payload = printBody(seed)
    const first = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', seed, {
      method: 'POST', body: JSON.stringify(payload),
    }))
    const second = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', seed, {
      method: 'POST', body: JSON.stringify(payload),
    }))
    const a = await body(first)
    const b = await body(second)
    assert.equal(a.jobId, b.jobId)
    assert.equal(a.created, true)
    assert.equal(b.created, false)
  })

  await test('same device idempotency key with different bytes returns 409', async () => {
    const seed = await seedDeviceScope('device-conflict')
    const payload = printBody(seed)
    await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', seed, {
      method: 'POST', body: JSON.stringify(payload),
    }))
    const bytes = Buffer.from([0x1b, 0x40, 0x0d])
    const conflict = {
      ...payload,
      commandStream: {
        encoding: 'base64',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        data: bytes.toString('base64'),
      },
    }
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', seed, {
      method: 'POST', body: JSON.stringify(conflict),
    }))
    assert.equal(response.status, 409)
  })

  await test('a valid device cannot read an order from another tenant', async () => {
    const seed = await seedDeviceScope('device-tenant-a')
    const other = await seedDeviceScope('device-tenant-b')
    const response = await handleDeviceRelayOrderDetailRequest(
      request(`/api/es-tray-02/device/orders/${other.order.orderNo}`, seed),
      other.order.orderNo,
    )
    assert.equal(response.status, 404)
  })

  await test('a valid device cannot enqueue an order from another tenant', async () => {
    const seed = await seedDeviceScope('device-tenant-enqueue-a')
    const other = await seedDeviceScope('device-tenant-enqueue-b')
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', seed, {
      method: 'POST', body: JSON.stringify(printBody(seed, { orderNo: other.order.orderNo })),
    }))
    assert.equal(response.status, 404)
  })

  await test('a valid device cannot read an order from another store in its tenant', async () => {
    const seed = await seedDeviceScope('device-store-a')
    const store = await prisma.store.create({
      data: {
        tenantId: seed.tenant.id,
        code: suffix('device-store-b').slice(0, 80),
        name: 'other store',
        status: 'ACTIVE',
      },
    })
    const order = await prisma.customerOrder.create({
      data: {
        tenantId: seed.tenant.id,
        storeId: store.id,
        storeCode: store.code,
        orderNo: `ORDER-${randomUUID()}`,
        itemsJson: '[]',
        totalAmount: '0',
      },
    })
    const response = await handleDeviceRelayOrderDetailRequest(
      request(`/api/es-tray-02/device/orders/${order.orderNo}`, seed),
      order.orderNo,
    )
    assert.equal(response.status, 404)
  })

  await test('a valid device cannot enqueue an order from another store in its tenant', async () => {
    const seed = await seedDeviceScope('device-store-enqueue-a')
    const store = await prisma.store.create({
      data: {
        tenantId: seed.tenant.id,
        code: suffix('device-store-enqueue-b').slice(0, 80),
        name: 'other enqueue store',
        status: 'ACTIVE',
      },
    })
    const order = await prisma.customerOrder.create({
      data: {
        tenantId: seed.tenant.id,
        storeId: store.id,
        storeCode: store.code,
        orderNo: `ORDER-${randomUUID()}`,
        itemsJson: '[]',
        totalAmount: '0',
      },
    })
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', seed, {
      method: 'POST', body: JSON.stringify(printBody(seed, { orderNo: order.orderNo })),
    }))
    assert.equal(response.status, 404)
  })

  await test('missing Browser POS credentials are rejected', async () => {
    const result = await authenticateDeviceRelayPrincipal(
      request('/api/es-tray-02/device/config'),
    )
    assert.deepEqual(result, { ok: false, status: 401, error: 'POS_DEVICE_AUTH_REQUIRED' })
  })

  await test('a forged Browser POS token is rejected', async () => {
    const seed = await seedDeviceScope('device-forged')
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed, {
      headers: { 'x-pos-device-token': `${seed.token}forged` },
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })

  await test('a valid token presented for a different browser device is rejected', async () => {
    const seed = await seedDeviceScope('device-stolen')
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed, {
      headers: { 'x-pos-device-id': `browser_${randomUUID().replaceAll('-', '_')}` },
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })

  await test('a revoked BrowserPosDevice session is rejected', async () => {
    const seed = await seedDeviceScope('device-session-revoked')
    await prisma.browserPosDevice.update({
      where: { id: seed.sessionId },
      data: { status: 'REVOKED', activeSlot: null, revokedAt: new Date() },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_SESSION_INACTIVE')
  })

  await test('an expired BrowserPosDevice session is rejected', async () => {
    const seed = await seedDeviceScope('device-session-expired')
    await prisma.browserPosDevice.update({
      where: { id: seed.sessionId },
      data: { tokenExpiresAt: new Date(Date.now() - 1_000) },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_SESSION_INACTIVE')
  })

  await test('a BrowserPosDevice session without BROWSER_POS scope is rejected', async () => {
    const seed = await seedDeviceScope('device-session-scope')
    await prisma.browserPosDevice.update({
      where: { id: seed.sessionId }, data: { scopes: [] },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_SESSION_INACTIVE')
  })

  await test('a Browser POS session without its consumed launch ticket is rejected', async () => {
    const seed = await seedDeviceScope('device-link-missing')
    await prisma.computerBrowserLaunchTicket.delete({ where: { id: seed.launchTicket.id } })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_NOT_COMPUTER_BOUND')
  })

  await test('ambiguous duplicate launch-ticket linkage is rejected fail-closed', async () => {
    const seed = await seedDeviceScope('device-link-duplicate')
    await prisma.computerBrowserLaunchTicket.create({
      data: {
        bindingId: seed.binding.id,
        ticketHash: createHash('sha256').update(randomUUID()).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
        browserDeviceIdHash: hashBrowserDeviceId(seed.browserDeviceId),
        browserPosDeviceId: seed.sessionId,
      },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_NOT_COMPUTER_BOUND')
  })

  await test('a launch ticket without consumed-at evidence is rejected', async () => {
    const seed = await seedDeviceScope('device-link-unused')
    await prisma.computerBrowserLaunchTicket.update({
      where: { id: seed.launchTicket.id }, data: { usedAt: null },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_LAUNCH_PROOF_INVALID')
  })

  await test('a launch ticket linked to the wrong browser device is rejected', async () => {
    const seed = await seedDeviceScope('device-link-wrong-device')
    await prisma.computerBrowserLaunchTicket.update({
      where: { id: seed.launchTicket.id },
      data: { browserDeviceIdHash: hashBrowserDeviceId(`browser_${randomUUID().replaceAll('-', '_')}`) },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_LAUNCH_PROOF_INVALID')
  })

  await test('a disabled ComputerBinding makes config disabled and enqueue forbidden', async () => {
    const seed = await seedDeviceScope('device-disabled')
    await prisma.computerBinding.update({ where: { id: seed.binding.id }, data: { disabledAt: new Date() } })
    const config = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config', seed))
    const enqueue = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', seed, {
      method: 'POST', body: JSON.stringify(printBody(seed)),
    }))
    assert.equal((await body(config)).enabled, false)
    assert.equal(enqueue.status, 403)
  })

  await test('a non-APPROVED ComputerBinding is unavailable', async () => {
    const seed = await seedDeviceScope('device-not-approved')
    await prisma.computerBinding.update({ where: { id: seed.binding.id }, data: { status: 'REJECTED' } })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.context.unavailableReason, 'COMPUTER_BINDING_NOT_APPROVED')
  })

  await test('an unbound ComputerBinding is unavailable', async () => {
    const seed = await seedDeviceScope('device-unbound')
    await prisma.computerBinding.update({ where: { id: seed.binding.id }, data: { boundAt: null } })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.context.unavailableReason, 'COMPUTER_BINDING_NOT_BOUND')
  })

  await test('a revoked ComputerBinding credential is unavailable', async () => {
    const seed = await seedDeviceScope('device-credential-revoked')
    await prisma.computerBinding.update({
      where: { id: seed.binding.id }, data: { credentialStatus: 'VOID' },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.context.unavailableReason, 'CREDENTIAL_NOT_ACTIVE')
  })

  await test('an expired ComputerBinding credential is unavailable', async () => {
    const seed = await seedDeviceScope('device-credential-expired')
    await prisma.computerBinding.update({
      where: { id: seed.binding.id },
      data: { credentialExpiresAt: new Date(Date.now() - 1_000) },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.context.unavailableReason, 'CREDENTIAL_EXPIRED')
  })

  await test('an inactive tenant disables the delegated print capability', async () => {
    const seed = await seedDeviceScope('device-tenant-inactive')
    await prisma.tenant.update({ where: { id: seed.tenant.id }, data: { status: 'DISABLED' } })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.context.unavailableReason, 'TENANT_INACTIVE')
  })

  await test('an inactive store disables the delegated print capability', async () => {
    const seed = await seedDeviceScope('device-store-inactive')
    await prisma.store.update({ where: { id: seed.store.id }, data: { status: 'DISABLED' } })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.context.unavailableReason, 'STORE_INACTIVE')
  })

  await test('a signed token with forged tenant/store scope is rejected', async () => {
    const seed = await seedDeviceScope('device-scope-forged')
    const forged = signPosDeviceToken({
      tenantId: 'forged-tenant',
      storeId: 'forged-store',
      storeCode: 'FORGED',
      deviceId: seed.browserDeviceId,
      issuedBy: 'computer-binding',
      browserPosSessionId: seed.sessionId,
    })
    await prisma.browserPosDevice.update({
      where: { id: seed.sessionId }, data: { tokenHash: hashPosDeviceToken(forged) },
    })
    const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config', seed, {
      headers: { 'x-pos-device-token': forged },
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error, 'POS_DEVICE_SCOPE_MISMATCH')
  })

  console.log(`es-tray device print runtime tests passed (${cases} cases)`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
