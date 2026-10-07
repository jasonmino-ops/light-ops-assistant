import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { intentCreateData, processCustomerOrderFulfillmentIntent, cancelCustomerOrderKitchenIntent } from '../lib/customer-order-fulfillment'
import { authenticateRenderWorker, configuredRenderWorker, claimCustomerOrderRender, sealCustomerOrderRender, failCustomerOrderRender } from '../lib/customer-order-render-dispatch'
import { ALLOWED_CUSTOMER_ORDER_RENDERER_VERSIONS, customerOrderRendererReleased, validateCustomerOrderRaster } from '../lib/customer-order-fulfillment-renderer'
import { encodeRgbaToEscPosEscStar24 } from '../lib/qzEscPosBitImage'

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const profileId = sha('test-only-profile'), credential = 'a'.repeat(43)
const worker = { workerId: 'owner-a', tenantId: 'tenant-a', storeId: 'store-a', roles: ['KITCHEN'] as Array<'KITCHEN' | 'FRONT'>, profileId, credentialSha256: sha(credential) }
const raw = Buffer.from(encodeRgbaToEscPosEscStar24({ width: 576, height: 24, rgba: new Uint8ClampedArray(576 * 24 * 4).fill(255) }))
const output = { payloadBase64: raw.toString('base64'), byteLength: raw.length, payloadHash: sha(raw), rendererVersion: profileId }

// Sequential in-memory behavior substitute. Real concurrency/locks live in the
// separately classified PostgreSQL suite, never inferred from this model.
function fixture(count = 1) {
  let clock = new Date(), mode = 'V3_ACTIVE'
  const orders: any[] = [], rows: any[] = []
  for (let n = 0; n < count; n++) {
    const order = { tenantId: worker.tenantId, storeId: worker.storeId, orderNo: `order-${n}`, storeName: '店 កាហ្វេ', currencyCode: 'USD',
      createdAt: clock, paidAt: null, tableNo: 'A1', remark: null, totalAmount: 2, paymentStatus: 'UNPAID' as const, paymentMethod: null,
      items: [{ productId: 'p', name: '茶', spec: null, price: 2, originalPrice: 2, quantity: 1, lineAmount: 2, printKitchenTicket: true }] }
    orders.push({ ...order, status: 'CONFIRMED' })
    rows.push({ id: `intent-${n.toString().padStart(5, '0')}`, ...intentCreateData({ order, role: 'KITCHEN', decision: 'REQUIRED', now: clock }),
      printJobId: null, sealedAt: null, renderAttemptCount: 0, renderProfileId: null, renderLeaseTokenHash: null, renderLeaseExpiresAt: null, renderLeaseOwnerId: null })
  }
  function matches(row: any, where: any): boolean {
    return Object.entries(where).every(([key, expected]: [string, any]) => {
      if (key === 'OR') return expected.some((w: any) => matches(row, w))
      if (key === 'tenantId_storeId_orderNo_role') return matches(row, expected)
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        if ('in' in expected) return expected.in.includes(row[key])
        if ('lte' in expected) return row[key] != null && row[key] <= expected.lte
        if ('gt' in expected) return row[key] != null && row[key] > expected.gt
      }
      return row[key] === expected
    })
  }
  const db: any = {
    customerOrder: { findFirst: async ({ where }: any) => orders.find(r => matches(r, where)) ?? null },
    v3PrintControlPlane: { findUnique: async () => ({ tenantId: worker.tenantId, mode }) },
    customerOrderFulfillmentIntent: {
      findUnique: async ({ where }: any) => structuredClone(rows.find(r => matches(r, where)) ?? null),
      findFirst: async ({ where }: any) => structuredClone(rows.find(r => matches(r, where)) ?? null),
      findMany: async ({ where, take }: any) => structuredClone(rows.filter(r => matches(r, where)).sort((a, b) => +a.nextAttemptAt - +b.nextAttemptAt || a.id.localeCompare(b.id)).slice(0, take)),
      updateMany: async ({ where, data }: any) => {
        const found = rows.filter(r => matches(r, where))
        for (const row of found) for (const [k, v] of Object.entries(data)) row[k] = (v as any)?.increment != null ? row[k] + (v as any).increment : v
        return { count: found.length }
      },
    },
    $queryRaw: async (sql: TemplateStringsArray) => sql.join('?').includes('pg_try_advisory') ? [{ acquired: true }] : [{ id: 'order' }],
  }
  db.$transaction = async (fn: any) => fn(db)
  return { db, rows, orders, runtime: { testProfileId: profileId, now: () => clock }, clock: () => clock,
    advance: (ms: number) => { clock = new Date(+clock + ms) }, mode: (next: string) => { mode = next } }
}

