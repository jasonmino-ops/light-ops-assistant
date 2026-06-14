/**
 * POST /api/pos/session/complete
 * 销售完成（CASH 即时 / KHQR 收款确认）后 fire-and-forget；把 PosSession 切到 COMPLETED。
 * 仅写镜像；不动 SaleRecord / PaymentIntent（那两者由 /api/sales 主链负责）。
 * 幂等：行不存在静默 200。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  let body: { orderNo?: unknown; totalAmount?: unknown; paymentMethod?: unknown }
  try { body = await req.json() } catch { body = {} }

  const orderNo = typeof body.orderNo === 'string' && body.orderNo ? body.orderNo.slice(0, 64) : null
  const totalAmount = Number(body.totalAmount)
  const paymentMethod = typeof body.paymentMethod === 'string'
    && (body.paymentMethod === 'CASH' || body.paymentMethod === 'KHQR')
    ? body.paymentMethod : null

  try {
    await prisma.posSession.updateMany({
      where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
      data: {
        status: 'COMPLETED',
        paymentMethod: paymentMethod ?? undefined,
        paymentStatus: 'PAID',
        orderNo: orderNo ?? undefined,
        totalAmount: Number.isFinite(totalAmount) ? +totalAmount.toFixed(2) : undefined,
        khqrPayload: null,
        khqrImageUrl: null,
        completedAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[pos/session/complete] update failed', e)
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
