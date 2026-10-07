import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { GET } from '../app/api/cron/customer-order-fulfillment-recovery/route'

type Row = Record<string, any>

function setup(includeBadRow = false) {
  const now = Date.now()
  const intents: Row[] = Array.from({ length: 1105 }, (_, index) => ({
    id: `intent-${String(index).padStart(4, '0')}`,
    tenantId: 'tenant-a', storeId: 'store-a', orderNo: `H5-${String(index).padStart(4, '0')}`,
    role: 'FRONT', source: 'H5_HOME', state: 'RENDER_PENDING', decision: 'REQUIRED',
    attemptCount: 0, maxAttempts: 12, nextAttemptAt: new Date(now - 1000), deadlineAt: new Date(now + 86_400_000),
    lastRecoverySweepAt: null, printJobId: null, idempotencyKey: `network:${String(index).padStart(64, '0')}`,
  }))
  intents.push({
    id: 'expired-intent', tenantId: 'tenant-a', storeId: 'store-a', orderNo: 'H5-EXPIRED', role: 'FRONT', source: 'H5_HOME', state: 'RENDER_PENDING', decision: 'REQUIRED',
    attemptCount: 0, maxAttempts: 12, nextAttemptAt: new Date(now - 1000), deadlineAt: new Date(now - 1000), lastRecoverySweepAt: null, printJobId: null, idempotencyKey: `network:${'e'.repeat(64)}`,
  })
  if (includeBadRow) {
    intents.unshift({
      id: 'bad-intent', tenantId: 'tenant-a', storeId: 'store-a', orderNo: 'H5-BAD', role: 'FRONT', source: 'H5_HOME', state: 'RENDER_PENDING', decision: 'REQUIRED',
      attemptCount: 0, maxAttempts: 12, nextAttemptAt: new Date(now - 1000), deadlineAt: new Date(now + 86_400_000), lastRecoverySweepAt: null, printJobId: null, idempotencyKey: `network:${'b'.repeat(64)}`,
    })
  }
  const db = prisma as unknown as Row
  const originals: Array<() => void> = []
  let controlPlaneMode = 'V3_ACTIVE'
  function stub(model: string, method: string, fn: (...args: any[]) => any) {
    const target = db[model] as Row
    const original = target[method]
    target[method] = fn
    originals.push(() => { target[method] = original })
  }
  stub('customerOrderFulfillmentIntent', 'findMany', async ({ take }: Row) => intents
    .filter((intent) => intent.source === 'H5_HOME'
      && ['PENDING', 'RENDER_PENDING', 'FAILED_RETRYABLE'].includes(intent.state)
      && (intent.nextAttemptAt <= new Date() || intent.deadlineAt <= new Date()))
    .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, take))
  stub('customerOrderFulfillmentIntent', 'findUnique', async ({ where }: Row) => {
    if (includeBadRow && where.id === 'bad-intent') throw new Error('CUSTOMER_ORDER_BAD_ROW')
    return intents.find((intent) => intent.id === where.id) ?? null
  })
  stub('customerOrderFulfillmentIntent', 'updateMany', async ({ where, data }: Row) => {
    const rows = intents.filter((intent) => intent.id === where.id
      && (!where.source || intent.source === where.source)
      && (!where.state?.in || where.state.in.includes(intent.state))
      && (!where.nextAttemptAt?.lte || intent.nextAttemptAt <= where.nextAttemptAt.lte))
    for (const intent of rows) {
      for (const [key, value] of Object.entries(data)) intent[key] = (value as any)?.increment != null ? intent[key] + (value as any).increment : value
    }
    return { count: rows.length }
  })
  stub('customerOrderFulfillmentIntent', 'update', async ({ where, data }: Row) => {
    const intent = intents.find((row) => row.id === where.id)
    if (!intent) throw new Error('intent missing')
    for (const [key, value] of Object.entries(data)) intent[key] = (value as any)?.increment != null ? intent[key] + (value as any).increment : value
    return intent
  })
  stub('v3PrintControlPlane', 'findUnique', async () => ({ tenantId: 'tenant-a', mode: controlPlaneMode }))
  const originalTransaction = db.$transaction
  db.$transaction = async (operation: (tx: Row) => Promise<unknown>) => operation(db)
  originals.push(() => { db.$transaction = originalTransaction })

  return {
    intents,
    setMode: (mode: string) => { controlPlaneMode = mode },
    restore: () => originals.reverse().forEach((restore) => restore()),
    request: () => new NextRequest('https://example.test/api/cron/customer-order-fulfillment-recovery', { headers: { authorization: 'Bearer recovery-secret' } }),
  }
}

test('recovery advances beyond ten pages and keeps renderer-blocked intents visible', async () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'recovery-secret'
  const f = setup()
  try {
    const first = await GET(f.request())
    const firstBody = await first.json()
    assert.equal(first.status, 200)
    assert.equal(firstBody.summary.scanned, 1000)
    assert.equal(firstBody.summary.pages, 10)
    assert.equal(firstBody.summary.notReady, 999)
    assert.equal(f.intents.filter((intent) => intent.lastRecoverySweepAt).length, 1000)

    const second = await GET(f.request())
    const secondBody = await second.json()
    assert.equal(second.status, 200)
    assert.equal(secondBody.summary.scanned, 106)
    assert.equal(secondBody.summary.notReady, 106)
    assert.equal(f.intents.filter((intent) => intent.lastRecoverySweepAt).length, 1106)
  } finally {
    f.restore()
    if (previous == null) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  }
})

test('expired intent is visible and removed from the actionable set', async () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'recovery-secret'
  const f = setup()
  try {
    const response = await GET(f.request())
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.summary.expired, 1)
    assert.equal(f.intents.find((intent) => intent.id === 'expired-intent')?.state, 'EXPIRED')
  } finally {
    f.restore()
    if (previous == null) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  }
})

test('recovery persists a retry backoff for a bad row instead of leaving it at the queue head', async () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'recovery-secret'
  const f = setup(true)
  try {
    const first = await GET(f.request())
    const firstBody = await first.json()
    assert.equal(first.status, 503)
    assert.equal(firstBody.summary.failed, 1)
    const bad = f.intents.find((intent) => intent.id === 'bad-intent')
    assert.equal(bad?.state, 'FAILED_RETRYABLE')
    assert.ok(bad?.nextAttemptAt > new Date())

    const second = await GET(f.request())
    const secondBody = await second.json()
    assert.equal(second.status, 200)
    assert.equal(secondBody.summary.failed, 0)
    assert.equal(secondBody.errors.length, 0)
  } finally {
    f.restore()
    if (previous == null) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  }
})

test('V2_ACTIVE never creates an H5 job and recovery remains visible', async () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'recovery-secret'
  const f = setup()
  f.setMode('V2_ACTIVE')
  try {
    const response = await GET(f.request())
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.summary.notReady, 999)
  } finally {
    f.restore()
    if (previous == null) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  }
})

test('recovery route is CRON_SECRET protected', async () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'recovery-secret'
  const f = setup()
  try {
    const response = await GET(new NextRequest('https://example.test/api/cron/customer-order-fulfillment-recovery'))
    assert.equal(response.status, 401)
  } finally {
    f.restore()
    if (previous == null) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  }
})
