import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const migrationNames = readdirSync('prisma/migrations')
  .filter((name) => /^\d+_/.test(name))
  .sort()
const lifecycle = '20260723093000_add_browser_pos_device_lifecycle'
const metadata = '20260723100000_ep_br_link_auth_01_browser_pos_metadata'
const delivery = '20260723110000_ep_br_link_auth_01_binding_delivery'

assert.ok(migrationNames.includes(lifecycle), 'BrowserPosDevice lifecycle migration must remain present')
assert.ok(migrationNames.includes(metadata), 'BrowserPosDevice metadata migration must remain present')
assert.ok(migrationNames.includes(delivery), 'idempotent binding delivery migration must remain present')
assert.ok(
  migrationNames.indexOf(lifecycle) < migrationNames.indexOf(metadata),
  'BrowserPosDevice metadata migration must run after the lifecycle table creation migration',
)
assert.equal(
  migrationNames.includes('20260723000000_ep_br_link_auth_01'),
  false,
  'the metadata ALTER must not precede BrowserPosDevice creation in a fresh chain',
)
assert.ok(
  migrationNames.indexOf(metadata) < migrationNames.indexOf(delivery),
  'binding delivery must run after BrowserPosDevice metadata and lifecycle migrations',
)

const sql = readFileSync(`prisma/migrations/${metadata}/migration.sql`, 'utf8')
assert.match(sql, /ALTER TABLE "BrowserPosDevice"/, 'metadata migration must alter the existing BrowserPosDevice table')
assert.match(sql, /ADD COLUMN IF NOT EXISTS "displayName" TEXT/, 'incremental metadata migration must be additive')
assert.match(sql, /ADD COLUMN IF NOT EXISTS "browserInfo" TEXT/, 'incremental metadata migration must be idempotent for already-updated databases')

const deliverySql = readFileSync(`prisma/migrations/${delivery}/migration.sql`, 'utf8')
assert.match(deliverySql, /CREATE TABLE "BrowserPosBindingDelivery"/, 'binding delivery migration must create a dedicated table')
assert.match(deliverySql, /"requestId" TEXT NOT NULL/, 'binding delivery must retain its challenge identity')
assert.match(deliverySql, /"bindingAttemptId" TEXT NOT NULL/, 'binding delivery must retain its idempotency identity')
assert.match(deliverySql, /"encryptedResult" TEXT NOT NULL/, 'binding delivery must retain encrypted result only')
assert.match(deliverySql, /BrowserPosBindingDelivery_requestId_key/, 'one challenge must have one winning delivery operation')

console.log('Browser POS shared-link migration order static tests passed')
