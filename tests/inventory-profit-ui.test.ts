import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const products = read('app/products/page.tsx')
const inventory = read('app/inventory/page.tsx')
const salesProfit = read('app/sales-profit/page.tsx')
const inventoryEntry = read('app/components/InventoryEntry.tsx')
const profitEntry = read('app/components/SalesProfitEntry.tsx')

assert.match(products, /import InventoryEntry from '@\/app\/components\/InventoryEntry'/)
assert.match(products, /\{canManageProducts \? <InventoryEntry \/> : null\}/)
assert.equal((products.match(/<InventoryEntry \/>/g) ?? []).length, 1, 'products adds one inventory entry only')
assert.match(inventoryEntry, /href="\/inventory"/)
assert.match(profitEntry, /href="\/sales-profit"/)

assert.match(inventory, /useState\(false\)/, 'all-inventory view is opt-in')
assert.match(inventory, /\[item\.name, item\.barcode, item\.sku \?\? ''\]/, 'search covers name, barcode and SKU')
assert.match(inventory, /minimumStock[\s\S]*useState\('10'\)/, 'minimum stock defaults to 10')
assert.match(inventory, /requestKey,\s*productId,\s*quantity:/, 'receiving sends its stable request key')
assert.match(inventory, /\/api\/inventory-profit\/inventory\/export/, 'inventory exports through the protected route')
assert.match(inventory, /telegramPresenceHeaders\(\)/, 'sensitive inventory actions request Telegram presence')

for (const period of ['TODAY', 'WEEK', 'MONTH']) assert.match(salesProfit, new RegExp(`value: '${period}'`))
for (const label of ['\u51c0\u9500\u552e\u989d', '\u9500\u552e\u6210\u672c', '\u9500\u552e\u6bdb\u5229', '\u9500\u552e\u6bdb\u5229\u7387', '\u6210\u672c\u8986\u76d6\u7387', '\u6570\u636e\u622a\u81f3']) {
  assert.ok(salesProfit.includes(label), `sales profit renders ${label}`)
}
assert.match(salesProfit, /costOfGoodsSold === null \? '\u2014'/, 'missing cost is rendered as unavailable, not zero')
assert.match(salesProfit, /telegramPresenceHeaders\(\)/, 'profit requests Telegram presence')

console.log('inventory profit UI tests passed: owner entries, periods, NULL cost, search, defaults, receiving and export')
