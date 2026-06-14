/**
 * POST /api/pos/session/cancel
 * 手机 /sale 用户清空购物车 / 取消 KHQR / 离开销售流程时 fire-and-forget；
 * 把 PosSession 切到 CANCELLED + 清空 items / 二维码字段。
 * 幂等：行不存在静默 200。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  try {
    await prisma.posSession.updateMany({
      where: { tenantId: ctx.tenantId, storeId: ctx.storeId },
      data: {
        status: 'CANCELLED',
        itemsJson: '[]',
        totalAmount: 0,
        itemCount: 0,
        paymentMethod: null,
        paymentStatus: null,
        khqrPayload: null,
        khqrImageUrl: null,
        message: null,
        completedAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[pos/session/cancel] update failed', e)
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 })
  }
}
