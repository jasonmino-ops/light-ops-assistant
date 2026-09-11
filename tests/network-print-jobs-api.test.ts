import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import { GET as jobs } from '../app/api/network-print/jobs/route'

// 只允许打到明确的本地测试库；生产连接串永远不是 127.0.0.1，也永远不叫 light_ops_test。
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid')
if (process.env.NETWORK_PRINT_OBSERVABILITY_TEST_DATABASE !== '1'
  || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
  || url.pathname !== '/light_ops_test'
  || !process.env.AUTH_SECRET
  || process.env.VERCEL_ENV) {
  throw new Error('Explicit LOCAL test database (127.0.0.1/light_ops_test) and AUTH_SECRET are required')
}

const tenants: string[] = []
let cases = 0
async function test(name: string, run: () => Promise<void>) {
  await run()
  console.log(`PASS ${name}`)
  cases += 1
}

const MINUTE = 60_000
const DAY = 86_400_000

type Fixture = Awaited<ReturnType<typeof fixture>>

async function fixture() {
  const tag = `NPO${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const tenant = await prisma.tenant.create({ data: { name: tag } })
  tenants.push(tenant.id)
  const store = await prisma.store.create({ data: { tenantId: tenant.id, code: tag, name: `${tag}店` } })
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, username: tag, displayName: `${tag}员工`, role: 'STAFF' },
  })
  await prisma.userStoreRole.create({
    data: { tenantId: tenant.id, storeId: store.id, userId: user.id, role: 'STAFF', status: 'ACTIVE' },
  })
  const cookie = `auth-session=${signSession({
    tenantId: tenant.id, storeId: store.id, userId: user.id, role: 'STAFF',
  })}`
  return { tenant, store, user, cookie, scope: { tenantId: tenant.id, storeId: store.id } }
}

/** 同租户第二个门店 + 该门店会话，用于同租户跨店隔离反向用例。 */
async function siblingStore(base: Fixture) {
  const tag = `NPO${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const store = await prisma.store.create({ data: { tenantId: base.tenant.id, code: tag, name: `${tag}店` } })
  const cookie = `auth-session=${signSession({
    tenantId: base.tenant.id, storeId: store.id, userId: base.user.id, role: 'STAFF',
  })}`
  return { store, cookie }
}

type Seed = {
  orderNo?: string | null
  role?: string | null
  mode?: string | null
  status?: 'PENDING' | 'CLAIMED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'
  createdAt?: Date
  completedAt?: Date | null
  resultStatus?: string | null
  resultCode?: string | null
  resultMessage?: string | null
  effectBoundary?: string | null
  physicalCompletionKnown?: boolean
  attemptCount?: number
  claimAttempt?: number
  schemaVersion?: number
  payload?: unknown
}

function networkPayload(seed: Seed) {
  const order: Record<string, unknown> = {
    storeCode: 'CODE', storeName: '门店', createdAt: new Date().toISOString(),
    cashierName: '小张', paymentMethod: 'CASH', currencyCode: 'USD', totalAmount: 5,
    lang: 'zh', items: [{ name: '矿泉水', spec: '550ml', qty: 2, price: 2.5, lineAmount: 5 }],
  }
  if (seed.orderNo !== null) order.orderNo = seed.orderNo
  const payload: Record<string, unknown> = { profile: 'network-v2', requestId: `network:${randomUUID()}`, rendererVersion: 1, order }
  if (seed.role !== null) payload.role = seed.role
  if (seed.mode !== null) payload.mode = seed.mode
  return payload
}

async function seedJob(f: Fixture, seed: Seed) {
  const createdAt = seed.createdAt ?? new Date()
  return prisma.eshopTrayPrintJob.create({
    data: {
      tenantId: f.tenant.id,
      storeId: f.store.id,
      idempotencyKey: `key-${randomUUID()}`,
      requestHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
      schemaVersion: seed.schemaVersion ?? 2,
      payload: (seed.payload ?? networkPayload(seed)) as object,
      status: seed.status ?? 'SUCCEEDED',
      attemptCount: seed.attemptCount ?? 1,
      claimAttempt: seed.claimAttempt ?? 1,
      nextAttemptAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + DAY),
      completedAt: seed.completedAt === undefined
        ? (['SUCCEEDED', 'FAILED', 'EXPIRED'].includes(seed.status ?? 'SUCCEEDED') ? createdAt : null)
        : seed.completedAt,
      resultStatus: seed.resultStatus ?? null,
      resultCode: seed.resultCode ?? null,
      resultMessage: seed.resultMessage ?? null,
      effectBoundary: seed.effectBoundary ?? null,
      physicalCompletionKnown: seed.physicalCompletionKnown ?? false,
      createdAt,
    },
  })
}

