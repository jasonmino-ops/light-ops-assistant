/**
 * GET /api/bind/info?token=<token>
 *
 * Returns the role and current store name for a bind token without consuming it.
 * Used by the /bind page to render the correct form (OWNER vs STAFF).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'MISSING_TOKEN', message: '缺少 token 参数' }, { status: 400 })
  }

  const bt = await prisma.bindToken.findUnique({
    where: { token },
    include: { store: { select: { name: true } } },
  })

  if (
    !bt ||
    bt.status !== 'ACTIVE' ||
    bt.expiresAt < new Date() ||
    bt.usedCount >= bt.maxUses
  ) {
    return NextResponse.json(
      { error: 'INVALID_TOKEN', message: '邀请码无效或已失效 / លេខអញ្ជើញមិនត្រឹមត្រូវ ឬផុតកំណត់' },
      { status: 400 },
    )
  }

  // 与 /api/admin/bind-tokens 同一拼装规则，保证 QR / 明文链接 / 复制三处完全一致
  // 安卓兜底：/bind 页拿到 tgLink 后可显示「用 Telegram 打开」按钮，避免外部浏览器白屏
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME ?? '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '')
  const tgLink = botUsername ? `https://t.me/${botUsername}?startapp=bind_${bt.token}` : null

  return NextResponse.json({ role: bt.role, storeName: bt.store.name, tgLink })
}
