import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getKitchenTicketHtmlForTest } from '../app/components/KitchenTicket'

const ticket = {
  storeName: 'CarGarden',
  orderNo: 'SO-20260726-001',
  createdAt: '2026-07-26T10:30:00.000Z',
  items: [
    { name: '招牌汉堡', spec: '双层牛肉 / 少冰', qty: 2 },
    { name: '炸薯条', qty: 3 },
  ],
}

const html = getKitchenTicketHtmlForTest(ticket, 'zh')

assert.match(html, /CarGarden/)
assert.match(html, /厨房单/)
assert.match(html, /SO-20260726-001/)
assert.match(html, /招牌汉堡/)
assert.match(html, /双层牛肉 \/ 少冰/)
assert.match(html, /数量：2/)
assert.match(html, /炸薯条/)
assert.match(html, /数量：3/)
assert.doesNotMatch(html, /单价|小计|折扣|合计|实收|找零|支付方式|KHQR|二维码|金额/)

const englishHtml = getKitchenTicketHtmlForTest(ticket, 'en')
assert.match(englishHtml, /Kitchen Ticket/)
assert.match(englishHtml, /Order No\./)
assert.match(englishHtml, /Time/)
assert.match(englishHtml, /Qty: 2/)
assert.doesNotMatch(englishHtml, /厨房单|订单号|交易时间|数量|单价|合计|金额/)

const khmerHtml = getKitchenTicketHtmlForTest(ticket, 'km')
assert.match(khmerHtml, /បង្កាន់ដៃផ្ទះបាយ/)
assert.match(khmerHtml, /លេខបញ្ជាទិញ/)
assert.match(khmerHtml, /ពេលវេលា/)
assert.match(khmerHtml, /ចំនួន: 2/)
assert.doesNotMatch(khmerHtml, /厨房单|订单号|交易时间|数量|单价|合计|金额/)

const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
assert.match(cashier, /onAfterPrintWithWindow: printKitchenTicketAfterReceipt/)
assert.match(cashier, /printKitchenTicket\(kitchenTicket, lang, \{\s*printWindow,\s*onAfterPrint: finishReceiptPrintFlow,\s*\}/)
assert.match(cashier, /autoPrintedReceiptKeyRef\.current === receiptKey/, 'existing page-lifecycle duplicate guard must remain')
assert.match(cashier, /items: receipt\.items\.map\(\(\{ name, spec, qty \}\) => \(\{ name, spec, qty \}\)\)/, 'kitchen ticket must use the submitted receipt snapshot')
assert.match(cashier, /const \[isReceiptPrintChainActive, setIsReceiptPrintChainActive\] = useState\(false\)/, 'the sequence must expose an active print-chain state')
assert.match(cashier, /receiptPrintLockedRef\.current = true\s*\n\s*setIsReceiptPrintChainActive\(true\)/, 'manual and automatic starts must synchronously lock then mark the chain active')
assert.match(cashier, /setIsReceiptPrintChainActive\(false\)\s*\n\s*receiptPrintLockedRef\.current = false/, 'normal and failure cleanup must release both locks')
const closeStart = cashier.indexOf('function closeSaleResultOverlay()')
const continueStart = cashier.indexOf('function handleContinueSale()', closeStart)
const printActionStart = cashier.indexOf('function handleSaleResultPrintAction()', continueStart)
assert.ok(closeStart >= 0 && continueStart > closeStart && printActionStart > continueStart)
const closeContract = cashier.slice(closeStart, continueStart)
const continueContract = cashier.slice(continueStart, printActionStart)
for (const [name, contract] of [['background dismissal', closeContract], ['continue sale', continueContract]] as const) {
  assert.match(contract, /isReceiptPrintChainActive \|\| receiptPrintLockedRef\.current/, `${name} must be blocked while the physical print chain is active`)
  assert.match(contract, /v3Admission\?\.status === 'PENDING'/, `${name} must be blocked before durable V3 acceptance`)
  assert.match(contract, /v3Admission\?\.status === 'REJECTED'/, `${name} must preserve a recoverable rejected intent`)
}
assert.match(cashier, /disabled=\{isReceiptPrintChainActive \|\| saleResult\.v3Admission\?\.status === 'PENDING' \|\| saleResult\.v3Admission\?\.status === 'REJECTED'\}/, 'the continue control must remain disabled for active, pending, or rejected print responsibility')
assert.match(cashier, /正在完成打印…/, 'the continue control must visibly report active physical printing')
