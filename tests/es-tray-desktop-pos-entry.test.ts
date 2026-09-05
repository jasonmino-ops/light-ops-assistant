import assert from 'node:assert/strict'
import fs from 'node:fs'

const desktopEntry = fs.readFileSync('app/desktop/pos/page.tsx', 'utf8')
const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const orderDetail = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
const relayClient = fs.readFileSync('lib/eShopTrayCloudClient.ts', 'utf8')
const records = fs.readFileSync('app/records/page.tsx', 'utf8')

let cases = 0
function test(name: string, run: () => void) {
  run()
  cases += 1
  console.log(`PASS ${name}`)
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('/desktop/pos still renders the existing CashierPage runtime', () => {
  assert.match(desktopEntry, /import CashierPage from '@\/app\/cashier\/page'/)
  assert.match(desktopEntry, /mode === 'pos'[\s\S]*<CashierPage \/>/)
})

test('the Desktop sales-record list remains sourced from the scoped records API', () => {
  const openRecords = sourceBetween(cashier, 'async function handleOpenDesktopRecords()', 'async function loadShiftReport()')
  assert.match(openRecords, /fetch\(`\/api\/records\?\$\{params\.toString\(\)\}`/)
  assert.match(openRecords, /headers: posDeviceHeaders\(storeCode\)/)
})

test('the sales-record row keeps the server order number as the detail identity', () => {
  const rowProjection = sourceBetween(cashier, 'const desktopRecordRows = (() =>', '// 待收款挂单')
  assert.match(rowProjection, /orderNo: item\.orderNo \|\| item\.recordNo/)
})

test('CashierPage reuses OrderDetailSheet instead of defining a second Relay client', () => {
  assert.equal((cashier.match(/import OrderDetailSheet from '@\/app\/components\/OrderDetailSheet'/g) ?? []).length, 1)
  assert.doesNotMatch(cashier, /from '@\/lib\/eShopTrayCloudClient'/)
})

test('the Desktop record selection has an order-scoped detail state', () => {
  assert.match(cashier, /selectedDesktopRecordOrderNo, setSelectedDesktopRecordOrderNo.*useState<string \| null>\(null\)/)
})

test('one Desktop record click opens the reused detail with that row order number', () => {
  const recordList = sourceBetween(cashier, '{desktopRecordRows.map((row) =>', '{/* ── Sale success overlay')
  assert.match(recordList, /onClick=\{\(\) => \{[\s\S]*setSelectedDesktopRecordOrderNo\(row\.orderNo\)[\s\S]*\}\}/)
  assert.equal((recordList.match(/setSelectedDesktopRecordOrderNo\(row\.orderNo\)/g) ?? []).length, 1)
})

test('the reused detail is mounted only for the Desktop POS path', () => {
  assert.match(cashier, /\{isDesktopPos && \([\s\S]*<OrderDetailSheet[\s\S]*orderNo=\{selectedDesktopRecordOrderNo\}/)
})

test('closing the reused detail clears both selected order and inline expansion', () => {
  assert.match(cashier, /onClose=\{\(\) => \{[\s\S]*setSelectedDesktopRecordOrderNo\(null\)[\s\S]*setExpandedDesktopRecordKey\(null\)/)
})

test('opening the Desktop records panel resets any prior selected detail', () => {
  const openRecords = sourceBetween(cashier, 'async function handleOpenDesktopRecords()', 'async function loadShiftReport()')
  assert.match(openRecords, /setDesktopRecordsOpen\(true\)[\s\S]*setSelectedDesktopRecordOrderNo\(null\)/)
})

test('OrderDetailSheet selects the reviewed OWNER or device config gate when an order opens', () => {
  assert.match(orderDetail, /const readEnableState = isDesktopPosDeviceRuntime\(\)/)
  assert.match(orderDetail, /readEshopTray02DeviceCloudEnableState[\s\S]*readEshopTray02CloudEnableState/)
  assert.match(orderDetail, /void readEnableState\(\)\.then/)
})

test('a disabled or failed config gate preserves the existing browser print path', () => {
  const printHandler = sourceBetween(orderDetail, 'async function handlePrint()', 'const busy =')
  assert.match(printHandler, /if \(cloudRelayState !== 'enabled'\) \{[\s\S]*openExistingBrowserPrint\(html, completePrintAction\)[\s\S]*return/)
})

test('the Relay-enabled path reuses the reviewed receipt renderer and explicit enqueue clients', () => {
  const printHandler = sourceBetween(orderDetail, 'async function handlePrint()', 'const busy =')
  assert.match(printHandler, /html = buildPrintHTML\(d as ShareData, shareLabels\)/)
  assert.match(printHandler, /renderTicketHtmlToEscPosRaw\(html\)/)
  assert.match(printHandler, /submitEshopTray02DeviceCloudPrint[\s\S]*submitEshopTray02CloudPrint/)
  assert.equal((printHandler.match(/await submitPrint\(/g) ?? []).length, 1)
})

test('the print handler remains single-flight and keeps a stable retry intent', () => {
  const printHandler = sourceBetween(orderDetail, 'async function handlePrint()', 'const busy =')
  assert.match(printHandler, /\|\| printInFlightRef\.current/)
  assert.match(printHandler, /printInFlightRef\.current = true/)
  assert.match(printHandler, /getOrCreateEshopTray02PrintIntent\(relayIntentRef\.current, d\.orderNo\)/)
  assert.match(printHandler, /Retain the intent and exact command bytes/)
})

test('an ambiguous Relay failure has no blind browser or QZ fallback', () => {
  const printHandler = sourceBetween(orderDetail, 'async function handlePrint()', 'const busy =')
  const relayFailure = sourceBetween(printHandler, '} catch (error) {\n      // Retain the intent', '} finally {')
  assert.doesNotMatch(relayFailure, /openExistingBrowserPrint|window\.print|qz/i)
})

test('the cloud client still fixes the target to the 前台 Windows queue', () => {
  assert.match(relayClient, /const RELAY_QUEUE_NAME = '前台' as const/)
  assert.match(relayClient, /target: \{ transport: 'windows-queue', queueName: RELAY_QUEUE_NAME \}/)
})

test('the cashier completion print path remains on its existing QZ/browser implementation', () => {
  assert.match(cashier, /submitDesktopReceiptPrint\(/)
  assert.match(cashier, /handlePrintReceipt\(saleResult\.receipt, saleResult\.kitchenTicket\)/)
  assert.doesNotMatch(cashier, /submitEshopTray02CloudPrint\(|renderTicketHtmlToEscPosRaw\(/)
})

test('the existing 补打小票 path remains unchanged outside the Desktop POS modal', () => {
  assert.match(records, /reprintLabel=.*'补打小票'/)
  assert.match(records, /handleSaleRecordReprint/)
  assert.match(records, /printDesktopReceipt\(/)
})

test('OrderDetailSheet remains the sole owner of config, rendering, and enqueue selection', () => {
  assert.equal((orderDetail.match(/const readEnableState =/g) ?? []).length, 1)
  assert.equal((orderDetail.match(/renderTicketHtmlToEscPosRaw\(html\)/g) ?? []).length, 1)
  assert.equal((orderDetail.match(/const submitPrint =/g) ?? []).length, 1)
  assert.equal((orderDetail.match(/await submitPrint\(/g) ?? []).length, 1)
})

console.log(`es-tray Desktop POS entry tests passed (${cases} cases)`)
