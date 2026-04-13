/**
 * lib/payment-breakdown.ts
 *
 * 计算销售记录中的收款方式拆分：现金 vs KHQR（已支付）。
 *
 * 口径规则：
 *  - 无 PaymentIntent（历史单）→ 全归入现金已付
 *  - PaymentIntent.status = PAID, paymentMethod = CASH  → 现金已付
 *  - PaymentIntent.status = PAID, paymentMethod = KHQR  → KHQR 已付
 *  - PaymentIntent.status = PENDING / CANCELLED / FAILED / EXPIRED → 不计入任何拆分
 *  - SaleRecord.status = CANCELLED         → 已被 status 过滤掉，不参与
 *  - SaleRecord.status = PENDING_PAYMENT   → 已被 status 过滤掉，不参与（待收款单不计收入）
 */
import { prisma } from './prisma'

export type PaymentBreakdown = {
  cashSaleAmount: number
  khqrSaleAmount: number
}

export async function getPaymentBreakdown(params: {
  tenantId: string
  from: Date
  to: Date
  storeId?: string
  operatorUserId?: string
}): Promise<PaymentBreakdown> {
  const { tenantId, from, to, storeId, operatorUserId } = params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saleWhere: any = {
    tenantId,
    saleType: 'SALE',
    status: 'COMPLETED',
    createdAt: { gte: from, lte: to },
  }
  if (storeId) saleWhere.storeId = storeId
  if (operatorUserId) saleWhere.operatorUserId = operatorUserId

  // Step 1: distinct orderNos for COMPLETED SALE records in range
  const orderRows = await prisma.saleRecord.findMany({
    where: saleWhere,
    select: { orderNo: true },
    distinct: ['orderNo'],
  })

  const orderNos = orderRows.map((r) => r.orderNo).filter(Boolean) as string[]
  if (orderNos.length === 0) return { cashSaleAmount: 0, khqrSaleAmount: 0 }

  // Step 2: look up PaymentIntents for those orderNos
  const pis = await prisma.paymentIntent.findMany({
    where: { orderNo: { in: orderNos } },
    select: { orderNo: true, paymentMethod: true, status: true },
  })
  const piMap = new Map(pis.map((pi) => [pi.orderNo, pi]))

  const cashOrderNos: string[] = []
  const khqrOrderNos: string[] = []

  for (const orderNo of orderNos) {
    const pi = piMap.get(orderNo)
    if (!pi) {
      // 无 PI = 历史单，视为现金已付
      cashOrderNos.push(orderNo)
    } else if (pi.status === 'PAID' && pi.paymentMethod === 'CASH') {
      cashOrderNos.push(orderNo)
    } else if (pi.status === 'PAID' && pi.paymentMethod === 'KHQR') {
      khqrOrderNos.push(orderNo)
    }
    // PENDING / CANCELLED / FAILED → 不计入
  }

  // Step 3: aggregate
  const [cashAgg, khqrAgg] = await Promise.all([
    cashOrderNos.length > 0
      ? prisma.saleRecord.aggregate({
          where: { ...saleWhere, orderNo: { in: cashOrderNos } },
          _sum: { lineAmount: true },
        })
      : null,
    khqrOrderNos.length > 0
      ? prisma.saleRecord.aggregate({
          where: { ...saleWhere, orderNo: { in: khqrOrderNos } },
          _sum: { lineAmount: true },
        })
      : null,
  ])

  return {
    cashSaleAmount: parseFloat((cashAgg?._sum.lineAmount?.toNumber() ?? 0).toFixed(2)),
    khqrSaleAmount: parseFloat((khqrAgg?._sum.lineAmount?.toNumber() ?? 0).toFixed(2)),
  }
}

/**
 * 为一批 orderNo 批量查询 PaymentIntent 信息（用于记录列表逐条展示）。
 * 返回 Map<orderNo, { paymentMethod, paymentStatus }>。
 */
export async function getOrderPaymentMap(
  orderNos: string[],
): Promise<Map<string, { paymentMethod: 'CASH' | 'KHQR'; paymentStatus: string }>> {
  if (orderNos.length === 0) return new Map()

  const pis = await prisma.paymentIntent.findMany({
    where: { orderNo: { in: orderNos } },
    select: { orderNo: true, paymentMethod: true, status: true },
  })

  return new Map(
    pis.map((pi) => [
      pi.orderNo,
      {
        paymentMethod: pi.paymentMethod as 'CASH' | 'KHQR',
        paymentStatus: pi.status,
      },
    ]),
  )
}
