/**
 * POST /api/creators/[id]/dashboard-token
 *
 * 为博主生成或重置只读看板 token（OWNER 权限）。
 * 每次调用都生成新 token，旧 token 自动失效。
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { publicUrl } from '@/lib/public-url'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  const creator = await prisma.creator.findUnique({ where: { id }, select: { id: true, storeId: true } })
  if (!creator) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (creator.storeId !== ctx.storeId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const token = randomBytes(24).toString('hex')  // 48-char hex, URL-safe

  await prisma.creator.update({
    where: { id },
    data: {
      dashboardToken:          token,
      dashboardTokenCreatedAt: new Date(),
      dashboardTokenRevokedAt: null,
    },
  })

  return NextResponse.json({ token, dashboardUrl: publicUrl(`/creator/p/${token}`, req.nextUrl.origin) })
}
