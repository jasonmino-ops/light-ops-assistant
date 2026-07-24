import { Prisma } from '@prisma/client'
import type { PaymentIntent, PrismaClient } from '@prisma/client'
import { generateKhqrPayload } from '@/lib/khqr'
import { findKhqrConfig, type MerchantKhqrConfig } from '@/lib/merchant-config'
import { isKhqrSupportedCurrency } from '@/lib/currency'

/**
 * 挂单（PENDING_PAYMENT）结账的唯一权威状态机。
 *
 * 手机商户端与浏览器员工端共用同一套逻辑，避免出现语义不同的第二套支付状态机：
 *   - CASH  → 原子创建 PaymentIntent(PAID) 且明细行 PENDING_PAYMENT → COMPLETED
 *   - KHQR  → 创建 PaymentIntent(PENDING)，明细行保持 PENDING_PAYMENT，
 *             收款完成仅由既有受控确认链 /api/payments/:id/confirm 负责
 *
 * 并发安全：依赖 PaymentIntent.orderNo 的唯一约束（@unique）。
 * 同一 orderNo 并发结账时只有一个 create 成功，另一个命中 P2002，
 * 回滚后读取既有 PaymentIntent 返回稳定结果——不重复创建、不重复完成、不返回 500。
 *
 * 金额、状态、可结账前提全部在服务端事务内校验，不信任任何客户端提交的金额或状态。
 */

export type DeferredCheckoutPaymentMethod = 'CASH' | 'KHQR'

export type DeferredCheckoutInput = {
  tenantId: string
  storeId: string
  operatorUserId: string
  orderNo: string
  paymentMethod: DeferredCheckoutPaymentMethod
  currencyCode: string
}

export type DeferredCheckoutError =
  | 'NOT_FOUND'
  | 'ORDER_CANCELLED'
  | 'ALREADY_COMPLETED'
  | 'STATE_INCONSISTENT'
  | 'PAYMENT_NOT_RESUMABLE'
  | 'KHQR_UNSUPPORTED_CURRENCY'
  | 'KHQR_NOT_CONFIGURED'

export type DeferredCheckoutResult =
  | {
      ok: true
      created: boolean // true = 本次新建，false = 恢复既有意图（幂等 / 并发回收）
      pi: PaymentIntent
      totalAmount: number
      khqrImageUrl: string | null
    }
  | { ok: false; error: DeferredCheckoutError; piStatus?: string }

// 事务内主动中止的哨兵：CASH 条件更新落空时抛出，触发回滚 + 幂等恢复。
class ConditionalUpdateMiss extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// 依据既有支付状态机决定如何恢复已存在的 PaymentIntent。
function recoverExisting(
  pi: PaymentIntent,
  scope: { tenantId: string; storeId: string },
): DeferredCheckoutResult {
  // 跨租户 / 跨门店的意图不可见（防止越权恢复）
  if (pi.tenantId !== scope.tenantId || pi.storeId !== scope.storeId) {
    return { ok: false, error: 'NOT_FOUND' }
  }
  switch (pi.status) {
    case 'PAID':
      // 已完成：幂等返回，明细行此前已 COMPLETED
      return { ok: true, created: false, pi, totalAmount: pi.amount.toNumber(), khqrImageUrl: null }
    case 'PENDING':
      // KHQR 收款中：恢复到既有确认链，不新建意图
      return { ok: true, created: false, pi, totalAmount: pi.amount.toNumber(), khqrImageUrl: null }
    case 'CANCELLED':
      // 已取消订单不可重新结账
      return { ok: false, error: 'ORDER_CANCELLED', piStatus: pi.status }
    default:
      // FAILED / EXPIRED：终态失败但仍欠款。orderNo 唯一约束下不能再建有效意图，
      // 且现有支付规则无“改写终态意图重试”的路径，故拒绝并保留可见性，
      // 交由既有支付规则处理，绝不静默完成或产生第二个有效意图。
      return { ok: false, error: 'PAYMENT_NOT_RESUMABLE', piStatus: pi.status }
  }
}

