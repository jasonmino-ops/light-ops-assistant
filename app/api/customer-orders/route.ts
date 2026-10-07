import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM, customerOrderJobEvidence, customerOrderPrintJobId } from '@/lib/customer-order-fulfillment'

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  storeCode: true,
  customerTelegramId: true,
  tableNo: true,
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

type FulfillmentEvidence = {
  kitchen: 'QUEUED' | 'NOT_READY' | 'RETRYING' | 'RESULT_UNKNOWN' | 'EXECUTION_REPORTED' | 'FAILED' | 'NOT_REQUIRED' | 'REVIEW_REQUIRED' | 'EXPIRED' | 'NOT_APPLICABLE' | 'PROCESSING'
  front: 'QUEUED' | 'NOT_READY' | 'RETRYING' | 'RESULT_UNKNOWN' | 'EXECUTION_REPORTED' | 'FAILED' | 'NOT_REQUIRED' | 'REVIEW_REQUIRED' | 'EXPIRED' | 'NOT_APPLICABLE' | 'PROCESSING'
}

async function buildFulfillmentEvidence(orders: Array<any>): Promise<Map<string, FulfillmentEvidence>> {
  if (orders.length === 0) return new Map()
  const ids = orders.flatMap((order) => {
    const base = { tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo }
    try { return [customerOrderPrintJobId(base, 'KITCHEN'), customerOrderPrintJobId(base, 'FRONT')] } catch { return [] }
  })
  const intents = await prisma.customerOrderFulfillmentIntent.findMany({
    where: {
      source: 'H5_HOME',
      OR: orders.map((order) => ({ tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo })),
    },
    select: {
      tenantId: true, storeId: true, orderNo: true, role: true, decision: true, state: true,
      printJobId: true, cancelResultCode: true, renderLeaseExpiresAt: true, lastErrorCode: true,
    },
  })
  const jobIds = [...new Set(intents.map((intent) => intent.printJobId).filter(Boolean) as string[])]
  const jobs = await prisma.eshopTrayPrintJob.findMany({
    where: { OR: [{ idempotencyKey: { in: ids } }, ...(jobIds.length ? [{ id: { in: jobIds } }] : [])], tenantId: { in: [...new Set(orders.map((order) => order.tenantId))] } },
    select: { id: true, tenantId: true, storeId: true, idempotencyKey: true, status: true, resultStatus: true, claimTokenHash: true, expiresAt: true, completedAt: true, effectBoundary: true },
  })
  const jobMap = new Map(jobs.flatMap((job) => [
    [`${job.tenantId}:${job.storeId}:key:${job.idempotencyKey}`, job] as const,
    [`${job.tenantId}:${job.storeId}:id:${job.id}`, job] as const,
  ]))
  const intentMap = new Map(intents.map((intent) => [`${intent.tenantId}:${intent.storeId}:${intent.orderNo}:${intent.role}`, intent]))
  const evidence = new Map<string, FulfillmentEvidence>()
  for (const order of orders) {
    let kitchen: FulfillmentEvidence['kitchen'] = 'NOT_APPLICABLE'
    let front: FulfillmentEvidence['front'] = 'NOT_APPLICABLE'
    const job = (role: 'KITCHEN' | 'FRONT') => {
      try {
        const intent = role === 'KITCHEN' ? kitchenIntent : frontIntent
        return (intent?.printJobId ? jobMap.get(`${order.tenantId}:${order.storeId}:id:${intent.printJobId}`) : null)
          ?? jobMap.get(`${order.tenantId}:${order.storeId}:key:${customerOrderPrintJobId(order, role)}`)
          ?? null
      } catch { return null }
    }
    const kitchenIntent = intentMap.get(`${order.tenantId}:${order.storeId}:${order.orderNo}:KITCHEN`)
    const frontIntent = intentMap.get(`${order.tenantId}:${order.storeId}:${order.orderNo}:FRONT`)
    if (!kitchenIntent) {
      kitchen = 'NOT_APPLICABLE'
    } else if (kitchenIntent.decision === 'NOT_REQUIRED' || kitchenIntent.state === 'NOT_REQUIRED') {
      kitchen = 'NOT_REQUIRED'
    } else if (kitchenIntent?.state === 'CANCELLED' && kitchenIntent.cancelResultCode === CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM) {
      kitchen = 'NOT_REQUIRED'
    } else if (kitchenIntent?.printJobId) {
      kitchen = customerOrderJobEvidence(job('KITCHEN'))
    } else if (kitchenIntent.state === 'MANUAL_REVIEW') {
      kitchen = 'REVIEW_REQUIRED'
    } else if (kitchenIntent.state === 'EXPIRED') {
      kitchen = 'EXPIRED'
    } else if (kitchenIntent.state === 'FAILED_RETRYABLE') {
      kitchen = 'RETRYING'
    } else if (kitchenIntent.state === 'CANCELLED') {
      kitchen = 'REVIEW_REQUIRED'
    } else {
      kitchen = kitchenIntent.renderLeaseExpiresAt && kitchenIntent.renderLeaseExpiresAt > new Date() || !kitchenIntent.lastErrorCode ? 'PROCESSING' : 'NOT_READY'
    }
    if (!frontIntent) front = 'NOT_APPLICABLE'
    else if (order.paymentStatus !== 'PAID') front = 'NOT_REQUIRED'
    else if (frontIntent.printJobId) front = customerOrderJobEvidence(job('FRONT'))
    else if (frontIntent.state === 'MANUAL_REVIEW') front = 'REVIEW_REQUIRED'
    else if (frontIntent.state === 'EXPIRED') front = 'EXPIRED'
    else if (frontIntent.state === 'FAILED_RETRYABLE') front = 'RETRYING'
    else if (frontIntent.state === 'CANCELLED') front = 'REVIEW_REQUIRED'
    else front = frontIntent.renderLeaseExpiresAt && frontIntent.renderLeaseExpiresAt > new Date() || !frontIntent.lastErrorCode ? 'PROCESSING' : 'NOT_READY'
    evidence.set(order.id, { kitchen, front })
  }
  return evidence
}

function mapOrder(o: {
  id: string; orderNo: string; storeCode: string; customerTelegramId: string | null
  tableNo: string | null
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
    ? { tenantId: ctx.tenantId, storeId: ctx.storeId }
    : { tenantId: ctx.tenantId }
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
