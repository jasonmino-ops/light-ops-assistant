import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const orderDetail = readFileSync(new URL('../app/components/OrderDetailSheet.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/eShopTrayClient.ts', import.meta.url), 'utf8')

assert.match(orderDetail, /buildPrintHTML\(d as ShareData, shareLabels\)/)
assert.match(orderDetail, /if \(!eshopTrayEnabled\) \{\s*openExistingBrowserPrint\(html\)\s*return\s*\}/)
assert.match(orderDetail, /locateEshopTray\(\)/)
assert.match(orderDetail, /renderTicketHtmlToEscPosRaw\(html\)/)
assert.match(orderDetail, /submitEshopTrayPrint\(tray, commandStream\)/)
assert.match(orderDetail, /openExistingBrowserPrint\(html\)/)
assert.match(orderDetail, /win\.print\(\)/)
assert.match(orderDetail, /error instanceof EshopTrayClientError && !error\.submitted/)
assert.match(orderDetail, /trayPrintFailed/)
assert.match(client, /targetAddressSpace: 'local'/)
assert.match(client, /credentials: 'omit'/)
assert.doesNotMatch(client, /qz\.websocket|printers\.find|window\.print/)

const gateCheck = orderDetail.indexOf('if (!eshopTrayEnabled)')
const locatorCall = orderDetail.indexOf('const tray = await locateEshopTray()')
assert.ok(gateCheck >= 0 && gateCheck < locatorCall, 'non-FIELD stores must fall back before Runtime Locator is called')

console.log('E-Shop Tray browser integration checks passed')
