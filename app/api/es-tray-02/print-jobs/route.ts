import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import {
  EshopTray02ContractError,
  parseEshopTray02PrintRequest,
} from '@/lib/eShopTrayRelayContract'
import { readEshopTray02FieldConfig } from '@/lib/eShopTrayRelayField'
import { enqueueEshopTray02FieldPrint } from '@/lib/eShopTrayRelayFieldStore'

export const runtime = 'nodejs'

/** OWNER submission endpoint. FIELD ONLY. NOT A PRODUCTION CONTRACT. */
export async function POST(req: NextRequest) {
  const config = readEshopTray02FieldConfig()
  if (!config) return NextResponse.json({ error: 'ES_TRAY_02_FIELD_DISABLED' }, { status: 404 })

  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'OWNER_REQUIRED' }, { status: 403 })

  const store = await prisma.store.findFirst({
    where: { id: ctx.storeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { id: true, code: true },
  })
  if (!store || store.code !== config.storeCode) {
    return NextResponse.json({ error: 'ES_TRAY_02_FIELD_DISABLED' }, { status: 404 })
  }

  try {
    const request = parseEshopTray02PrintRequest(await req.json())
    const job = await enqueueEshopTray02FieldPrint({
      tenantId: ctx.tenantId,
      storeId: store.id,
      userId: ctx.userId,
    }, request)
    return NextResponse.json({
      fieldOnly: true,
      productionContract: false,
      jobId: job.id,
      requestId: request.requestId,
      status: 'PENDING_RECEIVE',
    }, { status: 202 })
  } catch (error) {
    const code = error instanceof EshopTray02ContractError
      ? error.code
      : error instanceof SyntaxError
        ? 'ES_TRAY_02_INVALID_JSON'
        : 'ES_TRAY_02_SUBMIT_FAILED'
    return NextResponse.json({ error: code }, { status: code === 'ES_TRAY_02_SUBMIT_FAILED' ? 500 : 400 })
  }
}
