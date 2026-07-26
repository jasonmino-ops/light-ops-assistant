import assert from 'node:assert/strict'
import { getKitchenTicketHtmlForTest } from '../app/components/KitchenTicket'

const base = {
  storeName: 'Food Store',
  orderNo: 'S-20260726-001',
  createdAt: '2026-07-26T08:00:00.000Z',
  items: [
    { name: 'Chicken Rice', spec: 'No sugar / extra chilli', quantity: 2 },
  ],
}

const original = getKitchenTicketHtmlForTest(base, 'zh')
assert.match(original, /厨房单/)
assert.match(original, /Chicken Rice/)
assert.match(original, /No sugar \/ extra chilli/)
assert.match(original, /数量/)
assert.doesNotMatch(original, /单价|小计|折扣|合计|支付方式|找零|KHQR|二维码|金额/)

const reprint = getKitchenTicketHtmlForTest({ ...base, isReprint: true }, 'zh')
assert.match(reprint, /补打厨房单/)

console.log('kitchen-ticket-content.test.ts passed')
