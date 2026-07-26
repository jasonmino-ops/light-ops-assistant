import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderDesktopReceiptHtml, type DesktopReceiptData } from '../app/components/DesktopReceipt'

const receipt: DesktopReceiptData = {
  storeName: 'Mino Pet Shop',
  orderNo: 'SO-TEST-QZ-001',
  createdAt: '2026-07-26T06:00:00.000Z',
  cashierName: 'Desktop POS',
  paymentMethod: 'CASH',
  totalAmount: 13.5,
  currencyCode: 'USD',
  items: [
    { name: 'Item A', spec: 'Large', qty: 2, price: 1.25, lineAmount: 2.5 },
    { name: 'Item B', spec: 'Blue', qty: 1, price: 11, lineAmount: 11 },
  ],
}

function testRenderedHtmlCarriesReceiptContent() {
  const html = renderDesktopReceiptHtml(receipt, 'zh')
  assert.match(html, /销售小票/, 'the QZ path must render the same receipt title as the browser print path')
  assert.match(html, /SO-TEST-QZ-001/, 'the QZ path must include the order number')
  assert.match(html, /Mino Pet Shop/, 'the QZ path must include the store name')
  assert.match(html, /Item A \(Large\)/, 'the QZ path must include the first item and spec')
  assert.match(html, /Item B \(Blue\)/, 'the QZ path must include the second item and spec')
  assert.match(html, /2 × \$1\.25/, 'the QZ path must include the first item quantity and unit price')
  assert.match(html, /\$2\.50/, 'the QZ path must include the first item amount')
  assert.match(html, /\$11\.00/, 'the QZ path must include the second item amount')
  assert.match(html, /现金/, 'the QZ path must include the payment method')
  assert.match(html, /\$13\.50/, 'the QZ path must include the receipt total')
  assert.match(html, /80mm/, 'the QZ path must keep the 80mm receipt layout')
  assert.equal((html.match(/<div class="item">/g) ?? []).length, 2, 'all receipt lines must be rendered')
}

function testRenderedHtmlIsPureAndDeterministic() {
  const first = renderDesktopReceiptHtml(receipt, 'zh')
  const second = renderDesktopReceiptHtml(receipt, 'zh')
  assert.equal(first, second, 'rendering the same receipt data twice must be deterministic')
}

function testRenderedHtmlIsSelfContainedAndPrintable() {
  const html = renderDesktopReceiptHtml(receipt, 'zh')
  assert.match(html, /^<!doctype html>/i)
  assert.match(html, /<html[\s>]/i)
  assert.match(html, /<head>[\s\S]*<style>[\s\S]*<\/style>[\s\S]*<\/head>/i)
  assert.match(html, /<body>[\s\S]*<\/body>[\s\S]*<\/html>\s*$/i)
  assert.doesNotMatch(html, /<link\b|@import\b/i, 'QZ HTML must not depend on external CSS')
  assert.doesNotMatch(html, /html, body\s*\{[^}]*overflow:\s*hidden/i, 'the printable document must not crop the receipt body')
  assert.doesNotMatch(html, /\.receipt\s*\{[^}]*\bheight\s*:/i, 'the receipt body must not have a fixed height')
}

function testWindowPrintAndQzUseTheSameRenderer() {
  const source = readFileSync(new URL('../app/components/DesktopReceipt.tsx', import.meta.url), 'utf8')
  assert.match(
    source,
    /win\.document\.write\(renderDesktopReceiptHtml\(data, lang\)\)/,
    'browser and QZ printing must share the same receipt renderer and snapshot data',
  )
}

function run() {
  testRenderedHtmlCarriesReceiptContent()
  testRenderedHtmlIsPureAndDeterministic()
  testRenderedHtmlIsSelfContainedAndPrintable()
  testWindowPrintAndQzUseTheSameRenderer()
  console.log('qz receipt content tests passed')
}

run()
