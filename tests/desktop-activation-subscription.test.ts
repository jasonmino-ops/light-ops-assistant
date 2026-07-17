import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  computeDesktopSubscriptionAccess,
  isDesktopSubscriptionAllowed,
} from '../lib/desktop-activation/subscription-access'

assert.deepEqual(computeDesktopSubscriptionAccess('TRIAL'), {
  accessState: 'ALLOWED',
  status: 'TRIAL',
  warning: null,
})
assert.deepEqual(computeDesktopSubscriptionAccess('ACTIVE'), {
  accessState: 'ALLOWED',
  status: 'ACTIVE',
  warning: null,
})
assert.deepEqual(computeDesktopSubscriptionAccess('EXPIRED'), {
  accessState: 'BLOCKED',
  status: 'EXPIRED',
  warning: null,
})
assert.deepEqual(computeDesktopSubscriptionAccess('CANCELLED'), {
  accessState: 'BLOCKED',
  status: 'CANCELLED',
  warning: null,
})
assert.deepEqual(computeDesktopSubscriptionAccess('UNKNOWN'), {
  accessState: 'BLOCKED',
  status: 'UNKNOWN',
  warning: null,
})

assert.equal(isDesktopSubscriptionAllowed(computeDesktopSubscriptionAccess('TRIAL')), true)
assert.equal(isDesktopSubscriptionAllowed(computeDesktopSubscriptionAccess('ACTIVE')), true)
assert.equal(isDesktopSubscriptionAllowed(computeDesktopSubscriptionAccess('EXPIRED')), false)
assert.equal(isDesktopSubscriptionAllowed(computeDesktopSubscriptionAccess('CANCELLED')), false)

const helperSource = fs.readFileSync('lib/desktop-activation/subscription-access.ts', 'utf8')
assert.doesNotMatch(helperSource, /GRACE/, 'EP-MB3-06A must not introduce GRACE access without an existing policy')

console.log('desktop activation subscription tests passed')
