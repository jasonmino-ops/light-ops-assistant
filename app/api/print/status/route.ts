/**
 * GET /api/print/status — 打印机状态 + 最近打印日志（OWNER）
 *
 * 返回：
 *   { configured, tierEnabled, tier, recent: [{ orderNo, status, message, at }] }
 *
 * 不调用 Telegram、不写库；recent 从 OperationLog 中按 actionType='PRINT_RECEIPT' 取本租户最近 10 条。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { isPrinterConfigured, isPrintingTier, getPrinterTokenWithDiag } from '@/lib/cloudPrinter'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { tier: true },
  })

  const recentLogs = await prisma.operationLog.findMany({
    where: { tenantId: ctx.tenantId, actionType: 'PRINT_RECEIPT' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { targetId: true, status: true, message: true, createdAt: true },
  })

  // ?diagnose=1 触发强制重拉 token，返回完整诊断信息（用于 TOKEN_FAILED 排障）
  // secret 已脱敏；不缓存（每次都重新签名）
  const diagnose = req.nextUrl.searchParams.get('diagnose') === '1'
  let diag: unknown = null
  if (diagnose) {
    const r = await getPrinterTokenWithDiag(true)
    diag = { tokenObtained: !!r.token, ...r.diag }
  }

  return NextResponse.json({
    configured:  isPrinterConfigured(),
    tier:        tenant?.tier ?? 'LITE',
    tierEnabled: isPrintingTier(tenant?.tier),
    recent: recentLogs.map((l) => ({
      orderNo: l.targetId,
      status:  l.status,
      message: l.message,
      at:      l.createdAt.toISOString(),
    })),
    diag,
  })
}