test('dedicated owner authentication is exact and production allowlist stays empty', () => {
  assert.deepEqual(ALLOWED_CUSTOMER_ORDER_RENDERER_VERSIONS, [])
  assert.equal(customerOrderRendererReleased(profileId), false)
  assert.deepEqual(configuredRenderWorker(JSON.stringify(worker)), worker)
  assert.equal(configuredRenderWorker(JSON.stringify({ ...worker, allStores: true })), null)
  assert.equal(authenticateRenderWorker(`Bearer ${credential}`, worker), worker)
  assert.equal(authenticateRenderWorker(`Bearer ${'b'.repeat(43)}`, worker), null)
  assert.equal(authenticateRenderWorker('DEV', worker), null)
})

test('claim reserves one owner slot; immutable result seals once; no job before T3', async () => {
  const f = fixture(2)
  const first = await claimCustomerOrderRender(f.db, worker, f.runtime)
  assert.equal(first.kind, 'CLAIMED')
  assert.equal(f.rows[0].renderAttemptCount, 1); assert.equal(f.rows[0].attemptCount, 0)
  assert.equal(f.rows[0].renderLeaseTokenHash, sha(first.claim.token))
  assert.equal((await claimCustomerOrderRender(f.db, worker, f.runtime)).kind, 'BUSY')
  assert.equal(f.rows[1].renderAttemptCount, 0)
  const reply = { ...first.claim, ...output }
  assert.equal((await sealCustomerOrderRender(f.db, worker, reply, f.runtime)).kind, 'SEALED')
  assert.equal(f.rows[0].printJobId, null); assert.equal(f.rows[0].renderLeaseTokenHash, null)
  assert.equal((await sealCustomerOrderRender(f.db, worker, reply, f.runtime)).kind, 'ALREADY_SEALED')
  assert.equal(f.rows[0].renderAttemptCount, 1)
  assert.equal((await sealCustomerOrderRender(f.db, worker, { ...reply, snapshotHash: 'f'.repeat(64) }, f.runtime)).kind, 'CONFLICT')
  assert.equal(f.rows[0].state, 'MANUAL_REVIEW'); assert.equal(f.rows[0].payloadHash, output.payloadHash)
})

test('cancel revokes lease; late success and failure cannot revive or overwrite it', async () => {
  const f = fixture(), claimed = await claimCustomerOrderRender(f.db, worker, f.runtime)
  f.orders[0].status = 'CANCELLED'
  await cancelCustomerOrderKitchenIntent(f.db, f.orders[0], f.clock())
  const before = structuredClone(f.rows[0])
  assert.equal((await sealCustomerOrderRender(f.db, worker, { ...claimed.claim, ...output }, f.runtime)).kind, 'TERMINAL')
  assert.equal((await failCustomerOrderRender(f.db, worker, { ...claimed.claim, code: 'RENDER_FAILED' }, f.runtime)).kind, 'STALE')
  assert.deepEqual(f.rows[0], before); assert.equal(before.renderLeaseTokenHash, null)
})

test('crash/lease expiry consumes bounded render budget, not job attempts; stale result rejected', async () => {
  const f = fixture()
  for (let n = 1; n <= 3; n++) {
    const claimed = await claimCustomerOrderRender(f.db, worker, f.runtime)
    assert.equal(claimed.kind, 'CLAIMED'); assert.equal(f.rows[0].renderAttemptCount, n)
    f.advance(60_001)
    assert.equal((await sealCustomerOrderRender(f.db, worker, { ...claimed.claim, ...output }, f.runtime)).kind, 'STALE')
    await claimCustomerOrderRender(f.db, worker, f.runtime)
    assert.equal(f.rows[0].attemptCount, 0)
    if (n < 3) {
      assert.equal(f.rows[0].state, 'FAILED_RETRYABLE')
      assert.equal(+f.rows[0].nextAttemptAt - +f.clock(), 60_000 * 2 ** (n - 1))
      f.advance(60_000 * 2 ** (n - 1))
    } else assert.equal(f.rows[0].state, 'MANUAL_REVIEW')
  }
})

