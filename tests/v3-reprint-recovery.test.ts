import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import {
  getOrCreateV3ReprintIntent,
  readAccountV3ReprintAvailability,
  submitDeviceV3Reprint,
} from '../lib/eShopTrayCloudClient'
import { isDesktopPosDeviceRuntime } from '../lib/es-tray-device-client'
import {
  enqueueV3ManualReprintWithDb,
  parseV3ReprintRequest,
  readV3ReprintAvailabilityWithDb,
  V3ReprintError,
  type V3ReprintRequest,
} from '../lib/v3-print-reprint'
import {
  handleAccountV3ReprintRequest,
  handleDeviceV3ReprintRequest,
  type V3ReprintRouteDependencies,
} from '../lib/v3-print-reprint-routes'

const bytes = Buffer.from([0x1b, 0x40, 0x0a])
const stream = {
  encoding: 'base64' as const,
  byteLength: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  data: bytes.toString('base64'),
}

function input(overrides: Partial<V3ReprintRequest> = {}): V3ReprintRequest {
  return {
    schemaVersion: 3,
    requestId: 'v3-reprint:front:11111111-2222-4333-8444-555555555555',
    orderNo: 'ORDER-REPRINT-1',
    role: 'FRONT',
    confirmation: 'OPERATOR_CONFIRMED',
    rendererVersion: 'reprint-raw-v1',
    commandStream: stream,
    ...overrides,
  }
}

function fakeDb(options: {
  mode?: string
  kitchenEnabled?: boolean
  orderExists?: boolean
  originalUnknown?: boolean
  originalPending?: boolean
} = {}) {
  const jobs: any[] = []
  const audits: any[] = []
  const tx = {
    store: { findFirst: async () => ({ printKitchenTicket: options.kitchenEnabled ?? true }) },
    v3PrintControlPlane: { findUnique: async () => ({ tenantId: 'tenant-a', mode: options.mode ?? 'V3_ACTIVE' }) },
    saleRecord: { findFirst: async () => options.orderExists === false ? null : { id: 'sale-a' } },
    customerOrder: { findFirst: async () => null },
    eshopTrayPrintJob: {
      findUnique: async (args: any) => {
        const key = args.where?.tenantId_storeId_idempotencyKey?.idempotencyKey
        if (key?.startsWith('network:') && options.originalUnknown) {
          return { schemaVersion: 3, effectBoundary: 'CROSSING_UNKNOWN', resultStatus: 'CROSSING_UNKNOWN', resultCode: 'V3:x:1:1:CROSSING_UNKNOWN' }
        }
        if (key?.startsWith('network:') && options.originalPending) {
          return { schemaVersion: 3, effectBoundary: null, resultStatus: null, resultCode: null }
        }
        return jobs.find((job) => job.idempotencyKey === key) ?? null
      },
      create: async ({ data }: any) => {
        const job = { id: `job-${jobs.length + 1}`, status: 'PENDING', completedAt: null, ...data }
        jobs.push(job)
        return job
      },
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
    v3PrintExecutionBatch: { findUnique: async () => null },
    operationLog: {
      create: async ({ data }: any) => {
        const audit = { id: `audit-${audits.length + 1}`, ...data }
        audits.push(audit)
        return audit
      },
      findFirst: async ({ where }: any) => audits.find((audit) => audit.requestId === where.requestId) ?? null,
    },
  }
  return {
    db: { $transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx) } as any,
    jobs,
    audits,
  }
}

function request(path: string, method: 'GET' | 'POST', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })
}

function dependencies(overrides: Partial<V3ReprintRouteDependencies> = {}): V3ReprintRouteDependencies {
  return {
    accountContext: async () => ({ tenantId: 'tenant-a', storeId: 'store-a', userId: 'user-a', role: 'STAFF' }),
    deviceContext: async () => ({
      ok: true,
      context: {
        principal: 'BROWSER_POS_DEVICE', browserPosDeviceId: 'browser-a', computerBindingId: 'binding-a',
        tenantId: 'tenant-a', storeId: 'store-a', storeCode: 'STORE-A', enabled: true, unavailableReason: null,
      },
    }),
    availability: async () => ({ enabled: true, kitchenEnabled: true, legacyAllowed: false }),
    enqueue: async (_scope, _actor, value) => ({
      created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role,
    }),
    ...overrides,
  }
}

