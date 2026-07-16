import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dispatchCashierCartTotalChanged, CASHIER_CART_TOTAL_CHANGED_EVENT } from '../lib/customer-display-cart-event'

const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const bridge = fs.readFileSync('app/desktop/pos/UsbCustomerDisplayBridge.tsx', 'utf8')
const display = fs.readFileSync('app/desktop/display/page.tsx', 'utf8')
const eventHelper = fs.readFileSync('lib/customer-display-cart-event.ts', 'utf8')
const realtimeHelper = fs.readFileSync('lib/customer-display-realtime-channel.ts', 'utf8')

assert.match(cashier, /dispatchCashierCartTotalChanged/, 'CashierPage should publish cart total events')
assert.match(cashier, /publishCustomerDisplayRealtimeMessage/, 'CashierPage should publish local realtime display snapshots')
assert.match(cashier, /window\.location\.pathname === '\/desktop\/pos' && params\.get\('mode'\) === 'pos'/, 'cart events should only publish from Desktop POS mode=pos')
assert.match(cashier, /totalAmount = cart\.length > 0 \? cartTotal\(cart\) : 0/, 'cart event amount should come from cartTotal(cart)')
assert.match(cashier, /itemCount: cartCount\(cart\)/, 'cart event item count should come from cartCount(cart)')
assert.match(cashier, /reason: cart\.length > 0 \? 'cart' : 'clear'/, 'empty cart should publish clear reason')
assert.match(cashier, /reason: 'final'/, 'checkout confirmation should publish final reason')
assert.match(cashier, /items,\s*[\r\n\s]*totalAmount,\s*[\r\n\s]*itemCount: cartCount\(input\.cartSnapshot\),\s*[\r\n\s]*currencyCode/, 'realtime channel should send a full cart snapshot')
assert.match(cashier, /customerDisplayRealtimeChannelRef\.current = null[\s\S]*channel\?\.close\(\)/, 'cashier realtime channel should close on unmount')
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
assert.doesNotMatch(bridge, /customer-display-realtime-channel/, 'USB bridge should not depend on web display realtime channel')

assert.match(display, /createCustomerDisplayRealtimeChannel/, 'Desktop display should subscribe to local realtime channel')
assert.match(display, /shouldApplyCustomerDisplayRealtimeMessage\(realtimeGuardRef\.current, message, storeCode\)/, 'Desktop display should isolate realtime messages by storeCode and sequence')
assert.match(display, /shouldIgnoreStaleDisplayResponse\(current\?\.session \?\? null, body\.session, realtimeGuardRef\.current\)/, 'Desktop display should guard poll results after realtime messages')
assert.match(display, /channel\.onmessage = null[\s\S]*channel\.close\(\)/, 'Desktop display realtime channel should close on unmount')
assert.match(display, /message\.type === 'CLEAR'[\s\S]*session: null/, 'Desktop display should accept explicit CLEAR messages')
assert.match(display, /const image = new Image\(\)[\s\S]*setPreloadedStoreKhqr\(\{ storeCode, url: storeKhqrImageSrc, ready: true \}\)/, 'Desktop display should preload the current store KHQR image before instant fallback display')
assert.match(display, /preloadedStoreKhqr\?\.storeCode === storeCode[\s\S]*preloadedStoreKhqr\.url === storeKhqrImageSrc/, 'Desktop display should bind preloaded KHQR readiness to the current storeCode and URL')
assert.match(display, /sessionKhqrImageSrc \?\? \(isKhqrSession \|\| !session \? storeKhqrImageSrc : null\)/, 'KHQR payment sessions should fall back to the ready current-store static KHQR image')

assert.match(cashier, /if \(syncKey === lastCashierDisplaySyncKey\.current\) return/, 'manual cashier display sync should suppress duplicate POSTs by syncKey')
assert.match(cashier, /const inFlightCashierDisplaySyncKey = useRef\(''\)/, 'cashier display sync should track in-flight keys separately from successful keys')
assert.match(cashier, /if \(syncKey === inFlightCashierDisplaySyncKey\.current\) return/, 'same cashier display sync key should be deduped while a request is in flight')
assert.match(cashier, /return false[\s\S]*return true[\s\S]*catch\(\(e\) => \{[\s\S]*return false/, 'display-session POST helper should report 2xx success and non-2xx/network failure')
assert.match(cashier, /postCashierDisplaySession\(input\)\.then\(\(ok\) => \{[\s\S]*if \(inFlightCashierDisplaySyncKey\.current !== syncKey\) return[\s\S]*inFlightCashierDisplaySyncKey\.current = ''[\s\S]*if \(ok\) lastCashierDisplaySyncKey\.current = syncKey/, 'successful sync key should only be recorded after the matching POST succeeds')
assert.match(cashier, /\.catch\(\(\) => \{[\s\S]*if \(inFlightCashierDisplaySyncKey\.current === syncKey\) \{[\s\S]*inFlightCashierDisplaySyncKey\.current = ''/, 'thrown sync failures should release the in-flight key for retry')
assert.doesNotMatch(cashier, /const syncCurrentCartToCustomerDisplay[\s\S]*lastCashierDisplaySyncKey\.current = syncKey[\s\S]*postCashierDisplaySession\(/, 'manual sync must not record the successful key before issuing the POST')
assert.match(cashier, /message: displayPayment === 'KHQR'[\s\S]*CUSTOMER_DISPLAY_KHQR_FOCUS_MESSAGE[\s\S]*: '请扫码支付'[\s\S]*: null/, 'KHQR focus message should remain part of the sync key')
assert.match(cashier, /inFlightCashierDisplaySyncKey\.current = ''[\s\S]*setCart\(\[\]\)/, 'new order reset should clear in-flight sync state before clearing the cart')
assert.match(cashier, /syncCurrentCartToCustomerDisplay\(method\)/, 'selecting CASH should sync CASH state instead of forcing KHQR display-session sync')
assert.doesNotMatch(cashier, /if \(method === 'KHQR'\)[\s\S]{0,180}syncCurrentCartToCustomerDisplay\('KHQR'\)\s*\n\s*\}/, 'non-KHQR desktop payment selection must not force KHQR sync')

assert.match(eventHelper, /window\.dispatchEvent/, 'event helper should dispatch a browser CustomEvent')
assert.match(eventHelper, /console\.warn\('\[cashier:cart-total\] event dispatch failed'/, 'event helper should isolate dispatch failures')
assert.match(realtimeHelper, /BroadcastChannel/, 'realtime helper should use BroadcastChannel')
assert.match(realtimeHelper, /typeof window === 'undefined' \|\| typeof BroadcastChannel === 'undefined'/, 'realtime helper should degrade when BroadcastChannel is unavailable')
assert.match(realtimeHelper, /message\.storeCode !== storeCode/, 'realtime helper should reject cross-store messages')
assert.match(realtimeHelper, /message\.sequence < current\.sequence/, 'realtime helper should reject old sequence messages')
assert.match(realtimeHelper, /next\.status === 'DRAFT'/, 'realtime helper should prevent old DRAFT poll results from overriding local cart snapshots')

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