export async function checkoutDeferredOrder(
  db: PrismaClient,
  input: DeferredCheckoutInput,
): Promise<DeferredCheckoutResult> {
  const { tenantId, storeId, operatorUserId, orderNo, paymentMethod, currencyCode } = input

  // KHQR 前置校验（事务外快速失败，无副作用）
  let khqrConfig: MerchantKhqrConfig | null = null
  if (paymentMethod === 'KHQR') {
    if (!isKhqrSupportedCurrency(currencyCode)) {
      return { ok: false, error: 'KHQR_UNSUPPORTED_CURRENCY' }
    }
    khqrConfig = await findKhqrConfig(tenantId, storeId)
    if (!khqrConfig) {
      return { ok: false, error: 'KHQR_NOT_CONFIGURED' }
    }
  }

  // 幂等快速路径：已存在支付意图则按状态机恢复
  const existing = await db.paymentIntent.findUnique({ where: { orderNo } })
  if (existing) return recoverExisting(existing, { tenantId, storeId })

  // 校验可结账前提（金额以服务端记录为权威）
  const records = await db.saleRecord.findMany({
    where: { orderNo, tenantId, storeId },
    select: { status: true, lineAmount: true },
  })
  if (records.length === 0) return { ok: false, error: 'NOT_FOUND' }
  const pending = records.filter((r) => r.status === 'PENDING_PAYMENT')
  if (pending.length === 0) {
    const anyCancelled = records.some((r) => r.status === 'CANCELLED')
    return { ok: false, error: anyCancelled ? 'ORDER_CANCELLED' : 'ALREADY_COMPLETED' }
  }
  if (pending.length !== records.length) {
    // 部分 COMPLETED / CANCELLED、部分 PENDING_PAYMENT —— 状态不一致，拒绝
    return { ok: false, error: 'STATE_INCONSISTENT' }
  }
  const totalAmount = pending.reduce((sum, r) => sum + r.lineAmount.toNumber(), 0)

  try {
    const pi = await db.$transaction(async (tx) => {
      const khqrPayload =
        paymentMethod === 'KHQR' && khqrConfig
          ? generateKhqrPayload({ amount: totalAmount, orderNo, config: khqrConfig })
          : null

      const intent = await tx.paymentIntent.create({
        data: {
          tenantId,
          storeId,
          operatorUserId,
          orderNo,
          paymentMethod,
          status: paymentMethod === 'CASH' ? 'PAID' : 'PENDING',
          amount: totalAmount,
          khqrPayload,
          provider: khqrConfig?.provider ?? null,
          merchantConfigId: khqrConfig?.id ?? null,
          paidAt: paymentMethod === 'CASH' ? new Date() : null,
        },
      })

      // CASH：条件更新，仅把仍处于 PENDING_PAYMENT 的明细转 COMPLETED，并校验命中数
      if (paymentMethod === 'CASH') {
        const upd = await tx.saleRecord.updateMany({
          where: { orderNo, tenantId, storeId, status: 'PENDING_PAYMENT' },
          data: { status: 'COMPLETED' },
        })
        if (upd.count !== pending.length) {
          // 明细在事务开始后被改写（取消 / 完成）→ 主动回滚，交由幂等恢复处理
          throw new ConditionalUpdateMiss()
        }
      }

      return intent
    })

    return { ok: true, created: true, pi, totalAmount, khqrImageUrl: khqrConfig?.khqrImageUrl ?? null }
  } catch (err) {
    if (isUniqueViolation(err)) {
      // 并发结账：读取胜者意图返回稳定结果，绝不返回 500
      const winner = await db.paymentIntent.findUnique({ where: { orderNo } })
      if (winner) return recoverExisting(winner, { tenantId, storeId })
    }
    if (err instanceof ConditionalUpdateMiss) {
      // CASH 条件更新落空：并发已改写明细，按既有意图恢复
      const winner = await db.paymentIntent.findUnique({ where: { orderNo } })
      if (winner) return recoverExisting(winner, { tenantId, storeId })
      return { ok: false, error: 'STATE_INCONSISTENT' }
    }
    throw err
  }
}
