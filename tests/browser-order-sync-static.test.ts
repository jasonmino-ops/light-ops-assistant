/**
 * EP-BR-ORDER-SYNC-01 静态安全测试（无需数据库）。
 *
 * 锁定本轮整改的关键安全属性，防止回退：
 *   1. 待收款查询与结账不得使用 storeCode 弱回退（allowStoreCodeFallback: false）；
 *   2. 浏览器结账不得存在 KHQR 客户端确认旁路（无 manualPaymentConfirmed / resolveCashierPaymentIntentStatus）；
 *   3. KHQR 只创建 PENDING 支付意图，完成走既有受控确认链；
 *   4. CASH 结账为条件更新并校验命中数；并发唯一冲突转为稳定恢复而非 500；
 *   5. 待收款列表以明细状态为权威，不因存在任意 PaymentIntent 而永久隐藏；
 *   6. 收款完成状态机唯一（浏览器端复用 lib/order-checkout + 既有 confirm 链）。
 *
 * 运行：npx tsx tests/browser-order-sync-static.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

// 去掉块注释与行注释，避免"禁止出现"类断言被文档注释里的词误伤。
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function main() {
  const checkoutRoute = read('app/api/cashier/checkout/route.ts')
  const pendingRoute = read('app/api/cashier/pending-orders/route.ts')
  const service = read('lib/order-checkout.ts')
  const confirmRoute = read('app/api/payments/[paymentId]/confirm/route.ts')
  const cashierPage = read('app/cashier/page.tsx')

  assert.match(service, /export async function checkoutDeferredOrder/,
    'the shared checkout service must be exported')

  // 1) 授权边界：待收款查询与结账都禁止 storeCode 弱回退
  assert.match(checkoutRoute, /allowStoreCodeFallback:\s*false/,
    'cashier checkout must not allow storeCode fallback')
  assert.doesNotMatch(checkoutRoute, /allowStoreCodeFallback:\s*true/,
    'cashier checkout must never enable storeCode fallback')
  assert.match(pendingRoute, /allowStoreCodeFallback:\s*false/,
    'pending-orders must not allow storeCode fallback')
  assert.doesNotMatch(pendingRoute, /allowStoreCodeFallback:\s*true/,
    'pending-orders must never enable storeCode fallback')
  assert.match(checkoutRoute, /authorizeDesktopPosRequest/,
    'cashier checkout must reuse the formal desktop POS authorization boundary')
  assert.match(pendingRoute, /authorizeDesktopPosRequest/,
    'pending-orders must reuse the formal desktop POS authorization boundary')

  // 2) 无 KHQR 客户端确认旁路（忽略文档注释，仅看实际代码）
  const checkoutCode = stripComments(checkoutRoute)
  assert.doesNotMatch(checkoutCode, /manualPaymentConfirmed/,
    'cashier checkout code must not accept a client manualPaymentConfirmed flag')
  assert.doesNotMatch(checkoutCode, /resolveCashierPaymentIntentStatus/,
    'cashier checkout code must not reuse the instant-sale KHQR confirmation shortcut')

  // 3) KHQR → PENDING；完成走既有受控确认链
  assert.match(service, /paymentMethod === 'CASH' \? 'PAID' : 'PENDING'/,
    'service must persist KHQR intents as PENDING, only CASH as PAID')
  assert.match(cashierPage, /\/api\/payments\/\$\{encodeURIComponent\(body\.paymentIntentId\)\}\/confirm/,
    'browser KHQR completion must go through the existing payments confirm chain')

  // 4) CASH 条件更新校验命中数；并发唯一冲突稳定恢复
  assert.match(service, /upd\.count !== pending\.length/,
    'CASH completion must verify the conditional update affected exactly the pending lines')
  assert.match(service, /P2002/,
    'service must recognise the unique-constraint race and recover instead of surfacing 500')
  assert.match(service, /recoverExisting/,
    'service must recover a concurrent winner PaymentIntent deterministically')
  // 恢复矩阵覆盖全部支付状态
  for (const st of ['PAID', 'PENDING', 'CANCELLED']) {
    assert.match(service, new RegExp(`case '${st}'`), `recovery must handle ${st} explicitly`)
  }
  assert.match(service, /PAYMENT_NOT_RESUMABLE/,
    'recovery must handle terminal FAILED/EXPIRED without silently completing')

  // 5) 待收款列表以明细状态为权威，不再按 PaymentIntent 存在与否排除
  const pendingCode = stripComments(pendingRoute)
  assert.match(pendingCode, /status:\s*'PENDING_PAYMENT'/,
    'pending-orders must be driven by PENDING_PAYMENT record status')
  assert.doesNotMatch(pendingCode, /paymentIntent\.findMany/,
    'pending-orders must not hide orders merely because a PaymentIntent exists')
  assert.doesNotMatch(pendingCode, /checkedOut/,
    'pending-orders must not exclude orders by prior checkout existence')

  // 6) 确认链为受控条件转换（PENDING → PAID）且并发安全
  assert.match(confirmRoute, /status:\s*'PENDING'/,
    'confirm must only transition intents currently in PENDING')
  assert.match(confirmRoute, /updateMany/,
    'confirm must use a conditional update to avoid double completion')
  assert.match(confirmRoute, /updated\.count === 0/,
    'confirm must return a stable state on concurrent races, not double-complete')

  // 单一状态机：手机端 checkout 路由复用同一服务
  const ordersCheckout = read('app/api/orders/[orderNo]/checkout/route.ts')
  assert.match(ordersCheckout, /checkoutDeferredOrder/,
    'mobile deferred checkout must reuse the shared checkout service (single state machine)')

  console.log('browser order-sync static security tests passed')
}

main()
