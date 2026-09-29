import assert from 'node:assert/strict'
import fs from 'node:fs'
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
assert.match(salePage, /allProducts\.find\(\(p\) => p\.barcode\.toLowerCase\(\) === ql\)/)
assert.match(salePage, /queryProductByBarcode\(localProduct\.barcode\)/)
assert.match(salePage, /\/api\/products\?barcode=\$\{encodeURIComponent\(barcode\)\}/)
assert.match(productsPage, /matchesProductSearch\(p, q\)/)

assert.match(productsApi, /tenantId: ctx\.tenantId/)
assert.match(productsApi, /status: 'ACTIVE'/)
assert.match(productsApi, /sku: true/)
assert.match(cashierStoreApi, /const productWhere = \{ tenantId: store\.tenantId, status: 'ACTIVE' as const \}/)
assert.match(cashierStoreApi, /sku: true/)

const products = Array.from({ length: 229 }, (_, index) => ({
  id: `product-${index + 1}`,
  name: `商品 ${index + 1}`,
  barcode: `290731045${String(index + 1).padStart(4, '0')}`,
  sku: index === 201 ? 'ERA1015' : `OTHER${index + 1}`,
  spec: null,
}))
const matches = products.filter((product) => matchesProductSearch(product, ' ERA1015 '))
assert.equal(matches.length, 1, 'SKU search must find the product after the 200th row')
assert.deepEqual(matches[0], products[201], 'SKU search must select the matching product, not a barcode alias')
assert.equal(matchesProductSearch(products[201], products[201].name), true, 'name search remains supported')
assert.equal(matchesProductSearch(products[201], products[201].barcode), true, 'barcode search remains supported')
assert.equal(matchesProductSearch({ ...products[201], sku: null }, 'ERA1015'), false, 'SKU search does not treat barcode or name as SKU')

const numericSku = { ...products[201], sku: '12345', barcode: '9900000000000' }
assert.equal(matchesProductSearch(numericSku, '12345'), true, 'numeric SKU remains searchable independently of barcode')
assert.equal(matchesProductSearch(numericSku, numericSku.barcode), true, 'barcode remains independently searchable')

console.log('product SKU search checks passed: ERA1015-style SKU, name, barcode, tenant/status contracts, and >200th product')
