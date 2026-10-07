import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const read = (path: string) => fs.readFileSync(path, 'utf8')

const schema = read('prisma/schema.prisma')
const productApi = read('app/api/products/[id]/route.ts')
const menuApi = read('app/api/public/menu/route.ts')
const menuCatalog = read('lib/public-menu-data.ts')
const orderApi = read('app/api/public/orders/route.ts')
const menuPage = read('app/menu/page.tsx')

assert.match(schema, /discountPrice\s+Decimal\?\s+@db\.Decimal\(12, 2\)/)
assert.match(schema, /discountEnabled\s+Boolean\s+@default\(false\)/)
assert.match(productApi, /折扣价必须大于 0 且低于原售价/)
assert.match(menuApi, /await loadPublicMenuCatalog\(code\)/)
assert.match(menuCatalog, /product\.discountEnabled && product\.discountPrice \? product\.discountPrice\.toNumber\(\) : product\.sellPrice\.toNumber\(\)/)
// Require the actual query's pricing fields, not an exact object spelling that
// prohibits unrelated approved fields (such as printKitchenTicket).
const orderSource = ts.createSourceFile('public-orders.ts', orderApi, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const productQueries: ts.CallExpression[] = []
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'findMany'
    && ts.isPropertyAccessExpression(node.expression.expression)
    && node.expression.expression.name.text === 'product') productQueries.push(node)
  ts.forEachChild(node, visit)
}
visit(orderSource)
assert.equal(productQueries.length, 1, 'expected one real product.findMany query')
const query = productQueries[0].arguments[0]
assert.ok(query && ts.isObjectLiteralExpression(query), 'product query must have explicit options')
const selects = query.properties.filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p)
  && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'select')
assert.equal(selects.length, 1, 'product query must have one explicit select')
const selection = selects[0].initializer
assert.ok(ts.isObjectLiteralExpression(selection), 'pricing select must be inspectable')
assert.ok(!query.properties.some(ts.isSpreadAssignment) && !selection.properties.some(ts.isSpreadAssignment),
  'spreads must not silently override protected select fields')
for (const field of ['id', 'name', 'spec', 'sellPrice', 'discountPrice', 'discountEnabled']) {
  const properties: ts.PropertyAssignment[] = selection.properties.filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p)
    && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === field)
  assert.equal(properties.length, 1, `product select must include ${field} exactly once`)
  assert.equal(properties[0].initializer.kind, ts.SyntaxKind.TrueKeyword, `product select must enable ${field}`)
}
assert.match(orderApi, /originalPrice, price, quantity: item\.quantity, lineAmount/)
assert.match(orderApi, /const payableAmount = \+Math\.max\(0, saleSubtotal - couponDiscountAmount\)/)
assert.match(menuPage, /textDecoration: 'line-through'/)
assert.match(menuPage, /productDiscountAmount \+ \(couponState\?\.discountAmount \?\? 0\)/)

console.log('product discount V0.1 static checks passed')
