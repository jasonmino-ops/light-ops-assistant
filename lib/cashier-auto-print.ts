/**
 * Persistent, local-POS at-most-once gate for automatic receipt printing.
 *
 * The browser/renderer that owns the physical printer records the claim before
 * opening the print dialog. A failed automatic dialog therefore remains
 * fail-closed; staff can always use the explicit manual reprint control.
 */
export const CASHIER_AUTO_PRINT_RECEIPT_PREFIX = 'cashier:autoPrintedReceipt:'

type PersistentStore = Pick<Storage, 'getItem' | 'setItem'>

export function cashierAutoPrintReceiptKey(storeCode: string, orderNo: string) {
  return `${CASHIER_AUTO_PRINT_RECEIPT_PREFIX}${storeCode}:${orderNo}`
}

export function claimCashierAutoPrint(
  storage: PersistentStore,
  input: { storeCode: string; orderNo: string },
) {
  if (!input.storeCode || !input.orderNo) return false
  try {
    const key = cashierAutoPrintReceiptKey(input.storeCode, input.orderNo)
    if (storage.getItem(key) === '1') return false
    storage.setItem(key, '1')
    // Storage can be unavailable or write-restricted. Do not auto-print when a
    // durable claim cannot be verified; manual reprint remains available.
    return storage.getItem(key) === '1'
  } catch {
    return false
  }
}
