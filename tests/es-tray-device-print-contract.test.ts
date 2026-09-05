import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { POST as ownerEnqueue } from '../app/api/es-tray-02/print-jobs/route'
import {
  getOrCreateEshopTray02PrintIntent,
  readEshopTray02CloudEnableState,
  readEshopTray02DeviceCloudEnableState,
  submitEshopTray02CloudPrint,
  submitEshopTray02DeviceCloudPrint,
  type EshopTray02Fetch,
} from '../lib/eShopTrayCloudClient'
import {
  authenticateDeviceRelayPrincipal,
  type DeviceRelayAuthResult,
  type DeviceRelayContext,
} from '../lib/es-tray-relay/device-auth'
import { handleDeviceRelayOrderDetailRequest } from '../lib/es-tray-relay/device-order-route'
import {
  handleDeviceRelayConfigRequest,
  handleDeviceRelayEnqueueRequest,
  type DeviceRelayRouteDependencies,
} from '../lib/es-tray-relay/device-routes'

process.env.COMPUTER_CLIENT_TOKEN_SECRET ||= 'test-device-relay-computer-secret-32-bytes'

const context: DeviceRelayContext = {
  principal: 'BROWSER_POS_DEVICE',
  browserPosDeviceId: 'browser-session-a',
  computerBindingId: 'computer-binding-a',
  tenantId: 'tenant-a',
  storeId: 'store-a',
  storeCode: 'STORE-A',
  enabled: true,
  unavailableReason: null,
}

const acceptedJob = {
  id: 'job-device-001',
  schemaVersion: 1,
  status: 'PENDING',
}

function auth(value: DeviceRelayAuthResult = { ok: true, context }) {
  return async () => value
}

