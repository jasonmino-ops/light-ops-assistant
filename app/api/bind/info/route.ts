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

  return NextResponse.json({ role: bt.role, storeName: bt.store.name })
}
