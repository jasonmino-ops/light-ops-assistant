import assert from 'node:assert/strict'
import fs from 'node:fs'

const service = fs.readFileSync('lib/desktop-activation/service.ts', 'utf8')
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const revokeDeviceRoute = fs.readFileSync('app/api/desktop/devices/[id]/revoke/route.ts', 'utf8')
const auth = fs.readFileSync('lib/desktop-activation/auth.ts', 'utf8')

assert.match(
  service,
  /SELECT "id" FROM "DesktopActivationPin" WHERE "storeId" = \$\{input\.store\.id\} AND "activeSlot" = 'ACTIVE' FOR UPDATE/,
  'activation should lock the active PIN row before consuming it',
)
assert.match(
  service,
  /SELECT "id" FROM "DesktopDevice" WHERE "installationIdHash" = \$\{installationIdHash\} AND "activeSlot" = 'ACTIVE' FOR UPDATE/,
  'activation should lock the active installation row before device reuse/create',
)
assert.match(schema, /@@unique\(\[storeId, activeSlot\]\)/, 'store active PIN uniqueness should be enforced in the database')
assert.match(schema, /@@unique\(\[installationIdHash, activeSlot\]\)/, 'active installation uniqueness should be enforced in the database')

assert.match(service, /activationPin\.failedAttempts \+ 1/, 'wrong PIN attempts should be counted')
assert.match(service, /DESKTOP_ACTIVATION_PIN_MAX_FAILED_ATTEMPTS/, 'PIN lock threshold should be centralized')
assert.match(service, /getActivationPinLockedUntil\(now\)/, 'PIN lockout should set lockedUntil')
assert.match(service, /return lockedUntil[\s\S]*\?[\s\S]*failure\(423, 'PIN_LOCKED'/, 'fifth failed PIN attempt should lock the PIN')

assert.match(service, /activeDevice && activeDevice\.storeId !== input\.store\.id/, 'same installation cannot move across stores while active')
assert.match(service, /INSTALLATION_BOUND_TO_OTHER_STORE/, 'cross-store duplicate installation should return a conflict')
assert.match(service, /status:\s*'USED'[\s\S]*activeSlot:\s*null[\s\S]*usedByDeviceId:\s*device\.id/, 'successful activation should atomically consume PIN')

assert.match(service, /tokenHash:\s*tokenBundle\.tokenHash[\s\S]*tokenHashVersion:\s*tokenBundle\.tokenHashVersion[\s\S]*tokenVersion:\s*\{ increment: 1 \}/, 'same-store reactivation should rotate token and increment credential version')
assert.doesNotMatch(service, /tokenHashVersion:\s*\{ increment: 1 \}/, 'tokenHashVersion must remain an algorithm version, not a rotation counter')
assert.match(service, /eventType: activeDevice \? 'DEVICE_REACTIVATED' : 'DEVICE_ACTIVATED'/, 'reactivation should be audited')
assert.match(service, /eventType:\s*'TOKEN_ROTATED'/, 'token rotation should be audited')
assert.match(service, /credentialVersion:\s*device\.tokenVersion/, 'audit metadata should expose credentialVersion')

assert.match(service, /latestRevokedDevice[\s\S]*replacesDeviceId: latestRevokedDevice\?\.id \?\? null/, 'new activation after revoked device should link replacement identity')
assert.match(revokeDeviceRoute, /status:\s*'REVOKED'[\s\S]*activeSlot:\s*null/, 'device revoke should make the active installation slot reusable')
assert.doesNotMatch(revokeDeviceRoute, /tokenHash:\s*null|tokenHash:\s*undefined/, 'device revoke must retain tokenHash on the revoked record')
assert.match(auth, /device\.status !== 'ACTIVE'[\s\S]*DESKTOP_DEVICE_REVOKED/, 'revoked token verification must fail')

assert.match(service, /isP2002\(error\)[\s\S]*CONFLICT_RETRY_REQUIRED/, 'database uniqueness races should surface as retryable conflicts')
assert.match(revokeDeviceRoute, /FOR UPDATE/, 'device revoke should lock device identity before status transition')

console.log('desktop activation concurrency static tests passed')
