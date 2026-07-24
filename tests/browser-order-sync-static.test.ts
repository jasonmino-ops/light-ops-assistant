/**
 * EP-BR-ORDER-SYNC-01 静态测试（无需数据库）。
 *
 * 本轮范围：手机端挂单在浏览器员工端只读同步 + 正确显示“待收款”。
 * 锁定以下属性，防止回退，并确认本轮未夹带电脑端结算/支付链扩展：
 *   1. pending-orders 保持正式门店授权（allowStoreCodeFallback: false），
 *      不接受仅凭 storeCode / 伪造 header 读取；
 *   2. pending-orders 以 PENDING_PAYMENT 明细状态为权威返回整单明细；
 *   3. 销售记录中 PENDING_PAYMENT 显示“待收款”，不再显示 UNKNOWN；
 *   4. /api/records 透传 status 供状态显示；
 *   5. 浏览器不存在对手机挂单的结算能力（无 /api/cashier/checkout 调用、
 *      无 order-checkout 服务、待收款条目只提供“查看明细”而非“收款”）。
 *
 * 运行：npx tsx tests/browser-order-sync-static.test.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function main() {
  const pendingRoute = read('app/api/cashier/pending-orders/route.ts')
  const recordsRoute = read('app/api/records/route.ts')
  const cashierPage = read('app/cashier/page.tsx')

  // 1) 正式门店授权，禁止 storeCode 弱回退
  assert.match(pendingRoute, /authorizeDesktopPosRequest/,
    'pending-orders must use the formal desktop POS authorization boundary')
  assert.match(pendingRoute, /allowStoreCodeFallback:\s*false/,
    'pending-orders must not allow storeCode fallback')
  assert.doesNotMatch(pendingRoute, /allowStoreCodeFallback:\s*true/,
    'pending-orders must never enable storeCode fallback')

  // 2) 以明细状态为权威返回整单明细
  const pendingCode = stripComments(pendingRoute)
  assert.match(pendingCode, /status:\s*'PENDING_PAYMENT'/,
    'pending-orders must be driven by PENDING_PAYMENT record status')
  for (const field of ['unitPrice', 'quantity', 'lineAmount', 'productNameSnapshot']) {
    assert.match(pendingCode, new RegExp(field), `pending-orders must expose ${field} for detail view`)
  }

  // 3 & 4) 记录状态显示：透传 status + 前端展示“待收款”
  assert.match(recordsRoute, /status:\s*r\.status/,
    '/api/records must pass through SaleRecord.status for status display')
  assert.match(cashierPage, /recordPendingPayment/,
    'cashier records must render a pending-payment label')
  assert.match(cashierPage, /status === 'PENDING_PAYMENT'/,
    'cashier records must map PENDING_PAYMENT rather than showing UNKNOWN')

  // 5) 本轮无电脑端结算扩展
  assert.equal(existsSync(resolve(process.cwd(), 'app/api/cashier/checkout/route.ts')), false,
    'cashier checkout route must not exist in this scope')
  assert.equal(existsSync(resolve(process.cwd(), 'lib/order-checkout.ts')), false,
    'shared checkout state machine must not exist in this scope')
  const page = stripComments(cashierPage)
  assert.doesNotMatch(page, /\/api\/cashier\/checkout/,
    'browser must not call a pending-order checkout endpoint')
  assert.doesNotMatch(page, /handleCheckoutPendingOrder|activePendingOrderNo/,
    'browser must not contain pending-order settlement logic')
  assert.doesNotMatch(page, /paymentIntentId\}\/confirm/,
    'browser must not auto-confirm payments for restored holds')
  // 待收款条目仅提供“查看明细”，不出现不可安全执行的“收款”
  assert.match(cashierPage, /setViewPendingOrder\(order\)/,
    'pending holds must open a view-only detail modal')
  assert.match(cashierPage, /serverPendingView/,
    'pending hold action must be a view-details action')
  assert.doesNotMatch(cashierPage, /serverPendingRestore/,
    'pending hold action must not be a settlement/restore-to-checkout action')

  console.log('browser order-sync (view-only) static tests passed')
}

main()