test('reported failures count reservation once and repeated report is stale', async () => {
  const f = fixture(), claim = (await claimCustomerOrderRender(f.db, worker, f.runtime)).claim
  const report = { ...claim, code: 'RENDER_TIMEOUT' }
  assert.equal((await failCustomerOrderRender(f.db, worker, report, f.runtime)).kind, 'WAITING')
  const before = structuredClone(f.rows[0])
  assert.equal((await failCustomerOrderRender(f.db, worker, report, f.runtime)).kind, 'STALE')
  assert.deepEqual(f.rows[0], before); assert.equal(before.renderAttemptCount, 1); assert.equal(before.attemptCount, 0)
})

test('scope, snapshot, profile and malformed RAW_BYTES are independently fenced', async () => {
  const f = fixture(), claim = (await claimCustomerOrderRender(f.db, worker, f.runtime)).claim
  assert.equal((await sealCustomerOrderRender(f.db, { ...worker, storeId: 'foreign' }, { ...claim, ...output }, f.runtime)).kind, 'NOT_FOUND')
  for (const patch of [{ payloadHash: 'f'.repeat(64) }, { payloadBase64: output.payloadBase64 + '\n' }, { byteLength: output.byteLength + 1 }]) {
    assert.equal((await sealCustomerOrderRender(f.db, worker, { ...claim, ...output, ...patch }, f.runtime)).kind, 'INVALID_BYTES')
  }
  assert.equal((await sealCustomerOrderRender(f.db, worker, { ...claim, ...output, profileId: 'f'.repeat(64) }, f.runtime)).kind, 'INVALID')
  assert.equal(f.rows[0].sealedAt, null)
  const invalid = Buffer.from(raw); invalid[0] = 0
  assert.throws(() => validateCustomerOrderRaster({ ...output, payloadBase64: invalid.toString('base64'), payloadHash: sha(invalid) }), /GRAMMAR/)
})

test('fixed deadline expires visibly, and cron cannot fence out an active renderer', async () => {
  const f = fixture(), claim = (await claimCustomerOrderRender(f.db, worker, f.runtime)).claim
  const revision = f.rows[0].revision
  assert.equal((await processCustomerOrderFulfillmentIntent(f.db, f.rows[0].id, f.clock(), f.runtime)).status, 'PROCESSING')
  assert.equal(f.rows[0].revision, revision)
  f.advance(30 * 60_000)
  assert.equal((await sealCustomerOrderRender(f.db, worker, { ...claim, ...output }, f.runtime)).kind, 'EXPIRED')
  assert.equal(f.rows[0].state, 'EXPIRED'); assert.equal(f.rows[0].sealedAt, null)
})

test('more than 1000 unreleased rows progress across independent bounded polls', async () => {
  const f = fixture(1105), visited = new Set<string>()
  for (let poll = 0; poll < 56; poll++) {
    const result = await claimCustomerOrderRender(f.db, worker, { now: f.runtime.now })
    assert.equal(result.kind, 'IDLE'); assert.ok(result.processed <= 20)
    for (const row of f.rows) if (row.nextAttemptAt > f.clock()) visited.add(row.id)
  }
  assert.equal(visited.size, 1105)
  assert.ok(f.rows.every(r => r.revision === 1 && r.renderAttemptCount === 0 && r.attemptCount === 0))
})

test('V2 mode cannot allocate a render reservation or task', async () => {
  const f = fixture(); f.mode('V2_ACTIVE')
  await claimCustomerOrderRender(f.db, worker, f.runtime)
  assert.equal(f.rows[0].lastErrorCode, 'CUSTOMER_ORDER_V3_NOT_ACTIVE')
  assert.equal(f.rows[0].renderAttemptCount, 0); assert.equal(f.rows[0].printJobId, null)
})

