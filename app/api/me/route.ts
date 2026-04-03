/**
 * GET /api/me  — returns current session's tenant tier
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const ctx = getContext(req)
  if (!ctx) return NextResponse.json({ tier: 'LITE' })
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { tier: true },
  })
  return NextResponse.json({ tier: tenant?.tier ?? 'LITE' })
}
