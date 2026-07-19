import assert from 'node:assert/strict'
import fs from 'node:fs'

const guard = fs.readFileSync('scripts/staging-preview-guard.ts', 'utf8')
const cleanup = fs.readFileSync('scripts/cleanup-staging-runtime-fixtures.ts', 'utf8')
const bootstrap = fs.readFileSync('scripts/bootstrap-staging-preview.ts', 'utf8')
const runtime = fs.readFileSync('tests/desktop-activation-runtime.test.ts', 'utf8')

assert.match(guard, /STAGING_PREVIEW_MAINTENANCE/, 'staging scripts must require an explicit maintenance flag')
assert.match(guard, /STAGING_PROJECT_REF_FINGERPRINT/, 'staging scripts must pin the database fingerprint')
assert.match(guard, /VERCEL_ENV === 'production'/, 'staging scripts must reject Vercel Production')

assert.match(cleanup, /RUNTIME_MARKERS/, 'residual cleanup must use fixed runtime markers')
assert.match(cleanup, /desktopActivationAudit\.deleteMany[\s\S]*desktopActivationPin\.deleteMany[\s\S]*desktopDevice\.deleteMany/, 'cleanup must follow activation FK order')
assert.doesNotMatch(cleanup, /truncate|drop schema|deleteMany\(\{\}\)/i, 'cleanup must not perform broad destructive operations')
assert.match(cleanup, /residuals:\s*'ZERO'/, 'cleanup must report zero residuals')

assert.match(runtime, /createdTenantIds/, 'runtime tests must track created tenant IDs')
assert.match(runtime, /cleanupRuntimeFixtures/, 'runtime tests must clean fixtures with the same Prisma client')
assert.match(runtime, /finally[\s\S]*cleanupRuntimeFixtures[\s\S]*\$disconnect/, 'runtime cleanup and disconnect must run in finally')
assert.doesNotMatch(runtime, /spawn|subprocess|child_process/, 'runtime cleanup must not use a subprocess')

for (const value of ['preview-e1-tenant', 'preview-e1-store', 'PREV06C', 'preview-e1-owner', 'preview-e1-ops-admin']) {
  assert.match(bootstrap, new RegExp(value), `bootstrap must pin ${value}`)
}
assert.match(bootstrap, /import\('\.\.\/app\/api\/ops\/login\/route'\)/, 'bootstrap must reuse the existing ops login seed path')
assert.match(bootstrap, /checkOpsAuthContext/, 'bootstrap must verify the FK-backed ops session')
assert.match(bootstrap, /assertSyntheticNamespaceAvailable/, 'bootstrap must reject conflicting fixed-ID data')
assert.match(bootstrap, /upsertSyntheticFixtures/, 'bootstrap must be idempotent')
assert.match(bootstrap, /--verify-only/, 'bootstrap must support no-write verification')
assert.doesNotMatch(bootstrap, /createActivationPin|activationPin\.create|pinHash|deviceToken/, 'bootstrap must not generate activation credentials')

console.log('staging bootstrap and cleanup static tests passed')
