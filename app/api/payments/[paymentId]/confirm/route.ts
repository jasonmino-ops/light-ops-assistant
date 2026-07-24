import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'

/**
 * POST /api/payments/:paymentId/confirm[?storeCode=xxx]
 * 操作员手动确认已收款 — 将 PaymentIntent 状态设为 PAID（受控 PENDING → PAID 转换）。
 *
 * 授权两条正式路径（择一）：
 *   - 手机商户端 / 会话账号：getContext（不变）
 *   - 浏览器员工端：storeCode + 正式 POS 身份（账号或设备），不接受 storeCode 弱回退；
 *     并强制 PaymentIntent 归属该门店，跨店确认被拒绝。
 * 完成语义只此一处，浏览器端不另建 KHQR 完成路径。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params

  // 解析可信身份，得到 tenant（会话）或 tenant+store（POS）
  const ctx = await getContext(req)
  let tenantId: string
  let requiredStoreId: string | null = null

  if (ctx) {
    tenantId = ctx.tenantId
  } else {
    const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
    if (!storeCode) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
    const store = await prisma.store.findUnique({
      where: { code: storeCode },
      select: { id: true, tenantId: true, status: true, code: true },
    })
    if (!store || store.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
    }
    const posAuth = await authorizeDesktopPosRequest(req, {
      tenantId: store.tenantId,
      storeId: store.id,
      storeCode: store.code,
    }, { allowStoreCodeFallback: false })
    if (!posAuth) return unauthorizedPosResponse()
    tenantId = store.tenantId
    requiredStoreId = store.id
  }

  const pi = await prisma.paymentIntent.findFirst({
    where: { id: paymentId, tenantId, ...(requiredStoreId ? { storeId: requiredStoreId } : {}) },
  })

  if (!pi) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  if (pi.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'INVALID_STATE', status: pi.status },
      { status: 422 },
    )
  }

  // 受控转换：仅当仍为 PENDING 时置 PAID（条件更新，保证并发下不重复完成）
  const [updated] = await prisma.$transaction([
    prisma.paymentIntent.updateMany({
      where: { id: paymentId, tenantId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date() },
    }),
    // Deferred orders: KHQR confirm transitions PENDING_PAYMENT → COMPLETED
    // Direct retail orders: records are already COMPLETED, updateMany is a no-op
    prisma.saleRecord.updateMany({
      where: { orderNo: pi.orderNo, tenantId, status: 'PENDING_PAYMENT' },
      data: { status: 'COMPLETED' },
    }),
  ])

  if (updated.count === 0) {
    // 并发已被其它请求确认/取消：返回稳定状态而非重复完成
    const current = await prisma.paymentIntent.findUnique({ where: { id: paymentId } })
    return NextResponse.json({ error: 'INVALID_STATE', status: current?.status ?? 'UNKNOWN' }, { status: 422 })
  }

  return NextResponse.json({ id: paymentId, status: 'PAID', paidAt: new Date().toISOString() })
}
