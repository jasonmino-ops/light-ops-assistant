import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getKitchenTicketHtmlForTest } from '../app/components/KitchenTicket'

const html = getKitchenTicketHtmlForTest({
  storeName: 'CarGarden',
  orderNo: 'SO-20260726-001',
  createdAt: '2026-07-26T10:30:00.000Z',
  items: [
    { name: '招牌汉堡', spec: '双层牛肉 / 少冰', qty: 2 },
    { name: '炸薯条', qty: 3 },
  ],
}, 'zh')

assert.match(html, /CarGarden/)
assert.match(html, /厨房单/)
assert.match(html, /SO-20260726-001/)
assert.match(html, /招牌汉堡/)
assert.match(html, /双层牛肉 \/ 少冰/)
assert.match(html, /数量：2/)
assert.match(html, /炸薯条/)
assert.match(html, /数量：3/)
assert.doesNotMatch(html, /单价|小计|折扣|合计|实收|找零|支付方式|KHQR|二维码|金额/)

const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
assert.match(cashier, /printDesktopReceipt\(receipt, lang, \{ onAfterPrint: printKitchenTicketAfterReceipt \}\)/)
assert.match(cashier, /printKitchenTicket\(kitchenTicket, lang, \{ onAfterPrint: finishReceiptPrintFlow \}\)/)
assert.match(cashier, /autoPrintedReceiptKeyRef\.current === receiptKey/, 'existing page-lifecycle duplicate guard must remain')
assert.match(cashier, /items: receipt\.items\.map\(\(\{ name, spec, qty \}\) => \(\{ name, spec, qty \}\)\)/, 'kitchen ticket must use the submitted receipt snapshot')

console.log('kitchen ticket content and sequence tests passed')
