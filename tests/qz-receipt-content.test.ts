import assert from 'node:assert/strict'
import { renderDesktopReceiptHtml, type DesktopReceiptData } from '../app/components/DesktopReceipt'

const receipt: DesktopReceiptData = {
  storeName: 'CarGarden',
  orderNo: 'SO-QZ-01B-001',
  createdAt: '2026-08-02T06:00:00.000Z',
  cashierName: 'Desktop POS',
  paymentMethod: 'CASH',
  totalAmount: 13.5,
  currencyCode: 'USD',
  items: [
    { name: 'Item A', spec: 'Large', qty: 2, price: 1.25, lineAmount: 2.5 },
    { name: 'Item B', spec: 'Blue', qty: 1, price: 11, lineAmount: 11 },
  ],
}

const html = renderDesktopReceiptHtml(receipt, 'zh')
assert.match(html, /销售小票/)
assert.match(html, /SO-QZ-01B-001/)
assert.match(html, /CarGarden/)
assert.match(html, /Item A \(Large\)/)
assert.match(html, /Item B \(Blue\)/)
assert.match(html, /2 × \$1\.25/)
assert.match(html, /\$13\.50/)
assert.match(html, /80mm/)
assert.match(html, /height:\s*auto\s*!important/)
assert.match(html, /min-height:\s*0\s*!important/)
assert.match(html, /overflow:\s*visible\s*!important/)
assert.doesNotMatch(html, /<link\b|@import\b/i, 'QZ receipt HTML must be self-contained')
assert.equal(renderDesktopReceiptHtml(receipt, 'zh'), html, 'receipt rendering must be deterministic')

console.log('QZ DesktopReceipt content tests passed')
