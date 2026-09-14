import assert from 'node:assert/strict'
import { parseConfirmedCashierNetworkRoles } from '../lib/es-tray-relay/cashier-network-confirmation'

const queued = (mode: 'FRONT_ONLY' | 'SHARED_PRINTER', roles: Array<'FRONT' | 'KITCHEN'>) => ({
  profile: 'network-v2',
  mode,
  state: 'QUEUED',
  kitchenJobSuppressed: false,
  jobs: roles.map((role, index) => ({ role, jobId: `job-${index}` })),
})

assert.deepEqual(parseConfirmedCashierNetworkRoles(queued('FRONT_ONLY', ['FRONT']), 'FRONT_ONLY'), ['FRONT'])
assert.deepEqual(
  parseConfirmedCashierNetworkRoles(queued('SHARED_PRINTER', ['FRONT', 'KITCHEN']), 'SHARED_PRINTER'),
  ['FRONT', 'KITCHEN'],
)

const suppressed = {
  ...queued('SHARED_PRINTER', ['FRONT']),
  kitchenJobSuppressed: true,
}
assert.deepEqual(parseConfirmedCashierNetworkRoles(suppressed, 'SHARED_PRINTER'), ['FRONT'])

assert.equal(parseConfirmedCashierNetworkRoles(queued('SHARED_PRINTER', ['FRONT']), 'SHARED_PRINTER'), null)
assert.equal(
  parseConfirmedCashierNetworkRoles({ ...suppressed, jobs: [{ role: 'FRONT' }, { role: 'KITCHEN' }] }, 'SHARED_PRINTER'),
  null,
)
assert.equal(parseConfirmedCashierNetworkRoles(suppressed, 'FRONT_ONLY'), null)
assert.equal(
  parseConfirmedCashierNetworkRoles({ ...suppressed, kitchenJobSuppressed: 'true' }, 'SHARED_PRINTER'),
  null,
)

console.log('cashier network enqueue confirmation: 7 cases passed')
