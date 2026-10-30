import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { ExternalGoogleProvider, InventoryProfitExternalError } from '../lib/inventory-profit/external-google-provider'
import { GET as inventory, PATCH as updateMinimum } from '../app/api/inventory-profit/inventory/route'
import { GET as salesProfit } from '../app/api/inventory-profit/sales-profit/route'
import { POST as receive } from '../app/api/inventory-profit/receivings/route'
import { GET as exportInventory } from '../app/api/inventory-profit/inventory/export/route'

type AnyRecord = Record<string, any>
const db = prisma as unknown as AnyRecord
const restore: Array<() => void> = []

function stub(model: string, method: string, implementation: (args: AnyRecord) => unknown) {
  const original = db[model][method]
  db[model][method] = implementation
  restore.push(() => { db[model][method] = original })
}

function telegramInitData(telegramId: string, token: string, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'presence-query',
    user: JSON.stringify({ id: telegramId, first_name: 'Owner' }),
  })
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheck).digest('hex'))
  return params.toString()
}

function req(path: string, options: {
  role?: 'OWNER' | 'STAFF'
  storeId?: string
  method?: string
  body?: unknown
  presence?: string
} = {}) {
  const role = options.role ?? 'OWNER'
  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': 'pilot-tenant',
      'x-user-id': role === 'OWNER' ? 'pilot-owner' : 'pilot-staff',
      'x-store-id': options.storeId ?? 'pilot-store',
      'x-role': role,
      ...(options.presence ? { 'x-telegram-init-data': options.presence } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

async function main() {
  const envKeys = [
    'INVENTORY_PROFIT_PILOT_STORE_ID',
    'INVENTORY_PROFIT_GOOGLE_URL',
    'INVENTORY_PROFIT_GOOGLE_SECRET',
    'TELEGRAM_BOT_TOKEN',
  ] as const
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  process.env.INVENTORY_PROFIT_PILOT_STORE_ID = 'pilot-store'
  process.env.INVENTORY_PROFIT_GOOGLE_URL = 'https://script.test/exec'
  process.env.INVENTORY_PROFIT_GOOGLE_SECRET = 'provider-secret'
  process.env.TELEGRAM_BOT_TOKEN = 'telegram-test-token'
  restore.push(() => {
    for (const key of envKeys) {
      const value = oldEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  stub('user', 'findFirst', async ({ where }) => (
    where.id === 'pilot-owner' && where.tenantId === 'pilot-tenant'
      ? { telegramId: '9001' }
      : null
  ))

  const originalFetch = globalThis.fetch
  let stale = false
  let receivingCalls = 0
  const seenActions: string[] = []
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as AnyRecord
    seenActions.push(body.action)
    assert.equal(body.secret, 'provider-secret')
    const asOf = stale ? '2026-01-01T00:00:00.000Z' : new Date().toISOString()
    if (body.action === 'LIST_INVENTORY') {
      return Response.json({ ok: true, asOf, data: [
        { productId: 'p-neg', sku: 'NEG-1', barcode: 'B-NEG', name: '负库存', currentStock: -1, minimumStock: 10, averageCost: 2, inventoryValue: -2, updatedAt: asOf },
        { productId: 'p-zero', sku: 'ZERO-1', barcode: 'B-ZERO', name: '缺货', currentStock: 0, minimumStock: 10, averageCost: null, inventoryValue: null, updatedAt: asOf },
        { productId: 'p-low', sku: 'LOW-10', barcode: 'B-LOW', name: '低库存', currentStock: 10, minimumStock: 10, averageCost: 3, inventoryValue: 30, updatedAt: asOf },
        { productId: 'p-ok', sku: 'OK-11', barcode: 'B-OK', name: '正常', currentStock: 11, minimumStock: 10, averageCost: 4, inventoryValue: 44, updatedAt: asOf },
      ] })
    }
    if (body.action === 'GET_SALES_PROFIT') {
      return Response.json({ ok: true, asOf, data: {
        period: body.period,
        netSales: 100,
        costOfGoodsSold: 0,
        grossProfit: 100,
        grossMarginRate: 1,
        costCoverageRate: 0.5,
        costMethod: 'DAILY_PERIODIC_WAC',
      } })
    }
    if (body.action === 'SET_MINIMUM_STOCK') {
      return Response.json({ ok: true, asOf, data: { minimumStock: body.minimumStock } })
    }
    if (body.action === 'RECEIVE') {
      receivingCalls += 1
      return Response.json({ ok: true, asOf, data: {
        requestKey: body.requestKey,
        duplicate: receivingCalls > 1,
        recordedAt: asOf,
      } })
    }
    return Response.json({ ok: false }, { status: 400 })
  }) as typeof fetch
  restore.push(() => { globalThis.fetch = originalFetch })

  assert.equal((await inventory(req('/api/inventory-profit/inventory', { role: 'STAFF' }))).status, 403)
  assert.equal((await inventory(req('/api/inventory-profit/inventory', { storeId: 'other-store' }))).status, 403)

  const alerts = await (await inventory(req('/api/inventory-profit/inventory'))).json()
  assert.deepEqual(alerts.items.map((item: AnyRecord) => item.alert), ['NEGATIVE', 'OUT_OF_STOCK', 'LOW_STOCK'])
  assert.equal(alerts.items.some((item: AnyRecord) => 'averageCost' in item || 'inventoryValue' in item), false, 'ordinary inventory view excludes cost/value')
  const searched = await (await inventory(req('/api/inventory-profit/inventory?q=LOW-10'))).json()
  assert.deepEqual(searched.items.map((item: AnyRecord) => item.productId), ['p-low'])

  assert.equal((await salesProfit(req('/api/inventory-profit/sales-profit?period=TODAY'))).status, 403, 'profit requires Telegram presence')
  const presence = telegramInitData('9001', process.env.TELEGRAM_BOT_TOKEN)
  const wrongPresence = telegramInitData('9002', process.env.TELEGRAM_BOT_TOKEN)
  assert.equal((await salesProfit(req('/api/inventory-profit/sales-profit?period=TODAY', { presence: wrongPresence }))).status, 403)
  assert.equal((await salesProfit(req('/api/inventory-profit/sales-profit?period=TODAY', {
    presence: telegramInitData('9001', process.env.TELEGRAM_BOT_TOKEN, Math.floor(Date.now() / 1000) - 901),
  }))).status, 403, 'expired Telegram presence is rejected')
  const profit = await (await salesProfit(req('/api/inventory-profit/sales-profit?period=TODAY', { presence }))).json()
  assert.equal(profit.data.costCoverageRate, 0.5)
  assert.equal(profit.data.costOfGoodsSold, null, 'partial coverage never turns missing cost into zero')
  assert.equal(profit.data.grossProfit, null)
  assert.equal(profit.data.grossMarginRate, null)

  const updated = await updateMinimum(req('/api/inventory-profit/inventory', {
    method: 'PATCH', body: { minimumStock: 10 },
  }))
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).data.minimumStock, 10)

  const receivingBody = { requestKey: 'receive:pilot:0001', productId: 'p-low', quantity: 4, unitCost: 2.5, date: '2026-10-31' }
  const first = await receive(req('/api/inventory-profit/receivings', { method: 'POST', body: receivingBody, presence }))
  const repeated = await receive(req('/api/inventory-profit/receivings', { method: 'POST', body: receivingBody, presence }))
  assert.deepEqual([(await first.json()).data.duplicate, (await repeated.json()).data.duplicate], [false, true])

  const csvResponse = await exportInventory(req('/api/inventory-profit/inventory/export', { presence }))
  assert.equal(csvResponse.status, 200)
  const csvBytes = new Uint8Array(await csvResponse.arrayBuffer())
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV starts with UTF-8 BOM')
  const csv = new TextDecoder().decode(csvBytes)
  assert.match(csv, /平均成本,库存价值/)

  stale = true
  const staleResponse = await inventory(req('/api/inventory-profit/inventory'))
  assert.equal(staleResponse.status, 503)
  assert.deepEqual(await staleResponse.json(), { ok: false, state: 'STALE', message: '数据暂时无法更新' })
  stale = false

  const abortingFetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })) as typeof fetch
  const timeoutProvider = new ExternalGoogleProvider({
    endpoint: 'https://script.test/exec', secret: 'secret', timeoutMs: 5, fetcher: abortingFetch,
  })
  await assert.rejects(
    () => timeoutProvider.listInventory('pilot-store', {}),
    (error: unknown) => error instanceof InventoryProfitExternalError && error.code === 'TIMEOUT',
  )

  const unavailableProvider = new ExternalGoogleProvider({
    endpoint: 'https://script.test/exec', secret: 'secret',
    fetcher: (async () => { throw new Error('offline') }) as typeof fetch,
  })
  await assert.rejects(
    () => unavailableProvider.listInventory('pilot-store', {}),
    (error: unknown) => error instanceof InventoryProfitExternalError && error.code === 'UNAVAILABLE',
  )
  assert.ok(seenActions.includes('GET_SALES_PROFIT') && seenActions.includes('LIST_INVENTORY') && seenActions.includes('RECEIVE'))
  console.log('inventory profit provider/access tests passed: OWNER, Telegram presence, NULL cost, coverage, low-stock, search, idempotency, stale, timeout, unavailable and CSV BOM')
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => { for (const fn of restore.reverse()) fn() })
