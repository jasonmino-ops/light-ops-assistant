import { createHash } from 'node:crypto'
import { qzRawBytesToBase64 } from './qzEscPosBitImage'
import { ES_TRAY_MAX_COMMAND_BYTES } from './es-tray-relay/config'
import { canonicalV3PrintEffectKey } from './v3-print-identity'

/**
 * H5-only adapter. It emits the existing V3 CLOUD_H5/RAW_BYTES shape and does
 * not change the V2 renderer, the V3 adapter, or any device renderer.
 * Linux shaping and physical-device compatibility remain a separate Gate.
 */
export const CUSTOMER_ORDER_RENDERER_VERSION = 'h5-order-raw-text-v1'
// Production allowlist is intentionally empty until the independent
// Linux/CJK/Khmer/device Renderer Gate is closed. Test fixtures must not add
// versions here.
export const ALLOWED_CUSTOMER_ORDER_RENDERER_VERSIONS: readonly string[] = []
export type CustomerOrderPrintRole = 'FRONT' | 'KITCHEN'
export type CustomerOrderTicketPurpose = 'KITCHEN_MAKE' | 'FRONT_UNPAID' | 'FRONT_PAID'

/** Missing purpose means historical semantics, never an unpaid FRONT. */
export function customerOrderTicketPurpose(role: CustomerOrderPrintRole, purpose?: string | null): CustomerOrderTicketPurpose {
  const value = purpose ?? (role === 'KITCHEN' ? 'KITCHEN_MAKE' : 'FRONT_PAID')
  if ((role === 'KITCHEN' && value === 'KITCHEN_MAKE')
    || (role === 'FRONT' && (value === 'FRONT_UNPAID' || value === 'FRONT_PAID'))) return value
  throw new Error('CUSTOMER_ORDER_ROLE_PURPOSE_MISMATCH')
}
export type CustomerOrderPaymentMethod = 'CASH' | 'QR'

export type CustomerOrderPrintItem = {
  productId: string
  name: string
  spec: string | null
  originalPrice: number
  price: number
  quantity: number
  lineAmount: number
  sugar?: string
  /** Only explicit true is a kitchen route. Missing is legacy/no-route. */
  printKitchenTicket?: boolean
}

export type CustomerOrderPrintOrder = {
  tenantId: string
  storeId: string
  orderNo: string
  storeName: string
  currencyCode: string
  createdAt: Date
  paidAt: Date | null
  tableNo: string | null
  remark: string | null
  totalAmount: number
  paymentStatus: 'UNPAID' | 'PAID'
  paymentMethod: CustomerOrderPaymentMethod | null
  ticketPurpose?: CustomerOrderTicketPurpose
  items: CustomerOrderPrintItem[]
}

export type V3PrintIntent = {
  schemaVersion: 3
  printJobId: string
  source: 'CLOUD_H5'
  role: CustomerOrderPrintRole
  payloadKind: 'RAW_BYTES'
  orderNo: string
  rendererVersion: string
  payloadBase64: string
  byteLength: number
  payloadHash: string
}

export type SealedCustomerOrderBytes = Pick<V3PrintIntent, 'payloadBase64' | 'byteLength' | 'payloadHash' | 'rendererVersion'>
export type RendererRelease = { testProfileId?: string }

/** An internal dependency injection, never constructed from a worker request. */
export function customerOrderRendererReleased(profileId: string | null | undefined, runtime?: RendererRelease): boolean {
  if (!profileId || !/^[a-f0-9]{64}$/.test(profileId)) return false
  return ALLOWED_CUSTOMER_ORDER_RENDERER_VERSIONS.includes(profileId)
    || (process.env.NODE_ENV === 'test' && runtime?.testProfileId === profileId)
}

