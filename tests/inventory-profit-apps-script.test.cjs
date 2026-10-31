const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

class RangeMock {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet
    this.row = row - 1
    this.column = column - 1
    this.rowCount = rowCount
    this.columnCount = columnCount
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowIndex) => (
      Array.from({ length: this.columnCount }, (_, columnIndex) => (
        this.sheet.data[this.row + rowIndex]?.[this.column + columnIndex] ?? ''
      ))
    ))
  }

  setValues(values) {
    values.forEach((row, rowIndex) => {
      const targetRow = this.row + rowIndex
      if (!this.sheet.data[targetRow]) this.sheet.data[targetRow] = []
      row.forEach((value, columnIndex) => {
        this.sheet.data[targetRow][this.column + columnIndex] = value
      })
    })
    return this
  }

  clearContent() {
    for (let rowIndex = 0; rowIndex < this.rowCount; rowIndex += 1) {
      const targetRow = this.row + rowIndex
      if (!this.sheet.data[targetRow]) continue
      for (let columnIndex = 0; columnIndex < this.columnCount; columnIndex += 1) {
        this.sheet.data[targetRow][this.column + columnIndex] = ''
      }
    }
    return this
  }
}

class SheetMock {
  constructor(name) {
    this.name = name
    this.data = []
  }

  getLastRow() {
    for (let index = this.data.length - 1; index >= 0; index -= 1) {
      if ((this.data[index] ?? []).some((value) => value !== '')) return index + 1
    }
    return 0
  }

  getLastColumn() {
    return this.data.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  }

  getRange(row, column, rowCount, columnCount) {
    return new RangeMock(this, row, column, rowCount, columnCount)
  }

  appendRow(row) {
    this.data.push([...row])
  }
}

class SpreadsheetMock {
  constructor() {
    this.sheets = new Map()
  }

  getSheetByName(name) {
    return this.sheets.get(name) ?? null
  }

  insertSheet(name) {
    const sheet = new SheetMock(name)
    this.sheets.set(name, sheet)
    return sheet
  }
}

function response(body, code = 200) {
  return {
    getResponseCode: () => code,
    getContentText: () => JSON.stringify(body),
  }
}

const spreadsheet = new SpreadsheetMock()
let lockAttempts = 0
let lockReleases = 0
let lockAvailable = true
let sleepCalls = 0
let fetchImpl = () => { throw new Error('fetch not configured') }
const context = vm.createContext({
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => { lockAttempts += 1; return lockAvailable },
      releaseLock: () => { lockReleases += 1 },
    }),
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (content) => ({
      content,
      setMimeType(mimeType) { this.mimeType = mimeType; return this },
    }),
  },
  UrlFetchApp: { fetch: (url, options) => fetchImpl(url, options) },
  Utilities: {
    sleep: () => { sleepCalls += 1 },
    formatDate: (date, timezone) => {
      assert.equal(timezone, 'Asia/Phnom_Penh')
      return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    },
  },
  Session: { getScriptTimeZone: () => 'UTC' },
})

vm.runInContext(fs.readFileSync('apps-script/inventory-profit/Code.gs', 'utf8'), context, {
  filename: 'apps-script/inventory-profit/Code.gs',
})

function post(body) {
  const output = context.doPost({ postData: { contents: JSON.stringify(body) } })
  assert.equal(output.mimeType, 'application/json')
  return JSON.parse(output.content)
}

context.initializeInventoryProfitPilot()
assert.deepEqual([...spreadsheet.sheets.keys()].sort(), ['Config', 'DailyProfit', 'Entries', 'Inventory', 'SalesDaily', '_Log'].sort())
assert.deepEqual(spreadsheet.getSheetByName('Inventory').data[0].slice(-2), ['updatedAt', 'trackingStartDate'], 'tracking metadata appends without shifting existing inventory columns')
context.setConfigValue_('PROVIDER_SECRET', 'provider-secret')
context.setConfigValue_('PILOT_STORE_ID', 'pilot-store')

