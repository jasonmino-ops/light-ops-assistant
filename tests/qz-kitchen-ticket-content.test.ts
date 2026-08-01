import assert from 'node:assert/strict'
import { renderKitchenTicketHtml } from '../app/components/KitchenTicket'

const html = renderKitchenTicketHtml({
  storeName: 'CarGarden',
  orderNo: 'SO-QZ-01B-001',
  createdAt: '2026-08-02T06:00:00.000Z',
  items: [
    { name: '招牌汉堡', spec: '双层牛肉 / 少冰', qty: 2 },
    { name: '炸薯条', qty: 3 },
  ],
}, 'zh')

assert.match(html, /CarGarden/)
assert.match(html, /厨房单/)
assert.match(html, /SO-QZ-01B-001/)
assert.match(html, /招牌汉堡/)
assert.match(html, /双层牛肉 \/ 少冰/)
assert.match(html, /数量：2/)
assert.match(html, /炸薯条/)
assert.match(html, /数量：3/)
assert.match(html, /80mm/)
assert.doesNotMatch(html, /单价|小计|折扣|合计|实收|找零|支付方式|KHQR|二维码|金额/)
assert.doesNotMatch(html, /<link\b|@import\b/i, 'QZ kitchen HTML must be self-contained')

console.log('QZ KitchenTicket content tests passed')
