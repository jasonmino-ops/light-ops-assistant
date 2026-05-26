import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/e-life/stores-by-category?type=<type>
 * Public — no auth.
 * Maps 8 UI category types to Store.businessType values (FOOD/RETAIL/SERVICE/GENERAL).
 * Returns up to 20 ACTIVE stores, sorted by updatedAt DESC.
 */

const TYPE_TO_BUSINESS: Record<string, string[]> = {
  food:          ['FOOD'],
  retail:        ['RETAIL'],
  cafe:          ['GENERAL'],
  service:       ['SERVICE'],
  entertainment: ['GENERAL'],
  health:        ['SERVICE'],
  auto:          ['SERVICE'],
  kids:          ['GENERAL'],
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  const bizTypes = TYPE_TO_BUSINESS[type]

  if (!bizTypes) {
    return NextResponse.json({ stores: [] })
  }

  const rows = await prisma.store.findMany({
    where: { status: 'ACTIVE', businessType: { in: bizTypes } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: { code: true, name: true, businessType: true, bannerUrl: true },
  })

  return NextResponse.json({
    stores: rows.map((s) => ({
      storeCode:    s.code,
      storeName:    s.name,
      businessType: s.businessType,
      bannerUrl:    s.bannerUrl ?? null,
    })),
  })
}
