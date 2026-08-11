export const STORE_RUNTIME_TASK_SCHEMA_VERSION = 1 as const
export const STORE_RUNTIME_RECEIPT_SCHEMA_VERSION = '1' as const
export const STORE_RUNTIME_TASK_TYPE = 'PRINT_RECEIPT' as const
export const STORE_RUNTIME_PRINTER_TARGET_TYPE = 'WINDOWS_QUEUE' as const
export const STORE_RUNTIME_MAX_RECEIPT_ITEMS = 200
export const STORE_RUNTIME_MAX_PAYLOAD_BYTES = 24 * 1024

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/
const PRINTER_NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,160}$/

export type StoreRuntimeReceiptItem = {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type StoreRuntimeReceipt = {
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
  items: StoreRuntimeReceiptItem[]
  subtotal: number
  discount?: number
  total: number
  paymentMethod?: string
  amountReceived?: number
  change?: number
  footer?: string
  language?: string
}

export type StoreRuntimePrintTaskCreateInput = {
  taskType: 'PRINT_RECEIPT'
  schemaVersion: 1
  idempotencyKey: string
  receipt: StoreRuntimeReceipt
}

export type StoreRuntimePrinterBindingInput = {
  targetType: 'WINDOWS_QUEUE'
  printerName: string
  enabled: boolean
}

export type StoreRuntimeTaskProgressInput =
  | { state: 'EXECUTING' }
  | {
      state: 'SUCCEEDED' | 'FAILED'
      resultCode: string
      message?: string
      effectBoundary: 'NOT_CROSSED' | 'CROSSING_UNKNOWN' | 'CROSSED'
      physicalCompletionKnown: boolean
    }

export class StoreRuntimeContractError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'StoreRuntimeContractError'
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  }
}

function requiredText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  }
  rejectUnsafeReceiptText(value)
  return value
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, maxLength)
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  }
  return value
}

function optionalFinite(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  return finiteNumber(value)
}

function rejectUnsafeReceiptText(value: string) {
  const lowered = value.toLowerCase()
  if (/<\/?[a-z][\s\S]*>/i.test(value)) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  if (lowered.includes('<style') || lowered.includes('font-family') || lowered.includes('javascript:')) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  }
  if (/https?:\/\//i.test(value) || /file:\/\//i.test(value)) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  if (/[a-z]:\\/i.test(value) || value.includes('/Users/') || value.includes('/home/')) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  }
  if (/\b(token|authorization|bearer)\b/i.test(value)) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
}

export function parseStoreRuntimeReceipt(value: unknown): StoreRuntimeReceipt {
  const receipt = objectValue(value)
  exactKeys(
    receipt,
    ['schemaVersion', 'receiptId', 'storeName', 'storeCode', 'timestamp', 'currencyCode', 'items', 'subtotal', 'total'],
    ['saleId', 'orderNumber', 'address', 'cashierName', 'discount', 'paymentMethod', 'amountReceived', 'change', 'footer', 'language'],
  )
  if (receipt.schemaVersion !== STORE_RUNTIME_RECEIPT_SCHEMA_VERSION) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RECEIPT_VERSION')
  }
  if (!Array.isArray(receipt.items) || receipt.items.length < 1 || receipt.items.length > STORE_RUNTIME_MAX_RECEIPT_ITEMS) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  }
  const items = receipt.items.map((raw) => {
    const item = objectValue(raw)
    exactKeys(item, ['name', 'quantity', 'unitPrice', 'lineTotal'])
    const quantity = finiteNumber(item.quantity)
    if (quantity <= 0) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
    return {
      name: requiredText(item.name, 160),
      quantity,
      unitPrice: finiteNumber(item.unitPrice),
      lineTotal: finiteNumber(item.lineTotal),
    }
  })
  const parsed: StoreRuntimeReceipt = {
    schemaVersion: STORE_RUNTIME_RECEIPT_SCHEMA_VERSION,
    receiptId: requiredText(receipt.receiptId, 80),
    storeName: requiredText(receipt.storeName, 120),
    storeCode: requiredText(receipt.storeCode, 80),
    timestamp: requiredText(receipt.timestamp, 80),
    currencyCode: requiredText(receipt.currencyCode, 12),
    items,
    subtotal: finiteNumber(receipt.subtotal),
    total: finiteNumber(receipt.total),
  }
  const optionalStrings: Array<[keyof StoreRuntimeReceipt, unknown, number]> = [
    ['saleId', receipt.saleId, 80],
    ['orderNumber', receipt.orderNumber, 80],
    ['address', receipt.address, 320],
    ['cashierName', receipt.cashierName, 80],
    ['paymentMethod', receipt.paymentMethod, 40],
    ['footer', receipt.footer, 320],
    ['language', receipt.language, 16],
  ]
  for (const [key, raw, limit] of optionalStrings) {
    const text = optionalText(raw, limit)
    if (text !== undefined) Object.assign(parsed, { [key]: text })
  }
  const optionalNumbers: Array<[keyof StoreRuntimeReceipt, unknown]> = [
    ['discount', receipt.discount],
    ['amountReceived', receipt.amountReceived],
    ['change', receipt.change],
  ]
  for (const [key, raw] of optionalNumbers) {
    const number = optionalFinite(raw)
    if (number !== undefined) Object.assign(parsed, { [key]: number })
  }
  if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > STORE_RUNTIME_MAX_PAYLOAD_BYTES) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_PAYLOAD_TOO_LARGE')
  }
  return parsed
}