function printBody(overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from([0x1b, 0x40, 0x0a])
  return {
    relayVersion: '0.1',
    requestId: 'desktop-order-print:11111111-2222-4333-8444-555555555555',
    orderNo: 'ORDER-DEVICE-001',
    documentName: 'E-Shop ORDER-DEVICE-001',
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

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://localhost${path}`, init)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function acceptedResponse(requestId: string, created = true) {
  return jsonResponse({
    fieldOnly: true,
    productionContract: true,
    schemaVersion: 1,
    jobId: 'job-device-001',
    requestId,
    status: 'PENDING_RECEIVE',
    created,
  }, 202)
}

async function responseBody(response: Response) {
  return await response.json() as Record<string, unknown>
}

let cases = 0
async function test(name: string, run: () => void | Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await test('device config accepts an authenticated delegated Browser POS principal', async () => {
    const response = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config'), {
      authenticate: auth(),
    })
    assert.equal(response.status, 200)
  })

  await test('device config preserves the frozen Desktop fieldOnly marker', async () => {
    const response = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config'), {
      authenticate: auth(),
    })
    assert.equal((await responseBody(response)).fieldOnly, true)
  })

  await test('eligible device config reports enabled=true', async () => {
    const response = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config'), {
      authenticate: auth(),
    })
    assert.equal((await responseBody(response)).enabled, true)
  })

  await test('device config is never cacheable', async () => {
    const response = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config'), {
      authenticate: auth(),
    })
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  })

  await test('device config exposes no binding, tenant, store, or credential material', async () => {
    const response = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config'), {
      authenticate: auth(),
    })
    assert.deepEqual(Object.keys(await responseBody(response)).sort(), [
      'enabled', 'fieldOnly', 'productionContract',
    ])
  })

  await test('device config rejects a missing device principal', async () => {
    const response = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config'), {
      authenticate: auth({ ok: false, status: 401, error: 'POS_DEVICE_AUTH_REQUIRED' }),
    })
    assert.equal(response.status, 401)
  })

  await test('device authentication fails closed when AUTH_SECRET is absent', async () => {
    const previous = process.env.AUTH_SECRET
    delete process.env.AUTH_SECRET
    try {
      const result = await authenticateDeviceRelayPrincipal(request('/api/es-tray-02/device/config'))
      assert.deepEqual(result, { ok: false, status: 503, error: 'DEVICE_AUTH_NOT_CONFIGURED' })
    } finally {
      if (previous === undefined) delete process.env.AUTH_SECRET
      else process.env.AUTH_SECRET = previous
    }
  })

  await test('an authenticated but inactive binding receives enabled=false', async () => {
    const response = await handleDeviceRelayConfigRequest(request('/api/es-tray-02/device/config'), {
      authenticate: auth({
        ok: true,
        context: { ...context, enabled: false, unavailableReason: 'COMPUTER_DISABLED' },
      }),
    })
    assert.deepEqual(await responseBody(response), {
      fieldOnly: true,
      productionContract: true,
      enabled: false,
    })
  })

  await test('device enqueue uses only the server-derived tenant scope', async () => {
    let scope: { tenantId: string; storeId: string } | null = null
    const dependencies: DeviceRelayRouteDependencies = {
      authenticate: auth(),
      orderExists: async () => true,
      enqueue: async (input) => {
        scope = input
        return { created: true, job: acceptedJob }
      },
    }
    await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', {
      method: 'POST', body: JSON.stringify(printBody()),
    }), dependencies)
    assert.ok(scope)
    assert.equal((scope as { tenantId: string; storeId: string }).tenantId, context.tenantId)
  })

  await test('device enqueue uses only the server-derived store scope', async () => {
    let scope: { tenantId: string; storeId: string } | null = null
    const dependencies: DeviceRelayRouteDependencies = {
      authenticate: auth(),
      orderExists: async () => true,
      enqueue: async (input) => {
        scope = input
        return { created: true, job: acceptedJob }
      },
    }
    await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', {
      method: 'POST', body: JSON.stringify(printBody()),
    }), dependencies)
    assert.ok(scope)
    assert.equal((scope as { tenantId: string; storeId: string }).storeId, context.storeId)
  })

  await test('client tenant/store/binding override fields fail the exact request contract', async () => {
    let enqueueCalls = 0
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', {
      method: 'POST',
      body: JSON.stringify(printBody({
        tenantId: 'tenant-b', storeId: 'store-b', computerBindingId: 'binding-b',
      })),
    }), {
      authenticate: auth(),
      orderExists: async () => true,
      enqueue: async () => {
        enqueueCalls += 1
        return { created: true, job: acceptedJob }
      },
    })
    assert.equal(response.status, 400)
    assert.equal(enqueueCalls, 0)
  })

  await test('device enqueue rejects orders outside its derived scope', async () => {
    let enqueueCalls = 0
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', {
      method: 'POST', body: JSON.stringify(printBody()),
    }), {
      authenticate: auth(),
      orderExists: async () => false,
      enqueue: async () => {
        enqueueCalls += 1
        return { created: true, job: acceptedJob }
      },
    })
    assert.equal(response.status, 404)
    assert.equal(enqueueCalls, 0)
  })

  await test('device enqueue rejects an inactive binding before parsing side effects', async () => {
    let enqueueCalls = 0
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', {
      method: 'POST', body: JSON.stringify(printBody()),
    }), {
      authenticate: auth({
        ok: true,
        context: { ...context, enabled: false, unavailableReason: 'CREDENTIAL_NOT_ACTIVE' },
      }),
      orderExists: async () => true,
      enqueue: async () => {
        enqueueCalls += 1
        return { created: true, job: acceptedJob }
      },
    })
    assert.equal(response.status, 403)
    assert.equal(enqueueCalls, 0)
  })

  await test('device enqueue keeps the target queue fixed to 前台', async () => {
    let observedQueue = ''
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', {
      method: 'POST', body: JSON.stringify(printBody()),
    }), {
      authenticate: auth(),
      orderExists: async () => true,
      enqueue: async (_scope, relayRequest) => {
        observedQueue = relayRequest.target.queueName
        return { created: true, job: acceptedJob }
      },
    })
    assert.equal(response.status, 202)
    assert.equal(observedQueue, '前台')
  })

  await test('device enqueue retains the production response envelope', async () => {
    const response = await handleDeviceRelayEnqueueRequest(request('/api/es-tray-02/device/print-jobs', {
      method: 'POST', body: JSON.stringify(printBody()),
    }), {
      authenticate: auth(),
      orderExists: async () => true,
      enqueue: async () => ({ created: true, job: acceptedJob }),
    })
    const body = await responseBody(response)
    assert.equal(response.status, 202)
    assert.equal(body.productionContract, true)
    assert.equal(body.status, 'PENDING_RECEIVE')
  })

  await test('device order detail receives only server-derived scope', async () => {
    let observed: { tenantId: string; storeId: string } | null = null
    const response = await handleDeviceRelayOrderDetailRequest(
      request('/api/es-tray-02/device/orders/ORDER-DEVICE-001'),
      'ORDER-DEVICE-001',
      {
        authenticate: auth(),
        readOrder: async (scope) => {
          observed = scope
          return { orderNo: 'ORDER-DEVICE-001' }
        },
      },
    )
    assert.equal(response.status, 200)
    assert.deepEqual(observed, { tenantId: context.tenantId, storeId: context.storeId })
  })

  await test('device order detail returns 404 without leaking another scope', async () => {
    const response = await handleDeviceRelayOrderDetailRequest(
      request('/api/es-tray-02/device/orders/ORDER-OTHER'),
      'ORDER-OTHER',
      { authenticate: auth(), readOrder: async () => null },
    )
    assert.equal(response.status, 404)
    assert.deepEqual(await responseBody(response), { error: 'ORDER_NOT_FOUND' })
  })

  await test('device order detail is non-cacheable', async () => {
    const response = await handleDeviceRelayOrderDetailRequest(
      request('/api/es-tray-02/device/orders/ORDER-DEVICE-001'),
      'ORDER-DEVICE-001',
      { authenticate: auth(), readOrder: async () => ({ orderNo: 'ORDER-DEVICE-001' }) },
    )
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  })

  await test('device config client calls only the device endpoint', async () => {
    const calls: string[] = []
    const state = await readEshopTray02DeviceCloudEnableState(async (input) => {
      calls.push(input)
      return jsonResponse({ fieldOnly: true, enabled: true })
    })
    assert.equal(state, 'enabled')
    assert.deepEqual(calls, ['/api/es-tray-02/device/config'])
  })

  await test('owner config client still calls only the OWNER endpoint', async () => {
    const calls: string[] = []
    await readEshopTray02CloudEnableState(async (input) => {
      calls.push(input)
      return jsonResponse({ fieldOnly: true, enabled: true })
    })
    assert.deepEqual(calls, ['/api/es-tray-02/config'])
  })

  const requestId = 'desktop-order-print:11111111-2222-4333-8444-555555555555'
  const commandStream = Uint8Array.from([0x1b, 0x40, 0x0a])

  await test('device print client calls only the device enqueue endpoint', async () => {
    const calls: string[] = []
    await submitEshopTray02DeviceCloudPrint({
      orderNo: 'ORDER-DEVICE-001', requestId, commandStream,
      fetchImpl: async (input) => {
        calls.push(input)
        return acceptedResponse(requestId)
      },
    })
    assert.deepEqual(calls, ['/api/es-tray-02/device/print-jobs'])
  })

  await test('owner print client still calls only the OWNER enqueue endpoint', async () => {
    const calls: string[] = []
    await submitEshopTray02CloudPrint({
      orderNo: 'ORDER-DEVICE-001', requestId, commandStream,
      fetchImpl: async (input) => {
        calls.push(input)
        return acceptedResponse(requestId)
      },
    })
    assert.deepEqual(calls, ['/api/es-tray-02/print-jobs'])
  })

  await test('device retry keeps one idempotency key and exact command bytes', async () => {
    const intent = getOrCreateEshopTray02PrintIntent(null, 'ORDER-DEVICE-001', () => requestId)
    intent.commandStream = commandStream
    assert.equal(getOrCreateEshopTray02PrintIntent(intent, intent.orderNo), intent)
    const bodies: string[] = []
    const capture: EshopTray02Fetch = async (_input, init) => {
      bodies.push(String(init?.body))
      return acceptedResponse(requestId, bodies.length === 1)
    }
    await submitEshopTray02DeviceCloudPrint({ ...intent, commandStream: intent.commandStream, fetchImpl: capture })
    await submitEshopTray02DeviceCloudPrint({ ...intent, commandStream: intent.commandStream, fetchImpl: capture })
    assert.equal(bodies[0], bodies[1])
  })

  const component = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
  const deviceClient = fs.readFileSync('lib/es-tray-device-client.ts', 'utf8')
  const ownerConfigRoute = fs.readFileSync('app/api/es-tray-02/config/route.ts', 'utf8')
  const ownerEnqueueRoute = fs.readFileSync('app/api/es-tray-02/print-jobs/route.ts', 'utf8')
  const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')

  await test('OrderDetailSheet explicitly selects device config only for /desktop/pos', () => {
    assert.match(component, /isDesktopPosDeviceRuntime\(\)[\s\S]*readEshopTray02DeviceCloudEnableState[\s\S]*readEshopTray02CloudEnableState/)
  })

  await test('OrderDetailSheet explicitly selects device-scoped order detail', () => {
    assert.match(component, /isDesktopPosDeviceRuntime\(\)[\s\S]*readDesktopPosDeviceOrderDetail\(orderNo\)[\s\S]*apiFetch\(`\/api\/orders/)
  })

  await test('OrderDetailSheet explicitly selects device enqueue', () => {
    assert.match(component, /isDesktopPosDeviceRuntime\(\)[\s\S]*submitEshopTray02DeviceCloudPrint[\s\S]*submitEshopTray02CloudPrint/)
  })

  await test('device fetch has no OWNER apiFetch fallback', () => {
    assert.doesNotMatch(deviceClient, /\bapiFetch\b|getContext|OWNER/)
    assert.match(deviceClient, /fetch\(input, \{ \.\.\.init, credentials: 'omit', headers \}\)/)
  })

  await test('device fetch explicitly omits account-session cookies', () => {
    assert.match(deviceClient, /credentials: 'omit'/)
  })

  await test('browser device client never reads or transmits deviceSecret', () => {
    assert.doesNotMatch(deviceClient, /deviceSecret|x-installation-id|authorization/i)
  })

  await test('OWNER routes remain independent of Browser POS device auth', () => {
    assert.doesNotMatch(ownerConfigRoute + ownerEnqueueRoute, /DeviceRelay|pos-device|BrowserPos/i)
    assert.match(ownerEnqueueRoute, /ctx\.role !== 'OWNER'/)
  })

  await test('OWNER enqueue remains unavailable without an OWNER session', async () => {
    const response = await ownerEnqueue(request('/api/es-tray-02/print-jobs', {
      method: 'POST', body: JSON.stringify(printBody()),
    }))
    assert.equal(response.status, 401)
    assert.equal((await responseBody(response)).error, 'LOGIN_REQUIRED')
  })

  await test('OWNER enqueue still rejects a non-OWNER identity', async () => {
    const response = await ownerEnqueue(request('/api/es-tray-02/print-jobs', {
      method: 'POST',
      headers: {
        'x-tenant-id': 'tenant-a',
        'x-user-id': 'staff-a',
        'x-store-id': 'store-a',
        'x-role': 'STAFF',
      },
      body: JSON.stringify(printBody()),
    }))
    assert.equal(response.status, 403)
    assert.equal((await responseBody(response)).error, 'OWNER_REQUIRED')
  })

  await test('ambiguous Relay failure still cannot fall back to QZ or browser print', () => {
    const catchStart = component.indexOf('// Retain the intent and exact command bytes')
    const catchEnd = component.indexOf('} finally {', catchStart)
    assert.ok(catchStart > 0 && catchEnd > catchStart)
    assert.doesNotMatch(component.slice(catchStart, catchEnd), /openExistingBrowserPrint|window\.print|qz/i)
  })

  await test('the existing cashier page remains byte-identical to its exact governance approval', () => {
    assert.equal(
      createHash('sha256').update(cashier).digest('hex'),
      '9d1c8aaa8c0ac919dbc75dc18ee9668f3f81f315da46650862a0d14ee2c536b3',
    )
  })

  await test('device routes are isolated from OWNER routes at distinct paths', () => {
    assert.equal(fs.existsSync('app/api/es-tray-02/device/config/route.ts'), true)
    assert.equal(fs.existsSync('app/api/es-tray-02/device/print-jobs/route.ts'), true)
    assert.equal(fs.existsSync('app/api/es-tray-02/device/orders/[orderNo]/route.ts'), true)
  })

  console.log(`es-tray device print contract tests passed (${cases} cases)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
