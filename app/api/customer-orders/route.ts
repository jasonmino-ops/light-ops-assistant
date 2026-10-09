import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM, customerOrderJobEvidence } from '@/lib/customer-order-fulfillment'

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  storeCode: true,
  customerTelegramId: true,
  tableNo: true,
  remark: true,
  itemsJson: true,
  totalAmount: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  paidAt: true,
  sourcePlatform: true,
  campaignCode: true,
  campaignLinkId: true,
  campaignIntent: true,
  createdAt: true,
  tenantId: true,
  storeId: true,
} as const

type Evidence = ReturnType<typeof customerOrderJobEvidence>
type FulfillmentEvidence = { kitchen: Evidence; front: Evidence; frontUnpaid: Evidence }

async function buildFulfillmentEvidence(orders: Array<any>): Promise<Map<string, FulfillmentEvidence>> {
  if (!orders.length) return new Map()
  const intents = await prisma.customerOrderFulfillmentIntent.findMany({ where: {
    source: 'H5_HOME', OR: orders.map(o => ({ tenantId: o.tenantId, storeId: o.storeId, orderNo: o.orderNo })),
  }, select: { tenantId: true, storeId: true, orderNo: true, role: true, purpose: true, decision: true, state: true,
    printJobId: true, idempotencyKey: true, cancelResultCode: true, renderLeaseExpiresAt: true, lastErrorCode: true } })
  const jobs = intents.length ? await prisma.eshopTrayPrintJob.findMany({ where: {
    OR: intents.map(i => ({ tenantId: i.tenantId, storeId: i.storeId,
      ...(i.printJobId ? { id: i.printJobId } : { idempotencyKey: i.idempotencyKey }) })),
  }, select: { id: true, idempotencyKey: true, tenantId: true, storeId: true, status: true, resultStatus: true, claimTokenHash: true,
    expiresAt: true, completedAt: true, effectBoundary: true } }) : []
  const now = new Date()
  const evidence = (o: any, purpose: 'KITCHEN_MAKE' | 'FRONT_UNPAID' | 'FRONT_PAID'): Evidence => {
    const i = intents.find(i => i.tenantId === o.tenantId && i.storeId === o.storeId && i.orderNo === o.orderNo && i.purpose === purpose)
    if (!i) return 'NOT_APPLICABLE'
    if (!i.printJobId && jobs.some(j => j.tenantId === o.tenantId && j.storeId === o.storeId && j.idempotencyKey === i.idempotencyKey)) return 'REVIEW_REQUIRED'
    if (i.decision === 'NOT_REQUIRED' || i.state === 'NOT_REQUIRED') return 'NOT_REQUIRED'
    if (i.state === 'CANCELLED' && i.cancelResultCode === CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM) return 'NOT_REQUIRED'
    if (i.state === 'MANUAL_REVIEW' || i.state === 'CANCELLED') return 'REVIEW_REQUIRED'
    if (i.printJobId) return customerOrderJobEvidence(jobs.find(j => j.id === i.printJobId && j.tenantId === o.tenantId && j.storeId === o.storeId) ?? null, now)
    if (i.state === 'EXPIRED') return 'EXPIRED'
    if (i.state === 'FAILED_RETRYABLE') return 'RETRYING'
    return (i.renderLeaseExpiresAt && i.renderLeaseExpiresAt > now) || !i.lastErrorCode ? 'PROCESSING' : 'NOT_READY'
  }
  // Keep the existing mobile front field paid-only; never alias unpaid to paid.
  return new Map(orders.map(o => [o.id, { kitchen: evidence(o, 'KITCHEN_MAKE'), front: evidence(o, 'FRONT_PAID'), frontUnpaid: evidence(o, 'FRONT_UNPAID') }]))
}

function mapOrder(o: {
  id: string; orderNo: string; storeCode: string; customerTelegramId: string | null
  tableNo: string | null; remark: string | null
  itemsJson: string; totalAmount: { toNumber(): number }; status: string
  paymentStatus: string; paymentMethod: string | null; paidAt: Date | null
  sourcePlatform: string | null; campaignCode: string | null; campaignLinkId: string | null
  campaignIntent: string | null; createdAt: Date
}, campaignLinkMap: Map<string, {
  creatorName: string | null
  videoTitle: string | null
  targetUrl: string
}> = new Map()) {
  const campaignLink = o.campaignLinkId ? campaignLinkMap.get(o.campaignLinkId) ?? null : null
  let items: unknown[] = []
  try {
    const parsed = JSON.parse(o.itemsJson)
    if (Array.isArray(parsed)) items = parsed
  } catch {
    // Keep the order visible for manual review instead of failing the whole list.
  }
  return {
    id: o.id,
    orderNo: o.orderNo,
    storeCode: o.storeCode,
    customerTelegramId: o.customerTelegramId,
    tableNo: o.tableNo,
    remark: o.remark,
    items,
    totalAmount: o.totalAmount.toNumber(),
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    sourcePlatform: o.sourcePlatform,
    campaignCode: o.campaignCode,
    campaignIntent: o.campaignIntent,
    campaignLink: campaignLink ? {
      creatorName: campaignLink.creatorName,
      videoTitle: campaignLink.videoTitle,
      landingType: campaignLink.targetUrl.startsWith('/p/') ? 'MARKETING_PAGE' : 'MENU',
    } : null,
    createdAt: o.createdAt.toISOString(),
  }
}

