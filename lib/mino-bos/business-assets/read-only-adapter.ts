import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { RequestContext } from '@/lib/context'

const PENDING_REAL_DEVICE_VALIDATION = 'pending_real_device_validation' as const
const PLACEHOLDER_ONLY = 'placeholder_only' as const

type AssetScope = {
  tenantId: string
  storeId?: string
}

type StoreRow = {
  id: string
  code: string
  name: string
  status: string
  checkoutMode: string
  businessType: string
  createdAt: string
  updatedAt: string
}

type ProductRow = {
  id: string
  barcode: string
  sku: string | null
  name: string
  spec: string | null
  sellPrice: number
  status: string
  categoryId: string | null
  createdAt: string
  updatedAt: string
}

type SaleRecordRow = {
  id: string
  recordNo: string
  orderNo: string | null
  storeId: string
  storeCode: string
  storeName: string
  operatorUserId: string
  productId: string | null
  barcode: string
  productNameSnapshot: string
  specSnapshot: string | null
  unitPrice: number
  quantity: number
  lineAmount: number
  saleType: string
  status: string
  source: string | null
  offlineSyncStatus: string | null
  createdAt: string
  updatedAt: string
}

type CustomerOrderRow = {
  id: string
  orderNo: string
  storeId: string
  storeCode: string
  tableNo: string | null
  itemCount: number
  totalQuantity: number
  totalAmount: number
  status: string
  paymentStatus: string
  paymentMethod: string | null
  sourcePlatform: string | null
  campaignIntent: string | null
  createdAt: string
  updatedAt: string
  paidAt: string | null
}

function toNumber(value: Prisma.Decimal | null | undefined): number {
  return value?.toNumber() ?? 0
}

function resolveScope(ctx: RequestContext, requestedStoreId: string | null): AssetScope {
  if (ctx.role === 'STAFF') {
    return { tenantId: ctx.tenantId, storeId: ctx.storeId }
  }

  return {
    tenantId: ctx.tenantId,
    storeId: requestedStoreId?.trim() || undefined,
  }
}

function parseCustomerOrderItems(itemsJson: string): { itemCount: number; totalQuantity: number } {
  try {
    const parsed = JSON.parse(itemsJson)
    if (!Array.isArray(parsed)) return { itemCount: 0, totalQuantity: 0 }
    const totalQuantity = parsed.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)
    return { itemCount: parsed.length, totalQuantity }
  } catch {
    return { itemCount: 0, totalQuantity: 0 }
  }
}

async function assertStoreScope(scope: AssetScope): Promise<boolean> {
  if (!scope.storeId) return true

  const store = await prisma.store.findFirst({
    where: {
      id: scope.storeId,
      tenantId: scope.tenantId,
    },
    select: { id: true },
  })

  return !!store
}

