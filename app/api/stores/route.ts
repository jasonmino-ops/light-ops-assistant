/**
 * GET /api/stores  — OWNER only
 * Returns all active stores for the current tenant.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const ctx = getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const stores = await prisma.store.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })

  return NextResponse.json(stores)
}