async function buildCampaignLinkMap(orders: { campaignLinkId: string | null }[]) {
  const ids = [...new Set(orders.map((o) => o.campaignLinkId).filter(Boolean) as string[])]
  if (ids.length === 0) return new Map<string, { creatorName: string | null; videoTitle: string | null; targetUrl: string }>()
  const links = await prisma.campaignLink.findMany({
    where: { id: { in: ids } },
    select: { id: true, creatorName: true, videoTitle: true, targetUrl: true },
  })
  return new Map(links.map((l) => [l.id, {
    creatorName: l.creatorName,
    videoTitle: l.videoTitle,
    targetUrl: l.targetUrl,
  }]))
}

/**
 * GET /api/customer-orders
 *
 * 模式 A（待处理）：?status=PENDING,CONFIRMED,COMPLETED
 *   默认返回 PENDING + CONFIRMED + COMPLETED（只含未付款的 COMPLETED）。
 *
 * 模式 B（已付款，用于概览汇总与最近记录）：?paymentStatus=PAID[&dateFrom=yyyy-MM-dd]
 *   返回 status=COMPLETED, paymentStatus=PAID 的订单，可按 paidAt 日期筛选。
 *
 * OWNER 和 STAFF 均可查看。
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  const storeCode = req.nextUrl.searchParams.get('storeCode')
  const selectedStore = storeCode ? { storeCode } : {}

  // Exact selection also returns a committed paid order after a lost response.
  // Same tenant/STAFF-store authority as the existing list; never POS identity.
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const order = await prisma.customerOrder.findFirst({ where: {
      id, tenantId: ctx.tenantId, ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}), ...selectedStore,
    }, select: ORDER_SELECT })
    if (!order) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    const evidence = await buildFulfillmentEvidence([order])
    return NextResponse.json({ ...mapOrder(order), fulfillment: evidence.get(order.id) })
  }

  // ── 模式 B：已付款订单（用于概览 + 最近记录） ─────────────────────────────
  const paymentStatusParam = req.nextUrl.searchParams.get('paymentStatus')
  if (paymentStatusParam === 'PAID') {
    const dateFromParam = req.nextUrl.searchParams.get('dateFrom')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      tenantId: ctx.tenantId,
      ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}),
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      ...selectedStore,
    }
    if (dateFromParam) {
      where.paidAt = {
        gte: new Date(dateFromParam + 'T00:00:00.000Z'),
        lte: new Date(dateFromParam + 'T23:59:59.999Z'),
      }
    }
    const orders = await prisma.customerOrder.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      take: 50,
      select: ORDER_SELECT,
    })
    const campaignLinkMap = await buildCampaignLinkMap(orders)
    const evidence = await buildFulfillmentEvidence(orders)
    return NextResponse.json(orders.map((o) => ({ ...mapOrder(o, campaignLinkMap), fulfillment: evidence.get(o.id) })))
  }

  // ── 模式 A：待处理订单 ────────────────────────────────────────────────────
  const statusParam = req.nextUrl.searchParams.get('status')
  const statuses = statusParam
    ? statusParam.split(',')
    : ['PENDING', 'CONFIRMED', 'COMPLETED']

  // COMPLETED 状态只返回未付款的，已付款订单不再需要操作
  const includesCompleted = statuses.includes('COMPLETED')
  const scope = ctx.role === 'STAFF'
    ? { tenantId: ctx.tenantId, storeId: ctx.storeId, ...selectedStore }
    : { tenantId: ctx.tenantId, ...selectedStore }
  const where = includesCompleted
    ? {
        ...scope,
        OR: [
          { status: { in: statuses.filter((s) => s !== 'COMPLETED') } },
          { status: 'COMPLETED', paymentStatus: 'UNPAID' },
        ],
      }
    : { ...scope, status: { in: statuses } }

  const orders = await prisma.customerOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: ORDER_SELECT,
  })

  const campaignLinkMap = await buildCampaignLinkMap(orders)
  const evidence = await buildFulfillmentEvidence(orders)
  return NextResponse.json(orders.map((o) => ({ ...mapOrder(o, campaignLinkMap), fulfillment: evidence.get(o.id) })))
}
