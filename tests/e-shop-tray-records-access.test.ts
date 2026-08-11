import assert from 'node:assert/strict'
import { isDesktopRecordsRoute } from '../lib/records-route-access'

assert.equal(isDesktopRecordsRoute('/records'), false, 'mobile records must require a merchant session')
assert.equal(isDesktopRecordsRoute('/records', '?from=desktop'), false, 'desktop records also requires a store code')
assert.equal(
  isDesktopRecordsRoute('/records', '?from=desktop&storeCode=STORE-A'),
  true,
  'authenticated desktop records remains a standalone route',
)
assert.equal(
  isDesktopRecordsRoute('/records', '?storeCode=STORE-A&from=desktop'),
  true,
  'desktop records query parameter order must not matter',
)
assert.equal(isDesktopRecordsRoute('/records', '?from=mobile&storeCode=STORE-A'), false)
assert.equal(isDesktopRecordsRoute('/records/archive', '?from=desktop&storeCode=STORE-A'), false)

console.log('E-Shop Tray records access checks passed')
