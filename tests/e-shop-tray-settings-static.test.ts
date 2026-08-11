import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const settings = readFileSync(new URL('../app/components/EshopTraySettings.tsx', import.meta.url), 'utf8')
const records = readFileSync(new URL('../app/records/page.tsx', import.meta.url), 'utf8')
const telegramInit = readFileSync(new URL('../app/components/TelegramInit.tsx', import.meta.url), 'utf8')

assert.match(settings, /\/api\/desktop\/activation-pins/)
assert.match(settings, /storeId/)
assert.match(settings, /data-eshop-tray-create-code/)
assert.match(settings, /data-eshop-tray-connection-code/)
assert.match(settings, /data-eshop-tray-cloud-status/)
assert.doesNotMatch(settings, /testEshopTrayConnection|localStorage|192\.168\.|\/v1\/health/)
assert.match(records, /isEshopTrayFieldEnabled\(\{[\s\S]*storeCode: contextStoreCode,[\s\S]*realRole,[\s\S]*isDesktopRecords,[\s\S]*\}\)/)
assert.match(records, /eshopTrayEnabled && <EshopTraySettings/)
assert.match(records, /eshopTrayEnabled=\{eshopTrayEnabled\}/)
assert.match(records, /eshopTrayStoreCode=\{eshopTrayEnabled \? contextStoreCode : null\}/)
assert.doesNotMatch(telegramInit, /PUBLIC_PATH_PREFIXES[^\n]*['"]\/records['"]/)

for (const language of ['zh', 'en', 'km']) {
  const dictionary = readFileSync(new URL(`../lib/i18n/${language}.ts`, import.meta.url), 'utf8')
  for (const key of ['entry', 'cloudSubtitle', 'cloudRelay', 'cloudReady', 'connectionCode', 'createCode', 'codeReady', 'codeFailed']) {
    assert.match(dictionary, new RegExp(`\\b${key}:`), `${language} is missing tray.${key}`)
  }
}

console.log('E-Shop Tray Cloud Relay settings static checks passed')
