/**
 * PATCH /api/creators/[id] — soft pause / restore creator（OWNER）
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  const { id } = await params
  let body: { status?: string } = {}
  try { body = await req.json() } catch { /* empty body */ }

  if (!['active', 'inactive'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'INVALID_STATUS', message: '状态不正确' }, { status: 400 })
  }

  const creator = await prisma.creator.findUnique({
    where: { id },
    select: { id: true, storeId: true },
  })
  if (!creator) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (creator.storeId !== ctx.storeId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const updated = await prisma.creator.update({
    where: { id },
    data: { status: body.status },
    select: {
      id: true, name: true, displayName: true,
      tiktokHandle: true, phone: true, note: true, status: true, preferredLang: true,
      dashboardToken: true, dashboardTokenCreatedAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json(updated)
}
