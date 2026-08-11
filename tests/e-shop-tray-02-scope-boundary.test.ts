import assert from 'node:assert/strict'
import fs from 'node:fs'

const orderSheet = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
const fieldStore = fs.readFileSync('lib/eShopTrayRelayFieldStore.ts', 'utf8')
const submitRoute = fs.readFileSync('app/api/es-tray-02/print-jobs/route.ts', 'utf8')
const receiveRoute = fs.readFileSync('app/api/es-tray-02/print-jobs/receive/route.ts', 'utf8')

assert.match(orderSheet, /renderTicketHtmlToEscPosRaw\(html\)/)
assert.match(orderSheet, /submitEshopTray02CloudPrint/)
assert.doesNotMatch(orderSheet, /cloudPrinter|printReceipt\(/)

assert.match(fieldStore, /FIELD ONLY temporary relay persistence/)
assert.match(fieldStore, /NOT the Transport\s+\* Contract/)
assert.match(submitRoute, /OWNER_REQUIRED/)
assert.match(submitRoute, /productionContract: false/)
assert.match(receiveRoute, /productionContract: false/)

for (const source of [fieldStore, submitRoute, receiveRoute]) {
  assert.doesNotMatch(source, /desktop-activation|heartbeat|printer-binding|message bus/i)
}

const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
assert.doesNotMatch(schema, /EshopTray|StoreRuntimePrintTask|StoreRuntimePrinterBinding/)

console.log('ES-TRAY-02 scope boundary tests passed')
