/**
 * GET /api/me  — returns current session's tenant tier, store name, and tenant name
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ tier: 'LITE', storeName: null, tenantName: null })
  const [tenant, store] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { tier: true, name: true },
    }),
    ctx.storeId
      ? prisma.store.findUnique({ where: { id: ctx.storeId }, select: { name: true, checkoutMode: true } })
      // storeId baked into session may be empty (logged in before stores were created) — fall back to first active store
      : prisma.store.findFirst({
          where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { name: true, checkoutMode: true },
        }),
  ])
  return NextResponse.json({
    tier: tenant?.tier ?? 'LITE',
    storeName: store?.name ?? null,
    tenantName: tenant?.name ?? null,
    checkoutMode: store?.checkoutMode ?? 'DIRECT_PAYMENT',
  })
}
