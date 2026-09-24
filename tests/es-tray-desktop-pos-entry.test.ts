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

test('the sales-record row keeps orderNo distinct from its display record number', () => {
  const rowProjection = sourceBetween(cashier, 'const desktopRecordRows = (() =>', '// 待收款挂单')
  assert.match(rowProjection, /orderNo: string \| null/)
  assert.match(rowProjection, /displayNo: string/)
  assert.match(rowProjection, /orderNo: item\.orderNo,/)
  assert.match(rowProjection, /displayNo: key,/)
  assert.doesNotMatch(rowProjection, /orderNo: item\.orderNo \|\| item\.recordNo/)
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
  assert.match(recordList, /!row\.orderNo[\s\S]*缺少原始订单号，无法查看订单详情或补打/)
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
  assert.match(orderDetail, /const deviceRuntime = isDesktopPosDeviceRuntime\(\)/)
  assert.match(orderDetail, /const readEnableState = deviceRuntime/)
  assert.match(orderDetail, /readEshopTray02DeviceCloudEnableState[\s\S]*readEshopTray02CloudEnableState/)
  assert.match(orderDetail, /Promise\.all\(\[readEnableState\(\), readReprint\(\)\]\)/)
})

test('a disabled or failed config gate preserves the existing browser print path', () => {
  const printHandler = sourceBetween(orderDetail, 'async function handlePrint()', 'const busy =')
  assert.match(printHandler, /const availability = await readCurrentV3ReprintAvailability\(\)/)
  assert.match(printHandler, /if \(!availability\?\.legacyAllowed\)[\s\S]*return/)
  assert.match(printHandler, /if \(cloudRelayState !== 'enabled'\) \{[\s\S]*openExistingBrowserPrint\(html, completePrintAction\)[\s\S]*return/)
})

test('legacy reprint permission is refreshed at click time and fails closed after a V3 transition', () => {
  const action = sourceBetween(orderDetail, 'async function handleReprintAction()', 'async function handleV3Reprint()')
  assert.match(action, /const availability = await readCurrentV3ReprintAvailability\(\)/)
  assert.match(action, /if \(availability\?\.enabled\)[\s\S]*setReprintChoice\('FRONT'\)/)
  assert.match(action, /if \(availability\?\.legacyAllowed\)[\s\S]*void handlePrint\(\)/)
  assert.doesNotMatch(action, /v3Reprint\?\.legacyAllowed/)
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

test('the cashier completion path preserves its existing V2 QZ/browser fallback contract', () => {
  const printHandler = sourceBetween(cashier, 'const handlePrintReceipt = useCallback', 'function closeSaleResultOverlay()')
  const legacyPrint = sourceBetween(printHandler, 'const runLegacyPrint = () =>', 'void submitV3LocalTickets')
  assert.match(cashier, /handlePrintReceipt\(saleResult\.receipt, saleResult\.kitchenTicket\)/)
  assert.match(legacyPrint, /printDesktopReceipt\(receipt, lang/)
  assert.match(printHandler, /submitDesktopReceiptPrint\(\{[\s\S]*legacyPrint: runLegacyPrint/)
  assert.doesNotMatch(legacyPrint, /submitEshopTray02CloudPrint\(|renderTicketHtmlToEscPosRaw\(/)
})

test('Desktop Records delegates 补打小票 to canonical OrderDetail V3 recovery', () => {
  assert.match(records, /canonicalOrderNo: item\.orderNo/)
  assert.match(records, /setSelectedOrderNo\(entry\.canonicalOrderNo\)/)
  assert.doesNotMatch(records, /handleSaleRecordReprint|printDesktopReceipt|DesktopReceiptPreview/)
  assert.match(orderDetail, /getOrCreateV3ReprintIntent/)
})

test('OrderDetailSheet remains the sole owner of legacy and V3 rendering/enqueue selection', () => {
  assert.equal((orderDetail.match(/const readEnableState =/g) ?? []).length, 1)
  assert.equal((orderDetail.match(/renderTicketHtmlToEscPosRaw\(html\)/g) ?? []).length, 2)
  assert.equal((orderDetail.match(/const submitPrint =/g) ?? []).length, 1)
  assert.equal((orderDetail.match(/await submitPrint\(/g) ?? []).length, 1)
})

console.log(`es-tray Desktop POS entry tests passed (${cases} cases)`)
