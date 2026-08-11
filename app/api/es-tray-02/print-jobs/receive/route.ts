import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readEshopTray02FieldConfig } from '@/lib/eShopTrayRelayField'
import { receiveNextEshopTray02FieldPrint } from '@/lib/eShopTrayRelayFieldStore'

export const runtime = 'nodejs'

function authorized(req: NextRequest, expected: string): boolean {
  const header = req.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const expectedHash = createHash('sha256').update(expected).digest()
  const providedHash = createHash('sha256').update(provided).digest()
  return provided.length > 0 && timingSafeEqual(expectedHash, providedHash)
}

/** Single-Tray one-shot receive endpoint. FIELD ONLY. NOT A PRODUCTION CONTRACT. */
export async function POST(req: NextRequest) {
  const config = readEshopTray02FieldConfig()
  if (!config) return NextResponse.json({ error: 'ES_TRAY_02_FIELD_DISABLED' }, { status: 404 })
  if (!authorized(req, config.token)) {
    return NextResponse.json({ error: 'ES_TRAY_02_FIELD_UNAUTHORIZED' }, { status: 401 })
  }

  const store = await prisma.store.findUnique({
    where: { code: config.storeCode },
    select: { id: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'ES_TRAY_02_FIELD_STORE_UNAVAILABLE' }, { status: 404 })
  }

  const job = await receiveNextEshopTray02FieldPrint({
    tenantId: store.tenantId,
    storeId: store.id,
  })
  return NextResponse.json({
    fieldOnly: true,
    productionContract: false,
    job,
  }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
