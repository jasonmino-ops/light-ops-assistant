/**
 * POST /api/v/[code]/click — 公开，无需登录
 * 顾客点击"立即下单"时调用，+1 clickCount。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params
  try {
    await prisma.campaignLink.update({
      where: { code },
      data: { clickCount: { increment: 1 } },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
}
