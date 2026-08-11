import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { readEshopTray02FieldConfig, ES_TRAY_02_MAX_COMMAND_BYTES } from '@/lib/eShopTrayRelayField'

export const runtime = 'nodejs'

const MAX_TRACE_BODY_CHARS = 4096
const CLIENT_TRACE_EVENTS = new Set([
  'PRINT_CLICK',
  'PRINT_HTML_START',
  'PRINT_HTML_SUCCESS',
  'PRINT_HTML_FAILED',
  'ESC_POS_RENDER_START',
  'ESC_POS_RENDER_SUCCESS',
  'ESC_POS_RENDER_FAILED',
  'DIGEST_START',
  'DIGEST_SUCCESS',
  'DIGEST_FAILED',
  'BASE64_START',
  'BASE64_SUCCESS',
  'BASE64_FAILED',
  'CLOUD_SUBMIT_START',
  'CLOUD_SUBMIT_RESULT',
  'CLOUD_SUBMIT_FAILED',
  'RENDER_DOM_MOUNTED',
  'FRAME_LOAD_START',
  'FRAME_LOAD_DONE',
  'FRAME_LOAD_FAILED',
  'FONTS_START',
  'FONTS_DONE',
  'FONTS_FAILED',
  'IMAGES_START',
  'IMAGES_DONE',
  'IMAGES_FAILED',
  'RAF_1_START',
  'RAF_1_DONE',
  'RAF_2_START',
  'RAF_2_DONE',
  'HTML2CANVAS_IMPORT_START',
  'HTML2CANVAS_IMPORT_DONE',
  'HTML2CANVAS_IMPORT_FAILED',
  'HTML2CANVAS_START',
  'HTML2CANVAS_DONE',
  'HTML2CANVAS_FAILED',
  'PIXEL_ENCODE_START',
  'PIXEL_ENCODE_DONE',
  'PIXEL_ENCODE_FAILED',
])

type TraceBody = {
  event: string
  timestamp: string
  orderRef?: string
  byteLength?: number
  httpStatus?: number
  elapsedMs?: number
  canvasWidth?: number
  canvasHeight?: number
  error?: { name: string; message: string }
}

function parseTraceBody(raw: string): TraceBody | null {
  if (!raw || raw.length > MAX_TRACE_BODY_CHARS) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (body.fieldOnly !== true || body.productionContract !== false) return null
  if (typeof body.event !== 'string' || !CLIENT_TRACE_EVENTS.has(body.event)) return null
  if (
    typeof body.timestamp !== 'string'
    || body.timestamp.length > 40
    || !Number.isFinite(Date.parse(body.timestamp))
  ) return null

  const parsed: TraceBody = { event: body.event, timestamp: body.timestamp }
  if (body.orderRef !== undefined) {
    if (typeof body.orderRef !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(body.orderRef)) return null
    parsed.orderRef = body.orderRef
  }
  if (body.byteLength !== undefined) {
    if (
      !Number.isSafeInteger(body.byteLength)
      || Number(body.byteLength) < 0
      || Number(body.byteLength) > ES_TRAY_02_MAX_COMMAND_BYTES
    ) return null
    parsed.byteLength = Number(body.byteLength)
  }
  if (body.httpStatus !== undefined) {
    if (!Number.isInteger(body.httpStatus) || Number(body.httpStatus) < 100 || Number(body.httpStatus) > 599) {
      return null
    }
    parsed.httpStatus = Number(body.httpStatus)
  }
  if (body.elapsedMs !== undefined) {
    if (!Number.isSafeInteger(body.elapsedMs) || Number(body.elapsedMs) < 0 || Number(body.elapsedMs) > 3_600_000) {
      return null
    }
    parsed.elapsedMs = Number(body.elapsedMs)
  }
  for (const dimension of ['canvasWidth', 'canvasHeight'] as const) {
    if (body[dimension] === undefined) continue
    if (!Number.isSafeInteger(body[dimension]) || Number(body[dimension]) <= 0 || Number(body[dimension]) > 100_000) {
      return null
    }
    parsed[dimension] = Number(body[dimension])
  }
  if (body.error !== undefined) {
    if (!body.error || typeof body.error !== 'object' || Array.isArray(body.error)) return null
    const error = body.error as Record<string, unknown>
    if (
      typeof error.name !== 'string'
      || error.name.length > 64
      || typeof error.message !== 'string'
      || error.message.length > 160
    ) return null
    parsed.error = { name: error.name, message: error.message }
  }
  return parsed
}

/** FIELD ONLY client diagnostics. NOT A PRODUCTION CONTRACT. */
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

  const trace = parseTraceBody(await req.text())
  if (!trace) return NextResponse.json({ error: 'ES_TRAY_02_FIELD_TRACE_INVALID' }, { status: 400 })

  try {
    const payloadSnapshot = {
      fieldOnly: true,
      notProductionContract: true,
      event: trace.event,
      clientTimestamp: trace.timestamp,
      ...(trace.orderRef ? { orderRef: trace.orderRef } : {}),
      ...(trace.byteLength === undefined ? {} : { byteLength: trace.byteLength }),
      ...(trace.httpStatus === undefined ? {} : { httpStatus: trace.httpStatus }),
      ...(trace.elapsedMs === undefined ? {} : { elapsedMs: trace.elapsedMs }),
      ...(trace.canvasWidth === undefined ? {} : { canvasWidth: trace.canvasWidth }),
      ...(trace.canvasHeight === undefined ? {} : { canvasHeight: trace.canvasHeight }),
      ...(trace.error ? { error: trace.error } : {}),
    } satisfies Prisma.InputJsonValue
    await prisma.operationLog.create({
      data: {
        tenantId: ctx.tenantId,
        storeId: store.id,
        userId: ctx.userId,
        actionType: 'ES_TRAY_02_FIELD_CLIENT_TRACE',
        targetType: 'ES_TRAY_02_FIELD_CLIENT',
        targetId: trace.orderRef,
        status: trace.event.endsWith('_FAILED') ? 'FAILED' : 'SUCCESS',
        message: `FIELD ONLY · ${trace.event} · NOT PRODUCTION CONTRACT`,
        payloadSnapshot,
      },
    })
    return NextResponse.json({ fieldOnly: true, productionContract: false, accepted: true }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'ES_TRAY_02_FIELD_TRACE_FAILED' }, { status: 500 })
  }
}
