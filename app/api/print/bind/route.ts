/**
 * POST /api/print/bind — 设备绑定/确认（OWNER + 高级版商户）
 *
 * 用于排查云打印机离线/未绑定问题。
 * 复用 lib/cloudPrinter.bindDevice → 先 getPrinterTokenWithDiag 拿 token，再调
 * https://open.sw-aiot.com/api/device/bindPrint
 *
 * 返回厂商完整 response body（便于排障）+ 拿不到 token 时附带 tokenDiag。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { bindDevice, isPrinterConfigured, isPrintingTier, logPrintAttempt } from '@/lib/cloudPrinter'

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { tier: true },
  })
  if (!isPrintingTier(tenant?.tier)) {
    return NextResponse.json({ error: 'TIER_REQUIRED', message: '需要高级版' }, { status: 403 })
  }
  if (!isPrinterConfigured()) {
    return NextResponse.json({ error: 'PRINTER_NOT_CONFIGURED' }, { status: 500 })
  }

  // body 可选覆写默认参数（pwidth / timeout / nickname）
  let body: { pwidth?: number; timeout?: number; nickname?: string } = {}
  try { body = await req.json() } catch { /* 无 body 也接受，全用默认 */ }

  const result = await bindDevice({
    pwidth:   typeof body.pwidth   === 'number' ? body.pwidth   : undefined,
    timeout:  typeof body.timeout  === 'number' ? body.timeout  : undefined,
    nickname: typeof body.nickname === 'string' ? body.nickname : undefined,
  })

  // 写一条审计日志（OperationLog 复用，不新增表）
  await logPrintAttempt({
    tenantId: ctx.tenantId,
    storeId:  ctx.storeId,
    orderNo:  `BIND-${Date.now()}`,
    status:   result.ok ? 'ok' : 'failed',
    error:    result.ok ? undefined : (result.errorMessage ?? 'unknown'),
    reason:   'bind_device',
  })

  // 不管成败都返回完整 result（含 rawBody / tokenDiag / request），便于前端展示
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