export async function getReadOnlyBusinessAssets(params: {
  ctx: RequestContext
  requestedStoreId: string | null
}) {
  const scope = resolveScope(params.ctx, params.requestedStoreId)
  const storeScopeOk = await assertStoreScope(scope)

  if (!storeScopeOk) {
    return {
      ok: false as const,
      statusCode: 403,
      body: { error: 'FORBIDDEN', message: 'storeId is outside current tenant scope' },
    }
  }

  const storeWhere = {
    tenantId: scope.tenantId,
    ...(scope.storeId ? { id: scope.storeId } : {}),
  }
  const productWhere = { tenantId: scope.tenantId }
  const scopedWhere = {
    tenantId: scope.tenantId,
    ...(scope.storeId ? { storeId: scope.storeId } : {}),
  }
  const saleWhere = scopedWhere
  const orderWhere = scopedWhere
  const paymentWhere = scopedWhere
  const memberWhere = scopedWhere

  const [
    stores,
    storeCount,
    products,
    productCount,
    sales,
    saleCount,
    customerOrders,
    customerOrderCount,
    paymentMethodGroups,
    memberCount,
    memberStatusGroups,
  ] = await Promise.all([
    prisma.store.findMany({
      where: storeWhere,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        checkoutMode: true,
        businessType: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    prisma.store.count({ where: storeWhere }),
    prisma.product.findMany({
      where: productWhere,
      select: {
        id: true,
        barcode: true,
        sku: true,
        name: true,
        spec: true,
        sellPrice: true,
        status: true,
        categoryId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.product.count({ where: productWhere }),
    prisma.saleRecord.findMany({
      where: saleWhere,
      select: {
        id: true,
        recordNo: true,
        orderNo: true,
        storeId: true,
        operatorUserId: true,
        productId: true,
        barcode: true,
        productNameSnapshot: true,
        specSnapshot: true,
        unitPrice: true,
        quantity: true,
        lineAmount: true,
        saleType: true,
        status: true,
        source: true,
        offlineSyncStatus: true,
        createdAt: true,
        updatedAt: true,
        store: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.saleRecord.count({ where: saleWhere }),
    prisma.customerOrder.findMany({
      where: orderWhere,
      select: {
        id: true,
        orderNo: true,
        storeId: true,
        storeCode: true,
        tableNo: true,
        itemsJson: true,
        totalAmount: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        sourcePlatform: true,
        campaignIntent: true,
        createdAt: true,
        updatedAt: true,
        paidAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.customerOrder.count({ where: orderWhere }),
    prisma.paymentIntent.groupBy({
      by: ['paymentMethod', 'status'],
      where: paymentWhere,
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.member.count({ where: memberWhere }),
    prisma.member.groupBy({
      by: ['status'],
      where: memberWhere,
      _count: { _all: true },
    }),
  ])

  const mappedStores: StoreRow[] = stores.map((store) => ({
    id: store.id,
    code: store.code,
    name: store.name,
    status: store.status,
    checkoutMode: store.checkoutMode,
    businessType: store.businessType,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  }))

  const mappedProducts: ProductRow[] = products.map((product) => ({
    id: product.id,
    barcode: product.barcode,
    sku: product.sku,
    name: product.name,
    spec: product.spec,
    sellPrice: toNumber(product.sellPrice),
    status: product.status,
    categoryId: product.categoryId,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }))

  const mappedSales: SaleRecordRow[] = sales.map((sale) => ({
    id: sale.id,
    recordNo: sale.recordNo,
    orderNo: sale.orderNo,
    storeId: sale.storeId,
    storeCode: sale.store.code,
    storeName: sale.store.name,
    operatorUserId: sale.operatorUserId,
    productId: sale.productId,
    barcode: sale.barcode,
    productNameSnapshot: sale.productNameSnapshot,
    specSnapshot: sale.specSnapshot,
    unitPrice: toNumber(sale.unitPrice),
    quantity: toNumber(sale.quantity),
    lineAmount: toNumber(sale.lineAmount),
    saleType: sale.saleType,
    status: sale.status,
    source: sale.source,
    offlineSyncStatus: sale.offlineSyncStatus,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(),
  }))

  const mappedCustomerOrders: CustomerOrderRow[] = customerOrders.map((order) => {
    const itemStats = parseCustomerOrderItems(order.itemsJson)
    return {
      id: order.id,
      orderNo: order.orderNo,
      storeId: order.storeId,
      storeCode: order.storeCode,
      tableNo: order.tableNo,
      itemCount: itemStats.itemCount,
      totalQuantity: itemStats.totalQuantity,
      totalAmount: toNumber(order.totalAmount),
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      sourcePlatform: order.sourcePlatform,
      campaignIntent: order.campaignIntent,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
    }
  })

  return {
    ok: true as const,
    statusCode: 200,
    body: {
      status: 'ok',
      scope: 'read_only',
      generatedAt: new Date().toISOString(),
      context: {
        tenantId: scope.tenantId,
        storeId: scope.storeId ?? null,
        role: params.ctx.role,
      },
      assets: {
        stores: {
          total: storeCount,
          returned: mappedStores.length,
          items: mappedStores,
        },
        products: {
          total: productCount,
          returned: mappedProducts.length,
          items: mappedProducts,
        },
        sales: {
          total: saleCount,
          returned: mappedSales.length,
          items: mappedSales,
        },
        customerOrders: {
          total: customerOrderCount,
          returned: mappedCustomerOrders.length,
          items: mappedCustomerOrders,
        },
        paymentMethodStats: {
          source: 'PaymentIntent',
          groups: paymentMethodGroups.map((group) => ({
            paymentMethod: group.paymentMethod,
            paymentStatus: group.status,
            count: group._count._all,
            amount: toNumber(group._sum.amount),
          })),
          credentialExposure: false,
        },
        memberStats: {
          total: memberCount,
          byStatus: memberStatusGroups.map((group) => ({
            status: group.status,
            count: group._count._all,
          })),
          balanceExposure: false,
          ledgerExposure: false,
        },
        telegramEntryStatus: {
          status: PLACEHOLDER_ONLY,
          message: 'telegram_binding_status_placeholder_only',
        },
        inviteBindBotEntryStatus: {
          status: PLACEHOLDER_ONLY,
          message: 'invite_bind_bot_entry_placeholder_only',
        },
        deviceStatus: { status: PENDING_REAL_DEVICE_VALIDATION },
        printerStatus: { status: PENDING_REAL_DEVICE_VALIDATION },
        posStatus: { status: PENDING_REAL_DEVICE_VALIDATION },
        offlineSyncStatus: { status: PENDING_REAL_DEVICE_VALIDATION },
        cashierStatus: { status: PENDING_REAL_DEVICE_VALIDATION },
        desktopPosStatus: { status: PENDING_REAL_DEVICE_VALIDATION },
      },
      warnings: [
        'real_device_validation_pending',
        'read_only_adapter_no_writeback',
        'payment_credentials_not_exposed',
        'member_balance_and_ledger_not_exposed',
      ],
    },
  }
}
