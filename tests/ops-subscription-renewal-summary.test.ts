import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  attachOpsSubscriptionReminders,
  getOpsRenewalDueTenants,
} from '../lib/ops-subscription-renewal-summary'
import { computeSubscriptionReminder } from '../lib/subscription-reminder'

const NOW = new Date('2026-08-19T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function atDaysFromNow(days: number) {
  return new Date(NOW.getTime() + days * DAY_MS)
}

function subscription(tenantId: string, expiry: Date | null) {
  return {
    tenantId,
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEndsAt: expiry,
  }
}

const tenantRows = [
  { id: 'tenant-normal', name: 'Normal', storeCount: 1 },
  { id: 'tenant-remind', name: 'Remind', storeCount: 2 },
  { id: 'tenant-grace', name: 'Grace', storeCount: 1 },
  { id: 'tenant-expired', name: 'Expired', storeCount: 1 },
  { id: 'tenant-legacy', name: 'Legacy', storeCount: 3 },
]
const attached = attachOpsSubscriptionReminders(tenantRows, [
  subscription('tenant-expired', atDaysFromNow(-3)),
  subscription('tenant-normal', atDaysFromNow(16)),
  subscription('tenant-grace', atDaysFromNow(-2)),
  subscription('tenant-remind', atDaysFromNow(15)),
  subscription('tenant-legacy', null),
], NOW)

assert.equal(attached.find((row) => row.id === 'tenant-normal')?.subscriptionReminder.displayState, 'NORMAL')
assert.equal(attached.find((row) => row.id === 'tenant-remind')?.subscriptionReminder.displayState, 'REMIND')
assert.equal(attached.find((row) => row.id === 'tenant-grace')?.subscriptionReminder.displayState, 'GRACE')
assert.equal(attached.find((row) => row.id === 'tenant-expired')?.subscriptionReminder.displayState, 'EXPIRED')
assert.equal(attached.find((row) => row.id === 'tenant-legacy')?.subscriptionReminder.displayState, 'NORMAL')

const due = getOpsRenewalDueTenants(attached)
assert.deepEqual(due.map((row) => row.id), ['tenant-remind', 'tenant-grace', 'tenant-expired'])
assert.equal(due.find((row) => row.id === 'tenant-remind')?.storeCount, 2, 'a multi-store Tenant must remain one summary row')

const exactBoundaryRows = attachOpsSubscriptionReminders([
  { id: 'exact-remind', name: 'Exact 15 days' },
  { id: 'exact-expired', name: 'Exact 3 days' },
], [
  subscription('exact-remind', atDaysFromNow(15)),
  subscription('exact-expired', atDaysFromNow(-3)),
], NOW)
assert.equal(exactBoundaryRows[0].subscriptionReminder.displayState, 'REMIND')
assert.equal(exactBoundaryRows[1].subscriptionReminder.displayState, 'EXPIRED')
assert.equal(getOpsRenewalDueTenants(exactBoundaryRows).length, 2)

const deduplicated = getOpsRenewalDueTenants([attached[1], { ...attached[1], storeCount: 9 }])
assert.equal(deduplicated.length, 1, 'duplicate Store-derived rows must not duplicate the Tenant summary')

const tenantIsolationRows = attachOpsSubscriptionReminders([
  { id: 'tenant-a', name: 'A' },
  { id: 'tenant-b', name: 'B' },
], [
  subscription('tenant-b', atDaysFromNow(40)),
  subscription('tenant-a', atDaysFromNow(2)),
], NOW)
assert.equal(tenantIsolationRows[0].subscriptionReminder.displayState, 'REMIND')
assert.equal(tenantIsolationRows[0].subscriptionReminder.expiry, atDaysFromNow(2).toISOString())
assert.equal(tenantIsolationRows[1].subscriptionReminder.displayState, 'NORMAL')
assert.equal(tenantIsolationRows[1].subscriptionReminder.expiry, atDaysFromNow(40).toISOString())

const renewedRows = attachOpsSubscriptionReminders(
  [{ id: 'tenant-renewed', name: 'Renewed' }],
  [subscription('tenant-renewed', atDaysFromNow(45))],
  NOW,
)
assert.equal(renewedRows[0].subscriptionReminder.displayState, 'NORMAL')
assert.equal(getOpsRenewalDueTenants(renewedRows).length, 0, 'renewed Tenant should leave the summary on the next read')

const ownerState = computeSubscriptionReminder(subscription('same-tenant', atDaysFromNow(-1)), NOW)
const opsState = attachOpsSubscriptionReminders(
  [{ id: 'same-tenant', name: 'Same Tenant' }],
  [subscription('same-tenant', atDaysFromNow(-1))],
  NOW,
)[0].subscriptionReminder
assert.deepEqual(opsState, ownerState, 'OWNER and Ops must use the same evaluator result')

const opsTenantsApi = fs.readFileSync('app/api/ops/tenants/route.ts', 'utf8')
const opsPage = fs.readFileSync('app/ops/page.tsx', 'utf8')
const opsSummaryHelper = fs.readFileSync('lib/ops-subscription-renewal-summary.ts', 'utf8')
const ownerReminderApi = fs.readFileSync('app/api/subscription/reminder/route.ts', 'utf8')
const tenantDetailPage = fs.readFileSync('app/ops/[tenantId]/page.tsx', 'utf8')

assert.match(opsTenantsApi, /tenantSubscription\.findMany\(\{[\s\S]*tenantId: \{ in: ids \}/, 'Ops query must stay inside the returned Tenant set')
assert.match(opsTenantsApi, /attachOpsSubscriptionReminders\(tenantRows, subscriptions, reminderNow\)/)
assert.match(opsSummaryHelper, /computeSubscriptionReminder\(/, 'Ops must call the shared evaluator')
assert.match(ownerReminderApi, /computeSubscriptionReminder\(/, 'OWNER must call the shared evaluator')
assert.doesNotMatch(opsTenantsApi + opsPage + opsSummaryHelper, /15\s*\*\s*24|3\s*\*\s*24/, 'Ops must not copy the date-window algorithm')
assert.match(opsPage, /label="待续费商家"[\s\S]*renewalDueTenants\.length/)
assert.match(opsPage, /apiFetch\(url, \{ cache: 'no-store' \}, OWNER_CTX\)/, 'each /ops read must recompute the runtime summary')
assert.match(opsPage, /href=\{`\/ops\/\$\{tenant\.id\}`\}/, 'summary item must enter the existing Tenant detail')
assert.match(tenantDetailPage, /确认收款并续费/, 'existing renewal entry must remain intact')
assert.doesNotMatch(opsPage, /subscription\/renew/, 'the /ops summary must not add a renewal form or call the renewal API')

console.log('ops subscription renewal summary tests passed')
