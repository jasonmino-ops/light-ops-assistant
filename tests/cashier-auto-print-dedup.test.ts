import assert from 'node:assert/strict'
import {
  cashierAutoPrintReceiptKey,
  claimCashierAutoPrint,
} from '../lib/cashier-auto-print'

class MemoryStorage {
  constructor(private readonly values = new Map<string, string>()) {}

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  remount() {
    return new MemoryStorage(this.values)
  }
}

const storeCode = 'AUTO-PRINT-STORE'
const orderNo = 'S-AUTO-PRINT-001'
const storage = new MemoryStorage()

assert.equal(claimCashierAutoPrint(storage, { storeCode, orderNo }), true,
  'first result delivery may claim one automatic print')
assert.equal(claimCashierAutoPrint(storage, { storeCode, orderNo }), false,
  'same result delivery must not claim a second automatic print')
assert.equal(claimCashierAutoPrint(storage.remount(), { storeCode, orderNo }), false,
  'reload or Desktop renderer remount must retain the automatic print claim')
assert.equal(claimCashierAutoPrint(storage, { storeCode, orderNo: 'S-AUTO-PRINT-002' }), true,
  'a distinct order remains eligible for one automatic print')
assert.equal(cashierAutoPrintReceiptKey(storeCode, orderNo).includes(orderNo), true,
  'persistent automatic-print identity must include the stable order number')

console.log('cashier persistent auto-print dedup tests passed')
