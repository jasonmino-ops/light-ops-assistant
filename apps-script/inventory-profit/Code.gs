var INVENTORY_PROFIT_SHEETS = {
  Config: ['key', 'value'],
  Entries: ['requestKey', 'productId', 'sku', 'barcode', 'name', 'quantity', 'unitCost', 'date', 'createdAt'],
  SalesDaily: ['date', 'productId', 'quantity', 'netSales', 'costOfGoodsSold', 'costCovered', 'updatedAt'],
  Inventory: ['productId', 'sku', 'barcode', 'name', 'currentStock', 'minimumStock', 'averageCost', 'inventoryValue', 'updatedAt'],
  DailyProfit: ['date', 'netSales', 'costOfGoodsSold', 'grossProfit', 'grossMarginRate', 'costCoverageRate', 'costMethod', 'updatedAt'],
  _Log: ['timestamp', 'level', 'event', 'detail']
}

var INVENTORY_PROFIT_COST_METHOD = 'DAILY_PERIODIC_WAC'
var INVENTORY_PROFIT_DEFAULT_MINIMUM = 10
var INVENTORY_PROFIT_PAGE_LIMIT = 5000
var INVENTORY_PROFIT_MAX_RETRIES = 3

function onOpen() {
  initializeInventoryProfitPilot()
}

function initializeInventoryProfitPilot() {
  return withInventoryProfitLock_(function () {
    ensureInventoryProfitSheets_()
    if (configValue_('MINIMUM_STOCK') === '') setConfigValue_('MINIMUM_STOCK', String(INVENTORY_PROFIT_DEFAULT_MINIMUM))
    return true
  })
}

function doPost(event) {
  try {
    ensureInventoryProfitSheets_()
    var body = parsePostBody_(event)
    var providerSecret = configValue_('PROVIDER_SECRET')
    if (!providerSecret || body.secret !== providerSecret) return jsonOutput_({ ok: false, error: 'UNAUTHORIZED' })

    var pilotStoreId = configValue_('PILOT_STORE_ID')
    if (!pilotStoreId || body.storeId !== pilotStoreId) return jsonOutput_({ ok: false, error: 'PILOT_STORE_REQUIRED' })

    if (body.action === 'GET_SALES_PROFIT') return jsonOutput_(salesProfitResponse_(body.period))
    if (body.action === 'LIST_INVENTORY') return jsonOutput_(inventoryResponse_(body))
    if (body.action === 'SET_MINIMUM_STOCK') {
      return jsonOutput_(withInventoryProfitLock_(function () { return setMinimumStockResponse_(body.minimumStock) }))
    }
    if (body.action === 'RECEIVE') {
      return jsonOutput_(withInventoryProfitLock_(function () { return receivingResponse_(body) }))
    }
    return jsonOutput_({ ok: false, error: 'INVALID_ACTION' })
  } catch (error) {
    logInventoryProfit_('ERROR', 'DO_POST', error && error.message ? error.message : String(error))
    return jsonOutput_({ ok: false, error: 'UNAVAILABLE' })
  }
}

function syncHourly() {
  var today = startOfLocalDay_(new Date())
  return syncInventoryProfitRange_(formatLocalDate_(addDays_(today, -3)), formatLocalDate_(today))
}

function syncWeekly() {
  var today = startOfLocalDay_(new Date())
  return syncInventoryProfitRange_(formatLocalDate_(addDays_(today, -34)), formatLocalDate_(today))
}

function syncInventoryProfitRange_(fromDate, toDate) {
  ensureInventoryProfitSheets_()
  var payload = {
    products: fetchAllFeedPages_('products'),
    sales: fetchAllFeedPages_('sales', fromDate, toDate),
    customerOrders: fetchAllFeedPages_('customer-orders', fromDate, toDate),
    refunds: fetchAllFeedPages_('refunds', fromDate, toDate)
  }
  return withInventoryProfitLock_(function () {
    applyFeedPayload_(payload, fromDate, toDate)
    logInventoryProfit_('INFO', 'SYNC', fromDate + '..' + toDate)
    return { from: fromDate, to: toDate, products: payload.products.length }
  })
}

