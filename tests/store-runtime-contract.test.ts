import assert from 'node:assert/strict'
import {
  parseStoreRuntimePrintTaskCreateInput,
  parseStoreRuntimePrinterBindingInput,
  parseStoreRuntimeTaskProgressInput,
  StoreRuntimeContractError,
} from '../lib/store-runtime/contract'

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1',
    receiptId: 'receipt-contract-001',
    storeName: '中 English ខ្មែរ',
    storeCode: 'STORE-A',
    timestamp: '2026-08-11T00:00:00.000Z',
    currencyCode: 'USD',
    items: [{ name: '咖啡 / Coffee / កាហ្វេ', quantity: 1, unitPrice: 2.5, lineTotal: 2.5 }],
    subtotal: 2.5,
    total: 2.5,
    ...overrides,
  }
}

function expectContractError(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof StoreRuntimeContractError && error.code === code)
}

const task = parseStoreRuntimePrintTaskCreateInput({
  taskType: 'PRINT_RECEIPT',
  schemaVersion: 1,
  idempotencyKey: 'receipt:contract-001',
  receipt: receipt(),
})
assert.equal(task.taskType, 'PRINT_RECEIPT')
assert.equal(task.receipt.items[0].name, '咖啡 / Coffee / កាហ្វេ')

expectContractError(() => parseStoreRuntimePrintTaskCreateInput({
  taskType: 'RUN_SCRIPT',
  schemaVersion: 1,
  idempotencyKey: 'receipt:contract-001',
  receipt: receipt(),
}), 'STORE_RUNTIME_UNSUPPORTED_TASK')

expectContractError(() => parseStoreRuntimePrintTaskCreateInput({
  taskType: 'PRINT_RECEIPT',
  schemaVersion: 1,
  idempotencyKey: 'short',
  receipt: receipt(),
}), 'STORE_RUNTIME_INVALID_IDEMPOTENCY_KEY')

expectContractError(() => parseStoreRuntimePrintTaskCreateInput({
  taskType: 'PRINT_RECEIPT',
  schemaVersion: 1,
  idempotencyKey: 'receipt:unsafe-001',
  receipt: receipt({ footer: '<script>steal()</script>' }),
}), 'STORE_RUNTIME_INVALID_PAYLOAD')

assert.deepEqual(parseStoreRuntimePrinterBindingInput({
  targetType: 'WINDOWS_QUEUE',
  printerName: 'EPSON TM-T82',
  enabled: true,
}), { targetType: 'WINDOWS_QUEUE', printerName: 'EPSON TM-T82', enabled: true })

expectContractError(() => parseStoreRuntimePrinterBindingInput({
  targetType: 'TCP_9100',
  printerName: '192.168.1.20',
  enabled: true,
}), 'STORE_RUNTIME_INVALID_PRINTER_BINDING')

assert.deepEqual(parseStoreRuntimeTaskProgressInput({
  state: 'SUCCEEDED',
  resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
  effectBoundary: 'CROSSED',
  physicalCompletionKnown: false,
}), {
  state: 'SUCCEEDED',
  resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
  effectBoundary: 'CROSSED',
  physicalCompletionKnown: false,
})

expectContractError(() => parseStoreRuntimeTaskProgressInput({
  state: 'SUCCEEDED',
  resultCode: 'PRINTED',
  effectBoundary: 'CROSSED',
  physicalCompletionKnown: true,
}), 'STORE_RUNTIME_INVALID_RESULT')

console.log('Store Runtime contract tests passed')
