import { prisma } from '@/lib/prisma'
import type { DeviceRelayContext } from './device-auth'

type RawCustomerOrderItem = {
  productId?: string
  name?: string
  spec?: string | null
  quantity?: number
  price?: number
  originalPrice?: number
  lineAmount?: number
}

/**
 * Read-only receipt data for the device-only Desktop POS runtime.
 * Every database lookup is constrained by the server-derived tenant/store.
 */
export async function readDeviceRelayOrderDetail(
  scope: Pick<DeviceRelayContext, 'tenantId' | 'storeId'>,
  orderNo: string,
) {
  const records = await prisma.saleRecord.findMany({
    where: { orderNo, tenantId: scope.tenantId, storeId: scope.storeId },
    include: {
      store: { select: { name: true } },
      operatorUser: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (records.length > 0) {
    const paymentIntent = await prisma.paymentIntent.findFirst({
      where: { orderNo, tenantId: scope.tenantId, storeId: scope.storeId },
    })
    const first = records[0]
    return {
      orderNo,
      storeName: first.store.name,
      operatorDisplayName: first.operatorUser.displayName,
      createdAt: first.createdAt.toISOString(),
      saleStatus: first.status,
      items: records.map((record) => ({
        id: record.id,
        recordNo: record.recordNo,
        productNameSnapshot: record.productNameSnapshot,
        specSnapshot: record.specSnapshot ?? null,
        quantity: record.quantity.toNumber(),
        unitPrice: record.unitPrice.toNumber(),
        lineAmount: record.lineAmount.toNumber(),
        saleType: record.saleType,
      })),
      totalAmount: records.reduce((sum, record) => sum + record.lineAmount.toNumber(), 0),
      paymentMethod: paymentIntent?.paymentMethod ?? null,
      paymentStatus: paymentIntent?.status ?? null,
      paidAt: paymentIntent?.paidAt?.toISOString() ?? null,
      cancelledAt: paymentIntent?.cancelledAt?.toISOString() ?? null,
    }
  }

  const customerOrder = await prisma.customerOrder.findFirst({
    where: { orderNo, tenantId: scope.tenantId, storeId: scope.storeId },
  })
  if (!customerOrder) return null

  const store = await prisma.store.findFirst({
    where: { id: scope.storeId, tenantId: scope.tenantId },
    select: { name: true },
  })
  if (!store) return null

  let rawItems: RawCustomerOrderItem[] = []
  try {
    const parsed = JSON.parse(customerOrder.itemsJson)
    rawItems = Array.isArray(parsed) ? parsed as RawCustomerOrderItem[] : []
  } catch {
    rawItems = []
  }

  const items = rawItems.map((item, index) => {
    const quantity = typeof item.quantity === 'number' ? item.quantity : 1
    const unitPrice = typeof item.price === 'number' ? item.price : 0
    const lineAmount = typeof item.lineAmount === 'number'
      ? item.lineAmount
      : quantity * unitPrice
    return {
      id: `${customerOrder.orderNo}-${index}`,
      recordNo: customerOrder.orderNo,
      productNameSnapshot: item.name ?? '商品',
      specSnapshot: item.spec ?? null,
      quantity,
      unitPrice,
      lineAmount,
      saleType: 'SALE' as const,
    }
  })

  const subtotal = +rawItems.reduce((sum, item) => {
    const quantity = typeof item.quantity === 'number' ? item.quantity : 1
    const originalPrice = typeof item.originalPrice === 'number'
      ? item.originalPrice
      : typeof item.price === 'number' ? item.price : 0
    return sum + originalPrice * quantity
  }, 0).toFixed(2)
  const payableAmount = customerOrder.totalAmount.toNumber()
  const redemption = await prisma.couponRedemption.findFirst({
    where: {
      orderNo,
      tenantId: scope.tenantId,
      storeId: scope.storeId,
    },
    select: { discountAmount: true, couponId: true },
  })
  let discountAmount = +(subtotal - payableAmount).toFixed(2)
  if (!Number.isFinite(discountAmount) || discountAmount < 0) discountAmount = 0

  let couponName: string | null = null
  if (redemption?.couponId) {
    const coupon = await prisma.customerCoupon.findFirst({
      where: {
        id: redemption.couponId,
        tenantId: scope.tenantId,
        OR: [{ storeId: scope.storeId }, { storeId: null }],
      },
      select: { name: true },
    })
    couponName = coupon?.name ?? null
  }

  return {
    orderNo: customerOrder.orderNo,
    storeName: store.name,
    operatorDisplayName: '顾客自助下单',
    createdAt: customerOrder.createdAt.toISOString(),
    saleStatus: customerOrder.status,
    items,
    totalAmount: payableAmount,
    subtotal,
    discountAmount,
    payableAmount,
    couponName,
    orderSource: 'CUSTOMER_H5',
    paymentMethod: customerOrder.paymentMethod ?? null,
    paymentStatus: customerOrder.paymentStatus === 'PAID'
      ? 'PAID'
      : customerOrder.paymentStatus === 'UNPAID'
        ? 'PENDING'
        : customerOrder.paymentStatus,
    paidAt: customerOrder.paidAt?.toISOString() ?? null,
    cancelledAt: null,
    customerTelegramId: customerOrder.customerTelegramId,
    remark: customerOrder.remark,
    customerName: customerOrder.customerName,
    customerPhone: customerOrder.customerPhone,
    deliveryAddress: customerOrder.deliveryAddress,
    deliveryNote: customerOrder.deliveryNote,
    deliveryLat: customerOrder.deliveryLat,
    deliveryLng: customerOrder.deliveryLng,
    mapUrl: customerOrder.deliveryLat != null && customerOrder.deliveryLng != null
      ? `https://maps.google.com/?q=${customerOrder.deliveryLat},${customerOrder.deliveryLng}`
      : null,
    deliveryAddressPhotoUrl: customerOrder.deliveryAddressPhotoUrl ?? null,
  }
}