export function parseStoreRuntimePrintTaskCreateInput(value: unknown): StoreRuntimePrintTaskCreateInput {
  const task = objectValue(value)
  exactKeys(task, ['taskType', 'schemaVersion', 'idempotencyKey', 'receipt'])
  if (task.taskType !== STORE_RUNTIME_TASK_TYPE || task.schemaVersion !== STORE_RUNTIME_TASK_SCHEMA_VERSION) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_UNSUPPORTED_TASK')
  }
  if (typeof task.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(task.idempotencyKey)) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_IDEMPOTENCY_KEY')
  }
  return {
    taskType: STORE_RUNTIME_TASK_TYPE,
    schemaVersion: STORE_RUNTIME_TASK_SCHEMA_VERSION,
    idempotencyKey: task.idempotencyKey,
    receipt: parseStoreRuntimeReceipt(task.receipt),
  }
}

export function parseStoreRuntimePrinterBindingInput(value: unknown): StoreRuntimePrinterBindingInput {
  const binding = objectValue(value)
  exactKeys(binding, ['targetType', 'printerName', 'enabled'])
  if (binding.targetType !== STORE_RUNTIME_PRINTER_TARGET_TYPE || typeof binding.enabled !== 'boolean') {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PRINTER_BINDING')
  }
  if (typeof binding.printerName !== 'string' || binding.printerName !== binding.printerName.trim() || !PRINTER_NAME_PATTERN.test(binding.printerName)) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PRINTER_BINDING')
  }
  return {
    targetType: STORE_RUNTIME_PRINTER_TARGET_TYPE,
    printerName: binding.printerName,
    enabled: binding.enabled,
  }
}

export function parseStoreRuntimeTaskProgressInput(value: unknown): StoreRuntimeTaskProgressInput {
  const progress = objectValue(value)
  if (progress.state === 'EXECUTING') {
    exactKeys(progress, ['state'])
    return { state: 'EXECUTING' }
  }
  exactKeys(progress, ['state', 'resultCode', 'effectBoundary', 'physicalCompletionKnown'], ['message'])
  if (progress.state !== 'SUCCEEDED' && progress.state !== 'FAILED') {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RESULT')
  }
  if (!['NOT_CROSSED', 'CROSSING_UNKNOWN', 'CROSSED'].includes(String(progress.effectBoundary))) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RESULT')
  }
  // The Windows queue/provider boundary cannot prove paper output. V1 must never
  // turn queue acceptance into a false physical-completion confirmation.
  if (progress.physicalCompletionKnown !== false) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RESULT')
  }
  const resultCode = requiredText(progress.resultCode, 80)
  const message = optionalText(progress.message, 500)
  return {
    state: progress.state,
    resultCode,
    ...(message ? { message } : {}),
    effectBoundary: progress.effectBoundary as 'NOT_CROSSED' | 'CROSSING_UNKNOWN' | 'CROSSED',
    physicalCompletionKnown: progress.physicalCompletionKnown,
  }
}