/** Strict grammar of the existing 576px ESC-* encoder, not a generic ESC/POS interpreter. */
export function validateCustomerOrderRaster(value: SealedCustomerOrderBytes): Buffer {
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > Math.min(3 * 1024 * 1024, ES_TRAY_MAX_COMMAND_BYTES)
    || typeof value.payloadBase64 !== 'string' || value.payloadBase64.length > 4 * Math.ceil(value.byteLength / 3)
    || !/^[a-f0-9]{64}$/.test(value.payloadHash) || !/^[a-f0-9]{64}$/.test(value.rendererVersion)) throw new Error('CUSTOMER_ORDER_RASTER_INVALID')
  const raw = Buffer.from(value.payloadBase64, 'base64')
  if (raw.length !== value.byteLength || raw.toString('base64') !== value.payloadBase64
    || createHash('sha256').update(raw).digest('hex') !== value.payloadHash) throw new Error('CUSTOMER_ORDER_RASTER_INTEGRITY')
  const header = Buffer.from([27, 64, 27, 51, 24])
  const footer = Buffer.from([27, 50, 27, 100, 3, 29, 86, 0])
  if (!raw.subarray(0, 5).equals(header) || !raw.subarray(-8).equals(footer)) throw new Error('CUSTOMER_ORDER_RASTER_GRAMMAR')
  const bandSize = 576 * 3 + 6
  const bands = (raw.length - 13) / bandSize
  if (!Number.isInteger(bands) || bands < 1 || bands > Math.ceil(16384 / 24)) throw new Error('CUSTOMER_ORDER_RASTER_DIMENSIONS')
  for (let offset = 5; offset < raw.length - 8; offset += bandSize) {
    if (!raw.subarray(offset, offset + 5).equals(Buffer.from([27, 42, 33, 64, 2])) || raw[offset + bandSize - 1] !== 10) {
      throw new Error('CUSTOMER_ORDER_RASTER_GRAMMAR')
    }
  }
  return raw
}

/** Canonical producer insertion order is the existing V3 requestHash contract. */
export function customerOrderEnvelopeFromSeal(
  order: CustomerOrderPrintOrder, role: CustomerOrderPrintRole, seal: SealedCustomerOrderBytes,
): V3PrintIntent {
  if (role !== 'FRONT' && role !== 'KITCHEN') throw new Error('CUSTOMER_ORDER_ROLE_INVALID')
  const purpose = customerOrderTicketPurpose(role, order.ticketPurpose)
  if (purpose === 'FRONT_PAID' && (order.paymentStatus !== 'PAID' || !order.paidAt || !['CASH', 'QR'].includes(order.paymentMethod ?? ''))) throw new Error('CUSTOMER_ORDER_FRONT_PAYMENT_REQUIRED')
  if (purpose === 'FRONT_UNPAID' && (order.paymentStatus !== 'UNPAID' || order.paymentMethod !== null || order.paidAt !== null)) throw new Error('CUSTOMER_ORDER_UNPAID_SNAPSHOT_INVALID')
  if (role === 'KITCHEN' && (order.paymentStatus !== 'UNPAID' || order.paymentMethod !== null || !kitchenItems(order).length)) throw new Error('CUSTOMER_ORDER_KITCHEN_SNAPSHOT_INVALID')
  validateCustomerOrderRaster(seal)
  return {
    schemaVersion: 3, printJobId: customerOrderPrintJobId(order, role, purpose), source: 'CLOUD_H5', role,
    payloadKind: 'RAW_BYTES', orderNo: order.orderNo, rendererVersion: seal.rendererVersion,
    payloadBase64: seal.payloadBase64, byteLength: seal.byteLength, payloadHash: seal.payloadHash,
  }
}

