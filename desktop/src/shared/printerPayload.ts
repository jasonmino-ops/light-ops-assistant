export const RUNTIME_RECEIPT_SCHEMA_VERSION = '1'
export const MAX_RECEIPT_ITEMS = 200
export const MAX_RUNTIME_RECEIPT_PAYLOAD_BYTES = 24 * 1024

export type RuntimeReceiptItemPayload = {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type RuntimeReceiptPayload = {
  schemaVersion: '1'
  receiptId: string
  saleId?: string
  orderNumber?: string
  storeName: string
  storeCode: string
  address?: string
  cashierName?: string
  timestamp: string
  currencyCode: string
  items: RuntimeReceiptItemPayload[]
  subtotal: number
  discount?: number
  total: number
  paymentMethod?: string
  amountReceived?: number
  change?: number
  footer?: string
  language?: string
}

export function validateRuntimeReceiptPayload(value: unknown): asserts value is RuntimeReceiptPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PRINT_RECEIPT')
  const receipt = value as Partial<RuntimeReceiptPayload>
  if (receipt.schemaVersion !== RUNTIME_RECEIPT_SCHEMA_VERSION) throw new Error('INVALID_PRINT_RECEIPT')
  requireText(receipt.receiptId, 80)
  requireText(receipt.storeName, 120)
  requireText(receipt.storeCode, 80)
  requireText(receipt.timestamp, 80)
  requireText(receipt.currencyCode, 12)
  optionalText(receipt.saleId, 80)
  optionalText(receipt.orderNumber, 80)
  optionalText(receipt.address, 320)
  optionalText(receipt.cashierName, 80)
  optionalText(receipt.paymentMethod, 40)
  optionalText(receipt.footer, 320)
  optionalText(receipt.language, 16)
  if (!Array.isArray(receipt.items) || receipt.items.length < 1 || receipt.items.length > MAX_RECEIPT_ITEMS) {
    throw new Error('INVALID_PRINT_RECEIPT')
  }
  for (const item of receipt.items) validateItem(item)
  requireFinite(receipt.subtotal)
  requireFinite(receipt.total)
  optionalFinite(receipt.discount)
  optionalFinite(receipt.amountReceived)
  optionalFinite(receipt.change)
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > MAX_RUNTIME_RECEIPT_PAYLOAD_BYTES) {
    throw new Error('INVALID_PRINT_RECEIPT_OVERSIZED')
  }
}

function validateItem(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PRINT_RECEIPT')
  const item = value as Partial<RuntimeReceiptItemPayload>
  requireText(item.name, 160)
  requireFinite(item.quantity)
  requireFinite(item.unitPrice)
  requireFinite(item.lineTotal)
  if ((item.quantity ?? 0) <= 0) throw new Error('INVALID_PRINT_RECEIPT')
}

function requireText(value: unknown, maxLength: number): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw new Error('INVALID_PRINT_RECEIPT')
  rejectUnsafeText(value)
}

function optionalText(value: unknown, maxLength: number): void {
  if (value === undefined || value === null || value === '') return
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('INVALID_PRINT_RECEIPT')
  rejectUnsafeText(value)
}

function requireFinite(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('INVALID_PRINT_RECEIPT')
}

function optionalFinite(value: unknown): void {
  if (value === undefined || value === null) return
  requireFinite(value)
}

function rejectUnsafeText(value: string): void {
  const lowered = value.toLowerCase()
  if (/<\/?[a-z][\s\S]*>/i.test(value)) throw new Error('INVALID_PRINT_RECEIPT')
  if (lowered.includes('<style') || lowered.includes('font-family') || lowered.includes('javascript:')) throw new Error('INVALID_PRINT_RECEIPT')
  if (/https?:\/\//i.test(value) || /file:\/\//i.test(value)) throw new Error('INVALID_PRINT_RECEIPT')
  if (/[a-z]:\\/i.test(value) || value.includes('/Users/') || value.includes('/home/')) throw new Error('INVALID_PRINT_RECEIPT')
  if (lowered.includes('token') || lowered.includes('authorization')) throw new Error('INVALID_PRINT_RECEIPT')
}
