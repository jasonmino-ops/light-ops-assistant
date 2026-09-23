const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (value) => fs.readFileSync(path.join(root, value), 'utf8')

test('V3 control plane schema is dedicated, store-scoped and device-scope fenced', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model V3PrintControlPlane \{/)
  assert.match(schema, /storeId\s+String\s+@unique/)
  assert.match(schema, /ownerEpoch\s+Int\s+@default\(0\)/)
  assert.match(schema, /ownerDevice DesktopDevice\?\s+@relation\("V3PrintControlPlaneOwner", fields: \[ownerDeviceId, tenantId, storeId\]/)
  assert.match(schema, /model V3PrintExecutionBatch \{/)
  assert.match(schema, /ownerDevice\s+DesktopDevice\s+@relation\("V3PrintExecutionBatchOwner", fields: \[ownerDeviceId, tenantId, storeId\]/)
})

test('migration constrains mode, owner shape, expiry and exact composite identity', () => {
  const sql = read('prisma/migrations/20260923022000_add_v3_print_control_plane/migration.sql')
  assert.match(sql, /mode_check.*V2_ACTIVE.*V2_DRAINING.*V3_ACTIVE.*V3_DRAINING.*BLOCKED_UNKNOWN/s)
  assert.match(sql, /owner_shape_check/)
  assert.match(sql, /V3PrintExecutionBatch_expiry_check/)
  assert.match(sql, /FOREIGN KEY \("ownerDeviceId", "tenantId", "storeId"\) REFERENCES "DesktopDevice"\("id", "tenantId", "storeId"\)/)
})

test('server writer rejects timeout promotion and requires explicit fenced writes', () => {
  const source = read('lib/v3-print-control-plane.ts')
  assert.match(source, /OWNER_LIVENESS_AMBIGUOUS/)
  assert.doesNotMatch(source, /leaseExpiresAt:\s*\{\s*lte: now\s*\}.*ownerEpoch:\s*\{\s*increment/s)
  assert.match(source, /stateVersion: identity\.stateVersion/)
  assert.match(source, /leaseExpiresAt: \{ gt: now \}/)
  assert.match(source, /controlledV3OwnerHandoff/)
})

test('Desktop and Owner APIs keep authority roles separate', () => {
  const desktop = read('app/api/desktop/v3-print-control-plane/route.ts')
  const owner = read('app/api/owner/v3-print-control-plane/route.ts')
  assert.match(desktop, /getDesktopDeviceContext/)
  assert.doesNotMatch(desktop, /transitionV3PrintMode|controlledV3OwnerHandoff/)
  assert.match(owner, /ctx\.role !== 'OWNER'/)
  assert.match(owner, /transitionV3PrintMode/)
  assert.match(owner, /controlledV3OwnerHandoff/)
})
