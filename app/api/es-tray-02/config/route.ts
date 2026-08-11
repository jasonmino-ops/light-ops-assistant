import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { readEshopTray02FieldConfig } from '@/lib/eShopTrayRelayField'

/** OWNER field gate lookup. FIELD ONLY. NOT A PRODUCTION CONTRACT. */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ fieldOnly: true, productionContract: false, enabled: false })
  }
  const config = readEshopTray02FieldConfig()
  if (!config) {
    return NextResponse.json({ fieldOnly: true, productionContract: false, enabled: false })
  }
  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { code: true },
  })
  return NextResponse.json({
    fieldOnly: true,
    productionContract: false,
    enabled: store?.code === config.storeCode,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
