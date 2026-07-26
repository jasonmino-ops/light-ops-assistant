import assert from 'node:assert/strict'
import { renderDesktopReceiptHtml, type DesktopReceiptData } from '../app/components/DesktopReceipt'

const receipt: DesktopReceiptData = {
  storeName: 'Mino Pet Shop',
  orderNo: 'SO-TEST-QZ-001',
  createdAt: '2026-07-26T06:00:00.000Z',
  cashierName: 'Desktop POS',
  paymentMethod: 'CASH',
  totalAmount: 12,
  currencyCode: 'USD',
  items: [{ name: 'Item A', qty: 1, price: 12, lineAmount: 12 }],
}

function testRenderedHtmlCarriesReceiptContent() {
  const html = renderDesktopReceiptHtml(receipt, 'zh')
  assert.match(html, /销售小票/, 'the QZ path must render the same receipt title as the browser print path')
  assert.match(html, /SO-TEST-QZ-001/, 'the QZ path must include the order number')
  assert.match(html, /Item A/, 'the QZ path must include line items')
  assert.match(html, /80mm/, 'the QZ path must keep the 80mm receipt layout')
}

function testRenderedHtmlIsPureAndDeterministic() {
  const first = renderDesktopReceiptHtml(receipt, 'zh')
  const second = renderDesktopReceiptHtml(receipt, 'zh')
  assert.equal(first, second, 'rendering the same receipt data twice must be deterministic')
}

function run() {
  testRenderedHtmlCarriesReceiptContent()
  testRenderedHtmlIsPureAndDeterministic()
  console.log('qz receipt content tests passed')
}

run()
