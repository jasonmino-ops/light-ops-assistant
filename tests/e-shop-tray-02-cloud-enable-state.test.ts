import assert from 'node:assert/strict'
import fs from 'node:fs'
import { resolveEshopTray02PrintPath } from '../lib/eShopTrayCloudClient'

assert.equal(resolveEshopTray02PrintPath('pending', false), 'CONFIG_PENDING')
assert.equal(resolveEshopTray02PrintPath('pending', true), 'CONFIG_PENDING')
assert.equal(resolveEshopTray02PrintPath('enabled', false), 'CLOUD_RELAY')
assert.equal(resolveEshopTray02PrintPath('enabled', true), 'CLOUD_RELAY')
assert.equal(resolveEshopTray02PrintPath('disabled', true), 'ES_TRAY_01_LAN')
assert.equal(resolveEshopTray02PrintPath('disabled', false), 'BROWSER')

const orderSheet = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')

assert.match(orderSheet, /useState<EshopTray02CloudEnableState>\('pending'\)/)
assert.match(orderSheet, /setCloudRelayState\('pending'\)/)
assert.match(orderSheet, /setCloudRelayState\('disabled'\)/)
assert.match(orderSheet, /printPath === 'CONFIG_PENDING'/)
assert.match(orderSheet, /printPath === 'CLOUD_RELAY'/)
assert.match(orderSheet, /printPath === 'BROWSER'/)
assert.match(orderSheet, /printDisabled = busy \|\| cloudRelayState === 'pending'/)
assert.match(orderSheet, /disabled=\{printDisabled\} onClick=\{handlePrint\}/)
assert.match(orderSheet, /const tray = await locateEshopTray\(\)/)

console.log('ES-TRAY-02 cloud enable state tests passed')
