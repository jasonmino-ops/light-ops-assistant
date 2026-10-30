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
let sleepCalls = 0
let fetchImpl = () => { throw new Error('fetch not configured') }
const context = vm.createContext({
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => { lockAttempts += 1; return true },
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
    formatDate: (date) => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
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
context.setConfigValue_('PROVIDER_SECRET', 'provider-secret')
context.setConfigValue_('PILOT_STORE_ID', 'pilot-store')

assert.deepEqual(post({ action: 'LIST_INVENTORY', secret: 'wrong', storeId: 'pilot-store' }), { ok: false, error: 'UNAUTHORIZED' })
assert.deepEqual(post({ action: 'LIST_INVENTORY', secret: 'provider-secret', storeId: 'other-store' }), { ok: false, error: 'PILOT_STORE_REQUIRED' })

context.replaceObjectRows_('Inventory', [{
  productId: 'p1', sku: 'SKU-1', barcode: 'BAR-1', name: 'Product 1', currentStock: 0,
  minimumStock: 10, averageCost: '', inventoryValue: '', updatedAt: new Date().toISOString(),
}])
context.setConfigValue_('LAST_SYNC_AT', new Date().toISOString())
const receiveBody = {
  action: 'RECEIVE', secret: 'provider-secret', storeId: 'pilot-store', requestKey: 'receive:test:0001',
  productId: 'p1', quantity: 10, unitCost: 2, date: '2026-10-30',
}
const firstReceiving = post(receiveBody)
const duplicateReceiving = post(receiveBody)
assert.equal(firstReceiving.ok, true)
assert.equal(firstReceiving.data.duplicate, false)
assert.equal(duplicateReceiving.data.duplicate, true)
assert.equal(context.rowsAsObjects_('Entries').length, 1, 'requestKey prevents duplicate entry rows')
assert.ok(lockAttempts >= 3 && lockAttempts === lockReleases, 'mutations use and release LockService')

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

context.setConfigValue_('FEED_URL', 'https://feed.test/api')
context.setConfigValue_('FEED_SECRET', 'feed-secret')
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
assert.match(source, /addDays_\(today, -3\)/, 'hourly sync covers today through D-3')
assert.match(source, /addDays_\(today, -34\)/, 'weekly sync covers 35 days')

console.log('inventory profit Apps Script tests passed: doPost, secret, store, LockService, requestKey, WAC, 5,000 SKU and retry')