function parsePostBody_(event) {
  if (!event || !event.postData || typeof event.postData.contents !== 'string') throw new Error('INVALID_BODY')
  var parsed = JSON.parse(event.postData.contents)
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_BODY')
  return parsed
}

function salesProfitResponse_(period) {
  if (['TODAY', 'WEEK', 'MONTH'].indexOf(period) === -1) return { ok: false, error: 'INVALID_PERIOD' }
  var asOf = configValue_('LAST_SYNC_AT')
  if (!asOf) return { ok: false, error: 'NOT_SYNCED' }
  var today = startOfLocalDay_(new Date())
  var start = today
  if (period === 'WEEK') {
    var mondayOffset = (today.getDay() + 6) % 7
    start = addDays_(today, -mondayOffset)
  } else if (period === 'MONTH') {
    start = new Date(today.getFullYear(), today.getMonth(), 1)
  }
  var from = formatLocalDate_(start)
  var to = formatLocalDate_(today)
  var rows = rowsAsObjects_('DailyProfit').filter(function (row) { return row.date >= from && row.date <= to })
  var netSales = sum_(rows, 'netSales')
  var weight = 0
  var coveredWeight = 0
  var cogs = 0
  rows.forEach(function (row) {
    var rowWeight = Math.abs(number_(row.netSales))
    var coverage = clamp_(number_(row.costCoverageRate), 0, 1)
    weight += rowWeight
    coveredWeight += rowWeight * coverage
    if (row.costOfGoodsSold !== '') cogs += number_(row.costOfGoodsSold)
  })
  var coverageRate = weight === 0 ? 1 : coveredWeight / weight
  var complete = coverageRate >= 0.999999
  var grossProfit = complete ? netSales - cogs : null
  return {
    ok: true,
    asOf: asOf,
    data: {
      period: period,
      netSales: netSales,
      costOfGoodsSold: complete ? cogs : null,
      grossProfit: grossProfit,
      grossMarginRate: complete && netSales !== 0 ? grossProfit / netSales : null,
      costCoverageRate: coverageRate,
      costMethod: INVENTORY_PROFIT_COST_METHOD
    }
  }
}

function inventoryResponse_(input) {
  var asOf = configValue_('LAST_SYNC_AT')
  if (!asOf) return { ok: false, error: 'NOT_SYNCED' }
  var query = String(input.query || '').trim().toLowerCase()
  var alertsOnly = input.alertsOnly === true
  var data = rowsAsObjects_('Inventory').filter(function (row) {
    if (query) {
      var haystack = [row.name, row.barcode, row.sku].join('\n').toLowerCase()
      if (haystack.indexOf(query) === -1) return false
    }
    if (alertsOnly && number_(row.currentStock) > number_(row.minimumStock)) return false
    return true
  }).slice(0, INVENTORY_PROFIT_PAGE_LIMIT).map(function (row) {
    return {
      productId: String(row.productId),
      sku: row.sku === '' ? null : String(row.sku),
      barcode: String(row.barcode),
      name: String(row.name),
      currentStock: number_(row.currentStock),
      minimumStock: number_(row.minimumStock),
      averageCost: row.averageCost === '' ? null : number_(row.averageCost),
      inventoryValue: row.inventoryValue === '' ? null : number_(row.inventoryValue),
      updatedAt: String(row.updatedAt || asOf)
    }
  })
  return { ok: true, asOf: asOf, data: data }
}

function setMinimumStockResponse_(rawMinimum) {
  var minimum = Number(rawMinimum)
  if (!isFinite(minimum) || minimum < 0 || Math.floor(minimum) !== minimum) return { ok: false, error: 'INVALID_MINIMUM_STOCK' }
  setConfigValue_('MINIMUM_STOCK', String(minimum))
  var now = new Date().toISOString()
  var inventory = rowsAsObjects_('Inventory')
  inventory.forEach(function (row) { row.minimumStock = minimum; row.updatedAt = now })
  replaceObjectRows_('Inventory', inventory)
  setConfigValue_('LAST_SYNC_AT', now)
  return { ok: true, asOf: now, data: { minimumStock: minimum } }
}

