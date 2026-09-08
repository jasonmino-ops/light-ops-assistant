import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import { hashClaimSecret, hashDeviceSecret, hashInstallationId } from '../lib/computer-client/crypto'
import { POST as sell } from '../app/api/cashier/sales/route'
import { POST as receive } from '../app/api/es-tray-02/print-jobs/receive/route'
import { POST as executing } from '../app/api/es-tray-02/print-jobs/[jobId]/executing/route'
import { POST as result } from '../app/api/es-tray-02/print-jobs/[jobId]/result/route'
import { enqueueCashierNetworkJobs } from '../lib/es-tray-relay/cashier-network-producer'
import { enqueueRelayPrintJob, claimNextRelayPrintJob, markRelayPrintJobExecuting, completeRelayPrintJob } from '../lib/es-tray-relay/service'
import { parsePrintRequest } from '../lib/es-tray-relay/contract'
import { readRelayTimingConfig } from '../lib/es-tray-relay/config'
import { NETWORK_PROFILE, NETWORK_CLIENT_VERSION, parseNetworkRequest, type NetworkMode } from '../e-shop-tray/src/networkContract'

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
if (process.env.NETWORK_V01_TEST_DATABASE !== '1' || url.hostname !== '127.0.0.1'
  || url.port !== '65432' || url.pathname !== '/light_ops_test'
  || !process.env.COMPUTER_CLIENT_TOKEN_SECRET || process.env.VERCEL_ENV) {
  throw new Error('Explicit LOCAL test database and test secret required; migrations are never run')
}
const tenants: string[] = []
let cases = 0
async function test(name: string, run: () => Promise<void>) { await run(); console.log(`PASS ${name}`); cases++ }
const printing = (mode: NetworkMode = 'SHARED_PRINTER') => ({ profile: NETWORK_PROFILE, mode, lang: 'zh' })
async function fixture() {
  const tag = `NET${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const tenant = await prisma.tenant.create({ data: { name: tag } }); tenants.push(tenant.id)
  const store = await prisma.store.create({ data: { name: tag, code: tag, tenantId: tenant.id } })
  const user = await prisma.user.create({ data: { tenantId: tenant.id, username: tag, displayName: tag, role: 'STAFF' } })
  await prisma.userStoreRole.create({ data: { tenantId: tenant.id, storeId: store.id, userId: user.id, role: 'STAFF', status: 'ACTIVE' } })
  const product = await prisma.product.create({ data: { tenantId: tenant.id, barcode: tag, name: '网络打印测试', sellPrice: 2.5 } })
  const installationId = `installation_${randomUUID().replaceAll('-', '')}`
  const deviceSecret = `ecc_v1_${randomUUID().replaceAll('-', '')}`
  const binding = await prisma.computerBinding.create({ data: {
    tenantId: tenant.id, storeId: store.id, installationIdHash: hashInstallationId(installationId),
    computerName: tag, agentVersion: NETWORK_CLIENT_VERSION, status: 'APPROVED',
    expiresAt: new Date(Date.now() + 86400000), claimSecretHash: hashClaimSecret(`ecr_v1_${'a'.repeat(32)}`),
    deviceSecretHash: hashDeviceSecret(deviceSecret), credentialStatus: 'ACTIVE', boundAt: new Date(),
  } })
  const scope = { tenantId: tenant.id, storeId: store.id }
  const cookie = `auth-session=${signSession({ ...scope, userId: user.id, role: 'STAFF' })}`
  const sale = (printIntent: unknown = printing(), paymentMethod = 'CASH') => new NextRequest('http://localhost/api/cashier/sales', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ storeCode: store.code, items: [{ barcode: product.barcode, quantity: 2 }],
      paymentMethod, manualPaymentConfirmed: paymentMethod === 'KHQR', ...(printIntent === null ? {} : { printing: printIntent }) }),
  })
  const agent = (path = 'receive', body?: unknown, version: 1 | 2 = 2) => new NextRequest(`http://localhost/api/es-tray-02/print-jobs/${path}`, {
    method: 'POST', headers: { 'x-installation-id': installationId, authorization: `Bearer ${deviceSecret}`,
      'x-es-tray-version': version === 2 ? NETWORK_CLIENT_VERSION : '0.1.3',
      ...(version === 2 ? { 'x-es-tray-profile': NETWORK_PROFILE } : {}), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { scope, tenant, store, user, product, binding, sale, agent }
}

async function queuedFixture(mode: NetworkMode = 'SHARED_PRINTER') {
  const f = await fixture()
  assert.equal((await sell(f.sale(printing(mode)))).status, 201)
  const jobs = await prisma.eshopTrayPrintJob.findMany({ where: f.scope })
  const front = jobs.find(job => parseNetworkRequest(job.payload).role === 'FRONT')!
  const kitchen = jobs.find(job => parseNetworkRequest(job.payload).role === 'KITCHEN')
  return { ...f, front, kitchen, timing: readRelayTimingConfig(),
    agentScope: { ...f.scope, computerBindingId: f.binding.id, schemaVersion: 2 as const } }
}

async function run() {
  const a = await fixture(), b = await fixture()
  await test('real cashier transaction persists two jobs even when response body is discarded', async () => {
    const response = await sell(a.sale())
    assert.equal(response.status, 201) // Deliberately never consume body: no browser follow-up.
    const sales = await prisma.saleRecord.findMany({ where: a.scope })
    const jobs = await prisma.eshopTrayPrintJob.findMany({ where: a.scope })
    assert.equal(sales.length, 1); assert.equal(jobs.length, 2)
    assert.deepEqual(jobs.map(j => parseNetworkRequest(j.payload).role).sort(), ['FRONT', 'KITCHEN'])
    assert.ok(jobs.every(j => parseNetworkRequest(j.payload).mode === 'SHARED_PRINTER'))
    assert.ok(jobs.every(j => j.createdAt.toISOString() === parseNetworkRequest(j.payload).order.createdAt))
    assert.equal(parseNetworkRequest(jobs[0].payload).order.orderNo, sales[0].orderNo)
    assert.equal(parseNetworkRequest(jobs[0].payload).order.totalAmount, 5)
  })
  await test('FRONT_ONLY transaction creates one FRONT and no KITCHEN, including on response loss', async () => {
    const f = await queuedFixture('FRONT_ONLY')
    assert.equal(f.kitchen, undefined)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: f.scope }), 1)
    const request = parseNetworkRequest(f.front.payload)
    assert.equal(request.mode, 'FRONT_ONLY')
    assert.equal(request.requestId, `network:${createHash('sha256').update(`cashier-network-v2:${request.order.orderNo}:FRONT`).digest('hex')}`)
    await prisma.$transaction(tx => enqueueCashierNetworkJobs(tx, f.scope, request.order, 'FRONT_ONLY'))
    await assert.rejects(prisma.$transaction(tx => enqueueCashierNetworkJobs(tx, f.scope, request.order, 'SHARED_PRINTER')))
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: f.scope }), 1)
    const claimed = await claimNextRelayPrintJob(f.agentScope, f.timing)
    assert.equal(claimed?.id, f.front.id)
  })
  await test('role idempotency is stable and preserves immutable snapshot after product edits', async () => {
    const first = await prisma.eshopTrayPrintJob.findFirstOrThrow({ where: a.scope })
    const snapshot = parseNetworkRequest(first.payload).order
    const initial = await prisma.eshopTrayPrintJob.count({ where: a.scope })
    await prisma.$transaction(tx => enqueueCashierNetworkJobs(tx, a.scope, snapshot, 'SHARED_PRINTER'))
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: a.scope }), initial)
    await assert.rejects(prisma.$transaction(tx => enqueueCashierNetworkJobs(tx, a.scope, { ...snapshot, storeName: 'tamper' }, 'SHARED_PRINTER')))
    await assert.rejects(prisma.$transaction(tx => enqueueCashierNetworkJobs(tx, a.scope, snapshot, 'FRONT_ONLY')))
    await prisma.product.update({ where: { id: a.product.id }, data: { name: 'CHANGED' } })
    assert.equal(parseNetworkRequest((await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: first.id } })).payload).order.items[0].name, '网络打印测试')
  })
  await test('failure inserting KITCHEN rolls back sale, payment and already inserted FRONT', async () => {
    const count = await prisma.saleRecord.count({ where: a.scope })
    const payments = await prisma.paymentIntent.count({ where: a.scope })
    const jobs = await prisma.eshopTrayPrintJob.count({ where: a.scope })
    const original = prisma.$transaction.bind(prisma)
    // Test-only failure injection inside a REAL PostgreSQL transaction.
    prisma.$transaction = ((callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => original(async tx => {
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key !== 'eshopTrayPrintJob') return Reflect.get(target, key)
        return new Proxy(target.eshopTrayPrintJob, { get(delegate, method) {
          if (method !== 'createMany') return Reflect.get(delegate, method)
          return (args: Parameters<typeof delegate.createMany>[0]) => {
            const data = args?.data as { payload?: { role?: string } }
            if (data.payload?.role === 'KITCHEN') throw new Error('INJECTED_SECOND_JOB_WRITE_FAILURE')
            return delegate.createMany(args)
          }
        } })
      } })
      return callback(wrapped)
    })) as typeof prisma.$transaction
    try { assert.equal((await sell(a.sale())).status, 500) } finally { prisma.$transaction = original }
    assert.equal(await prisma.saleRecord.count({ where: a.scope }), count)
    assert.equal(await prisma.paymentIntent.count({ where: a.scope }), payments)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: a.scope }), jobs)
  })
  await test('legacy sale unchanged; normal manual-confirmed KHQR creates Network pair', async () => {
    const count = await prisma.eshopTrayPrintJob.count({ where: b.scope })
    const legacy = await sell(b.sale(null)); assert.equal(legacy.status, 201)
    assert.equal((await legacy.json()).printing, undefined)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: b.scope }), count)
    assert.equal((await sell(b.sale(undefined, 'KHQR'))).status, 201)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: b.scope }), count + 2)
  })
  await test('missing/unknown/DUAL mode, host/port injection and excluded payment cause zero writes', async () => {
    const before = await prisma.saleRecord.count({ where: a.scope })
    const payments = await prisma.paymentIntent.count({ where: a.scope })
    const jobs = await prisma.eshopTrayPrintJob.count({ where: a.scope })
    for (const intent of [
      { profile: NETWORK_PROFILE, lang: 'zh' },
      { ...printing(), mode: 'DUAL_PRINTER' }, { ...printing(), mode: 'unknown' },
      { ...printing(), mode: null }, { ...printing(), host: '10.1.2.3', port: 9100 },
    ]) assert.equal((await sell(a.sale(intent))).status, 400)
    assert.equal((await sell(a.sale(undefined, 'MEMBER_BALANCE'))).status, 400)
    assert.equal(await prisma.saleRecord.count({ where: a.scope }), before)
    assert.equal(await prisma.paymentIntent.count({ where: a.scope }), payments)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: a.scope }), jobs)
  })
  let networkJob: { id: string; claimAttempt: number; claimToken: string }
  await test('v1 cannot claim or invalidate v2; v2 cannot claim v1', async () => {
    assert.equal((await (await receive(a.agent('receive', undefined, 1))).json()).job, null)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: { ...a.scope, status: 'PENDING' } }), 2)
    const bytes = Buffer.from([27, 64, 10])
    const request = parsePrintRequest({ relayVersion: '0.1', requestId: `legacy-${randomUUID()}`, orderNo: 'OLD-ORDER', documentName: 'old',
      target: { transport: 'windows-queue', queueName: '前台' }, commandStream: { encoding: 'base64', byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') } })
    const legacy = await enqueueRelayPrintJob(a.scope, request, readRelayTimingConfig())
    const response = await receive(a.agent()); assert.equal(response.status, 200)
    networkJob = (await response.json()).job
    assert.notEqual(networkJob.id, legacy.job.id)
    const row = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: networkJob.id } })
    assert.equal(parseNetworkRequest(row.payload).role, 'FRONT')
    const old = await receive(a.agent('receive', undefined, 1))
    assert.equal((await old.json()).job.id, legacy.job.id)
  })
  await test('cross-store and wrong-protocol execution/result proofs are rejected', async () => {
    const proof = { schemaVersion: 2, claimAttempt: networkJob.claimAttempt, claimToken: networkJob.claimToken }
    const params = { params: Promise.resolve({ jobId: networkJob.id }) }
    assert.equal((await executing(b.agent(`${networkJob.id}/executing`, proof), params)).status, 409)
    assert.equal((await executing(a.agent(`${networkJob.id}/executing`, proof, 1), params)).status, 400)
    assert.equal((await executing(a.agent(`${networkJob.id}/executing`, proof), params)).status, 200)
    const terminal = { ...proof, state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: 'CROSSED', physicalCompletionKnown: false }
    assert.equal((await result(b.agent(`${networkJob.id}/result`, terminal), params)).status, 409)
    assert.equal((await result(a.agent(`${networkJob.id}/result`, { ...terminal, physicalCompletionKnown: true }), params)).status, 400)
    assert.equal((await result(a.agent(`${networkJob.id}/result`, terminal), params)).status, 200)
    assert.equal((await result(a.agent(`${networkJob.id}/result`, terminal), params)).status, 200)
    assert.equal((await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: networkJob.id } })).physicalCompletionKnown, false)
  })
  await test('the old network development client is rejected before consuming mode jobs', async () => {
    const f = await queuedFixture()
    const request = f.agent()
    request.headers.set('x-es-tray-version', 'network-0.1.0')
    assert.equal((await receive(request)).status, 426)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: { ...f.scope, status: 'PENDING', attemptCount: 0 } }), 2)
  })
  await test('mode is hash-bound and old mode-less stored payloads are never reinterpreted', async () => {
    for (const legacy of [false, true]) {
      const f = await queuedFixture()
      const payload: Record<string, unknown> = { ...parseNetworkRequest(f.front.payload) }
      if (legacy) delete payload.mode
      else payload.mode = 'FRONT_ONLY'
      await prisma.eshopTrayPrintJob.update({ where: { id: f.front.id }, data: {
        payload: payload as Prisma.InputJsonValue,
        ...(legacy ? { requestHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') } : {}),
      } })
      assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
      const row = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: f.front.id } })
      assert.equal(row.status, 'FAILED'); assert.equal(row.attemptCount, 0)
      assert.equal(row.resultCode, 'STORED_PAYLOAD_INVALID')
      assert.equal(row.effectBoundary, 'NOT_CROSSED')
      assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
      const kitchen = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: f.kitchen!.id } })
      assert.equal(kitchen.status, 'FAILED'); assert.equal(kitchen.attemptCount, 0)
    }
  })
  await test('Shared FRONT precedes KITCHEN at identical timestamps and active claims block later jobs', async () => {
    const f = await queuedFixture()
    assert.equal((await sell(f.sale())).status, 201)
    const sameCreatedAt = new Date(Date.now() - 1000)
    await prisma.eshopTrayPrintJob.updateMany({ where: f.scope, data: { createdAt: sameCreatedAt } })
    // Deliberately put KITCHEN first lexically; createdAt/id alone must not pass.
    const frontId = `zz-front-${randomUUID()}`, kitchenId = `aa-kitchen-${randomUUID()}`
    await prisma.eshopTrayPrintJob.update({ where: { id: f.front.id }, data: { id: frontId, createdAt: sameCreatedAt } })
    await prisma.eshopTrayPrintJob.update({ where: { id: f.kitchen!.id }, data: { id: kitchenId, createdAt: sameCreatedAt } })
    f.front.id = frontId; f.kitchen!.id = kitchenId
    const concurrent = await Promise.all([
      claimNextRelayPrintJob(f.agentScope, f.timing), claimNextRelayPrintJob(f.agentScope, f.timing),
    ])
    assert.equal(concurrent.filter(Boolean).length, 1)
    const first = concurrent.find(job => job !== null); assert.ok(first)
    assert.equal(first.id, f.front.id)
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
    await markRelayPrintJobExecuting(f.agentScope, first.id, first, f.timing)
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
    await completeRelayPrintJob(f.agentScope, first.id, { ...first, state: 'SUCCEEDED',
      resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: 'CROSSED', physicalCompletionKnown: false })
    const second = await claimNextRelayPrintJob(f.agentScope, f.timing)
    assert.equal(second?.id, f.kitchen!.id)
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
  })
  for (const phase of ['CLAIMED', 'EXECUTING', 'ACKNOWLEDGED'] as const) {
    await test(`a late earlier-dated order cannot interrupt Shared pair after FRONT ${phase}`, async () => {
      const f = await queuedFixture()
      const first = await claimNextRelayPrintJob(f.agentScope, f.timing); assert.ok(first)
      assert.equal(first.id, f.front.id)
      const success = { ...first, state: 'SUCCEEDED' as const, resultCode: 'SUBMITTED_TO_NETWORK_SOCKET',
        effectBoundary: 'CROSSED' as const, physicalCompletionKnown: false as const }
      if (phase !== 'CLAIMED') await markRelayPrintJobExecuting(f.agentScope, first.id, first, f.timing)
      if (phase === 'ACKNOWLEDGED') await completeRelayPrintJob(f.agentScope, first.id, success)

      // This transaction becomes visible after A's claim/execution/ACK while
      // carrying B's older immutable sale time, as a late sale commit can do.
      const snapshot = parseNetworkRequest(f.front.payload).order
      const older = { ...snapshot, orderNo: `LATE-B-${randomUUID()}`,
        createdAt: new Date(Date.parse(snapshot.createdAt) - 60000).toISOString() }
      const inserted = await prisma.$transaction(tx => enqueueCashierNetworkJobs(tx, f.scope, older, 'SHARED_PRINTER'))
      const laterFrontId = inserted.jobs.find(job => job.role === 'FRONT')!.jobId
      const laterFront = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: laterFrontId } })
      assert.ok(laterFront.createdAt < f.front.createdAt)
      if (phase !== 'ACKNOWLEDGED') {
        assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
        if (phase === 'CLAIMED') await markRelayPrintJobExecuting(f.agentScope, first.id, first, f.timing)
        assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
        await completeRelayPrintJob(f.agentScope, first.id, success)
      }

      // Even a delayed KITCHEN retains the started pair's priority over B.
      const now = new Date()
      await prisma.eshopTrayPrintJob.update({ where: { id: f.kitchen!.id },
        data: { nextAttemptAt: new Date(now.getTime() + 60000) } })
      assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing, now), null)
      await prisma.eshopTrayPrintJob.update({ where: { id: f.kitchen!.id }, data: { nextAttemptAt: now } })
      const kitchen = await claimNextRelayPrintJob(f.agentScope, f.timing); assert.ok(kitchen)
      assert.equal(kitchen.id, f.kitchen!.id)
      assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
      await markRelayPrintJobExecuting(f.agentScope, kitchen.id, kitchen, f.timing)
      await completeRelayPrintJob(f.agentScope, kitchen.id, { ...success, ...kitchen })
      assert.equal((await claimNextRelayPrintJob(f.agentScope, f.timing))?.id, laterFrontId)
    })
  }
  await test('KITCHEN cannot depend on a separately valid FRONT with a different immutable snapshot', async () => {
    const f = await queuedFixture()
    const first = await claimNextRelayPrintJob(f.agentScope, f.timing); assert.ok(first)
    await markRelayPrintJobExecuting(f.agentScope, first.id, first, f.timing)
    await completeRelayPrintJob(f.agentScope, first.id, { ...first, state: 'SUCCEEDED',
      resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: 'CROSSED', physicalCompletionKnown: false })
    const request = parseNetworkRequest(f.kitchen!.payload)
    const changed = { ...request, order: { ...request.order, storeName: 'Different snapshot' } }
    await prisma.eshopTrayPrintJob.update({ where: { id: f.kitchen!.id }, data: {
      payload: changed as unknown as Prisma.InputJsonValue,
      requestHash: createHash('sha256').update(JSON.stringify(changed)).digest('hex'),
    } })
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
    const kitchen = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: f.kitchen!.id } })
    assert.equal(kitchen.resultCode, 'NETWORK_FRONT_DEPENDENCY_FAILED')
    assert.equal(kitchen.attemptCount, 0)
  })
  await test('Shared retry delay and claim recovery cannot be overtaken by KITCHEN or the next order', async () => {
    const f = await queuedFixture()
    const now = new Date()
    await prisma.eshopTrayPrintJob.updateMany({ where: f.scope, data: { createdAt: new Date(now.getTime() - 2000) } })
    assert.equal((await sell(f.sale(printing('FRONT_ONLY')))).status, 201)
    await prisma.eshopTrayPrintJob.update({ where: { id: f.front.id }, data: { nextAttemptAt: new Date(now.getTime() + 60000) } })
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing, now), null)
    await prisma.eshopTrayPrintJob.update({ where: { id: f.front.id }, data: { nextAttemptAt: now } })
    const first = await claimNextRelayPrintJob(f.agentScope, f.timing, now); assert.ok(first)
    await prisma.eshopTrayPrintJob.update({ where: { id: first.id }, data: { leaseExpiresAt: new Date(0) } })
    const retried = await claimNextRelayPrintJob(f.agentScope, f.timing, now)
    assert.equal(retried?.id, f.front.id)
    assert.equal(retried?.claimAttempt, first.claimAttempt + 1)
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing, now), null)
  })
  await test('a definite FRONT failure fails only its KITCHEN dependency without sending or claiming it', async () => {
    const f = await queuedFixture()
    await prisma.eshopTrayPrintJob.updateMany({ where: f.scope, data: { createdAt: new Date(Date.now() - 2000) } })
    const first = await claimNextRelayPrintJob(f.agentScope, f.timing); assert.ok(first)
    await completeRelayPrintJob(f.agentScope, first.id, { ...first, state: 'FAILED',
      resultCode: 'NETWORK_PREPARATION_FAILED', effectBoundary: 'NOT_CROSSED', physicalCompletionKnown: false })
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
    const kitchen = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: f.kitchen!.id } })
    assert.equal(kitchen.status, 'FAILED'); assert.equal(kitchen.attemptCount, 0)
    assert.equal(kitchen.resultCode, 'NETWORK_FRONT_DEPENDENCY_FAILED')
    assert.equal(kitchen.effectBoundary, 'NOT_CROSSED')
    assert.equal((await sell(f.sale(printing('FRONT_ONLY')))).status, 201)
    const next = await claimNextRelayPrintJob(f.agentScope, f.timing)
    assert.ok(next); assert.notEqual(next.id, first.id); assert.notEqual(next.id, kitchen.id)
  })
  await test('an acknowledged unknown FRONT stops KITCHEN and all later network orders durably', async () => {
    const f = await queuedFixture()
    await prisma.eshopTrayPrintJob.updateMany({ where: f.scope, data: { createdAt: new Date(Date.now() - 2000) } })
    const first = await claimNextRelayPrintJob(f.agentScope, f.timing); assert.ok(first)
    await markRelayPrintJobExecuting(f.agentScope, first.id, first, f.timing)
    const terminal = { ...first, state: 'FAILED' as const, resultCode: 'NETWORK_TCP_CLOSED',
      effectBoundary: 'CROSSING_UNKNOWN' as const, physicalCompletionKnown: false as const }
    await completeRelayPrintJob(f.agentScope, first.id, terminal)
    assert.equal((await sell(f.sale(printing('FRONT_ONLY')))).status, 201)
    assert.equal(await claimNextRelayPrintJob(f.agentScope, f.timing), null)
    await completeRelayPrintJob(f.agentScope, first.id, terminal) // Late/replayed ACK never clears the barrier.
    assert.equal(await claimNextRelayPrintJob({ ...f.agentScope }, f.timing), null)
    assert.equal(await prisma.eshopTrayPrintJob.count({ where: { ...f.scope, status: 'PENDING', attemptCount: 0 } }), 2)
    const otherStore = await queuedFixture('FRONT_ONLY')
    assert.equal((await claimNextRelayPrintJob(otherStore.agentScope, otherStore.timing))?.id, otherStore.front.id)
  })
  await test('CROSSING_UNKNOWN execution timeout is terminal and never reclaimed', async () => {
    const agentScope = { ...a.scope, computerBindingId: a.binding.id, schemaVersion: 2 as const }
    const job = await claimNextRelayPrintJob(agentScope, readRelayTimingConfig()); assert.ok(job)
    await prisma.eshopTrayPrintJob.update({ where: { id: job.id }, data: { status: 'EXECUTING', effectBoundary: 'CROSSING_UNKNOWN', leaseExpiresAt: new Date(0) } })
    assert.equal(await claimNextRelayPrintJob(agentScope, readRelayTimingConfig()), null)
    const recovered = await prisma.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: job.id } })
    assert.equal(recovered.status, 'FAILED'); assert.equal(recovered.effectBoundary, 'CROSSING_UNKNOWN')
    assert.equal((await sell(a.sale(printing('FRONT_ONLY')))).status, 201)
    assert.equal(await claimNextRelayPrintJob(agentScope, readRelayTimingConfig()), null)
  })
  await test('cashier Network-owned sale has no legacy receipt/auto-print handoff', async () => {
    const source = readFileSync('app/cashier/page.tsx', 'utf8')
    assert.match(source, /pathname === '\/cashier'/)
    assert.match(source, /!window\.eshopDesktopRuntime\?\.isDesktop/)
    assert.match(source, /const receipt = isDesktopPos && !networkPrint && !networkQueued/)
    assert.match(source, /\{!saleResult\.networkPrintStatus && <div[^>]*>[\s\S]*?: d\.receiptNotAuto\}\s*<\/div>\}/)
    assert.match(source, /get\('networkMode'\)/)
    assert.match(source, /networkMode !== 'FRONT_ONLY' && networkMode !== 'SHARED_PRINTER'/)
    assert.match(source, /mode: networkMode/)
    assert.match(source, /saleResult\.networkPrintRoles\?\.join/)
    assert.doesNotMatch(source, /<div style=\{s\.modalSub\}>FRONT \/ KITCHEN —/)
  })
}
run().then(() => console.log(`Network V0.1 database integration PASS (${cases})`)).catch(error => {
  console.error(error); process.exitCode = 1
}).finally(async () => {
  // Delete only unique fixtures created above. Never reset/drop/truncate shared test data.
  for (const tenantId of tenants) {
    await prisma.eshopTrayPrintJob.deleteMany({ where: { tenantId } })
    await prisma.paymentIntent.deleteMany({ where: { tenantId } })
    await prisma.saleRecord.deleteMany({ where: { tenantId } })
    await prisma.computerBinding.deleteMany({ where: { tenantId } })
    await prisma.userStoreRole.deleteMany({ where: { tenantId } })
    await prisma.product.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.store.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })
  }
  await prisma.$disconnect()
})