function localDate(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3_600_000 + offsetDays * DAY).toISOString().slice(0, 10)
}

/** 覆盖“昨天到今天”，任何时刻运行都包含 now 与 now-30min，避免跨本地日零点抖动。 */
function spanningRange() {
  return { range: 'CUSTOM', dateFrom: localDate(-1), dateTo: localDate(0) }
}

type Body = Record<string, any>

async function call(cookie: string | null, query: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const params = new URLSearchParams(query)
  const req = new NextRequest(`http://localhost/api/network-print/jobs?${params.toString()}`, {
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  })
  const res = await jobs(req)
  return { status: res.status, body: await res.json() as Body }
}

async function run() {
  await test('未认证请求被拒（无会话、无开发身份头）', async () => {
    const anonymous = await call(null)
    assert.equal(anonymous.status, 401)
    assert.equal(anonymous.body.error, 'MISSING_CONTEXT')

    // 伪造的签名 cookie 同样拒绝。
    const forged = await call('auth-session=not-a-valid-signature')
    assert.equal(forged.status, 401)

    // 线上关闭开发身份头后，只带 x-* 头也拿不到上下文。
    const f = await fixture()
    process.env.ESHOP_DISABLE_DEV_HEADERS = '1'
    try {
      const spoofed = await call(null, {}, {
        'x-tenant-id': f.tenant.id, 'x-user-id': f.user.id, 'x-store-id': f.store.id, 'x-role': 'OWNER',
      })
      assert.equal(spoofed.status, 401)
      assert.equal(spoofed.body.error, 'MISSING_CONTEXT')
    } finally {
      delete process.env.ESHOP_DISABLE_DEV_HEADERS
    }
  })

  await test('跨店越权：query 里的 storeId / tenantId 不作为权限依据，别店数据一律看不到', async () => {
    const a = await fixture()
    const orderNo = `ORD-${randomUUID().slice(0, 8)}`
    const jobA = await seedJob(a, { orderNo, role: 'FRONT', mode: 'FRONT_ONLY', effectBoundary: 'CROSSED', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET' })

    // 1) 另一个租户，带着 A 店的 storeId / tenantId 来查。
    const b = await fixture()
    const crossTenant = await call(b.cookie, { ...spanningRange(), storeId: a.store.id, tenantId: a.tenant.id })
    assert.equal(crossTenant.status, 200)
    assert.equal(crossTenant.body.totals.jobCount, 0)
    assert.deepEqual(crossTenant.body.jobs, [])
    assert.equal(crossTenant.body.totals.orderCount, 0)
    // 返回的门店只能是会话自己的门店。
    assert.equal(crossTenant.body.store.storeId, b.store.id)

    // 2) 同租户的另一个门店，带着 A 店 storeId 来查。
    const sibling = await siblingStore(a)
    const crossStore = await call(sibling.cookie, { ...spanningRange(), storeId: a.store.id })
    assert.equal(crossStore.status, 200)
    assert.equal(crossStore.body.totals.jobCount, 0)
    assert.equal(crossStore.body.store.storeId, sibling.store.id)
    assert.equal(crossStore.body.jobs.find((job: Body) => job.id === jobA.id), undefined)

    // 3) 本店会话看得到自己的任务，证明上面的空结果不是因为查询本身坏了。
    const own = await call(a.cookie, spanningRange())
    assert.equal(own.status, 200)
    assert.equal(own.body.totals.jobCount, 1)
    assert.equal(own.body.jobs[0].id, jobA.id)
    assert.equal(own.body.jobs[0].orderNo, orderNo)
    assert.equal(own.body.store.storeId, a.store.id)
    assert.equal(own.body.store.storeName, a.store.name)
  })

  await test('时间范围过滤：今天 / 近 7 天 / 自定义各自收窄', async () => {
    const f = await fixture()
    const now = new Date()
    const today = await seedJob(f, { orderNo: 'R-TODAY', role: 'FRONT', mode: 'FRONT_ONLY', createdAt: now })
    const threeDaysAgo = await seedJob(f, { orderNo: 'R-3D', role: 'FRONT', mode: 'FRONT_ONLY', createdAt: new Date(now.getTime() - 3 * DAY) })
    const nineDaysAgo = await seedJob(f, { orderNo: 'R-9D', role: 'FRONT', mode: 'FRONT_ONLY', createdAt: new Date(now.getTime() - 9 * DAY) })

    const todayView = await call(f.cookie, { range: 'TODAY' })
    assert.deepEqual(todayView.body.jobs.map((job: Body) => job.id), [today.id])
    assert.equal(todayView.body.range.mode, 'TODAY')
    assert.equal(todayView.body.range.dateFrom, todayView.body.range.dateTo)

    const weekView = await call(f.cookie, { range: '7D' })
    assert.deepEqual(new Set(weekView.body.jobs.map((job: Body) => job.id)), new Set([today.id, threeDaysAgo.id]))
    assert.equal(weekView.body.range.dateFrom, localDate(-6))

    const customView = await call(f.cookie, { range: 'CUSTOM', dateFrom: localDate(-10), dateTo: localDate(0) })
    assert.equal(customView.body.totals.jobCount, 3)
    assert.ok(customView.body.jobs.some((job: Body) => job.id === nineDaysAgo.id))

    const narrowView = await call(f.cookie, { range: 'CUSTOM', dateFrom: localDate(-3), dateTo: localDate(-3) })
    assert.deepEqual(narrowView.body.jobs.map((job: Body) => job.id), [threeDaysAgo.id])
  })

  await test('① 总量与 role 分布', async () => {
    const f = await fixture()
    for (const [orderNo, role] of [['A-1', 'FRONT'], ['A-1', 'KITCHEN'], ['A-2', 'FRONT'], ['A-2', 'KITCHEN']] as const) {
      await seedJob(f, { orderNo, role, mode: 'SHARED_PRINTER', effectBoundary: 'CROSSED', resultStatus: 'SUCCESS', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET' })
    }
    const { body } = await call(f.cookie, spanningRange())
    assert.equal(body.totals.orderCount, 2)
    assert.equal(body.totals.jobCount, 4)
    assert.deepEqual(body.totals.byRole, { FRONT: 2, KITCHEN: 2 })
    assert.deepEqual(body.totals.byStatus, { SUCCEEDED: 4 })
    assert.deepEqual(body.totals.byMode, { SHARED_PRINTER: 4 })
    assert.deepEqual(body.totals.byEffectBoundary, { CROSSED: 4 })
    assert.equal(body.anomalies.missingRoleOrders.length, 0)
  })

  await test('② 漏单：SHARED_PRINTER 缺 KITCHEN 报出，FRONT_ONLY 只有 FRONT 不报', async () => {
    const f = await fixture()
    await seedJob(f, { orderNo: 'M-SHARED', role: 'FRONT', mode: 'SHARED_PRINTER', effectBoundary: 'CROSSED' })
    await seedJob(f, { orderNo: 'M-FRONTONLY', role: 'FRONT', mode: 'FRONT_ONLY', effectBoundary: 'CROSSED' })
    await seedJob(f, { orderNo: 'M-OK', role: 'FRONT', mode: 'SHARED_PRINTER', effectBoundary: 'CROSSED' })
    await seedJob(f, { orderNo: 'M-OK', role: 'KITCHEN', mode: 'SHARED_PRINTER', effectBoundary: 'CROSSED' })
    // 只有 KITCHEN 的 SHARED_PRINTER 单：缺的是 FRONT，也要报出来。
    await seedJob(f, { orderNo: 'M-NOFRONT', role: 'KITCHEN', mode: 'SHARED_PRINTER', effectBoundary: 'CROSSED' })

    const { body } = await call(f.cookie, spanningRange())
    const missing = body.anomalies.missingRoleOrders as Body[]
    assert.deepEqual(new Set(missing.map((order) => order.orderNo)), new Set(['M-SHARED', 'M-NOFRONT']))
    const shared = missing.find((order) => order.orderNo === 'M-SHARED')!
    assert.equal(shared.mode, 'SHARED_PRINTER')
    assert.deepEqual(shared.expectedRoles, ['FRONT', 'KITCHEN'])
    assert.deepEqual(shared.missingRoles, ['KITCHEN'])
    assert.equal(shared.modeConflict, false)
    assert.deepEqual(missing.find((order) => order.orderNo === 'M-NOFRONT')!.missingRoles, ['FRONT'])
    // 正常的 FRONT_ONLY 单绝不能被误报成漏单——误报会让整页失去信任。
    assert.equal(missing.some((order) => order.orderNo === 'M-FRONTONLY'), false)
    assert.equal(missing.some((order) => order.orderNo === 'M-OK'), false)
    assert.equal(body.anomalies.modeUndeterminedOrders.length, 0)
  })

  await test('② 漏单：payload 读不出 mode 时标为无法判定，不算漏单', async () => {
    const f = await fixture()
    await seedJob(f, { payload: { broken: true, order: { orderNo: 'U-1' }, role: 'FRONT' } })
    await seedJob(f, { orderNo: 'U-2', role: 'FRONT', mode: 'SOMETHING_NEW' })

    const { body } = await call(f.cookie, spanningRange())
    assert.equal(body.anomalies.missingRoleOrders.length, 0)
    const undetermined = body.anomalies.modeUndeterminedOrders as Body[]
    assert.deepEqual(new Set(undetermined.map((order) => order.orderNo)), new Set(['U-1', 'U-2']))
    assert.equal(undetermined[0].reason, 'PAYLOAD_MODE_UNREADABLE')
    // 未知 mode 原样带出，不被丢弃。
    assert.equal(body.totals.byMode.SOMETHING_NEW, 1)
    assert.equal(body.totals.byMode.UNKNOWN, 1)
  })

  await test('③ 重复：同一 orderNo + role 出现多个 job', async () => {
    const f = await fixture()
    await seedJob(f, { orderNo: 'D-1', role: 'FRONT', mode: 'SHARED_PRINTER' })
    await seedJob(f, { orderNo: 'D-1', role: 'FRONT', mode: 'SHARED_PRINTER' })
    await seedJob(f, { orderNo: 'D-1', role: 'KITCHEN', mode: 'SHARED_PRINTER' })
    await seedJob(f, { orderNo: 'D-2', role: 'FRONT', mode: 'FRONT_ONLY' })

    const { body } = await call(f.cookie, spanningRange())
    const duplicates = body.anomalies.duplicateJobs as Body[]
    assert.equal(duplicates.length, 1)
    assert.equal(duplicates[0].orderNo, 'D-1')
    assert.equal(duplicates[0].role, 'FRONT')
    assert.equal(duplicates[0].count, 2)
    assert.equal(duplicates[0].jobIds.length, 2)
  })

  await test('④ 卡住：非终态停留超过阈值，阈值可调', async () => {
    const f = await fixture()
    const now = Date.now()
    const stuckPending = await seedJob(f, { orderNo: 'S-1', role: 'FRONT', mode: 'FRONT_ONLY', status: 'PENDING', createdAt: new Date(now - 30 * MINUTE) })
    const stuckExecuting = await seedJob(f, { orderNo: 'S-2', role: 'FRONT', mode: 'FRONT_ONLY', status: 'EXECUTING', createdAt: new Date(now - 20 * MINUTE) })
    const freshClaimed = await seedJob(f, { orderNo: 'S-3', role: 'FRONT', mode: 'FRONT_ONLY', status: 'CLAIMED', createdAt: new Date(now - 1 * MINUTE) })
    // 已终结的老任务不是“卡住”。
    await seedJob(f, { orderNo: 'S-4', role: 'FRONT', mode: 'FRONT_ONLY', status: 'SUCCEEDED', createdAt: new Date(now - 40 * MINUTE), effectBoundary: 'CROSSED' })

    const tenMinutes = await call(f.cookie, { ...spanningRange(), stuckMinutes: '10' })
    assert.equal(tenMinutes.body.stuckThresholdMinutes, 10)
    assert.deepEqual((tenMinutes.body.anomalies.stuckJobs as Body[]).map((job) => job.id), [stuckPending.id, stuckExecuting.id])
    assert.ok((tenMinutes.body.anomalies.stuckJobs as Body[])[0].ageMs >= 30 * MINUTE)

    const twentyFive = await call(f.cookie, { ...spanningRange(), stuckMinutes: '25' })
    assert.deepEqual((twentyFive.body.anomalies.stuckJobs as Body[]).map((job) => job.id), [stuckPending.id])

    const oneMinute = await call(f.cookie, { ...spanningRange(), stuckMinutes: '1' })
    assert.deepEqual(
      new Set((oneMinute.body.anomalies.stuckJobs as Body[]).map((job) => job.id)),
      new Set([stuckPending.id, stuckExecuting.id, freshClaimed.id]),
    )

    // 默认阈值 10 分钟。
    const defaults = await call(f.cookie, spanningRange())
    assert.equal(defaults.body.stuckThresholdMinutes, 10)
  })

  await test('⑤ 失败：FAILED / EXPIRED 按 resultCode 分组，未知 code 不被丢弃', async () => {
    const f = await fixture()
    await seedJob(f, { orderNo: 'F-1', role: 'FRONT', mode: 'FRONT_ONLY', status: 'FAILED', resultStatus: 'FAILURE', resultCode: 'NETWORK_EXECUTION_FAILED', effectBoundary: 'NOT_CROSSED' })
    await seedJob(f, { orderNo: 'F-2', role: 'FRONT', mode: 'FRONT_ONLY', status: 'FAILED', resultStatus: 'FAILURE', resultCode: 'NETWORK_EXECUTION_FAILED', effectBoundary: 'NOT_CROSSED' })
    await seedJob(f, { orderNo: 'F-3', role: 'FRONT', mode: 'FRONT_ONLY', status: 'EXPIRED', resultStatus: 'EXPIRED', resultCode: 'JOB_TTL_EXPIRED', effectBoundary: 'NOT_CROSSED' })
    // 代码里没有出现过的 resultCode（agent 只受正则约束），必须原样分组。
    await seedJob(f, { orderNo: 'F-4', role: 'FRONT', mode: 'FRONT_ONLY', status: 'FAILED', resultStatus: 'FAILURE', resultCode: 'BRAND_NEW_FUTURE_CODE', effectBoundary: 'NOT_CROSSED' })
    // resultCode 为空的失败任务也要有归属，不能凭空消失。
    await seedJob(f, { orderNo: 'F-5', role: 'FRONT', mode: 'FRONT_ONLY', status: 'FAILED', resultStatus: 'FAILURE', resultCode: null, effectBoundary: 'NOT_CROSSED' })
    await seedJob(f, { orderNo: 'F-6', role: 'FRONT', mode: 'FRONT_ONLY', status: 'SUCCEEDED', effectBoundary: 'CROSSED' })

    const { body } = await call(f.cookie, spanningRange())
    assert.equal(body.anomalies.failures.jobCount, 5)
    assert.deepEqual(body.anomalies.failures.groups, [
      { resultCode: 'NETWORK_EXECUTION_FAILED', count: 2 },
      { resultCode: 'BRAND_NEW_FUTURE_CODE', count: 1 },
      { resultCode: 'JOB_TTL_EXPIRED', count: 1 },
      { resultCode: 'NO_RESULT_CODE', count: 1 },
    ])
  })

  await test('⑥ 不确定：CROSSING_UNKNOWN 单独成区块，与普通失败分开', async () => {
    const f = await fixture()
    const unknownJob = await seedJob(f, {
      orderNo: 'X-1', role: 'FRONT', mode: 'FRONT_ONLY', status: 'FAILED', resultStatus: 'FAILURE',
      resultCode: 'RUNTIME_INTERRUPTED_DURING_EXECUTION', resultMessage: '执行中断',
      effectBoundary: 'CROSSING_UNKNOWN', attemptCount: 2,
    })
    await seedJob(f, { orderNo: 'X-2', role: 'FRONT', mode: 'FRONT_ONLY', status: 'FAILED', resultStatus: 'FAILURE', resultCode: 'NETWORK_PREPARATION_FAILED', effectBoundary: 'NOT_CROSSED' })

    const { body } = await call(f.cookie, spanningRange())
    const uncertain = body.anomalies.uncertainJobs as Body[]
    assert.equal(uncertain.length, 1)
    assert.equal(uncertain[0].id, unknownJob.id)
    assert.equal(uncertain[0].resultCode, 'RUNTIME_INTERRUPTED_DURING_EXECUTION')
    assert.equal(uncertain[0].resultMessage, '执行中断')
    // 它同时也计入失败总数，但区块是分开的。
    assert.equal(body.anomalies.failures.jobCount, 2)
    assert.equal(body.totals.byEffectBoundary.CROSSING_UNKNOWN, 1)
    assert.equal(body.totals.byEffectBoundary.NOT_CROSSED, 1)
  })

  await test('⑦ 重试与延迟：attemptCount > 1 列出，createdAt→completedAt 落入耗时分布', async () => {
    const f = await fixture()
    const now = Date.now()
    const created = new Date(now - 10 * MINUTE)
    await seedJob(f, {
      orderNo: 'T-1', role: 'FRONT', mode: 'FRONT_ONLY', status: 'SUCCEEDED', attemptCount: 3, claimAttempt: 3,
      resultCode: 'SUBMITTED_TO_NETWORK_SOCKET', effectBoundary: 'CROSSED',
      createdAt: created, completedAt: new Date(created.getTime() + 3_000),
    })
    await seedJob(f, {
      orderNo: 'T-2', role: 'FRONT', mode: 'FRONT_ONLY', status: 'SUCCEEDED', attemptCount: 1,
      effectBoundary: 'CROSSED', createdAt: created, completedAt: new Date(created.getTime() + 90_000),
    })
    await seedJob(f, {
      orderNo: 'T-3', role: 'FRONT', mode: 'FRONT_ONLY', status: 'SUCCEEDED', attemptCount: 2,
      effectBoundary: 'CROSSED', createdAt: created, completedAt: new Date(created.getTime() + 20_000),
    })

    const { body } = await call(f.cookie, spanningRange())
    const retried = body.anomalies.retriedJobs as Body[]
    assert.deepEqual(retried.map((job) => job.orderNo), ['T-1', 'T-3'])
    assert.equal(retried[0].attemptCount, 3)
    assert.equal(retried[0].durationMs, 3_000)
    const durations = body.anomalies.durations
    assert.equal(durations.completedCount, 3)
    assert.deepEqual(durations.buckets, [
      { bucket: '<5s', count: 1 },
      { bucket: '5-15s', count: 0 },
      { bucket: '15-60s', count: 1 },
      { bucket: '1-5min', count: 1 },
      { bucket: '>5min', count: 0 },
    ])
    assert.equal(durations.p50Ms, 20_000)
    assert.equal(durations.maxMs, 90_000)
  })

  await test('physicalCompletionKnown 恒为 false 的成功任务不产生任何异常', async () => {
    const f = await fixture()
    await seedJob(f, {
      orderNo: 'P-1', role: 'FRONT', mode: 'SHARED_PRINTER', status: 'SUCCEEDED',
      resultStatus: 'SUCCESS', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET',
      effectBoundary: 'CROSSED', physicalCompletionKnown: false,
    })
    await seedJob(f, {
      orderNo: 'P-1', role: 'KITCHEN', mode: 'SHARED_PRINTER', status: 'SUCCEEDED',
      resultStatus: 'SUCCESS', resultCode: 'SUBMITTED_TO_NETWORK_SOCKET',
      effectBoundary: 'CROSSED', physicalCompletionKnown: false,
    })

    const { body } = await call(f.cookie, spanningRange())
    assert.equal(body.anomalies.missingRoleOrders.length, 0)
    assert.equal(body.anomalies.duplicateJobs.length, 0)
    assert.equal(body.anomalies.stuckJobs.length, 0)
    assert.equal(body.anomalies.failures.jobCount, 0)
    assert.equal(body.anomalies.uncertainJobs.length, 0)
    assert.equal(body.anomalies.retriedJobs.length, 0)
    assert.equal(body.anomalies.modeUndeterminedOrders.length, 0)
    assert.equal(body.jobs[0].physicalCompletionKnown, false)
  })

  await test('空数据区间正常返回零值，不报错', async () => {
    const f = await fixture()
    const { status, body } = await call(f.cookie, { range: 'CUSTOM', dateFrom: localDate(-20), dateTo: localDate(-20) })
    assert.equal(status, 200)
    assert.deepEqual(body.jobs, [])
    assert.equal(body.totals.jobCount, 0)
    assert.equal(body.totals.orderCount, 0)
    assert.deepEqual(body.totals.byRole, {})
    assert.equal(body.anomalies.failures.jobCount, 0)
    assert.deepEqual(body.anomalies.failures.groups, [])
    assert.equal(body.anomalies.durations.completedCount, 0)
    assert.equal(body.anomalies.durations.p50Ms, null)
    assert.equal(body.anomalies.durations.maxMs, null)
    assert.equal(body.scan.truncated, false)
  })

  await test('非 network-v2（旧 relay）任务不进明细，但单独计数不静默丢弃', async () => {
    const f = await fixture()
    const network = await seedJob(f, { orderNo: 'V-2', role: 'FRONT', mode: 'FRONT_ONLY', effectBoundary: 'CROSSED' })
    await seedJob(f, {
      schemaVersion: 1,
      payload: { relayVersion: 1, requestId: 'legacy-request-0001', orderNo: 'V-1', documentName: 'X' },
    })

    const { body } = await call(f.cookie, spanningRange())
    assert.deepEqual(body.jobs.map((job: Body) => job.id), [network.id])
    assert.equal(body.scan.nonNetworkJobCount, 1)
    assert.equal(body.scan.totalJobCount, 1)
  })

  await test('订单号读不出的任务单独计数，不塞进任何订单', async () => {
    const f = await fixture()
    await seedJob(f, { orderNo: null, role: 'FRONT', mode: 'FRONT_ONLY' })
    await seedJob(f, { orderNo: 'N-1', role: 'FRONT', mode: 'FRONT_ONLY' })

    const { body } = await call(f.cookie, spanningRange())
    assert.equal(body.totals.jobsWithoutOrderNo, 1)
    assert.equal(body.totals.orderCount, 1)
    assert.equal(body.anomalies.missingRoleOrders.length, 0)
    assert.equal(body.anomalies.duplicateJobs.length, 0)
  })

  await test('参数校验：非法 range / 日期 / 阈值返回 400，且不泄露内部错误', async () => {
    const f = await fixture()
    for (const query of [
      { range: 'LAST_YEAR' },
      { range: 'CUSTOM' },
      { range: 'CUSTOM', dateFrom: '2026-13-01', dateTo: localDate(0) },
      { range: 'CUSTOM', dateFrom: localDate(0), dateTo: localDate(-1) },
      { range: 'CUSTOM', dateFrom: localDate(-40), dateTo: localDate(0) },
      { range: 'TODAY', stuckMinutes: '0' },
      { range: 'TODAY', stuckMinutes: '9999' },
      { range: 'TODAY', stuckMinutes: 'abc' },
    ]) {
      const { status, body } = await call(f.cookie, query as Record<string, string>)
      assert.equal(status, 400, `expected 400 for ${JSON.stringify(query)}`)
      assert.ok(['INVALID_RANGE', 'INVALID_DATE', 'INVALID_DATE_RANGE', 'INVALID_STUCK_MINUTES'].includes(body.error), body.error)
    }
  })

  await test('只读保证：路由与页面都不含任何写操作', async () => {
    const route = readFileSync('app/api/network-print/jobs/route.ts', 'utf8')
    const page = readFileSync('app/network-print/jobs/page.tsx', 'utf8')
    for (const [name, source] of [['route', route], ['page', page]] as const) {
      assert.doesNotMatch(source, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw|executeRawUnsafe)\b/, `${name} must not write`)
      assert.doesNotMatch(source, /method:\s*'(POST|PUT|PATCH|DELETE)'/, `${name} must not send write requests`)
    }
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/, 'only GET may exist')
    // 门店隔离：只能来自会话，不能来自请求参数。
    assert.match(route, /const ctx = await getContext\(req\)/)
    assert.match(route, /tenantId: ctx\.tenantId, storeId: ctx\.storeId/)
    assert.doesNotMatch(route, /params\.get\('storeId'\)|params\.get\('tenantId'\)/)
  })

  await test('页面对未知取值有兜底，未知 resultCode / 状态不会导致渲染崩溃', async () => {
    const page = readFileSync('app/network-print/jobs/page.tsx', 'utf8')
    // 所有枚举展示都过 label()，label() 对未知值原样返回而不是 undefined。
    assert.match(page, /function label\(dict: Record<string, string>, value: string \| null \| undefined, fallback = '—'\)/)
    assert.match(page, /return dict\[value\] \?\? value/)
    for (const dict of ['STATUS_LABEL', 'ROLE_LABEL', 'MODE_LABEL', 'BOUNDARY_LABEL']) {
      // 只允许通过 label(dict, ...) 使用，不允许直接下标取值后当字符串渲染。
      const direct = new RegExp(`${dict}\\[`, 'g')
      assert.equal(page.match(direct), null, `${dict} must only be read through label()`)
    }
    // resultCode 一律原样显示，没有白名单过滤。
    assert.match(page, /job\.resultCode \?\? '—'/)
    assert.match(page, /group\.resultCode/)
    // 触摸屏可点区域与字号底线。
    assert.match(page, /minHeight: 44/)
    assert.doesNotMatch(page, /fontSize: (?:[0-9]|1[0-3])\b/)
  })

  await test('扫描上限被如实报告，不静默截断', async () => {
    const route = readFileSync('app/api/network-print/jobs/route.ts', 'utf8')
    assert.match(route, /const MAX_SCAN_ROWS = \d+/)
    assert.match(route, /truncated: totalJobCount > jobs\.length/)
    const page = readFileSync('app/network-print/jobs/page.tsx', 'utf8')
    assert.match(page, /data\.scan\.truncated/)
  })
}

run()
  .then(() => console.log(`network print observability API PASS (${cases} cases)`))
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => {
    // 只删除本文件创建的独立 fixture；绝不 reset / drop / truncate 共享测试数据。
    for (const tenantId of tenants) {
      await prisma.eshopTrayPrintJob.deleteMany({ where: { tenantId } })
      await prisma.userStoreRole.deleteMany({ where: { tenantId } })
      await prisma.user.deleteMany({ where: { tenantId } })
      await prisma.store.deleteMany({ where: { tenantId } })
      await prisma.tenant.delete({ where: { id: tenantId } })
    }
    await prisma.$disconnect()
  })
