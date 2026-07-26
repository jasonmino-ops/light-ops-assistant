import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  readQzPrintEnabled,
  writeQzPrintEnabled,
  readQzSelectedPrinter,
  writeQzSelectedPrinter,
  clearLegacyGlobalQzConfig,
} from '../lib/cashier-qz-config'

class FakeLocalStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  keys() {
    return Array.from(this.store.keys())
  }
}

const fakeLocalStorage = new FakeLocalStorage()
Object.assign(globalThis, { localStorage: fakeLocalStorage })

const STORE_A = 'STORE-A'
const STORE_B = 'STORE-B'

function resetStorage() {
  fakeLocalStorage.keys().forEach((key) => fakeLocalStorage.removeItem(key))
}

function testDifferentStoresUseDifferentKeys() {
  resetStorage()
  writeQzPrintEnabled(STORE_A, true)
  writeQzSelectedPrinter(STORE_A, 'POS-80-A')
  writeQzPrintEnabled(STORE_B, false)

  const keys = fakeLocalStorage.keys()
  assert.ok(keys.some((k) => k.includes(STORE_A)), 'Store A must have its own key')
  assert.ok(keys.every((k) => !k.includes(STORE_A) || k.endsWith(STORE_A)), 'Store A key must be suffixed, not shared')
  assert.notEqual(
    keys.find((k) => k.includes('qzPrintEnabled') && k.endsWith(STORE_A)),
    keys.find((k) => k.includes('qzPrintEnabled') && k.endsWith(STORE_B)),
    'each store must use a distinct storage key',
  )
}

function testStoreAEnabledNotVisibleInStoreB() {
  resetStorage()
  writeQzPrintEnabled(STORE_A, true)
  assert.equal(readQzPrintEnabled(STORE_A), true)
  assert.equal(readQzPrintEnabled(STORE_B), false, 'Store B must not inherit Store A enabled state')
}

function testStoreAPrinterNotVisibleInStoreB() {
  resetStorage()
  writeQzSelectedPrinter(STORE_A, 'Printer POS-80')
  assert.equal(readQzSelectedPrinter(STORE_A), 'Printer POS-80')
  assert.equal(readQzSelectedPrinter(STORE_B), null, 'Store B must not inherit Store A printer selection')
}

function testSwitchingBackRestoresStoreAValues() {
  resetStorage()
  writeQzPrintEnabled(STORE_A, true)
  writeQzSelectedPrinter(STORE_A, 'Printer A')

  // Simulate switching to Store B and configuring it differently.
  writeQzPrintEnabled(STORE_B, true)
  writeQzSelectedPrinter(STORE_B, 'Printer B')

  // Switching back to Store A must restore exactly Store A's own values.
  assert.equal(readQzPrintEnabled(STORE_A), true)
  assert.equal(readQzSelectedPrinter(STORE_A), 'Printer A')
}

function testUnrelatedStoreDefaultsAreSafe() {
  resetStorage()
  // A store that has never been configured must read as disabled / no
  // printer, never as "missing storeCode" behavior and never another
  // store's values.
  assert.equal(readQzPrintEnabled('STORE-NEVER-CONFIGURED'), false)
  assert.equal(readQzSelectedPrinter('STORE-NEVER-CONFIGURED'), null)
}

function testLegacyGlobalKeysAreRemovedAndNeverRead() {
  resetStorage()
  fakeLocalStorage.setItem('cashier:qzPrintEnabled', '1')
  fakeLocalStorage.setItem('cashier:qzPrintPrinter', 'Legacy Printer')

  clearLegacyGlobalQzConfig()

  assert.equal(fakeLocalStorage.getItem('cashier:qzPrintEnabled'), null, 'legacy enabled key must be removed')
  assert.equal(fakeLocalStorage.getItem('cashier:qzPrintPrinter'), null, 'legacy printer key must be removed')

  // Even before cleanup runs, no store-scoped read must ever surface the
  // legacy global value.
  resetStorage()
  fakeLocalStorage.setItem('cashier:qzPrintEnabled', '1')
  fakeLocalStorage.setItem('cashier:qzPrintPrinter', 'Legacy Printer')
  assert.equal(readQzPrintEnabled(STORE_A), false, 'a store must never read the legacy global enabled key')
  assert.equal(readQzSelectedPrinter(STORE_A), null, 'a store must never read the legacy global printer key')
}

function testCashierPageGuardsWritesOnStoreCodeAndResetsOnChange() {
  const source = fs.readFileSync('app/cashier/page.tsx', 'utf8')

  assert.match(
    source,
    /if\s*\(storeCode\)\s*\{\s*try\s*\{\s*writeQzPrintEnabled\(storeCode,\s*next\)/,
    'enabling/disabling QZ must be guarded on a known storeCode before writing',
  )
  assert.match(
    source,
    /if\s*\(storeCode\)\s*\{\s*try\s*\{\s*writeQzSelectedPrinter\(storeCode,\s*next\)/,
    'selecting a QZ printer must be guarded on a known storeCode before writing',
  )
  assert.match(
    source,
    /setQzPrintEnabled\(false\)\s*\n\s*setQzStatus\('idle'\)\s*\n\s*setQzPrinters\(\[\]\)\s*\n\s*setQzSelectedPrinter\(null\)/,
    'switching storeCode must reset in-memory QZ state before loading the new store config',
  )
  assert.match(
    source,
    /if\s*\(!storeCode\)\s*return\s*\n\s*try\s*\{\s*setQzPrintEnabled\(readQzPrintEnabled\(storeCode\)\)/,
    'QZ config must only be loaded from storage once storeCode is known',
  )
  assert.match(
    source,
    /clearLegacyGlobalQzConfig\(\)/,
    'the legacy global QZ keys must be cleaned up on load',
  )
}

async function run() {
  testDifferentStoresUseDifferentKeys()
  testStoreAEnabledNotVisibleInStoreB()
  testStoreAPrinterNotVisibleInStoreB()
  testSwitchingBackRestoresStoreAValues()
  testUnrelatedStoreDefaultsAreSafe()
  testLegacyGlobalKeysAreRemovedAndNeverRead()
  testCashierPageGuardsWritesOnStoreCodeAndResetsOnChange()
  console.log('qz store isolation tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})
