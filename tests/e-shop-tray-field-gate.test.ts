import assert from 'node:assert/strict'
import {
  ESHOP_TRAY_FIELD_STORE_CODE,
  isEshopTrayFieldEnabled,
} from '../lib/eShopTrayFieldGate'
import { isEshopTrayCloudRelayFieldEnabled } from '../lib/eShopTrayCloudRelayField'

assert.equal(ESHOP_TRAY_FIELD_STORE_CODE, 'ST169E7000')

const enabledFor = (
  storeCode: string | null | undefined,
  gateValue: string | undefined,
  realRole = 'OWNER',
  isDesktopRecords = false,
) => isEshopTrayFieldEnabled({ storeCode, gateValue, realRole, isDesktopRecords })

assert.equal(enabledFor('ST169E7000', undefined), false)
assert.equal(enabledFor('ST169E7000', ''), false)
assert.equal(enabledFor('ST169E7000', '0'), false)
assert.equal(enabledFor('ST169E7000', '*'), false)

assert.equal(enabledFor('ST169E7000', '1'), true)
assert.equal(enabledFor('ST169E7000', '1', 'STAFF'), false)
assert.equal(enabledFor('ST169E7000', '1', 'OWNER', true), false)
assert.equal(enabledFor('ST169E7001', '1'), false)
assert.equal(enabledFor('STORE-A', '1'), false)
assert.equal(enabledFor('*', '1'), false)
assert.equal(enabledFor(null, '1'), false)
assert.equal(enabledFor(undefined, '1'), false)

assert.equal(isEshopTrayCloudRelayFieldEnabled('ST169E7000', '1'), true)
assert.equal(isEshopTrayCloudRelayFieldEnabled('ST169E7000', '0'), false)
assert.equal(isEshopTrayCloudRelayFieldEnabled('OTHER', '1'), false)
assert.equal(isEshopTrayCloudRelayFieldEnabled('*', '1'), false)

console.log('E-Shop Tray FIELD store gate checks passed')
