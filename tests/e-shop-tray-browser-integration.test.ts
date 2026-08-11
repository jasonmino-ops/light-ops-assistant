import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const orderDetail = readFileSync(new URL('../app/components/OrderDetailSheet.tsx', import.meta.url), 'utf8')
const cloudClient = readFileSync(new URL('../lib/eShopTrayCloudClient.ts', import.meta.url), 'utf8')

assert.match(orderDetail, /buildPrintHTML\(d as ShareData, shareLabels\)/)
assert.match(orderDetail, /if \(!eshopTrayEnabled\) \{\s*openExistingBrowserPrint\(html\)\s*return\s*\}/)
assert.match(orderDetail, /renderTicketHtmlToEscPosRaw\(html\)/)
assert.match(orderDetail, /submitEshopTrayCloudPrint\(\{/)
assert.match(orderDetail, /storeCode: eshopTrayStoreCode/)
assert.match(orderDetail, /commandStream/)
assert.match(orderDetail, /Once Cloud submission is attempted, never start Browser fallback/)
assert.match(orderDetail, /win\.print\(\)/)
assert.doesNotMatch(orderDetail, /locateEshopTray|submitEshopTrayPrint|\/v1\/health|\/v1\/print/)

assert.match(cloudClient, /\/api\/store-runtime\/print-tasks/)
assert.match(cloudClient, /taskType: 'PRINT_ESC_POS'/)
assert.match(cloudClient, /target: \{ type: 'WINDOWS_QUEUE', name: '前台' \}/)
assert.match(cloudClient, /sha256/)
assert.doesNotMatch(cloudClient, /192\.168\.|targetAddressSpace|\/v1\/health|\/v1\/print/)

const gateCheck = orderDetail.indexOf('if (!eshopTrayEnabled)')
const cloudCall = orderDetail.indexOf('await submitEshopTrayCloudPrint')
assert.ok(gateCheck >= 0 && gateCheck < cloudCall, 'non-FIELD stores must keep Browser print before Cloud submission')

console.log('E-Shop Tray Cloud Relay browser integration checks passed')