function receivingResponse_(input) {
  var requestKey = String(input.requestKey || '').trim()
  var productId = String(input.productId || '').trim()
  var quantity = Number(input.quantity)
  var unitCost = Number(input.unitCost)
  var date = String(input.date || '').trim()
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(requestKey)) return { ok: false, error: 'INVALID_REQUEST_KEY' }
  if (!productId || !isFinite(quantity) || quantity <= 0 || !isFinite(unitCost) || unitCost < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'INVALID_RECEIVING' }
  }
  var entries = rowsAsObjects_('Entries')
  var duplicate = entries.some(function (entry) { return String(entry.requestKey) === requestKey })
  var now = new Date().toISOString()
  if (duplicate) return { ok: true, asOf: configValue_('LAST_SYNC_AT') || now, data: { requestKey: requestKey, duplicate: true, recordedAt: now } }

  var product = rowsAsObjects_('Inventory').filter(function (row) { return String(row.productId) === productId })[0]
  if (!product) return { ok: false, error: 'PRODUCT_NOT_FOUND' }
  appendObjectRow_('Entries', {
    requestKey: requestKey,
    productId: productId,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    quantity: quantity,
    unitCost: unitCost,
    date: date,
    createdAt: now
  })
  recalculateInventoryProfit_()
  now = configValue_('LAST_SYNC_AT') || now
  return { ok: true, asOf: now, data: { requestKey: requestKey, duplicate: false, recordedAt: now } }
}

function applyFeedPayload_(payload, fromDate, toDate) {
  var productById = {}
  payload.products.forEach(function (product) {
    productById[String(product.id)] = {
      productId: String(product.id),
      sku: product.sku || '',
      barcode: product.barcode || '',
      name: product.name || ''
    }
  })
  var current = rowsAsObjects_('SalesDaily').filter(function (row) { return row.date < fromDate || row.date > toDate })
  var aggregates = {}

  function addLine(dateValue, productId, quantity, amount) {
    var date = String(dateValue || '').slice(0, 10)
    var id = String(productId || '')
    if (!date || !id) return
    var key = date + '|' + id
    if (!aggregates[key]) aggregates[key] = { date: date, productId: id, quantity: 0, netSales: 0, costOfGoodsSold: '', costCovered: '', updatedAt: new Date().toISOString() }
    aggregates[key].quantity += number_(quantity)
    aggregates[key].netSales += number_(amount)
  }

  payload.sales.forEach(function (row) { addLine(row.createdAt, row.productId, row.quantity, row.lineAmount) })
  payload.customerOrders.forEach(function (order) {
    ;(order.items || []).forEach(function (item) { addLine(order.paidAt || order.updatedAt, item.productId, item.quantity, item.lineAmount) })
  })
  payload.refunds.forEach(function (row) { addLine(row.createdAt, row.productId, -Math.abs(number_(row.quantity)), -Math.abs(number_(row.refundAmount))) })

  Object.keys(aggregates).sort().forEach(function (key) { current.push(aggregates[key]) })
  replaceObjectRows_('SalesDaily', current)
  recalculateInventoryProfit_(productById)
}

