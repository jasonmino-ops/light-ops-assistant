import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const settings = readFileSync(new URL('../app/components/EshopTraySettings.tsx', import.meta.url), 'utf8')
const records = readFileSync(new URL('../app/records/page.tsx', import.meta.url), 'utf8')

assert.match(settings, /testEshopTrayConnection\(address\)/)
assert.match(settings, /saveEshopTrayBaseUrl\(verifiedBaseUrl\)/)
assert.match(settings, /readSavedEshopTrayBaseUrl\(\)/)
assert.match(settings, /clearEshopTrayBaseUrl\(\)/)
assert.match(settings, /normalizedBaseUrl === verifiedBaseUrl/)
assert.match(settings, /'unset' \| 'unconnected' \| 'checking' \| 'connected' \| 'failed'/)
assert.match(settings, /connectedHealth\.version/)
assert.match(settings, /data-eshop-tray-service-online/)
assert.match(settings, /data-eshop-tray-address-input/)
assert.match(settings, /data-eshop-tray-test/)
assert.match(settings, /data-eshop-tray-save/)
assert.match(settings, /data-eshop-tray-clear/)
assert.match(records, /!isDesktopRecords && realRole === 'OWNER' && <EshopTraySettings/)

for (const language of ['zh', 'en', 'km']) {
  const dictionary = readFileSync(new URL(`../lib/i18n/${language}.ts`, import.meta.url), 'utf8')
  for (const key of ['entry', 'address', 'unset', 'unconnected', 'checking', 'connected', 'failed', 'online', 'version', 'test', 'save', 'clear']) {
    assert.match(dictionary, new RegExp(`\\b${key}:`), `${language} is missing tray.${key}`)
  }
}

console.log('E-Shop Tray settings static checks passed')
