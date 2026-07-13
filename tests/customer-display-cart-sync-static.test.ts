import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dispatchCashierCartTotalChanged, CASHIER_CART_TOTAL_CHANGED_EVENT } from '../lib/customer-display-cart-event'

const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const bridge = fs.readFileSync('app/desktop/pos/UsbCustomerDisplayBridge.tsx', 'utf8')
const eventHelper = fs.readFileSync('lib/customer-display-cart-event.ts', 'utf8')

assert.match(cashier, /dispatchCashierCartTotalChanged/, 'CashierPage should publish cart total events')
assert.match(cashier, /window\.location\.pathname === '\/desktop\/pos' && params\.get\('mode'\) === 'pos'/, 'cart events should only publish from Desktop POS mode=pos')
assert.match(cashier, /totalAmount = cart\.length > 0 \? cartTotal\(cart\) : 0/, 'cart event amount should come from cartTotal(cart)')
assert.match(cashier, /itemCount: cartCount\(cart\)/, 'cart event item count should come from cartCount(cart)')
assert.match(cashier, /reason: cart\.length > 0 \? 'cart' : 'clear'/, 'empty cart should publish clear reason')
assert.match(cashier, /reason: 'final'/, 'checkout confirmation should publish final reason')
assert.doesNotMatch(cashier, /customer-display-adapter/, 'CashierPage must not import serial adapter')

assert.match(bridge, /CASHIER_CART_TOTAL_CHANGED_EVENT/, 'USB bridge should listen to cart total event')
assert.match(bridge, /USB_CUSTOMER_DISPLAY_CART_DEBOUNCE_MS = 75/, 'cart updates should use light debounce')
assert.match(bridge, /displaySequenceRef/, 'bridge should use sequence guard for latest amount')
assert.match(bridge, /pendingAmountRef/, 'bridge should track pending amount for duplicate suppression')
assert.match(bridge, /hasActiveCartRef/, 'bridge should track active cart state')
assert.match(bridge, /latestCartAmountRef/, 'bridge should track latest cart amount')
assert.match(bridge, /lastCartEventAtRef/, 'bridge should track latest cart event timestamp')
assert.match(bridge, /statusRef\.current !== 'connected'/, 'bridge should ignore cart writes while disconnected')
assert.match(bridge, /detail\.reason === 'clear'/, 'bridge should clear on empty cart event')
assert.match(bridge, /detail\.reason === 'final'/, 'bridge should prioritize final amount events')
assert.match(bridge, /session\.status === 'COMPLETED'[\s\S]*USB_CUSTOMER_DISPLAY_COMPLETED_LINGER_MS/, 'PosSession completed fallback should still delay clear')
assert.match(bridge, /if \(!session\) \{\s*if \(hasActiveCartRef\.current\) return[\s\S]*await clearOnce\(\)/, 'null session should not clear an active cart amount')
assert.match(bridge, /if \(session\.status === 'DRAFT'\) \{\s*if \(hasActiveCartRef\.current\) return[\s\S]*await clearOnce\(\)/, 'DRAFT session should not clear an active cart amount')
assert.match(bridge, /if \(session\.status === 'CANCELLED'\) \{[\s\S]*markNoActiveCart\(\)[\s\S]*await clearOnce\(\)/, 'CANCELLED should clear even when cart state exists')
assert.match(bridge, /function isStaleAgainstActiveCart/, 'AWAITING_PAYMENT fallback should guard stale totals against active cart')
assert.match(bridge, /sessionAmountKey !== cartAmountKey && sessionUpdatedAtMs <= lastCartEventAtRef\.current/, 'old PosSession amount should not overwrite latest cart amount')
assert.match(bridge, /function handleManualClear\(\)/, 'manual clear should remain available')
assert.match(bridge, /next\.signature === lastSuccessfulSignatureRef\.current/, 'final PosSession fallback should dedupe by signature')

assert.match(eventHelper, /window\.dispatchEvent/, 'event helper should dispatch a browser CustomEvent')
assert.match(eventHelper, /console\.warn\('\[cashier:cart-total\] event dispatch failed'/, 'event helper should isolate dispatch failures')

const originalWindow = globalThis.window
let dispatchedType = ''
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    dispatchEvent(event: CustomEvent) {
      dispatchedType = event.type
      return true
    },
  },
})
dispatchCashierCartTotalChanged({
  storeCode: 'STORE-A',
  totalAmount: 12.5,
  itemCount: 1,
  updatedAt: '2026-07-13T00:00:00.000Z',
  reason: 'cart',
})
assert.equal(dispatchedType, CASHIER_CART_TOTAL_CHANGED_EVENT)

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    dispatchEvent() {
      throw new Error('listener failed')
    },
  },
})
const originalWarn = console.warn
console.warn = () => undefined
assert.doesNotThrow(() => dispatchCashierCartTotalChanged({
  storeCode: 'STORE-A',
  totalAmount: 0,
  itemCount: 0,
  updatedAt: '2026-07-13T00:00:00.000Z',
  reason: 'clear',
}))
console.warn = originalWarn

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: originalWindow,
})

console.log('customer display cart sync static tests passed')