function recalculateInventoryProfit_(freshProducts) {
  var now = new Date().toISOString()
  var previousInventory = rowsAsObjects_('Inventory')
  var products = freshProducts || {}
  if (!freshProducts) {
    previousInventory.forEach(function (row) {
      var id = String(row.productId)
      if (!products[id]) products[id] = { productId: id, sku: row.sku, barcode: row.barcode, name: row.name }
    })
  }
  var entries = rowsAsObjects_('Entries')
  entries.forEach(function (entry) {
    var id = String(entry.productId)
    if (!products[id]) products[id] = { productId: id, sku: entry.sku, barcode: entry.barcode, name: entry.name }
  })
  var sales = rowsAsObjects_('SalesDaily')
  var events = []
  entries.forEach(function (entry, index) { events.push({ date: String(entry.date), type: 0, index: index, row: entry }) })
  sales.forEach(function (sale, index) {
    var id = String(sale.productId)
    if (!products[id]) products[id] = { productId: id, sku: '', barcode: '', name: '' }
    events.push({ date: String(sale.date), type: 1, index: index, row: sale })
  })
  events.sort(function (a, b) { return a.date.localeCompare(b.date) || a.type - b.type || a.index - b.index })

  var states = {}
  function stateFor(id) {
    if (!states[id]) states[id] = { quantity: 0, averageCost: null, inventoryValue: null }
    return states[id]
  }

  events.forEach(function (event) {
    var row = event.row
    var id = String(row.productId)
    var state = stateFor(id)
    if (event.type === 0) {
      var receivedQuantity = number_(row.quantity)
      var receivedValue = receivedQuantity * number_(row.unitCost)
      if (state.quantity > 0 && state.averageCost !== null && state.inventoryValue !== null) {
        state.quantity += receivedQuantity
        state.inventoryValue += receivedValue
        state.averageCost = state.inventoryValue / state.quantity
      } else if (state.quantity <= 0) {
        state.quantity += receivedQuantity
        state.averageCost = number_(row.unitCost)
        state.inventoryValue = state.quantity * state.averageCost
      } else {
        state.quantity += receivedQuantity
        state.averageCost = null
        state.inventoryValue = null
      }
      return
    }

    var soldQuantity = number_(row.quantity)
    var covered = state.averageCost !== null
    row.costCovered = covered ? 'TRUE' : 'FALSE'
    row.costOfGoodsSold = covered ? soldQuantity * state.averageCost : ''
    state.quantity -= soldQuantity
    state.inventoryValue = covered ? state.quantity * state.averageCost : null
  })

  sales.forEach(function (row) { row.updatedAt = now })
  replaceObjectRows_('SalesDaily', sales)

  var minimum = Number(configValue_('MINIMUM_STOCK'))
  if (!isFinite(minimum) || minimum < 0) minimum = INVENTORY_PROFIT_DEFAULT_MINIMUM
  var inventory = Object.keys(products).sort().map(function (id) {
    var product = products[id]
    var state = stateFor(id)
    return {
      productId: id,
      sku: product.sku || '',
      barcode: product.barcode || '',
      name: product.name || '',
      currentStock: state.quantity,
      minimumStock: minimum,
      averageCost: state.averageCost === null ? '' : state.averageCost,
      inventoryValue: state.inventoryValue === null ? '' : state.inventoryValue,
      updatedAt: now
    }
  })
  replaceObjectRows_('Inventory', inventory)

  var daily = {}
  sales.forEach(function (row) {
    var date = String(row.date)
    if (!daily[date]) daily[date] = { date: date, netSales: 0, cogs: 0, weight: 0, coveredWeight: 0 }
    var item = daily[date]
    var amount = number_(row.netSales)
    var weight = Math.abs(amount)
    item.netSales += amount
    item.weight += weight
    if (String(row.costCovered) === 'TRUE') {
      item.coveredWeight += weight
      item.cogs += number_(row.costOfGoodsSold)
    }
  })
  var profitRows = Object.keys(daily).sort().map(function (date) {
    var item = daily[date]
    var coverage = item.weight === 0 ? 1 : item.coveredWeight / item.weight
    var complete = coverage >= 0.999999
    var gross = complete ? item.netSales - item.cogs : ''
    return {
      date: date,
      netSales: item.netSales,
      costOfGoodsSold: complete ? item.cogs : '',
      grossProfit: gross,
      grossMarginRate: complete && item.netSales !== 0 ? gross / item.netSales : '',
      costCoverageRate: coverage,
      costMethod: INVENTORY_PROFIT_COST_METHOD,
      updatedAt: now
    }
  })
  replaceObjectRows_('DailyProfit', profitRows)
  setConfigValue_('LAST_SYNC_AT', now)
}

function fetchAllFeedPages_(dataset, fromDate, toDate) {
  var baseUrl = configValue_('FEED_URL')
  var feedSecret = configValue_('FEED_SECRET')
  if (!baseUrl || !feedSecret) throw new Error('FEED_NOT_CONFIGURED')
  var all = []
  var cursor = ''
  var pages = 0
  do {
    var params = ['dataset=' + encodeURIComponent(dataset), 'limit=' + INVENTORY_PROFIT_PAGE_LIMIT]
    if (fromDate) params.push('from=' + encodeURIComponent(fromDate))
    if (toDate) params.push('to=' + encodeURIComponent(toDate))
    if (cursor) params.push('cursor=' + encodeURIComponent(cursor))
    var separator = baseUrl.indexOf('?') === -1 ? '?' : '&'
    var response = fetchJsonWithRetry_(baseUrl + separator + params.join('&'), {
      method: 'get',
      headers: { Authorization: 'Bearer ' + feedSecret },
      muteHttpExceptions: true
    })
    if (!response.ok || response.schemaVersion !== 1 || !Array.isArray(response.items)) throw new Error('INVALID_FEED_RESPONSE')
    all = all.concat(response.items)
    cursor = response.nextCursor || ''
    pages += 1
    if (pages > 100) throw new Error('FEED_PAGE_LIMIT')
  } while (cursor)
  return all
}