let cases = 0
async function test(name: string, run: () => void | Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await test('strict V3 reprint contract accepts an explicit role-specific operator confirmation', () => {
    assert.deepEqual(parseV3ReprintRequest(input()), input())
  })

  await test('an original canonical print identity cannot be submitted as a reprint identity', () => {
    assert.throws(() => parseV3ReprintRequest(input({ requestId: `network:${'a'.repeat(64)}` })), /V3_REPRINT_IDENTITY_INVALID/)
  })

  await test('request identity is cryptographically separated by role', () => {
    assert.throws(() => parseV3ReprintRequest(input({ role: 'KITCHEN' })), /V3_REPRINT_IDENTITY_ROLE_MISMATCH/)
  })

  await test('FRONT and KITCHEN manual actions receive independent new identities', () => {
    const front = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'FRONT', () => 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    const kitchen = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'KITCHEN', () => 'v3-reprint:kitchen:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    assert.notEqual(front.requestId, kitchen.requestId)
    assert.equal(front.orderNo, kitchen.orderNo)
  })

  await test('a retry of one unresolved role retains its exact identity and bytes', () => {
    const first = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'FRONT', () => 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    first.commandStream = new Uint8Array(bytes)
    const retry = getOrCreateV3ReprintIntent(first, 'ORDER-1', 'FRONT', () => { throw new Error('must not regenerate') })
    assert.equal(retry, first)
    assert.deepEqual(retry.commandStream, new Uint8Array(bytes))
  })

  await test('server persists one schema-3 remote reprint and its operator audit in one transaction', async () => {
    const state = fakeDb()
    const result = await enqueueV3ManualReprintWithDb(
      state.db,
      { tenantId: 'tenant-a', storeId: 'store-a' },
      { kind: 'ACCOUNT', userId: 'user-a', role: 'STAFF' },
      input(),
      new Date('2026-09-24T00:00:00.000Z'),
    )
    assert.equal(result.created, true)
    assert.equal(state.jobs.length, 1)
    assert.equal(state.jobs[0].schemaVersion, 3)
    assert.equal(state.jobs[0].payload.source, 'CLOUD_REMOTE_REPRINT')
    assert.equal(state.jobs[0].payload.role, 'FRONT')
    assert.equal(state.audits.length, 1)
    assert.equal(state.audits[0].actionType, 'V3_PRINT_MANUAL_REPRINT_REQUESTED')
    assert.equal(state.audits[0].requestId, input().requestId)
  })

  await test('CROSSING_UNKNOWN original execution fails closed before creating a reprint', async () => {
    const state = fakeDb({ originalUnknown: true })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER' },
        input(),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_ORIGINAL_UNKNOWN',
    )
    assert.equal(state.jobs.length, 0)
    assert.equal(state.audits.length, 0)
  })

  await test('a non-terminal original execution cannot race an intentional reprint', async () => {
    const state = fakeDb({ originalPending: true })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER' },
        input(),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_ORIGINAL_NOT_TERMINAL',
    )
    assert.equal(state.jobs.length, 0)
    assert.equal(state.audits.length, 0)
  })

  await test('reprint submission is rejected outside V3_ACTIVE without falling back to V2', async () => {
    const state = fakeDb({ mode: 'V2_ACTIVE' })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-a', computerBindingId: 'binding-a' },
        input(),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_MODE_NOT_ACTIVE',
    )
    assert.equal(state.jobs.length, 0)
  })

  await test('KITCHEN reprint requires the store kitchen-ticket contract', async () => {
    const state = fakeDb({ kitchenEnabled: false })
    await assert.rejects(
      enqueueV3ManualReprintWithDb(
        state.db,
        { tenantId: 'tenant-a', storeId: 'store-a' },
        { kind: 'ACCOUNT', userId: 'user-a', role: 'OWNER' },
        input({
          role: 'KITCHEN',
          requestId: 'v3-reprint:kitchen:11111111-2222-4333-8444-555555555555',
        }),
      ),
      (error: unknown) => error instanceof V3ReprintError && error.code === 'V3_REPRINT_KITCHEN_DISABLED',
    )
  })

  await test('account route derives tenant/store/user from the authenticated account session', async () => {
    let observed: unknown
    const response = await handleAccountV3ReprintRequest(request('/api/es-tray-02/v3-reprints', 'POST', input()), dependencies({
      enqueue: async (scope, actor, value) => {
        observed = { scope, actor }
        return { created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role }
      },
    }))
    assert.equal(response.status, 202)
    assert.deepEqual(observed, {
      scope: { tenantId: 'tenant-a', storeId: 'store-a' },
      actor: { kind: 'ACCOUNT', userId: 'user-a', role: 'STAFF' },
    })
  })

  await test('device route derives scope and audit actor from the delegated device principal', async () => {
    let observed: unknown
    const response = await handleDeviceV3ReprintRequest(request('/api/es-tray-02/device/v3-reprints', 'POST', input()), dependencies({
      enqueue: async (scope, actor, value) => {
        observed = { scope, actor }
        return { created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role }
      },
    }))
    assert.equal(response.status, 202)
    assert.deepEqual(observed, {
      scope: { tenantId: 'tenant-a', storeId: 'store-a' },
      actor: { kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-a', computerBindingId: 'binding-a' },
    })
  })

  await test('Desktop-issued device recovery derives its audit actor from the verified DesktopDevice', async () => {
    let observed: unknown
    const response = await handleDeviceV3ReprintRequest(request('/api/es-tray-02/device/v3-reprints', 'POST', input()), dependencies({
      deviceContext: async () => ({
        ok: true,
        context: {
          principal: 'DESKTOP_POS_DEVICE', browserPosDeviceId: 'browser-desktop-a', desktopDeviceId: 'desktop-device-a',
          tenantId: 'tenant-a', storeId: 'store-a', storeCode: 'STORE-A', enabled: true, unavailableReason: null,
        },
      }),
      enqueue: async (scope, actor, value) => {
        observed = { scope, actor }
        return { created: true, jobId: 'job-a', requestId: value.requestId, orderNo: value.orderNo, role: value.role }
      },
    }))
    assert.equal(response.status, 202)
    assert.deepEqual(observed, {
      scope: { tenantId: 'tenant-a', storeId: 'store-a' },
      actor: { kind: 'DESKTOP_DEVICE', browserPosDeviceId: 'browser-desktop-a', desktopDeviceId: 'desktop-device-a' },
    })
  })

  await test('Desktop records route is device-authenticated only with an explicit desktop store context', () => {
    const previous = (globalThis as any).window
    try {
      ;(globalThis as any).window = { location: { pathname: '/records', search: '?from=desktop&storeCode=STORE-A' } }
      assert.equal(isDesktopPosDeviceRuntime(), true)
      ;(globalThis as any).window = { location: { pathname: '/records', search: '' } }
      assert.equal(isDesktopPosDeviceRuntime(), false)
      ;(globalThis as any).window = { location: { pathname: '/desktop/pos', search: '?storeCode=STORE-A' } }
      assert.equal(isDesktopPosDeviceRuntime(), true)
    } finally {
      if (previous === undefined) delete (globalThis as any).window
      else (globalThis as any).window = previous
    }
  })

  await test('an unavailable V3 mode check stays unknown and cannot fail open to legacy print', async () => {
    assert.equal(await readAccountV3ReprintAvailability(async () => new Response(null, { status: 503 })), null)
    assert.equal(await readAccountV3ReprintAvailability(async () => {
      throw new Error('network unavailable')
    }), null)
    assert.equal(await readAccountV3ReprintAvailability(async () => new Response(JSON.stringify({
      enabled: false, kitchenEnabled: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })), null)
  })

  await test('only authoritative V2_ACTIVE permits the legacy print path', async () => {
    async function availability(mode: string | null, tenantId = 'tenant-a') {
      return readV3ReprintAvailabilityWithDb({
        store: { findFirst: async () => ({ printKitchenTicket: true }) },
        v3PrintControlPlane: { findUnique: async () => mode === null ? null : { tenantId, mode } },
      } as any, { tenantId: 'tenant-a', storeId: 'store-a' })
    }
    assert.deepEqual(await availability('V2_ACTIVE'), {
      enabled: false, kitchenEnabled: false, legacyAllowed: true,
    })
    assert.deepEqual(await availability('V3_ACTIVE'), {
      enabled: true, kitchenEnabled: true, legacyAllowed: false,
    })
    for (const mode of ['BLOCKED_UNKNOWN', 'V2_DRAINING', 'V3_DRAINING']) {
      assert.deepEqual(await availability(mode), {
        enabled: false, kitchenEnabled: false, legacyAllowed: false,
      })
    }
    assert.deepEqual(await availability(null), {
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    })
    assert.deepEqual(await availability('V2_ACTIVE', 'another-tenant'), {
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    })
  })

  await test('the client exposes legacy printing only from an explicit authoritative V2 response', async () => {
    assert.deepEqual(await readAccountV3ReprintAvailability(async () => new Response(JSON.stringify({
      enabled: false, kitchenEnabled: false, legacyAllowed: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })), {
      enabled: false, kitchenEnabled: false, legacyAllowed: true,
    })
    assert.deepEqual(await readAccountV3ReprintAvailability(async () => new Response(JSON.stringify({
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })), {
      enabled: false, kitchenEnabled: false, legacyAllowed: false,
    })
  })

  await test('record detail refreshes authoritative mode at action time before any legacy browser reprint', () => {
    const detail = readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
    const printStart = detail.indexOf('async function handlePrint()')
    const actionStart = detail.indexOf('async function handleReprintAction()')
    const v3Start = detail.indexOf('async function handleV3Reprint()')
    assert.ok(printStart >= 0 && actionStart > printStart && v3Start > actionStart)
    const print = detail.slice(printStart, actionStart)
    const action = detail.slice(actionStart, v3Start)
    assert.match(print, /const availability = await readCurrentV3ReprintAvailability\(\)/)
    assert.match(print, /if \(!availability\?\.legacyAllowed\)[\s\S]*return/)
    assert.match(action, /const availability = await readCurrentV3ReprintAvailability\(\)/)
    assert.match(action, /availability\?\.enabled[\s\S]*availability\?\.legacyAllowed[\s\S]*void handlePrint\(\)/)
    assert.doesNotMatch(action, /v3Reprint\?\.legacyAllowed/)
  })

  await test('Cashier auto-admission is independent of preview and cannot be discarded before acceptance', () => {
    const cashier = readFileSync('app/cashier/page.tsx', 'utf8')
    assert.equal((cashier.match(/v3Admission: \{ status: 'PENDING', acceptedRoles: \[\], unresolvedRoles: v3Roles \}/g) ?? []).length, 1)
    assert.match(cashier, /submitV3LocalTickets\(current\.receipt, current\.kitchenTicket, attemptedRoles\)/)
    assert.match(cashier, /status === 'V2_FALLBACK_REQUIRED' && result\.reason == null && acceptedRoles\.length === 0/)
    assert.match(cashier, /saleResult\?\.v3Admission\?\.status === 'PENDING' \|\| saleResult\?\.v3Admission\?\.status === 'REJECTED'/)
    assert.match(cashier, /status: unresolvedRoles\.length === 0 \? 'ACCEPTED' : 'REJECTED'/)
    assert.match(cashier, /const baseSaleResult: SaleResult = \{[\s\S]*paymentMethod: 'MEMBER_BALANCE'/)
    assert.match(cashier, /if \(admission\.route === 'V2_LEGACY'\) \{\s*setSaleResult\(baseSaleResult\)\s*return/)
    assert.match(cashier, /admission\?\.status === 'ACCEPTED'[\s\S]*setSelectedDesktopRecordOrderNo\(orderNo\)/)
    assert.match(cashier, /saleResult\?\.v3Admission && saleResult\.v3Admission\.status !== 'V2_LEGACY'/)
    const admissionStart = cashier.indexOf('const current = saleResult')
    const admissionEnd = cashier.indexOf('useEffect(() => {', admissionStart + 1)
    assert.ok(admissionStart > 0 && admissionEnd > admissionStart)
    assert.doesNotMatch(cashier.slice(admissionStart, admissionEnd), /setTimeout|Date\.now/)
  })

  await test('Records preserves canonical order identity and delegates recovery without direct printing', () => {
    const records = readFileSync('app/records/page.tsx', 'utf8')
    assert.match(records, /canonicalOrderNo: item\.orderNo/)
    assert.match(records, /if \(!entry\.canonicalOrderNo\)[\s\S]*无法查看详情或补打/)
    assert.match(records, /setSelectedOrderNo\(entry\.canonicalOrderNo\)/)
    assert.doesNotMatch(records, /item\.orderNo \?\? item\.recordNo[\s\S]{0,400}setSelectedOrderNo\(entry\.orderNo\)/)
    assert.doesNotMatch(records, /printDesktopReceipt|DesktopReceiptPreview|handleSaleRecordReprint/)
  })

  await test('protected Cashier and Records blobs match the exact active authorization', () => {
    assert.equal(
      createHash('sha256').update(readFileSync('app/cashier/page.tsx')).digest('hex'),
      '6716d0414fd2cf6bb603517abce055b6624020208224a98694a16691a54ed1eb',
    )
    assert.equal(
      createHash('sha256').update(readFileSync('app/records/page.tsx')).digest('hex'),
      '48efc97f9b77dd63bed22fb0e3b69e44bf13ababbad3a8956cf39a6426912a22',
    )
  })

  await test('device client sends a V3-only role-specific contract and validates the durable response', async () => {
    let body: any
    const intent = getOrCreateV3ReprintIntent(null, 'ORDER-1', 'FRONT', () => 'v3-reprint:front:11111111-2222-4333-8444-555555555555')
    intent.commandStream = new Uint8Array(bytes)
    const result = await submitDeviceV3Reprint({
      intent,
      fetchImpl: async (_path, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          schemaVersion: 3, source: 'CLOUD_REMOTE_REPRINT', status: 'PENDING_RECEIVE', audited: true,
          created: true, jobId: 'job-a', requestId: intent.requestId, orderNo: intent.orderNo, role: intent.role,
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      },
    })
    assert.equal(result.requestId, intent.requestId)
    assert.deepEqual(Object.keys(body).sort(), [
      'commandStream', 'confirmation', 'orderNo', 'rendererVersion', 'requestId', 'role', 'schemaVersion',
    ])
    assert.equal(body.source, undefined)
    assert.equal(body.tenantId, undefined)
    assert.equal(body.storeId, undefined)
  })

  console.log(`PASS v3 reprint recovery ${cases}/${cases}`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
