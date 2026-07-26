/**
 * Minimal ticket print audit. It deliberately records browser print-window
 * dispatches, not physical-printer success: a browser cannot prove paper exit.
 */
import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'

const TICKET_TYPES = ['CUSTOMER_RECEIPT', 'KITCHEN_TICKET'] as const
const TRIGGERS = ['ORIGINAL', 'REPRINT'] as const
const UPDATE_STATUSES = ['OPENED', 'FAILED', 'UNKNOWN'] as const

type TicketType = (typeof TICKET_TYPES)[number]
type Trigger = (typeof TRIGGERS)[number]

async function authorizeForRecord(req: NextRequest, id: string) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  if (!storeCode) return { response: NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 }) }
  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, status: true, businessType: true, kitchenTicketEnabled: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return { response: NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 }) }
  }
  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }, { allowStoreCodeFallback: true })
  if (!posAuth) return { response: unauthorizedPosResponse() }

  const anchor = await prisma.saleRecord.findFirst({
    where: { id, tenantId: store.tenantId, storeId: store.id, saleType: 'SALE' },
    select: { id: true, orderNo: true, recordNo: true },
  })
  if (!anchor) return { response: NextResponse.json({ error: 'SALE_RECORD_NOT_FOUND' }, { status: 404 }) }
  return { store, anchor, orderNo: anchor.orderNo ?? anchor.recordNo }
}

async function ticketIsPrintable(input: {
  store: { id: string; tenantId: string; businessType: string; kitchenTicketEnabled: boolean }
  orderNo: string
  ticketType: TicketType
}) {
  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: { orderNo: input.orderNo },
    select: { status: true },
  })
  if (!paymentIntent || paymentIntent.status !== 'PAID') return false
  if (input.ticketType === 'CUSTOMER_RECEIPT') return true
  if (input.store.businessType !== 'FOOD' || !input.store.kitchenTicketEnabled) return false
  const kitchenLine = await prisma.saleRecord.findFirst({
    where: {
      tenantId: input.store.tenantId,
      storeId: input.store.id,
      orderNo: input.orderNo,
      saleType: 'SALE',
      status: 'COMPLETED',
      printToKitchenSnapshot: true,
    },
    select: { id: true },
  })
  return !!kitchenLine
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const access = await authorizeForRecord(req, id)
  if ('response' in access) return access.response

  let body: { ticketType?: string; trigger?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  if (!TICKET_TYPES.includes(body.ticketType as TicketType) || !TRIGGERS.includes(body.trigger as Trigger)) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const ticketType = body.ticketType as TicketType
  const trigger = body.trigger as Trigger
  const printable = await ticketIsPrintable({ store: access.store, orderNo: access.orderNo, ticketType })
  if (!printable) {
    return NextResponse.json({ error: 'TICKET_NOT_PRINTABLE' }, { status: 409 })
  }

  const idempotencyKey = trigger === 'ORIGINAL'
    ? `${access.store.id}:${access.orderNo}:${ticketType}:ORIGINAL`
    : `${access.store.id}:${access.orderNo}:${ticketType}:REPRINT:${crypto.randomUUID()}`

  try {
    const dispatch = await prisma.ticketPrintDispatch.create({
      data: {
        tenantId: access.store.tenantId,
        storeId: access.store.id,
        orderNo: access.orderNo,
        ticketType,
        trigger,
        idempotencyKey,
      },
      select: { id: true, ticketType: true, trigger: true, status: true, createdAt: true },
    })
    return NextResponse.json({ dispatch, duplicate: false }, { status: 201 })
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || trigger !== 'ORIGINAL') {
      console.error('[ticket-dispatch POST]', error)
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
    }
    const existing = await prisma.ticketPrintDispatch.findUnique({
      where: { idempotencyKey },
      select: { id: true, ticketType: true, trigger: true, status: true, createdAt: true },
    })
    return NextResponse.json({ dispatch: existing, duplicate: true }, { status: 200 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const access = await authorizeForRecord(req, id)
  if ('response' in access) return access.response

  let body: { dispatchId?: string; status?: string; error?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  if (!body.dispatchId || !UPDATE_STATUSES.includes(body.status as (typeof UPDATE_STATUSES)[number])) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const result = await prisma.ticketPrintDispatch.updateMany({
    where: {
      id: body.dispatchId,
      tenantId: access.store.tenantId,
      storeId: access.store.id,
      orderNo: access.orderNo,
    },
    data: {
      status: body.status as (typeof UPDATE_STATUSES)[number],
      error: body.error?.slice(0, 600) || null,
      openedAt: body.status === 'OPENED' ? new Date() : undefined,
    },
  })
  if (result.count === 0) return NextResponse.json({ error: 'DISPATCH_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