spreadsheet.getSheetByName('Inventory').data[0][0] = 'tampered-before-auth'
assert.deepEqual(post({ action: 'LIST_INVENTORY', secret: 'wrong', storeId: 'pilot-store' }), { ok: false, error: 'UNAUTHORIZED' })
assert.equal(spreadsheet.getSheetByName('Inventory').data[0][0], 'tampered-before-auth', 'unauthenticated doPost cannot rewrite sheet structure')
assert.deepEqual(post({ action: 'LIST_INVENTORY', secret: 'provider-secret', storeId: 'other-store' }), { ok: false, error: 'PILOT_STORE_REQUIRED' })
assert.equal(spreadsheet.getSheetByName('Inventory').data[0][0], 'tampered-before-auth', 'wrong-store doPost cannot rewrite sheet structure')
context.ensureInventoryProfitSheets_()

context.replaceObjectRows_('Inventory', [{
  productId: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1', currentStock: 0,
  minimumStock: 10, averageCost: '', inventoryValue: '', trackingStartDate: '', updatedAt: new Date().toISOString(),
}])
context.setConfigValue_('LAST_FEED_SYNC_AT', '2026-10-30T00:00:00.000Z')
const receivingToday = context.localDateForInstant_(new Date())
const receiveBody = {
  action: 'RECEIVE', secret: 'provider-secret', storeId: 'pilot-store', requestKey: 'receive:test:0001',
  productId: 'p1', quantity: 10, unitCost: 2, date: receivingToday,
}
const firstReceiving = post(receiveBody)
const duplicateReceiving = post(receiveBody)
assert.equal(firstReceiving.ok, true)
assert.equal(firstReceiving.data.duplicate, false)
assert.equal(duplicateReceiving.data.duplicate, true)
assert.equal(context.rowsAsObjects_('Entries').length, 1, 'requestKey prevents duplicate entry rows')
assert.ok(lockAttempts >= 3 && lockAttempts === lockReleases, 'mutations use and release LockService')
assert.equal(context.configValue_('LAST_FEED_SYNC_AT'), '2026-10-30T00:00:00.000Z', 'receiving does not disguise stale feed data as fresh')
assert.equal(post({ action: 'SET_MINIMUM_STOCK', secret: 'provider-secret', storeId: 'pilot-store', minimumStock: 8 }).ok, true)
assert.equal(context.configValue_('LAST_FEED_SYNC_AT'), '2026-10-30T00:00:00.000Z', 'minimum-stock changes do not disguise stale feed data as fresh')
assert.deepEqual(post({ ...receiveBody, requestKey: 'receive:test:bad-date', date: '2026-02-30' }), { ok: false, error: 'INVALID_RECEIVING' })
assert.equal(context.validReceivingDate_('2026-10-31', '2026-10-31'), true, 'today is accepted')
assert.equal(context.validReceivingDate_('2026-10-28', '2026-10-31'), true, 'D-3 is accepted')
assert.equal(context.validReceivingDate_('2026-10-27', '2026-10-31'), false, 'D-4 is rejected')
assert.equal(context.validReceivingDate_('2026-11-01', '2026-10-31'), false, 'future dates are rejected')
assert.equal(post({ ...receiveBody, requestKey: 'receive:test:d3-pass', date: context.shiftLocalDate_(receivingToday, -3) }).ok, true)
assert.deepEqual(post({ ...receiveBody, requestKey: 'receive:test:d4-fail', date: context.shiftLocalDate_(receivingToday, -4) }), { ok: false, error: 'INVALID_RECEIVING' })
assert.deepEqual(post({ ...receiveBody, requestKey: 'receive:test:future', date: context.shiftLocalDate_(receivingToday, 1) }), { ok: false, error: 'INVALID_RECEIVING' })

