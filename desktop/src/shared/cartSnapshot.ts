/**
 * E-Shop Desktop — 购物车快照 IPC 契约（类型 + 运行时校验 + 防倒序守卫）
 *
 * 结构与 Web 层 lib/customer-display-realtime-channel.ts 的
 * CustomerDisplayRealtimeMessage 保持一致（Desktop 是旁路转发者，
 * 不是契约拥有者；Web 契约冻结，Desktop 侧独立声明避免跨界 import）。
 */

export type CartSnapshotItem = {
  productId: string
  name: string
  spec: string | null
  imageUrl?: string | null
  price: number
  qty: number
  lineAmount: number
}

export type CartSnapshotStatus = 'DRAFT' | 'AWAITING_PAYMENT' | 'COMPLETED' | 'CANCELLED'

export type CartSnapshotMessage = {
  type: 'CART_SNAPSHOT' | 'CLEAR'
  storeCode: string
  sentAt: string
  sequence: number
  items: CartSnapshotItem[]
  totalAmount: number
  itemCount: number
  currencyCode: string
  status: CartSnapshotStatus
  paymentMethod: 'CASH' | 'KHQR' | null
  paymentStatus: 'PENDING' | 'PAID' | null
}

const STATUSES: readonly string[] = ['DRAFT', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED']
const PAYMENT_METHODS: readonly (string | null)[] = ['CASH', 'KHQR', null]
const PAYMENT_STATUSES: readonly (string | null)[] = ['PENDING', 'PAID', null]

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isValidItem(v: unknown): v is CartSnapshotItem {
  if (!v || typeof v !== 'object') return false
  const item = v as Partial<CartSnapshotItem>
  return typeof item.productId === 'string'
    && typeof item.name === 'string'
    && (item.spec === null || typeof item.spec === 'string')
    && (item.imageUrl === undefined || item.imageUrl === null || typeof item.imageUrl === 'string')
    && isFiniteNumber(item.price)
    && isFiniteNumber(item.qty)
    && isFiniteNumber(item.lineAmount)
}

export type ValidationResult =
  | { ok: true; message: CartSnapshotMessage }
  | { ok: false; reason: string }

/** Main 进程权威校验：拒绝任何结构不合法的 payload。允许额外字段（如 relay 标记）。 */
export function validateCartSnapshotMessage(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not-an-object' }
  const m = value as Partial<CartSnapshotMessage>
  if (m.type !== 'CART_SNAPSHOT' && m.type !== 'CLEAR') return { ok: false, reason: 'bad-type' }
  if (typeof m.storeCode !== 'string' || m.storeCode.length === 0 || m.storeCode.length > 64) {
    return { ok: false, reason: 'bad-storeCode' }
  }
  if (typeof m.sentAt !== 'string' || !Number.isFinite(Date.parse(m.sentAt))) {
    return { ok: false, reason: 'bad-sentAt' }
  }
  if (!isFiniteNumber(m.sequence) || m.sequence < 0) return { ok: false, reason: 'bad-sequence' }
  if (!Array.isArray(m.items) || m.items.length > 500 || !m.items.every(isValidItem)) {
    return { ok: false, reason: 'bad-items' }
  }
  if (!isFiniteNumber(m.totalAmount) || !isFiniteNumber(m.itemCount)) {
    return { ok: false, reason: 'bad-amounts' }
  }
  if (typeof m.currencyCode !== 'string' || m.currencyCode.length > 8) {
    return { ok: false, reason: 'bad-currency' }
  }
  if (typeof m.status !== 'string' || !STATUSES.includes(m.status)) return { ok: false, reason: 'bad-status' }
  if (!PAYMENT_METHODS.includes((m.paymentMethod ?? null) as string | null)) return { ok: false, reason: 'bad-paymentMethod' }
  if (!PAYMENT_STATUSES.includes((m.paymentStatus ?? null) as string | null)) return { ok: false, reason: 'bad-paymentStatus' }
  return {
    ok: true,
    message: {
      type: m.type,
      storeCode: m.storeCode,
      sentAt: m.sentAt,
      sequence: m.sequence,
      items: m.items as CartSnapshotItem[],
      totalAmount: m.totalAmount,
      itemCount: m.itemCount,
      currencyCode: m.currencyCode,
      status: m.status as CartSnapshotStatus,
      paymentMethod: (m.paymentMethod ?? null) as CartSnapshotMessage['paymentMethod'],
      paymentStatus: (m.paymentStatus ?? null) as CartSnapshotMessage['paymentStatus'],
    },
  }
}

export type SnapshotGuard = {
  sequence: number
  sentAtMs: number
}

/**
 * 防倒序守卫：仅接受更新的快照。
 * 规则与 Web 层 shouldApplyCustomerDisplayRealtimeMessage 对齐：
 * sequence 更大 → 接受；sequence 相同且 sentAt 更新 → 接受；否则拒绝。
 */
export function isNewerSnapshot(current: SnapshotGuard | null, message: CartSnapshotMessage): boolean {
  const sentAtMs = Date.parse(message.sentAt)
  if (!Number.isFinite(sentAtMs)) return false
  if (!current) return true
  if (message.sequence < current.sequence) return false
  if (message.sequence === current.sequence && sentAtMs <= current.sentAtMs) return false
  return true
}

export function buildSnapshotGuard(message: CartSnapshotMessage): SnapshotGuard {
  return { sequence: message.sequence, sentAtMs: Date.parse(message.sentAt) || Date.now() }
}
