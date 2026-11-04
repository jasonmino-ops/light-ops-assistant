import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { verifyCashierCatalog } from '../lib/cashier-offline-db'
import { matchesProductSearch } from '../lib/product-search'

const read = (path: string) => fs.readFileSync(path, 'utf8')
const salePage = read('app/sale/page.tsx')
const productsPage = read('app/products/page.tsx')
const productsApi = read('app/api/products/route.ts')
const cashierStoreApi = read('app/api/cashier/store/route.ts')

assert.match(salePage, /sku: string \| null/)
assert.match(salePage, /matchesProductSearch\(p, q\)/)
assert.match(salePage, /p\.sku \? `\$\{p\.sku\} · \$\{p\.barcode\}` : p\.barcode/)
assert.match(salePage, /allProducts\.find\(\(p\) => p\.sku\?\.toLowerCase\(\) === ql\)/)
assert.match(salePage, /p\.barcode === query \|\| \(p\.auxEnabled && p\.auxBarcode === query\)/,
  'selling-unit barcode resolution must be exact for both main and auxiliary barcodes')
assert.match(salePage, /queryProductByBarcode\(query\)/,
  'the actual scanned selling-unit barcode must reach the server resolver')
assert.match(salePage, /\/api\/products\?barcode=\$\{encodeURIComponent\(barcode\)\}/)
assert.match(productsPage, /matchesProductSearch\(p, q\)/)

assert.match(productsApi, /tenantId: ctx\.tenantId/)
assert.match(productsApi, /status: 'ACTIVE'/)
assert.match(productsApi, /sku: true/)
assert.match(cashierStoreApi, /const productWhere = \{ tenantId: store\.tenantId, status: 'ACTIVE' as const \}/)
assert.match(cashierStoreApi, /sku: true/)

const products = Array.from({ length: 2129 }, (_, index) => ({
  id: `product-${index + 1}`,
  name: `商品 ${index + 1}`,
  barcode: `290731045${String(index + 1).padStart(4, '0')}`,
  sku: index === 2001 ? 'ERA1015' : `OTHER${index + 1}`,
  spec: null,
}))
const matches = products.filter((product) => matchesProductSearch(product, ' ERA1015 '))
assert.equal(matches.length, 1, 'SKU search must find the product after the 2000th row')
assert.deepEqual(matches[0], products[2001], 'SKU search must select the matching product, not a barcode alias')
assert.equal(matchesProductSearch(products[2001], products[2001].name), true, 'name search remains supported')
assert.equal(matchesProductSearch(products[2001], products[2001].barcode), true, 'barcode search remains supported')
assert.equal(matchesProductSearch({ ...products[2001], sku: null }, 'ERA1015'), false, 'SKU search does not treat barcode or name as SKU')

const numericSku = { ...products[2001], sku: '12345', barcode: '9900000000000' }
assert.equal(matchesProductSearch(numericSku, '12345'), true, 'numeric SKU remains searchable independently of barcode')
assert.equal(matchesProductSearch(numericSku, numericSku.barcode), true, 'barcode remains independently searchable')

console.log('product SKU search checks passed: ERA1015-style SKU, name, barcode, tenant/status contracts, and >2000th product')

async function testCashierCatalogProof() {
  const catalog = products.map(({ id }) => ({ id, updatedAt: '2026-01-01T00:00:00.000Z' }))
  const bytes = catalog.map(p => JSON.stringify([p.id, p.updatedAt])).sort().join('\n')
  const proof = {
    totalCount: catalog.length,
    digest: createHash('sha256').update(bytes).digest('hex'),
    verifiedAt: Date.now(),
  }
  assert.equal(await verifyCashierCatalog([...catalog].reverse(), proof), true, 'page and presentation order do not affect integrity')
  assert.equal(await verifyCashierCatalog(catalog.slice(0, 500), proof), false, 'truncated catalog cannot overwrite a complete cache')
  assert.equal(await verifyCashierCatalog([...catalog.slice(0, -1), catalog[0]], proof), false, 'duplicate IDs cannot satisfy a matching count')
  assert.equal(await verifyCashierCatalog([...catalog.slice(0, -1), { ...catalog.at(-1)!, id: 'replaced' }], proof), false, 'same-count replacement invalidates proof')
  assert.equal(await verifyCashierCatalog([...catalog.slice(0, -1), { ...catalog.at(-1)!, updatedAt: '2026-01-02T00:00:00.000Z' }], proof), false, 'a changed product revision invalidates proof')
  assert.equal(await verifyCashierCatalog([], {
    ...proof, totalCount: 0, digest: createHash('sha256').update('').digest('hex'),
  }), true, 'authoritative empty catalog is complete')
}
void testCashierCatalogProof().then(() => console.log('Cashier catalogue integrity cases passed'))