function fetchJsonWithRetry_(url, options) {
  var lastError = null
  for (var attempt = 1; attempt <= INVENTORY_PROFIT_MAX_RETRIES; attempt += 1) {
    try {
      var response = UrlFetchApp.fetch(url, options)
      var code = response.getResponseCode()
      if (code >= 200 && code < 300) return JSON.parse(response.getContentText())
      lastError = new Error('FEED_HTTP_' + code)
    } catch (error) {
      lastError = error
    }
    if (attempt < INVENTORY_PROFIT_MAX_RETRIES) Utilities.sleep(attempt * 250)
  }
  throw lastError || new Error('FEED_UNAVAILABLE')
}

function ensureInventoryProfitSheets_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  Object.keys(INVENTORY_PROFIT_SHEETS).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name)
    var headers = INVENTORY_PROFIT_SHEETS[name]
    var existing = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : []
    if (existing.join('\n') !== headers.join('\n')) sheet.getRange(1, 1, 1, headers.length).setValues([headers])
  })
}

function rowsAsObjects_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName)
  if (!sheet || sheet.getLastRow() < 2) return []
  var headers = INVENTORY_PROFIT_SHEETS[sheetName]
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
  return values.filter(function (row) { return row.some(function (value) { return value !== '' }) }).map(function (row) {
    var object = {}
    headers.forEach(function (header, index) { object[header] = row[index] })
    return object
  })
}

function replaceObjectRows_(sheetName, objects) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName)
  var headers = INVENTORY_PROFIT_SHEETS[sheetName]
  var oldRows = Math.max(0, sheet.getLastRow() - 1)
  if (oldRows > 0) sheet.getRange(2, 1, oldRows, headers.length).clearContent()
  if (!objects.length) return
  var values = objects.map(function (object) { return headers.map(function (header) { return object[header] === undefined || object[header] === null ? '' : object[header] }) })
  sheet.getRange(2, 1, values.length, headers.length).setValues(values)
}

function appendObjectRow_(sheetName, object) {
  var headers = INVENTORY_PROFIT_SHEETS[sheetName]
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName).appendRow(headers.map(function (header) {
    return object[header] === undefined || object[header] === null ? '' : object[header]
  }))
}

function configValue_(key) {
  var row = rowsAsObjects_('Config').filter(function (item) { return String(item.key) === key })[0]
  return row ? String(row.value || '') : ''
}

function setConfigValue_(key, value) {
  var rows = rowsAsObjects_('Config')
  var found = false
  rows.forEach(function (row) {
    if (String(row.key) === key) { row.value = String(value); found = true }
  })
  if (!found) rows.push({ key: key, value: String(value) })
  replaceObjectRows_('Config', rows)
}

function withInventoryProfitLock_(callback) {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) throw new Error('LOCK_TIMEOUT')
  try { return callback() } finally { lock.releaseLock() }
}

function logInventoryProfit_(level, event, detail) {
  try {
    ensureInventoryProfitSheets_()
    appendObjectRow_('_Log', { timestamp: new Date().toISOString(), level: level, event: event, detail: String(detail || '').slice(0, 1000) })
  } catch (_ignored) {}
}

function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON)
}

function number_(value) {
  var number = Number(value)
  return isFinite(number) ? number : 0
}

function sum_(rows, key) {
  return rows.reduce(function (total, row) { return total + number_(row[key]) }, 0)
}

function clamp_(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function startOfLocalDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays_(date, days) {
  var result = new Date(date.getTime())
  result.setDate(result.getDate() + days)
  return result
}

function formatLocalDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
}
