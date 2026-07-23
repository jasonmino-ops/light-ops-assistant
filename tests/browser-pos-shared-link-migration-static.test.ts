import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const migrationNames = readdirSync('prisma/migrations')
  .filter((name) => /^\d+_/.test(name))
  .sort()
const lifecycle = '20260723093000_add_browser_pos_device_lifecycle'
const metadata = '20260723100000_ep_br_link_auth_01_browser_pos_metadata'

assert.ok(migrationNames.includes(lifecycle), 'BrowserPosDevice lifecycle migration must remain present')
assert.ok(migrationNames.includes(metadata), 'BrowserPosDevice metadata migration must remain present')
assert.ok(
  migrationNames.indexOf(lifecycle) < migrationNames.indexOf(metadata),
  'BrowserPosDevice metadata migration must run after the lifecycle table creation migration',
)
assert.equal(
  migrationNames.includes('20260723000000_ep_br_link_auth_01'),
  false,
  'the metadata ALTER must not precede BrowserPosDevice creation in a fresh chain',
)

const sql = readFileSync(`prisma/migrations/${metadata}/migration.sql`, 'utf8')
assert.match(sql, /ALTER TABLE "BrowserPosDevice"/, 'metadata migration must alter the existing BrowserPosDevice table')
assert.match(sql, /ADD COLUMN IF NOT EXISTS "displayName" TEXT/, 'incremental metadata migration must be additive')
assert.match(sql, /ADD COLUMN IF NOT EXISTS "browserInfo" TEXT/, 'incremental metadata migration must be idempotent for already-updated databases')

console.log('Browser POS shared-link migration order static tests passed')
