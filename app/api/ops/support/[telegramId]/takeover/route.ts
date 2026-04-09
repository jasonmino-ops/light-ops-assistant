/**
 * POST /api/ops/support/[telegramId]/takeover
 *
 * 人工接管客户会话：将 SupportSession.sessionState 置为 human_active。
 * 接管后 bot 不再自动回复该用户，直到后续版本支持重置。
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ telegramId: string }> },
) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { telegramId } = await params
  if (!telegramId) return NextResponse.json({ error: 'MISSING_TELEGRAM_ID' }, { status: 400 })

  try {
    await prisma.supportSession.upsert({
      where: { telegramId },
      create: { telegramId, sessionState: 'human_active' },
      update: { sessionState: 'human_active' },
    })
    return NextResponse.json({ ok: true, sessionState: 'human_active' })
  } catch (e) {
    console.error('[ops/support/takeover] failed:', e)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