// Invoke the real route, with only the database dependency substituted. No
// HTTP parameter or environment switch can release a test renderer in this API.
test('worker route rejects other identity sources, malformed protocol and oversized bodies before database access', async () => {
  ;(globalThis as any).AsyncLocalStorage = AsyncLocalStorage
  const { NextRequest } = await import('next/server')
  const { POST } = await import('../app/api/customer-order-renderer/route')
  const { prisma } = await import('../lib/prisma')
  const priorConfig = process.env.H5_RENDER_WORKER_CONFIG
  const original = prisma.customerOrderFulfillmentIntent.findMany
  let accesses = 0
  prisma.customerOrderFulfillmentIntent.findMany = (async () => { accesses++; return [] }) as any
  const request = (body: string, headers: Record<string, string> = {}) => new NextRequest('https://example.test/api/customer-order-renderer', {
    method: 'POST', headers, body,
  })
  try {
    process.env.H5_RENDER_WORKER_CONFIG = JSON.stringify({ ...worker, workerId: 'route-input-owner' })
    const otherIdentityHeaders: Array<Record<string, string>> = [
      { cookie: 'auth-session=synthetic', 'x-tenant-id': worker.tenantId, 'x-role': 'OWNER' },
      { authorization: `Bearer ${'b'.repeat(43)}` },
    ]
    for (const headers of otherIdentityHeaders) assert.equal((await POST(request('{"protocol":1,"action":"claim"}', headers))).status, 401)
    const auth = { authorization: `Bearer ${credential}` }
    assert.equal((await POST(request('{}', auth))).status, 415)
    const json = { ...auth, 'content-type': 'application/json' }
    for (const body of ['{', '{"protocol":2,"action":"claim"}', '{"protocol":1,"action":"claim","tenantId":"foreign"}', '{"protocol":1,"action":"result","result":[]}']) {
      assert.equal((await POST(request(body, json))).status, 400)
    }
    assert.equal((await POST(request('{}', { ...json, 'content-length': String(5 * 1024 * 1024) }))).status, 400)
    assert.equal((await POST(request(' '.repeat(5 * 1024 * 1024), json))).status, 400)
    assert.equal(accesses, 0)
    delete process.env.H5_RENDER_WORKER_CONFIG
    assert.equal((await POST(request('{"protocol":1,"action":"claim"}', json))).status, 401)
  } finally {
    prisma.customerOrderFulfillmentIntent.findMany = original
    if (priorConfig === undefined) delete process.env.H5_RENDER_WORKER_CONFIG
    else process.env.H5_RENDER_WORKER_CONFIG = priorConfig
  }
})

test('worker route pins scope server-side, does not cache replies and sanitizes operational errors', async () => {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('../app/api/customer-order-renderer/route')
  const { prisma } = await import('../lib/prisma')
  const priorConfig = process.env.H5_RENDER_WORKER_CONFIG
  const original = prisma.customerOrderFulfillmentIntent.findMany
  let query: any
  try {
    process.env.H5_RENDER_WORKER_CONFIG = JSON.stringify({ ...worker, workerId: 'route-scope-owner' })
    prisma.customerOrderFulfillmentIntent.findMany = (async (args: any) => { query = args; return [] }) as any
    const request = () => new NextRequest('https://example.test/api/customer-order-renderer', { method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: '{"protocol":1,"action":"claim"}' })
    const response = await POST(request())
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { protocol: 1, kind: 'IDLE', processed: 0 })
    assert.equal(query.where.tenantId, worker.tenantId); assert.equal(query.where.storeId, worker.storeId)
    assert.deepEqual(query.where.role, { in: worker.roles })
    prisma.customerOrderFulfillmentIntent.findMany = (async () => { throw new Error('synthetic-sensitive-database-error') }) as any
    const failure = await POST(request())
    assert.equal(failure.status, 503)
    assert.deepEqual(await failure.json(), { error: 'RENDER_DISPATCH_UNAVAILABLE' })
  } finally {
    prisma.customerOrderFulfillmentIntent.findMany = original
    if (priorConfig === undefined) delete process.env.H5_RENDER_WORKER_CONFIG
    else process.env.H5_RENDER_WORKER_CONFIG = priorConfig
  }
})

test('real worker route enforces its additional process-local 240 request bound', async () => {
  const { NextRequest } = await import('next/server')
  const { POST } = await import('../app/api/customer-order-renderer/route')
  const { prisma } = await import('../lib/prisma')
  const priorConfig = process.env.H5_RENDER_WORKER_CONFIG
  const original = prisma.customerOrderFulfillmentIntent.findMany
  let accesses = 0
  try {
    process.env.H5_RENDER_WORKER_CONFIG = JSON.stringify({ ...worker, workerId: 'route-rate-owner' })
    prisma.customerOrderFulfillmentIntent.findMany = (async () => { accesses++; return [] }) as any
    for (let n = 0; n < 241; n++) {
      const response = await POST(new NextRequest('https://example.test/api/customer-order-renderer', { method: 'POST',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: '{"protocol":1,"action":"claim"}' }))
      assert.equal(response.status, n < 240 ? 200 : 429)
    }
    assert.equal(accesses, 240)
  } finally {
    prisma.customerOrderFulfillmentIntent.findMany = original
    if (priorConfig === undefined) delete process.env.H5_RENDER_WORKER_CONFIG
    else process.env.H5_RENDER_WORKER_CONFIG = priorConfig
  }
})
