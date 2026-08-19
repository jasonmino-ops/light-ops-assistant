import assert from 'node:assert/strict'
import fs from 'node:fs'

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(
  'prisma/migrations/20260819160000_add_sales_lead_support_config/migration.sql',
  'utf8',
)
const route = fs.readFileSync('app/api/ops/sales-lead-support/route.ts', 'utf8')
const helper = fs.readFileSync('lib/sales-lead-support.ts', 'utf8')
const openApi = fs.readFileSync('app/api/open/route.ts', 'utf8')
const landingApi = fs.readFileSync('app/api/public/acquisition-invites/[code]/landing/route.ts', 'utf8')
const leadApi = fs.readFileSync('app/api/public/sales-leads/route.ts', 'utf8')

assert.match(schema, /model SalesLeadSupportConfig/)
assert.match(schema, /supportPhone\s+String\?/)
assert.match(schema, /telegramSupportTarget\s+String\?/)
assert.match(schema, /updatedByOpsAdminId\s+String\?/)
assert.match(migration, /CREATE TABLE "SalesLeadSupportConfig"/)
assert.match(migration, /SalesLeadSupportConfig_singleton_check/)
assert.match(migration, /REVOKE ALL ON public\."SalesLeadSupportConfig" FROM anon/)
assert.match(migration, /REVOKE ALL ON public\."SalesLeadSupportConfig" FROM authenticated/)
assert.match(route, /getFkBackedOpsAdminIdentity\(req, 'OPS_ADMIN'\)/)
assert.match(route, /checkOpsAuthContext\(req\)/)
assert.match(route, /canManage: Boolean\(manager\)/)
assert.match(route, /normalizeSalesLeadSupportConfig\(body\)/)
assert.doesNotMatch(route, /NextResponse\.json\([^)]*updatedByOpsAdminId/)
assert.match(helper, /prisma\.salesLeadSupportConfig\.findUnique/)
assert.match(helper, /values\.telegramSupportTarget \|\| fallbackBot/)
assert.doesNotMatch(helper, /PLATFORM_SUPPORT_PHONE/)
assert.match(openApi, /await getPlatformSupportConfig\(\)/)
assert.match(landingApi, /await getPlatformSupportConfig\(\)/)
assert.match(leadApi, /await getPlatformSupportConfig\(\)/)

console.log('sales lead support config tests passed')
