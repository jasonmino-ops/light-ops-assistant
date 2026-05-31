/**
 * GET  /api/creators  — 当前门店博主列表（OWNER）
 * POST /api/creators  — 新增博主（OWNER）
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  const creators = await prisma.creator.findMany({
    where: { storeId: ctx.storeId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, displayName: true,
      tiktokHandle: true, phone: true, note: true, status: true, createdAt: true,
    },
  })
  return NextResponse.json({ creators })
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (!ctx.storeId) return NextResponse.json({ error: 'NO_STORE' }, { status: 400 })

  let body: { name?: string; tiktokHandle?: string; phone?: string; note?: string } = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'NAME_REQUIRED', message: '博主名称不能为空' }, { status: 400 })

  const creator = await prisma.creator.create({
    data: {
      tenantId:    ctx.tenantId,
      storeId:     ctx.storeId,
      name,
      tiktokHandle: typeof body.tiktokHandle === 'string' ? body.tiktokHandle.trim() || null : null,
      phone:        typeof body.phone        === 'string' ? body.phone.trim()        || null : null,
      note:         typeof body.note         === 'string' ? body.note.trim()         || null : null,
    },
  })
  return NextResponse.json(creator, { status: 201 })
}
