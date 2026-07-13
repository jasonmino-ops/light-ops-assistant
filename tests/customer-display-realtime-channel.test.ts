import assert from 'node:assert/strict'
import {
  buildCustomerDisplayRealtimeGuard,
  createCustomerDisplayRealtimeChannel,
  publishCustomerDisplayRealtimeMessage,
  shouldApplyCustomerDisplayRealtimeMessage,
  shouldIgnoreServerSessionAfterRealtime,
  type CustomerDisplayRealtimeMessage,
} from '../lib/customer-display-realtime-channel'

const snapshot: CustomerDisplayRealtimeMessage = {
  type: 'CART_SNAPSHOT',
  storeCode: 'STORE-A',
  sentAt: '2026-07-13T01:00:01.000Z',
  sequence: 2,
  items: [{
    productId: 'p1',
    name: 'Iced Coffee',
    spec: null,
    imageUrl: null,
    price: 2.5,
    qty: 2,
    lineAmount: 5,
  }],
  totalAmount: 5,
  itemCount: 2,
  currencyCode: 'USD',
  status: 'DRAFT',
  paymentMethod: null,
  paymentStatus: null,
}

let published: unknown = null
const fakeChannel = {
  postMessage(message: unknown) {
    published = message
  },
} as BroadcastChannel

assert.equal(publishCustomerDisplayRealtimeMessage(fakeChannel, snapshot), true)
assert.deepEqual(published, snapshot, 'cashier should publish the complete cart snapshot')

const guard = buildCustomerDisplayRealtimeGuard(snapshot, Date.parse('2026-07-13T01:00:01.100Z'))
assert.equal(shouldApplyCustomerDisplayRealtimeMessage(guard, { ...snapshot, storeCode: 'STORE-B', sequence: 3 }, 'STORE-A'), false)
assert.equal(shouldApplyCustomerDisplayRealtimeMessage(guard, { ...snapshot, sequence: 1 }, 'STORE-A'), false)
assert.equal(shouldApplyCustomerDisplayRealtimeMessage(guard, { ...snapshot, sequence: 2, sentAt: '2026-07-13T01:00:00.000Z' }, 'STORE-A'), false)
assert.equal(shouldApplyCustomerDisplayRealtimeMessage(guard, { ...snapshot, sequence: 3 }, 'STORE-A'), true)

const currentSession = {
  status: 'DRAFT',
  items: snapshot.items,
  totalAmount: 5,
  itemCount: 2,
  updatedAt: snapshot.sentAt,
}

assert.equal(
  shouldIgnoreServerSessionAfterRealtime(currentSession, null, guard, Date.parse('2026-07-13T01:00:02.000Z')),
  true,
  'null session should not clear a recent non-empty realtime cart',
)
assert.equal(
  shouldIgnoreServerSessionAfterRealtime(currentSession, {
    status: 'DRAFT',
    items: [],
    totalAmount: 0,
    itemCount: 0,
    updatedAt: '2026-07-13T01:00:00.000Z',
  }, guard, Date.parse('2026-07-13T01:00:02.000Z')),
  true,
  'old DRAFT should not clear a recent non-empty realtime cart',
)
assert.equal(
  shouldIgnoreServerSessionAfterRealtime(currentSession, {
    status: 'AWAITING_PAYMENT',
    items: snapshot.items,
    totalAmount: 5,
    itemCount: 2,
    updatedAt: '2026-07-13T01:00:03.000Z',
  }, guard, Date.parse('2026-07-13T01:00:04.000Z')),
  false,
  'newer server fallback should still recover and update the display',
)

const clearMessage: CustomerDisplayRealtimeMessage = {
  ...snapshot,
  type: 'CLEAR',
  sequence: 4,
  sentAt: '2026-07-13T01:00:04.000Z',
  items: [],
  totalAmount: 0,
  itemCount: 0,
  status: 'DRAFT',
}
const clearGuard = buildCustomerDisplayRealtimeGuard(clearMessage, Date.parse('2026-07-13T01:00:04.100Z'))
assert.equal(
  shouldIgnoreServerSessionAfterRealtime(null, currentSession, clearGuard, Date.parse('2026-07-13T01:00:05.000Z')),
  true,
  'explicit CLEAR should not be immediately overwritten by an older active DRAFT poll',
)

assert.equal(createCustomerDisplayRealtimeChannel(), null, 'BroadcastChannel fallback should be inert without a browser window')

console.log('customer display realtime channel tests passed')