context.replaceObjectRows_('Entries', [
  { requestKey: 'wac-entry-001', productId: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1', quantity: 10, unitCost: 2, date: '2026-10-30', createdAt: '2026-10-30T01:00:00Z' },
  { requestKey: 'wac-entry-002', productId: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1', quantity: 10, unitCost: 4, date: '2026-10-30', createdAt: '2026-10-30T02:00:00Z' },
])
context.replaceObjectRows_('SalesDaily', [
  { date: '2026-10-30', productId: 'p1', quantity: 5, netSales: 50, costOfGoodsSold: '', costCovered: '', updatedAt: '' },
])
context.recalculateInventoryProfit_({ p1: { productId: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1' } })
const inventory = context.rowsAsObjects_('Inventory')[0]
const salesDaily = context.rowsAsObjects_('SalesDaily')[0]
const dailyProfit = context.rowsAsObjects_('DailyProfit')[0]
assert.equal(inventory.currentStock, 15)
assert.equal(inventory.averageCost, 3)
assert.equal(inventory.inventoryValue, 45)
assert.equal(salesDaily.costOfGoodsSold, 15)
assert.equal(dailyProfit.costOfGoodsSold, 15)
assert.equal(dailyProfit.grossProfit, 35)
assert.equal(dailyProfit.costMethod, 'DAILY_PERIODIC_WAC')

const readLockAttempts = lockAttempts
const readLockReleases = lockReleases
assert.equal(post({ action: 'GET_SALES_PROFIT', secret: 'provider-secret', storeId: 'pilot-store', period: 'TODAY' }).ok, true)
assert.equal(post({ action: 'LIST_INVENTORY', secret: 'provider-secret', storeId: 'pilot-store', alertsOnly: false }).ok, true)
assert.equal(lockAttempts - readLockAttempts, 2, 'profit and inventory reads acquire the script lock')
assert.equal(lockReleases - readLockReleases, 2, 'profit and inventory reads release the script lock')
lockAvailable = false
assert.deepEqual(post({ action: 'GET_SALES_PROFIT', secret: 'provider-secret', storeId: 'pilot-store', period: 'TODAY' }), { ok: false, error: 'UNAVAILABLE' })
assert.deepEqual(post({ action: 'LIST_INVENTORY', secret: 'provider-secret', storeId: 'pilot-store', alertsOnly: false }), { ok: false, error: 'UNAVAILABLE' })
lockAvailable = true

context.replaceObjectRows_('Entries', [])
context.replaceObjectRows_('SalesDaily', [])
context.applyFeedPayload_({
  products: [
    { id: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1' },
    { id: 'p2', sku: 'SKU-2', barcode: 'BAR-2', name: 'Product 2' },
  ],
  sales: [{ createdAt: '2026-10-30T18:00:00.000Z', productId: null, quantity: 1, lineAmount: 0 }],
  customerOrders: [
    {
      paidAt: '2026-10-30T18:05:00.000Z', totalAmount: 50,
      items: [
        { productId: 'p1', quantity: 2, lineAmount: 60 },
        { productId: 'p2', quantity: 1, lineAmount: 40 },
      ],
    },
    {
      paidAt: '2026-10-30T18:10:00.000Z', totalAmount: 0,
      items: [{ productId: 'p1', quantity: 1, lineAmount: 20 }],
    },
  ],
  refunds: [],
}, '2026-10-31', '2026-10-31')
const localSales = context.rowsAsObjects_('SalesDaily')
assert.deepEqual([...new Set(localSales.map((row) => row.date))], ['2026-10-31'], 'UTC evening is bucketed into the Phnom Penh business day')
assert.equal(localSales.reduce((total, row) => total + Number(row.netSales), 0), 50, 'coupon discount is allocated so item net sales equal the paid total')
assert.equal(localSales.find((row) => row.productId === 'p1').quantity, 3, 'zero-payable coupon orders still consume inventory')
assert.equal(localSales.some((row) => row.productId === '__UNATTRIBUTED__'), true, 'unattributed sales remain visible to coverage accounting')
const incompleteProfit = context.rowsAsObjects_('DailyProfit')[0]
assert.equal(incompleteProfit.costCoverageRate, 0)
assert.equal(incompleteProfit.costOfGoodsSold, '', 'unattributed or missing cost never becomes zero COGS')

context.setConfigValue_('FEED_URL', 'https://feed.test/api')
context.setConfigValue_('FEED_SECRET', 'feed-secret')
const trackingToday = context.localDateForInstant_(new Date())
const trackingStart = context.shiftLocalDate_(trackingToday, -1)
const historicalDate = context.shiftLocalDate_(trackingStart, -1)
context.replaceObjectRows_('Entries', [{
  requestKey: 'tracking-entry-001', productId: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1',
  quantity: 100, unitCost: 2, date: trackingStart, createdAt: `${trackingStart}T01:00:00Z`,
}])
fetchImpl = (url) => {
  const dataset = new URL(url).searchParams.get('dataset')
  if (dataset === 'products') return response({ ok: true, schemaVersion: 1, items: [
    { id: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1' },
    { id: 'p2', sku: 'SKU-2', barcode: 'BAR-2', name: 'Product 2' },
  ], nextCursor: null })
  if (dataset === 'sales') return response({ ok: true, schemaVersion: 1, items: [
    { createdAt: `${historicalDate}T12:00:00+07:00`, productId: 'p1', quantity: 40, lineAmount: 400 },
  ], nextCursor: null })
  return response({ ok: true, schemaVersion: 1, items: [], nextCursor: null })
}
context.syncWeekly()
const trackingInventory = context.rowsAsObjects_('Inventory')
assert.equal(trackingInventory.find((row) => row.productId === 'p1').currentStock, 100, 'pre-pilot sales do not reduce first-entry inventory')
assert.equal(trackingInventory.find((row) => row.productId === 'p1').trackingStartDate, trackingStart)
assert.equal(trackingInventory.find((row) => row.productId === 'p2').trackingStartDate, '', 'products without entries remain NOT_TRACKED')
assert.deepEqual(post({ action: 'LIST_INVENTORY', secret: 'provider-secret', storeId: 'pilot-store', alertsOnly: true }).data, [], 'NOT_TRACKED products are absent from the default low-stock list')
assert.deepEqual(
  post({ action: 'LIST_INVENTORY', secret: 'provider-secret', storeId: 'pilot-store', alertsOnly: true, query: 'SKU-2' }).data.map((row) => row.productId),
  ['p2'],
  'search includes NOT_TRACKED products and bypasses the default low-stock filter',
)
const historicalSale = context.rowsAsObjects_('SalesDaily').find((row) => row.productId === 'p1')
assert.equal(historicalSale.costCovered, '', 'pre-pilot sales do not enter cost coverage')
assert.equal(historicalSale.costOfGoodsSold, '', 'pre-pilot sales do not produce COGS')
const historicalProfit = context.rowsAsObjects_('DailyProfit').find((row) => row.date === historicalDate)
assert.equal(historicalProfit.netSales, 400, 'pre-pilot net sales remain visible')
assert.equal(historicalProfit.costCoverageWeight, 0, 'pre-pilot sales do not enter cost coverage weight')
assert.equal(historicalProfit.costOfGoodsSold, '', 'pre-pilot sales do not become zero COGS')
assert.equal(historicalProfit.grossProfit, '', 'pre-pilot sales do not produce fake gross profit')

context.replaceObjectRows_('Entries', [])
context.replaceObjectRows_('SalesDaily', [])
const products = Array.from({ length: 5000 }, (_, index) => ({
  id: `p${String(index).padStart(4, '0')}`,
  sku: `SKU-${index}`,
  barcode: `BAR-${index}`,
  name: `Product ${index}`,
}))
let productPages = 0
let saleAttempts = 0
let sawBearerSecret = false
fetchImpl = (url, options) => {
  sawBearerSecret = sawBearerSecret || options.headers.Authorization === 'Bearer feed-secret'
  const parsed = new URL(url)
  const dataset = parsed.searchParams.get('dataset')
  if (dataset === 'products') {
    productPages += 1
    return productPages === 1
      ? response({ ok: true, schemaVersion: 1, items: products, nextCursor: products.at(-1).id })
      : response({ ok: true, schemaVersion: 1, items: [], nextCursor: null })
  }
  if (dataset === 'sales') {
    saleAttempts += 1
    if (saleAttempts < 3) throw new Error('temporary feed failure')
  }
  return response({ ok: true, schemaVersion: 1, items: [], nextCursor: null })
}
sleepCalls = 0
const sync = context.syncInventoryProfitRange_('2026-10-28', '2026-10-31')
assert.equal(sync.products, 5000)
assert.equal(context.rowsAsObjects_('Inventory').length, 5000, '5,000 SKU feed payload is retained')
assert.equal(productPages, 2, 'full 5,000-row page follows the cursor once')
assert.equal(saleAttempts, 3, 'feed synchronization retries transient failure')
assert.equal(sleepCalls, 2)
assert.equal(sawBearerSecret, true)

const source = fs.readFileSync('apps-script/inventory-profit/Code.gs', 'utf8')
assert.match(source, /shiftLocalDate_\(today, -3\)/, 'hourly sync covers today through D-3')
assert.match(source, /shiftLocalDate_\(today, -34\)/, 'weekly sync covers 35 days')

console.log('inventory profit Apps Script tests passed: tracking start, locked reads, receiving date guard, requestKey, WAC, timezone, coupon allocation, NULL cost, 5,000 SKU and retry')
