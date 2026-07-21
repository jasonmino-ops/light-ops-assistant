import assert from 'node:assert/strict'
import {
  CUSTOMER_DISPLAY_CHECKOUT_TIMEOUT_MS,
  CUSTOMER_DISPLAY_COMPLETION_LINGER_MS,
  CUSTOMER_DISPLAY_DRAFT_TIMEOUT_MS,
  customerDisplayEntryPath,
  deriveCustomerDisplayOrderPanelView,
  deriveCustomerDisplayPanelState,
} from '../lib/customer-display-panel-state'

const now = Date.parse('2026-07-21T09:00:00.000Z')
const base = {
  status: 'DRAFT',
  displayStatus: 'DRAFT',
  paymentMethod: null,
  items: [{ productId: 'p1' }],
  itemCount: 1,
  totalAmount: 3.5,
  completedAt: null,
  updatedAt: new Date(now).toISOString(),
} as const

assert.equal(deriveCustomerDisplayPanelState(base, now), 'ORDER', '普通订单应保留商品清单')
assert.equal(deriveCustomerDisplayPanelState({ ...base, paymentMethod: 'KHQR' }, now), 'KHQR', 'KHQR 应仅强化支付区')
assert.equal(deriveCustomerDisplayPanelState({ ...base, paymentMethod: 'CASH' }, now), 'CASH', '现金应恢复普通支付比例')
assert.equal(deriveCustomerDisplayPanelState({ ...base, paymentMethod: 'KHQR', items: [], itemCount: 0, totalAmount: 0 }, now), 'IDLE', '空购物车不得保留上一单付款状态')
assert.equal(deriveCustomerDisplayOrderPanelView('IDLE', base), 'EMPTY', 'IDLE 即使仍携带旧 session 也必须渲染空态')
assert.equal(deriveCustomerDisplayOrderPanelView('ORDER', base), 'CART', 'ORDER 应渲染购物清单')
assert.equal(deriveCustomerDisplayOrderPanelView('CASH', { ...base, paymentMethod: 'CASH' }), 'CART', 'CASH 应渲染购物清单')
assert.equal(deriveCustomerDisplayOrderPanelView('KHQR', { ...base, paymentMethod: 'KHQR' }), 'CART', 'KHQR 应渲染购物清单')

const completedAt = new Date(now - CUSTOMER_DISPLAY_COMPLETION_LINGER_MS + 1).toISOString()
assert.equal(deriveCustomerDisplayPanelState({ ...base, status: 'COMPLETED', completedAt }, now), 'COMPLETED', '完成态应促活约五秒')
assert.equal(deriveCustomerDisplayPanelState({ ...base, status: 'COMPLETED', completedAt }, now + 2), 'IDLE', '完成促活到期后应恢复普通态')
assert.equal(deriveCustomerDisplayOrderPanelView('COMPLETED', { ...base, status: 'COMPLETED', completedAt }), 'COMPLETED', '完成促活窗口内应显示完成面板和本单金额')
assert.equal(deriveCustomerDisplayOrderPanelView('IDLE', { ...base, status: 'COMPLETED', completedAt }), 'EMPTY', '完成促活到期后不得显示上一单金额或商品')
assert.equal(deriveCustomerDisplayPanelState({ ...base, status: 'DRAFT', completedAt: null }, now), 'ORDER', '新订单必须立即打断完成促活')
assert.equal(deriveCustomerDisplayOrderPanelView('ORDER', { ...base, status: 'DRAFT', completedAt: null }), 'CART', '新订单应立即显示新购物清单')

assert.equal(deriveCustomerDisplayPanelState({ ...base, status: 'CANCELLED', completedAt }, now), 'CANCELLED', '取消仅短暂提示')
assert.equal(deriveCustomerDisplayPanelState({ ...base, status: 'CANCELLED', completedAt }, now + 2), 'IDLE', '取消提示到期后不应促活')
assert.equal(deriveCustomerDisplayOrderPanelView('CANCELLED', { ...base, status: 'CANCELLED', completedAt }), 'CANCELLED', '取消提示窗口内应显示取消提示')
assert.equal(deriveCustomerDisplayOrderPanelView('IDLE', { ...base, status: 'CANCELLED', completedAt }), 'EMPTY', '取消提示到期后不得显示上一单商品')
assert.equal(
  deriveCustomerDisplayPanelState({ ...base, displayStatus: 'EXPIRED_DRAFT', updatedAt: new Date(now - CUSTOMER_DISPLAY_DRAFT_TIMEOUT_MS - CUSTOMER_DISPLAY_COMPLETION_LINGER_MS + 1).toISOString() }, now),
  'EXPIRED',
  '草稿超时应短暂提示',
)
assert.equal(deriveCustomerDisplayOrderPanelView('EXPIRED', { ...base, displayStatus: 'EXPIRED_DRAFT' }), 'EXPIRED', '草稿超时提示窗口内应显示超时提示')
assert.equal(deriveCustomerDisplayOrderPanelView('IDLE', { ...base, displayStatus: 'EXPIRED_DRAFT' }), 'EMPTY', '草稿超时提示到期后不得显示上一单商品')
assert.equal(
  deriveCustomerDisplayPanelState({ ...base, displayStatus: 'EXPIRED_CHECKOUT', updatedAt: new Date(now - CUSTOMER_DISPLAY_CHECKOUT_TIMEOUT_MS - CUSTOMER_DISPLAY_COMPLETION_LINGER_MS - 1).toISOString() }, now),
  'IDLE',
  '收款超时提示到期后应清理旧状态',
)
assert.equal(deriveCustomerDisplayOrderPanelView('IDLE', { ...base, displayStatus: 'EXPIRED_CHECKOUT' }), 'EMPTY', '收款超时提示到期后不得显示上一单商品')
assert.equal(customerDisplayEntryPath('STORE A/1'), '/m/STORE%20A%2F1', '顾客 H5 应使用 /m/<storeCode> 公开入口')

console.log('customer display panel state tests passed')