export function customerOrderSnapshot(intent: { snapshotJson: string; snapshotHash: string; tenantId: string; storeId: string; orderNo: string; role: string; purpose?: string; paymentIntentId?: string | null; schemaVersion: number; idempotencyKey: string }): CustomerOrderPrintOrder {
  if (typeof intent.snapshotJson !== 'string' || Buffer.byteLength(intent.snapshotJson) > 128 * 1024
    || createHash('sha256').update(intent.snapshotJson).digest('hex') !== intent.snapshotHash) throw new Error('CUSTOMER_ORDER_SNAPSHOT_HASH')
  const s = JSON.parse(intent.snapshotJson)
  const purpose = customerOrderTicketPurpose(intent.role as CustomerOrderPrintRole, intent.purpose)
  if (customerOrderTicketPurpose(intent.role as CustomerOrderPrintRole, s.ticketPurpose) !== purpose) throw new Error('CUSTOMER_ORDER_SNAPSHOT_PURPOSE')
  if (s.tenantId !== intent.tenantId || s.storeId !== intent.storeId || s.orderNo !== intent.orderNo || intent.schemaVersion !== 3
    || !['KITCHEN', 'FRONT'].includes(intent.role) || customerOrderPrintJobId(s, intent.role as CustomerOrderPrintRole, purpose) !== intent.idempotencyKey) throw new Error('CUSTOMER_ORDER_SNAPSHOT_IDENTITY')
  const order = customerOrderPrintOrder({ ...s, createdAt: new Date(s.createdAt), paidAt: s.paidAt ? new Date(s.paidAt) : null, itemsJson: JSON.stringify(s.items) })
  if (!Number.isFinite(order.createdAt.getTime()) || (order.paidAt && !Number.isFinite(order.paidAt.getTime()))) throw new Error('CUSTOMER_ORDER_SNAPSHOT_DATE')
  if (purpose === 'FRONT_PAID' && order.paymentStatus !== 'PAID') throw new Error('CUSTOMER_ORDER_FRONT_PAYMENT_REQUIRED')
  if (purpose === 'FRONT_UNPAID' && (s.ticketPurpose !== purpose || order.paymentStatus !== 'UNPAID'
    || order.paymentMethod !== null || order.paidAt !== null || intent.paymentIntentId != null)) throw new Error('CUSTOMER_ORDER_UNPAID_SNAPSHOT_INVALID')
  if (intent.role === 'KITCHEN' && (order.paymentStatus !== 'UNPAID' || order.paymentMethod !== null || !kitchenItems(order).length)) throw new Error('CUSTOMER_ORDER_KITCHEN_SNAPSHOT_INVALID')
  return { ...order, ticketPurpose: purpose }
}

function cleanText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u001b]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function money(value: number, currencyCode: string): string {
  return `${cleanText(currencyCode)} ${value.toFixed(2)}`
}

function itemLabel(item: CustomerOrderPrintItem): string {
  const options = [item.spec, item.sugar].filter(Boolean).map(cleanText).join('/')
  return options ? `${cleanText(item.name)} (${options})` : cleanText(item.name)
}

function escPosText(lines: string[]): Uint8Array {
  const body = `${lines.map(cleanText).join('\n')}\n\n\n`
  const bytes = Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x00]),
    Buffer.from(body, 'utf8'),
    Buffer.from([0x1d, 0x56, 0x00]),
  ])
  if (bytes.byteLength < 1 || bytes.byteLength > ES_TRAY_MAX_COMMAND_BYTES) {
    throw new Error('CUSTOMER_ORDER_PRINT_TOO_LARGE')
  }
  return new Uint8Array(bytes)
}

export function kitchenItems(order: Pick<CustomerOrderPrintOrder, 'items'>): CustomerOrderPrintItem[] {
  return order.items.filter((item) => item.printKitchenTicket === true)
}

export type CustomerOrderKitchenDisposition = 'REQUIRED' | 'NOT_REQUIRED' | 'MANUAL_REVIEW'

/**
 * A missing route marker is legacy ambiguity, not proof that every item belongs
 * to the kitchen.  Only an explicit boolean snapshot can make this decision.
 */
