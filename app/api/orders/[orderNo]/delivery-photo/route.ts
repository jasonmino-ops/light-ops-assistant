/**
 * GET /api/orders/[orderNo]/delivery-photo
 *
 * 顾客门牌/位置照片二进制端点。返回 CustomerOrder.deliveryAddressPhotoData
 * 对应的图片字节。开放访问（由 orderNo 难猜性 + URL 不外露兜底）；
 * 商户端订单详情与 Telegram 通知都用此 URL 渲染。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const { orderNo } = await params
  const order = await prisma.customerOrder.findUnique({
    where:  { orderNo },
    select: { deliveryAddressPhotoData: true },
  })
  if (!order?.deliveryAddressPhotoData) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const m = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(order.deliveryAddressPhotoData)
  if (!m) return NextResponse.json({ error: 'INVALID_DATA' }, { status: 500 })
  const mime = m[1]
  const buf  = Buffer.from(m[2], 'base64')
  return new NextResponse(buf, {
    status:  200,
    headers: {
      'Content-Type':  mime,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
