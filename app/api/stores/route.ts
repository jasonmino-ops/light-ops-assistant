/**
 * GET /api/stores  — OWNER only
 * Returns all active stores for the current tenant.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { getStoreContactsByIds } from '@/lib/store-contact-db'
import { getStoreLocationsByIds } from '@/lib/store-location-db'

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const stores = await prisma.store.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      checkoutMode: true,
      currencyCode: true,
      bannerUrl: true,
      announcement: true,
      promoText: true,
    },
  })

  const ids = stores.map((store) => store.id)
  const [contacts, locations] = await Promise.all([
    getStoreContactsByIds(ids),
    getStoreLocationsByIds(ids),
  ])
  return NextResponse.json(stores.map((store) => ({ ...store, ...contacts.get(store.id), ...locations.get(store.id) })))
}
