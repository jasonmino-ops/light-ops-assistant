/**
 * POST /api/campaign-links/[id]/settle — 标记短链已结算（OWNER）
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  let body: { settledNote?: string } = {}
  try { body = await req.json() } catch { /* empty ok */ }

  const link = await prisma.campaignLink.findUnique({ where: { id }, select: { storeId: true, settlementStatus: true } })
  if (!link) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (link.storeId !== ctx.storeId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (link.settlementStatus === 'settled') return NextResponse.json({ error: 'ALREADY_SETTLED' }, { status: 409 })

  const updated = await prisma.campaignLink.update({
    where: { id },
    data: {
      settlementStatus: 'settled',
      settledAt:        new Date(),
      settledNote:      typeof body.settledNote === 'string' ? body.settledNote.trim() || null : null,
    },
    select: { id: true, settlementStatus: true, settledAt: true, settledNote: true },
  })
  return NextResponse.json(updated)
}
