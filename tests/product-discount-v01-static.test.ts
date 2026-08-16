import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(path, 'utf8')

const schema = read('prisma/schema.prisma')
const productApi = read('app/api/products/[id]/route.ts')
const menuApi = read('app/api/public/menu/route.ts')
const orderApi = read('app/api/public/orders/route.ts')
const menuPage = read('app/menu/page.tsx')

assert.match(schema, /discountPrice\s+Decimal\?\s+@db\.Decimal\(12, 2\)/)
assert.match(schema, /discountEnabled\s+Boolean\s+@default\(false\)/)
assert.match(productApi, /折扣价必须大于 0 且低于原售价/)
assert.match(menuApi, /p\.discountEnabled && p\.discountPrice \? p\.discountPrice\.toNumber\(\) : p\.sellPrice\.toNumber\(\)/)
assert.match(orderApi, /select: \{ id: true, name: true, spec: true, sellPrice: true, discountPrice: true, discountEnabled: true \}/)
assert.match(orderApi, /originalPrice, price, quantity: item\.quantity, lineAmount/)
assert.match(orderApi, /const payableAmount = \+Math\.max\(0, saleSubtotal - couponDiscountAmount\)/)
assert.match(menuPage, /textDecoration: 'line-through'/)
assert.match(menuPage, /productDiscountAmount \+ \(couponState\?\.discountAmount \?\? 0\)/)

console.log('product discount V0.1 static checks passed')
