import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  CURRENT_DESKTOP_VERSION,
  currentPinStatus,
  deriveDesktopManagementStatus,
  desktopAuditCategory,
  desktopAuditEventLabel,
  shortDeviceReference,
} from '../lib/ops-desktop-management'

const now = new Date('2026-07-20T04:00:00.000Z')
const future = new Date('2026-07-21T04:00:00.000Z')

assert.equal(deriveDesktopManagementStatus({
  sourceStatus: 'REVOKED',
  tenantStatus: 'ACTIVE',
  storeStatus: 'ACTIVE',
  subscriptionAccessState: 'ALLOWED',
  tokenExpiresAt: future,
  lastSeenAt: now,
  now,
}), 'REVOKED')

assert.equal(deriveDesktopManagementStatus({
  sourceStatus: 'ACTIVE',
  tenantStatus: 'ACTIVE',
  storeStatus: 'ACTIVE',
  subscriptionAccessState: 'BLOCKED',
  tokenExpiresAt: future,
  lastSeenAt: now,
  now,
}), 'BLOCKED')

assert.equal(deriveDesktopManagementStatus({
  sourceStatus: 'ACTIVE',
  tenantStatus: 'ACTIVE',
  storeStatus: 'ACTIVE',
  subscriptionAccessState: 'ALLOWED',
  tokenExpiresAt: future,
  lastSeenAt: new Date('2026-07-18T00:00:00.000Z'),
  now,
}), 'OFFLINE')

assert.equal(deriveDesktopManagementStatus({
  sourceStatus: 'ACTIVE',
  tenantStatus: 'ACTIVE',
  storeStatus: 'ACTIVE',
  subscriptionAccessState: 'ALLOWED',
  tokenExpiresAt: future,
  lastSeenAt: new Date('2026-07-20T03:59:00.000Z'),
  now,
}), 'ACTIVE')

assert.equal(currentPinStatus(null, now), 'NONE')
assert.equal(currentPinStatus({ status: 'ACTIVE', expiresAt: new Date('2026-07-20T03:59:00.000Z') }, now), 'EXPIRED')
assert.equal(currentPinStatus({ status: 'USED', expiresAt: future }, now), 'USED')
assert.equal(shortDeviceReference('cm-device-abc12345'), 'ABC12345')
assert.equal(desktopAuditEventLabel('PIN_CREATED'), 'PIN Issued')
assert.equal(desktopAuditEventLabel('DEVICE_ACTIVATED'), 'Activation Success')
assert.equal(desktopAuditEventLabel('ACTIVATION_DENIED', 'SUBSCRIPTION_BLOCKED'), 'Subscription Blocked')
assert.equal(desktopAuditCategory('DEVICE_REVOKED'), 'REVOCATION')

const desktopPackage = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8'))
assert.equal(CURRENT_DESKTOP_VERSION, desktopPackage.version, 'console target version must match desktop/package.json')

console.log('ops desktop management domain tests passed')
