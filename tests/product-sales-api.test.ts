import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { GET as options } from '../app/api/owner/product-sales/options/route'
import { POST as query } from '../app/api/owner/product-sales/query/route'
import { GET as groups, POST as create } from '../app/api/owner/product-sales/groups/route'
import { PATCH as update } from '../app/api/owner/product-sales/groups/[id]/route'
import { GET as history } from '../app/api/owner/product-sales/reports/route'
import { GET as reportDetail } from '../app/api/owner/product-sales/reports/[id]/route'
import { GET as cron } from '../app/api/cron/product-sales-daily/route'
import { generateDailyGroup } from '../lib/product-sales/service'
import { localDate, shiftDate } from '../lib/product-sales/dates'

// In-memory delegates exercise real routes/services without executing migrations
// or connecting to a database. SQL unique/RLS declarations are checked separately.
type Data = Record<string, any>
const db = prisma as unknown as Data
const restore: Array<() => void> = []
function stub(model: string, method: string, fn: (...args: any[]) => any) {
  const original = db[model][method]
  db[model][method] = fn
  restore.push(() => { db[model][method] = original })
}
function req(path: string, method = 'GET', body?: unknown, role: string | null = 'OWNER') {
  return new NextRequest(`http://localhost/api/owner/product-sales${path}`, { method, headers: {
    'content-type': 'application/json', ...(role ? { 'x-role': role, 'x-tenant-id': 'tenant-a', 'x-user-id': 'owner-a', 'x-store-id': 'store-a' } : {}),
  }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
}
const id = 'c3427774-4e94-4db5-8430-36a6e15d72e1'
const selection = { storeId: null, products: [{ tenantId: 'tenant-a', productId: 'p1' }, { tenantId: 'tenant-b', productId: 'p2' }] }
const records = new Map<string, Data>()
const reports = new Map<string, Data>()
let telegramId = 'owner-telegram'
let activeStoreIds = ['store-a', 'store-b']
let failSource = false
let serializationFailures = 0
let lockCalls = 0
let queue: Promise<unknown> = Promise.resolve()
const when = new Date('2026-09-10T00:10:00+07:00')
const products = [{ id: 'p1', tenantId: 'tenant-a', name: 'Same', barcode: 'SAME', status: 'ACTIVE' }, { id: 'p2', tenantId: 'tenant-b', name: 'Same', barcode: 'SAME', status: 'ACTIVE' }, { id: 'secret', tenantId: 'other', name: 'Secret', barcode: 'SAME' }]
const saleRows: Data[] = [
  { id: 'r1', tenantId: 'tenant-a', storeId: 'store-a', productId: 'p1', saleType: 'SALE', quantity: 2, lineAmount: 10, status: 'COMPLETED', createdAt: new Date('2026-09-09T06:00:00+07:00') },
  { id: 'r2', tenantId: 'tenant-b', storeId: 'store-b', productId: 'p2', saleType: 'SALE', quantity: 3, lineAmount: 20, status: 'COMPLETED', createdAt: new Date('2026-09-09T23:59:59+07:00') },
  { id: 'r3', tenantId: 'tenant-a', storeId: 'store-a', productId: 'p1', saleType: 'SALE', quantity: 100, lineAmount: 999, status: 'COMPLETED', createdAt: new Date('2026-09-09T05:59:59+07:00') },
  { id: 'r4', tenantId: 'tenant-a', storeId: 'store-a', productId: 'p1', saleType: 'SALE', quantity: 100, lineAmount: 999, status: 'PENDING_PAYMENT', createdAt: new Date('2026-09-09T12:00:00+07:00') },
  { id: 'r5', tenantId: 'other', storeId: 'store-x', productId: 'secret', saleType: 'SALE', quantity: 100, lineAmount: 999, status: 'COMPLETED', createdAt: new Date('2026-09-09T12:00:00+07:00') },
]
const orders: Data[] = [
  { id: 'c1', tenantId: 'tenant-a', storeId: 'store-a', status: 'COMPLETED', paymentStatus: 'PAID', paidAt: new Date('2026-09-09T12:00:00+07:00'), totalAmount: 6, itemsJson: JSON.stringify([{ productId: 'p1', quantity: 1, lineAmount: 10 }]) },
  { id: 'c2', tenantId: 'tenant-a', storeId: 'store-a', status: 'COMPLETED', paymentStatus: 'UNPAID', paidAt: new Date('2026-09-09T12:00:00+07:00'), itemsJson: JSON.stringify([{ productId: 'p1', quantity: 100, lineAmount: 999 }]) },
]
function sourceFilter(rows: Data[], args: Data, timeField: string) {
  const { where } = args
  assert.equal(where.status, 'COMPLETED')
  assert.ok(where.AND[0].OR.length)
  if (timeField === 'paidAt') assert.equal(where.paymentStatus, 'PAID')
  if (failSource) throw new Error('injected source failure')
  return rows.filter((row) => row.status === where.status && (!where.paymentStatus || row.paymentStatus === where.paymentStatus)
    && where.AND[0].OR.some((pair: Data) => pair.tenantId === row.tenantId && pair.storeId === row.storeId)
    && where.AND[1].OR.some((time: Data) => row[timeField] >= time[timeField].gte && row[timeField] < time[timeField].lt)
    && (!where.id || row.id > where.id.gt)).slice(0, args.take)
}
function ownedGroup(where: Data) {
  const group = records.get(where.id)
  return group && (!where.ownerTelegramId || group.ownerTelegramId === where.ownerTelegramId) ? structuredClone(group) : null
}
function ownedReports(where: Data) {
  return [...reports.values()].filter((report) => (!where.group || records.get(report.groupId)?.ownerTelegramId === where.group.ownerTelegramId)
    && (!where.id || (typeof where.id === 'string' ? report.id === where.id : report.id < where.id.lt))
    && (!where.groupId || report.groupId === where.groupId))
}

async function main() {
  stub('user', 'findFirst', async ({ where }) => where.id === 'owner-a' && where.tenantId === 'tenant-a' && where.role === 'OWNER' && where.status === 'ACTIVE' ? { telegramId } : null)
  stub('userStoreRole', 'findMany', async ({ where }) => {
    assert.equal(where.role, 'OWNER'); assert.equal(where.status, 'ACTIVE')
    assert.equal(where.user.is.telegramId, telegramId)
    return ['a', 'b'].filter((suffix) => activeStoreIds.includes(`store-${suffix}`)).map((suffix) => ({
      tenantId: `tenant-${suffix}`, userId: `owner-${suffix}`, storeId: `store-${suffix}`, createdAt: when,
      user: { tenantId: `tenant-${suffix}` }, store: { id: `store-${suffix}`, tenantId: `tenant-${suffix}`, name: `Shop ${suffix}`, currencyCode: 'USD' },
    }))
  })
  stub('product', 'findMany', async ({ where }) => products.filter((product) => where.tenantId ? where.tenantId.in.includes(product.tenantId) : where.OR.some((ref: Data) => product.id === ref.id && product.tenantId === ref.tenantId)))
  stub('saleRecord', 'findMany', async (args) => sourceFilter(saleRows, args, 'createdAt'))
  stub('customerOrder', 'findMany', async (args) => sourceFilter(orders, args, 'paidAt'))
  stub('productSalesGroup', 'create', async ({ data }) => {
    if (records.has(data.id)) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.6.0' })
    const row = { ...data, createdAt: new Date('2026-09-08T00:00:00Z'), updatedAt: new Date('2026-09-08T00:00:00Z') }
    records.set(data.id, row); return structuredClone(row)
  })
  stub('productSalesGroup', 'findFirst', async ({ where }) => ownedGroup(where))
  stub('productSalesGroup', 'findUnique', async ({ where }) => ownedGroup(where))
  stub('productSalesGroup', 'findMany', async ({ where }) => [...records.values()].filter((row) => (!where.ownerTelegramId || row.ownerTelegramId === where.ownerTelegramId) && (where.enabled === undefined || row.enabled === where.enabled)).map((row) => structuredClone(row)))
  stub('productSalesGroup', 'updateMany', async ({ where, data }) => {
    const row = records.get(where.id)
    if (!row || row.ownerTelegramId !== where.ownerTelegramId || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 }
    Object.assign(row, data); return { count: 1 }
  })
  stub('productSalesDailyReport', 'findUnique', async ({ where }) => [...reports.values()].find((report) => report.groupId === where.groupId_reportDate.groupId && report.reportDate === where.groupId_reportDate.reportDate) ?? null)
  stub('productSalesDailyReport', 'create', async ({ data }) => {
    assert.ok(![...reports.values()].some((report) => report.groupId === data.groupId && report.reportDate === data.reportDate))
    const row = { id: `report-${reports.size + 1}`, ...data }; reports.set(row.id, row); return structuredClone(row)
  })
  stub('productSalesDailyReport', 'findMany', async ({ where }) => ownedReports(where))
  stub('productSalesDailyReport', 'findFirst', async ({ where }) => ownedReports(where)[0] ?? null)
  const originalTransaction = db.$transaction
  const originalRaw = db.$queryRaw
  db.$queryRaw = async (sql: TemplateStringsArray) => { assert.match(sql.join('?'), /ProductSalesGroup.*FOR UPDATE/); lockCalls++; return [] }
  db.$transaction = (fn: (tx: Data) => Promise<unknown>, opts: Data) => {
    assert.ok(['Serializable', 'RepeatableRead'].includes(opts.isolationLevel))
    const run = queue.then(async () => {
      if (serializationFailures > 0) { serializationFailures--; throw new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: '7.6.0' }) }
      const saved = structuredClone(reports)
      try { return await fn(db) } catch (error) { reports.clear(); for (const [key, value] of saved) reports.set(key, value); throw error }
    })
    queue = run.catch(() => {})
    return run
  }
  restore.push(() => { db.$transaction = originalTransaction; db.$queryRaw = originalRaw })

  assert.equal((await options(req('/options', 'GET', undefined, null))).status, 401)
  assert.equal((await groups(req('/groups', 'GET', undefined, 'STAFF'))).status, 403)
  const oldDisable = process.env.ESHOP_DISABLE_DEV_HEADERS
  process.env.ESHOP_DISABLE_DEV_HEADERS = '1'
  assert.equal((await options(req('/options'))).status, 401, 'forged headers cannot bypass disabled dev context')
  if (oldDisable === undefined) delete process.env.ESHOP_DISABLE_DEV_HEADERS; else process.env.ESHOP_DISABLE_DEV_HEADERS = oldDisable
  const opts = await (await options(req('/options'))).json()
  assert.deepEqual(opts.products.map((product: Data) => product.productId), ['p1', 'p2'])
  assert.equal(JSON.stringify(opts).includes('Secret'), false)
  assert.equal((await options(req('/options?storeId=store-x'))).status, 403)
  const body = { ...selection, period: 'CUSTOM', dateFrom: '2026-09-09', dateTo: '2026-09-09' }
  const response = await query(req('/query', 'POST', body))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control')!, /no-store/)
  const output = await response.json()
  assert.equal(output.totals[0].salesAmount, '40.00', '10 recorded sale + 10 customer line + 20 other store; no coupon allocation')
  assert.equal(output.totals[0].quantity, '6.00')
  const single = await (await query(req('/query', 'POST', { ...body, products: [selection.products[0]], storeId: 'store-a' }))).json()
  assert.equal(single.totals[0].salesAmount, '20.00')
  assert.equal((await query(req('/query', 'POST', { ...body, storeId: 'store-x' }))).status, 403)
  assert.equal((await query(req('/query', 'POST', { ...body, products: [{ tenantId: 'other', productId: 'secret' }] }))).status, 403)
  // Exercise real cursor loops across both persisted sources and the shared cap.
  const originalSales = [...saleRows]; const originalOrders = [...orders]
  try {
    saleRows.splice(0, saleRows.length, ...Array.from({ length: 1001 }, (_, i) => ({ ...originalSales[0], id: `r${String(i).padStart(6, '0')}`, quantity: 1, lineAmount: 1 })))
    orders.splice(0, orders.length, ...Array.from({ length: 1001 }, (_, i) => ({ ...originalOrders[0], id: `c${String(i).padStart(6, '0')}`, itemsJson: JSON.stringify([{ productId: 'p1', quantity: 1, lineAmount: 1 }]) })))
    const paged = await (await query(req('/query', 'POST', body))).json()
    assert.equal(paged.totals[0].salesAmount, '2002.00', 'both source page tails included exactly once')
    saleRows.splice(0, saleRows.length, ...Array.from({ length: 49000 }, (_, i) => ({ ...originalSales[0], id: `r${String(i).padStart(6, '0')}`, quantity: 1, lineAmount: 1 })))
    orders.length = 1000
    const atCap = await (await query(req('/query', 'POST', body))).json()
    assert.equal(atCap.totals[0].salesAmount, '50000.00')
    orders.push({ ...orders[0], id: 'c999999' })
    const overCap = await query(req('/query', 'POST', body))
    assert.equal(overCap.status, 422)
    assert.equal((await overCap.json()).error, 'QUERY_TOO_LARGE', 'no silent truncation across sources')
  } finally { saleRows.splice(0, saleRows.length, ...originalSales); orders.splice(0, orders.length, ...originalOrders) }
  const broken = new NextRequest('http://localhost/api/owner/product-sales/query', { method: 'POST', headers: req('/').headers, body: '{broken' })
  assert.equal((await query(broken)).status, 400)
  const crossOrigin = req('/query', 'POST', body); crossOrigin.headers.set('origin', 'https://attacker.invalid')
  assert.equal((await query(crossOrigin)).status, 403)

  const createBody = { id, name: 'Daily group', enabled: true, selection }
  const [first, repeated] = await Promise.all([create(req('/groups', 'POST', createBody)), create(req('/groups', 'POST', createBody))])
  assert.equal(first.status, 200); assert.equal(repeated.status, 200); assert.equal(records.size, 1)
  const saved = await first.json()
  assert.equal('ownerTelegramId' in saved, false)
  assert.equal((await create(req('/groups', 'POST', { ...createBody, name: 'Different' }))).status, 409)
  assert.equal((await update(req(`/groups/${id}`, 'PATCH', { ...createBody, updatedAt: 'stale' }), { params: Promise.resolve({ id }) })).status, 409)
  const [edit, staleEdit] = await Promise.all([
    update(req(`/groups/${id}`, 'PATCH', { ...createBody, name: 'Edited', updatedAt: saved.updatedAt }), { params: Promise.resolve({ id }) }),
    update(req(`/groups/${id}`, 'PATCH', { ...createBody, name: 'Other', updatedAt: saved.updatedAt }), { params: Promise.resolve({ id }) }),
  ])
  assert.deepEqual([edit.status, staleEdit.status].sort(), [200, 409])
  serializationFailures = 1
  const outcomes = await Promise.all([generateDailyGroup(id, when), generateDailyGroup(id, when)])
  assert.deepEqual(outcomes.sort(), ['created', 'existing']); assert.equal(reports.size, 1); assert.ok(lockCalls >= 2)
  const stored = [...reports.values()][0]
  assert.equal(stored.reportDate, '2026-09-09')
  assert.equal(stored.result.totals[0].salesAmount, '40.00')
  const originalJson = JSON.stringify(stored.result)
  records.get(id)!.name = 'Later edit'
  assert.equal(await generateDailyGroup(id, when), 'existing')
  assert.equal(JSON.stringify(stored.result), originalJson, 'group edits do not rewrite history')
  assert.equal((await reportDetail(req(`/reports/${stored.id}`), { params: Promise.resolve({ id: stored.id }) })).status, 200)
  activeStoreIds = ['store-a']
  assert.equal((await reportDetail(req(`/reports/${stored.id}`), { params: Promise.resolve({ id: stored.id }) })).status, 404)
  assert.equal((await (await history(req('/reports'))).json()).reports.length, 0)
  const disable = await update(req(`/groups/${id}`, 'PATCH', { enabled: false, updatedAt: records.get(id)!.updatedAt.toISOString() }), { params: Promise.resolve({ id }) })
  assert.equal(disable.status, 200, 'disable still works when stored selection contains a revoked store')
  assert.equal(await generateDailyGroup(id, when), 'skipped')
  activeStoreIds = ['store-a', 'store-b']
  records.get(id)!.enabled = true
  failSource = true
  const previousError = console.error; console.error = () => {}
  try {
    await assert.rejects(() => generateDailyGroup(id, new Date('2026-09-11T00:10:00+07:00')), /injected/)
    assert.equal(reports.size, 1, 'failed generation never stores a partial report')
    assert.equal((await query(req('/query', 'POST', body))).status, 500)
  } finally { console.error = previousError; failSource = false }
  telegramId = 'different-owner'
  assert.equal((await (await groups(req('/groups'))).json()).length, 0)
  assert.equal((await reportDetail(req(`/reports/${stored.id}`), { params: Promise.resolve({ id: stored.id }) })).status, 404)
  assert.equal((await update(req(`/groups/${id}`, 'PATCH', { enabled: false, updatedAt: saved.updatedAt }), { params: Promise.resolve({ id }) })).status, 404)
  telegramId = 'owner-telegram'
  assert.equal((await cron(new NextRequest('http://localhost/api/cron/product-sales-daily'))).status, 401)
  const secret = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'test-only-secret-123456789'
  const daily = await cron(new NextRequest('http://localhost/api/cron/product-sales-daily', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }))
  assert.equal(daily.status, 200)
  if (secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = secret
  assert.ok([...reports.values()].some((report) => report.reportDate === shiftDate(localDate(), -1)))
  console.log('product sales real route/service tests passed: auth, isolation, source predicates, CRUD, retries, history revocation and daily concurrency')
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => { for (const fn of restore.reverse()) fn() })
