import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const products = read('app/products/page.tsx')
const inventory = read('app/inventory/page.tsx')
const salesProfit = read('app/sales-profit/page.tsx')
const inventoryEntry = read('app/components/InventoryEntry.tsx')
const profitEntry = read('app/components/SalesProfitEntry.tsx')
const receivingRoute = read('app/api/inventory-profit/receivings/route.ts')
const salePage = read('app/sale/page.tsx')
const saleRoute = read('app/api/sales/route.ts')
const cashierRoute = read('app/api/cashier/sales/route.ts')

assert.match(products, /import InventoryEntry from '@\/app\/components\/InventoryEntry'/)
assert.match(products, /const canViewInventory = realRole === 'OWNER'/)
assert.doesNotMatch(products, /<InventoryEntry\s*\/>/, 'no standalone inventory entry')
const quickEntryGrid = products.slice(products.indexOf('<div style={s.quickEntryGrid}>'))
assert.match(quickEntryGrid, /products\.aiMenuImportAction[\s\S]*?<InventoryEntry style=\{s\.secondaryEntryBtn\} \/>\}/)
assert.match(products, /quickEntryGrid: \{[\s\S]*?gridTemplateColumns: '1fr 1fr'/)
assert.match(inventoryEntry, /库存与入库/)
assert.match(inventoryEntry, /href="\/inventory"/)
assert.doesNotMatch(inventoryEntry, /\/native-inventory|https?:\/\//)
assert.match(profitEntry, /href="\/sales-profit"/)

assert.match(inventory, /useState\(false\)/, 'all-inventory view is opt-in')
assert.match(inventory, /\[item\.name, item\.barcode, item\.sku \?\? ''\]/, 'search covers name, barcode and SKU')
assert.match(inventory, /apiFetch\('\/api\/inventory-profit\/inventory\?all=1'/, 'inventory loads the searchable all-product set')
assert.match(inventory, /apiFetch\('\/api\/inventory-profit\/inventory'/, 'inventory separately loads the tracked default-alert set')
assert.match(
  inventory,
  /if \(!normalized && !showAll && !defaultAlertProductIds\.has\(item\.productId\)\) return false/,
  'the default alert filter applies only when search is empty',
)
assert.match(inventory, /minimumStock[\s\S]*useState\('10'\)/, 'minimum stock defaults to 10')
assert.match(inventory, /requestKey,\s*productId,\s*quantity:/, 'receiving sends its stable request key')
assert.match(
  inventory,
  /body: JSON\.stringify\(\{\s*requestKey,\s*productId,\s*quantity: Number\(quantity\),\s*unitCost: Number\(unitCost\),\s*date,\s*\}\)/,
  'all receiving pickers share the existing request body',
)
assert.match(
  inventory,
  /if \(event\.key !== 'Enter'\) return\s+event\.preventDefault\(\)\s+if \(!event\.nativeEvent\.isComposing && !event\.repeat\) void lookupReceivingProduct\(\)/,
  'Enter on the manual code field only performs a lookup',
)
assert.match(inventory, /<button type="button"[^\n]*lookupReceivingProduct\(\)[^\n]*>查找<\/button>/, 'lookup button cannot submit the receiving form')
assert.match(inventory, /matches\.length === 1 && !resultsMayBeTruncated/, 'auto-selection requires a confirmed unique result')
assert.match(
  inventory,
  /if \(body\?\.ok !== true \|\| typeof body\.data\?\.duplicate !== 'boolean'\) \{\s*throw new Error[\s\S]*?\}\s*setMessage[\s\S]*?setRequestKey\(newRequestKey\(\)\)/,
  'the request key changes only after a confirmed receipt response',
)
assert.equal((inventory.match(/setRequestKey\(newRequestKey\(\)\)/g) ?? []).length, 1, 'failure never rotates the request key')
assert.match(inventory, /\/api\/inventory-profit\/inventory\/export/, 'inventory exports through the protected route')
assert.match(inventory, /telegramPresenceHeaders\(\)/, 'sensitive inventory actions request Telegram presence')
assert.match(inventory, /if \(realRole !== 'OWNER'\)/, 'inventory follows real OWNER identity even in staff work mode')
assert.match(receivingRoute, /RECEIVING_TIME_ZONE = 'Asia\/Phnom_Penh'/, 'receiving window uses the Pilot business timezone')
assert.match(receivingRoute, /value >= shiftDate\(today, -3\) && value <= today/, 'server accepts only today through D-3')

for (const period of ['TODAY', 'WEEK', 'MONTH']) assert.match(salesProfit, new RegExp(`value: '${period}'`))
for (const label of ['\u51c0\u9500\u552e\u989d', '\u9500\u552e\u6210\u672c', '\u9500\u552e\u6bdb\u5229', '\u9500\u552e\u6bdb\u5229\u7387', '\u6210\u672c\u8986\u76d6\u7387', '\u6570\u636e\u622a\u81f3']) {
  assert.ok(salesProfit.includes(label), `sales profit renders ${label}`)
}
assert.match(salesProfit, /costOfGoodsSold === null \? '\u2014'/, 'missing cost is rendered as unavailable, not zero')
assert.match(salesProfit, /telegramPresenceHeaders\(\)/, 'profit requests Telegram presence')
assert.match(salesProfit, /if \(realRole !== 'OWNER'\)/, 'profit follows the same real OWNER identity as its dashboard entry')

for (const [name, source] of [['sale page', salePage], ['sale route', saleRoute], ['cashier sale route', cashierRoute]]) {
  assert.doesNotMatch(source, /inventory-profit|InventoryProfitProvider|ExternalGoogleProvider/, `${name} does not depend on the external pilot`)
}

console.log('inventory profit UI tests passed: owner entries, periods, NULL cost, search, defaults, receiving, export and sale isolation')