export function customerOrderKitchenDisposition(
  order: Pick<CustomerOrderPrintOrder, 'items'>,
  kitchenEnabled: boolean,
): CustomerOrderKitchenDisposition {
  if (!kitchenEnabled) return 'NOT_REQUIRED'
  if (order.items.some((item) => typeof item.printKitchenTicket !== 'boolean')) return 'MANUAL_REVIEW'
  return kitchenItems(order).length > 0 ? 'REQUIRED' : 'NOT_REQUIRED'
}

export function customerOrderPrintJobId(
  order: Pick<CustomerOrderPrintOrder, 'tenantId' | 'storeId' | 'orderNo'>,
  role: CustomerOrderPrintRole,
  ticketPurpose?: CustomerOrderTicketPurpose,
): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(order.tenantId)) throw new Error('CUSTOMER_ORDER_TENANT_INVALID')
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(order.storeId)) throw new Error('CUSTOMER_ORDER_STORE_INVALID')
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(order.orderNo)) throw new Error('CUSTOMER_ORDER_NO_INVALID')
  const purpose = customerOrderTicketPurpose(role, ticketPurpose)
  const digest = createHash('sha256')
    .update(purpose === 'FRONT_UNPAID' ? `h5-front-unpaid-v1:${order.orderNo}` : canonicalV3PrintEffectKey(order.orderNo, role))
    .digest('hex')
  return `network:${digest}`
}

export function buildCustomerOrderPrintIntent(
  order: CustomerOrderPrintOrder,
  role: CustomerOrderPrintRole,
): V3PrintIntent {
  if (customerOrderTicketPurpose(role, order.ticketPurpose) === 'FRONT_UNPAID') throw new Error('CUSTOMER_ORDER_UNPAID_TEXT_RENDERER_UNSUPPORTED')
  const items = role === 'KITCHEN' ? kitchenItems(order) : order.items
  if (role === 'KITCHEN' && items.length === 0) throw new Error('CUSTOMER_ORDER_KITCHEN_ITEMS_EMPTY')
  if (role === 'FRONT') {
    if (order.paymentStatus !== 'PAID' || !order.paymentMethod) throw new Error('CUSTOMER_ORDER_FRONT_PAYMENT_REQUIRED')
    if (!order.paidAt) throw new Error('CUSTOMER_ORDER_FRONT_PAYMENT_TIME_REQUIRED')
  }

  const printTime = role === 'FRONT' ? order.paidAt! : order.createdAt
  const lines = [
    role === 'KITCHEN' ? '店小二 KITCHEN 制作单' : '店小二 FRONT 收款凭证',
    `门店: ${order.storeName}`,
    `单号: ${order.orderNo}`,
    ...(order.tableNo ? [`桌号: ${order.tableNo}`] : []),
    `时间: ${printTime.toISOString()}`,
    '--------------------------------',
    ...items.flatMap((item) => [
      itemLabel(item),
      `  x${item.quantity}   ${money(item.lineAmount, order.currencyCode)}`,
    ]),
    '--------------------------------',
    `合计: ${money(order.totalAmount, order.currencyCode)}`,
  ]

  if (role === 'KITCHEN') {
    lines.splice(4, 0, '付款状态: UNPAID')
  } else {
    lines.splice(4, 0, '付款状态: PAID', `付款方式: ${order.paymentMethod === 'QR' ? 'KHQR' : 'CASH'}`)
  }
  if (order.remark) lines.push(`备注: ${cleanText(order.remark)}`)

  const bytes = escPosText(lines)
  return {
    schemaVersion: 3,
    printJobId: customerOrderPrintJobId(order, role),
    source: 'CLOUD_H5',
    role,
    payloadKind: 'RAW_BYTES',
    orderNo: order.orderNo,
    rendererVersion: CUSTOMER_ORDER_RENDERER_VERSION,
    payloadBase64: qzRawBytesToBase64(bytes),
    byteLength: bytes.byteLength,
    payloadHash: createHash('sha256').update(bytes).digest('hex'),
  }
}

