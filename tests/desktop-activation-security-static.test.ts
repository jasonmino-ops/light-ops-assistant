import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

function read(file: string) {
  return fs.readFileSync(file, 'utf8')
}

function filesUnder(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath]
  })
}

const desktopApiFiles = filesUnder('app/api/desktop').filter((file) => file.endsWith('.ts'))
const helperFiles = filesUnder('lib/desktop-activation').filter((file) => file.endsWith('.ts'))
const newSourceFiles = [...desktopApiFiles, ...helperFiles]

for (const file of newSourceFiles) {
  const source = read(file)
  assert.doesNotMatch(source, /desktop-pos-auth|authorizeDesktopPosRequest|allowStoreCodeFallback/, `${file} must not use legacy POS auth`)
  assert.doesNotMatch(source, /\bOperationLog\b|\boperationLog\b/, `${file} must not write activation secrets to OperationLog`)
  assert.doesNotMatch(source, /console\./, `${file} must not log activation or token material`)
}

for (const file of desktopApiFiles) {
  const source = read(file)
  assert.doesNotMatch(source, /NextResponse\.json/, `${file} must use noStoreJson/apiError`)
  assert.match(source, /noStoreJson|apiError/, `${file} must produce Cache-Control: no-store responses`)
  assert.match(source, /withDesktopApiError/, `${file} must map unexpected exceptions to INTERNAL_ERROR`)
}

const cryptoSource = read('lib/desktop-activation/crypto.ts')
assert.doesNotMatch(cryptoSource, /AUTH_SECRET/, 'desktop activation secrets must not fall back to AUTH_SECRET')
assert.match(cryptoSource, /DESKTOP_DEVICE_TOKEN_SECRET/, 'desktop tokens must use their own secret')
assert.match(cryptoSource, /DESKTOP_ACTIVATION_PIN_SECRET/, 'activation PINs must use their own secret')
assert.match(cryptoSource, /assertDesktopActivationSecretsConfigured/, 'desktop activation should expose a dual-secret fail-closed check')
assert.match(cryptoSource, /\{40,128\}/, 'desktop token format should enforce a maximum token length')
assert.match(cryptoSource, /crypto\.randomBytes\(DESKTOP_DEVICE_TOKEN_BYTES\)/, 'desktop tokens must use CSPRNG bytes')
assert.match(cryptoSource, /crypto\.randomInt\(0, 1_000_000\)/, 'activation PINs must use CSPRNG randomInt')

const authSource = read('lib/desktop-activation/auth.ts')
assert.match(authSource, /assertDesktopActivationSecretsConfigured\(\)/, 'device auth should fail closed if either activation secret is missing')
assert.match(authSource, /Authorization: Bearer|Bearer\\s\+\(\.\+\)/, 'device auth must parse Authorization bearer tokens')
assert.match(authSource, /hashDesktopDeviceToken\(token\)/, 'device auth must hash bearer token before lookup')
assert.match(authSource, /findUnique\(\{[\s\S]*where: \{[\s\S]*tokenHash\s*\}/, 'device auth must look up by tokenHash')
assert.match(authSource, /device\.status !== 'ACTIVE'/, 'revoked devices must fail verification')
assert.doesNotMatch(authSource, /nextUrl\.searchParams|get\('storeCode'\)|where:\s*\{\s*code/, 'post-activation device auth must not use storeCode fallback')

const activateRoute = read('app/api/desktop/activate/route.ts')
assert.match(activateRoute, /storeCode/, 'only the public activation route accepts storeCode')
assert.match(activateRoute, /activateDesktopDevice/, 'public activation route should delegate to activation service')

for (const file of desktopApiFiles.filter((file) => file !== 'app/api/desktop/activate/route.ts')) {
  assert.doesNotMatch(read(file), /get\('storeCode'\)|where:\s*\{\s*code/, `${file} must not authorize by storeCode`)
}

const auditSource = read('lib/desktop-activation/audit.ts')
assert.match(auditSource, /SENSITIVE_KEY_PATTERN/, 'audit helper must reject sensitive metadata keys')
assert.match(auditSource, /token\|pin\|authorization\|secret\|hash\|installation\|payload\|request\|response/, 'audit metadata must block sensitive key names')
assert.match(auditSource, /ALLOWED_METADATA_KEYS/, 'audit metadata must use an allowlist')
assert.match(auditSource, /credentialVersion/, 'audit metadata should use credentialVersion rather than tokenHashVersion')
assert.doesNotMatch(auditSource, /'tokenHashVersion'/, 'audit metadata allowlist must not include token/hash key names')

const schema = read('prisma/schema.prisma')
assert.match(schema, /model DesktopDevice/, 'schema should define DesktopDevice')
assert.match(schema, /tokenHash\s+String\s+@unique/, 'DesktopDevice should store only tokenHash')
assert.match(schema, /tokenHashVersion\s+Int\s+@default\(1\)/, 'DesktopDevice should keep token hash algorithm version')
assert.match(schema, /tokenVersion\s+Int\s+@default\(1\)/, 'DesktopDevice should keep credential rotation version separately')
assert.match(schema, /installationIdHash\s+String/, 'DesktopDevice should store only installationIdHash')
assert.match(schema, /@@unique\(\[installationIdHash, activeSlot\]\)/, 'active installation identity must be unique')
assert.match(schema, /model DesktopActivationPin/, 'schema should define DesktopActivationPin')
assert.match(schema, /pinHash\s+String/, 'activation PIN must be stored as hash')
assert.match(schema, /@@unique\(\[storeId, activeSlot\]\)/, 'only one active PIN should exist per store')
assert.doesNotMatch(schema, /\bdeviceToken\b|\brawToken\b|\brawPin\b/, 'schema must not store raw token or raw PIN fields')

const migration = read('prisma/migrations/20260717090000_add_desktop_activation_identity/migration.sql')
assert.match(migration, /"tokenHash" TEXT NOT NULL/, 'migration must create tokenHash column')
assert.match(migration, /"pinHash" TEXT NOT NULL/, 'migration must create pinHash column')
assert.doesNotMatch(migration, /"deviceToken"|"rawToken"|"rawPin"/, 'migration must not create raw secret columns')

const tokenVersionMigration = read('prisma/migrations/20260717110000_add_desktop_device_token_version/migration.sql')
assert.match(tokenVersionMigration, /ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1/, 'incremental migration should add tokenVersion')

const pinCreateRoute = read('app/api/desktop/activation-pins/route.ts')
assert.match(pinCreateRoute, /CONFLICT_RETRY_REQUIRED/, 'PIN create should map concurrent active-slot conflicts to a stable business error')

const verifyRoute = read('app/api/desktop/auth/verify/route.ts')
const statusRoute = read('app/api/desktop/device/status/route.ts')
for (const [label, source] of [['verify', verifyRoute], ['status', statusRoute]] as const) {
  assert.match(source, /serializePublicDesktopDeviceIdentity/, `${label} should return the public device identity shape`)
  assert.doesNotMatch(source, /device:\s*auth\.device|store:\s*auth\.store/, `${label} must not return full serialized device/store objects directly`)
  assert.doesNotMatch(source, /revocationReason|replacesDeviceId|revokedByUserId|installationIdHash|tokenHash/, `${label} must not expose internal device fields`)
}

console.log('desktop activation security static tests passed')
