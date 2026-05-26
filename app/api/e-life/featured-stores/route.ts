import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/e-life/featured-stores
 * Public — no auth required.
 * Returns up to 6 ACTIVE stores sorted by updatedAt DESC (most recently active first).
 */
export async function GET() {
  const stores = await prisma.store.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    take: 6,
    select: { code: true, name: true, businessType: true, bannerUrl: true },
  })

  return NextResponse.json({
    stores: stores.map((s) => ({
      storeCode:    s.code,
      storeName:    s.name,
      businessType: s.businessType,
      bannerUrl:    s.bannerUrl ?? null,
    })),
  })
}