function parseItems(itemsJson: string): CustomerOrderPrintItem[] {
  let parsed: unknown
  try { parsed = JSON.parse(itemsJson) } catch { throw new Error('CUSTOMER_ORDER_ITEMS_INVALID') }
  if (!Array.isArray(parsed)) throw new Error('CUSTOMER_ORDER_ITEMS_INVALID')
  return parsed.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_ORDER_ITEMS_INVALID')
    const item = value as Record<string, unknown>
    if (
      typeof item.productId !== 'string'
      || typeof item.name !== 'string'
      || typeof item.quantity !== 'number'
      || !Number.isInteger(item.quantity)
      || item.quantity <= 0
      || typeof item.price !== 'number'
      || typeof item.lineAmount !== 'number'
      || !Number.isFinite(item.price)
      || item.price < 0
      || !Number.isFinite(item.lineAmount)
      || item.lineAmount < 0
    ) throw new Error('CUSTOMER_ORDER_ITEMS_INVALID')
    const originalPrice = typeof item.originalPrice === 'number' ? item.originalPrice : item.price
    if (!Number.isFinite(originalPrice) || originalPrice < 0) throw new Error('CUSTOMER_ORDER_ITEMS_INVALID')
    return {
      productId: item.productId,
      name: item.name,
      spec: typeof item.spec === 'string' ? item.spec : null,
      originalPrice,
      price: item.price,
      quantity: item.quantity,
      lineAmount: item.lineAmount,
      ...(typeof item.sugar === 'string' ? { sugar: item.sugar } : {}),
      ...(typeof item.printKitchenTicket === 'boolean' ? { printKitchenTicket: item.printKitchenTicket } : {}),
    }
  })
}

export function customerOrderPrintOrder(input: {
  tenantId: string
  storeId: string
  orderNo: string
  storeName: string
  currencyCode: string
  createdAt: Date
  paidAt: Date | null
  tableNo: string | null
  remark: string | null
  totalAmount: { toNumber(): number } | number
  paymentStatus: string
  paymentMethod: string | null
  itemsJson: string
}): CustomerOrderPrintOrder {
  if (input.paymentStatus !== 'UNPAID' && input.paymentStatus !== 'PAID') throw new Error('CUSTOMER_ORDER_PAYMENT_STATUS_INVALID')
  if (input.paymentMethod !== null && input.paymentMethod !== 'CASH' && input.paymentMethod !== 'QR') {
    throw new Error('CUSTOMER_ORDER_PAYMENT_METHOD_INVALID')
  }
  if (input.paymentStatus === 'UNPAID' && input.paymentMethod !== null) {
    throw new Error('CUSTOMER_ORDER_UNPAID_PAYMENT_METHOD_INVALID')
  }
  if (input.paymentStatus === 'PAID' && input.paymentMethod === null) {
    throw new Error('CUSTOMER_ORDER_PAID_PAYMENT_METHOD_REQUIRED')
  }
  if (input.paymentStatus === 'PAID' && input.paidAt === null) {
    throw new Error('CUSTOMER_ORDER_FRONT_PAYMENT_TIME_REQUIRED')
  }
  const totalAmount = typeof input.totalAmount === 'number' ? input.totalAmount : input.totalAmount.toNumber()
  if (!Number.isFinite(totalAmount) || totalAmount < 0) throw new Error('CUSTOMER_ORDER_TOTAL_INVALID')
  return {
    tenantId: input.tenantId,
    storeId: input.storeId,
    orderNo: input.orderNo,
    storeName: input.storeName,
    currencyCode: input.currencyCode,
    createdAt: input.createdAt,
    paidAt: input.paidAt,
    tableNo: input.tableNo,
    remark: input.remark,
    totalAmount,
    paymentStatus: input.paymentStatus as 'UNPAID' | 'PAID',
    paymentMethod: input.paymentMethod as CustomerOrderPaymentMethod | null,
    items: parseItems(input.itemsJson),
  }
}
