import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cashier = readFileSync(new URL('../app/cashier/page.tsx', import.meta.url), 'utf8')
const access = readFileSync(new URL('../app/api/cashier/access/route.ts', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../lib/qzPrinterAdapter.ts', import.meta.url), 'utf8')

assert.match(cashier, /const submitRawTicket = useCallback/)
assert.match(cashier, /printCustomerReceiptViaQz\(renderDesktopReceiptHtml\(receipt, lang\)\)/)
assert.match(cashier, /printKitchenTicketViaQz\(getKitchenTicketHtmlForTest\(ticket, lang\)\)/)
assert.match(adapter, /printHtmlAsEscPosBitImageViaFixedQzQueue\('receipt'/)
assert.match(adapter, /printHtmlAsEscPosBitImageViaFixedQzQueue\('kitchen'/)

assert.match(cashier, /QZ_BUSINESS_RAW_PREVIEW_ACTIVE/)
assert.match(cashier, /QZ_PREVIEW_LABEL === 'QZ-PRINT-02D'/)
assert.match(cashier, /\^\[0-9a-f\]\{40\}\$/)
assert.match(cashier, /QZ_BUSINESS_RAW_PREVIEW_ACTIVE \|\| qzRawCanaryAuthorized/)
assert.match(cashier, /const qzClientMode = qzRawBusinessActive \? 'raw' : 'signed'/)
assert.match(cashier, /listQzPrinters\(undefined, qzClientMode\)/)
const qzStatusRefresh = cashier.slice(
  cashier.indexOf('const handleRefreshQzStatus = useCallback'),
  cashier.indexOf('function handleQzPrintToggle'),
)
assert.doesNotMatch(qzStatusRefresh, /detectQzOnline/, 'RAW status refresh must not stop between signed connect and enumeration')
assert.ok(
  qzStatusRefresh.indexOf('listQzPrinters(undefined, qzClientMode)') < qzStatusRefresh.indexOf("setQzStatus('online')"),
  'RAW status refresh must enumerate printers before reporting QZ online',
)
assert.ok(
  qzStatusRefresh.indexOf('setQzPrinters(printers)') < qzStatusRefresh.indexOf("setQzStatus('online')"),
  'the enumerated printer list must reach UI state before QZ reports online',
)
assert.match(adapter, /return mode === 'raw' \? loadRawQz\(\) : loadQz\(\)/)
assert.match(cashier, /if \(qzRawBusinessActive\) \{[\s\S]*handleControlledQzPrint\('receipt', receipt, kitchenTicket\)/)

assert.match(cashier, /data-qz-print-kind="receipt"[\s\S]*handleControlledQzPrint\('receipt', saleResult\.receipt!/)
assert.match(cashier, /data-qz-print-kind="kitchen"[\s\S]*handleControlledQzPrint\('kitchen', saleResult\.receipt!/)
assert.match(cashier, /qzPrintInFlightRef = useRef<Set<QzPrintKind>>\(new Set\(\)\)/)
assert.match(cashier, /qzPrintInFlightRef\.current\.has\(kind\)/)
assert.match(cashier, /qzPrintInFlightRef\.current\.delete\(kind\)/)

assert.match(access, /const QZ_RAW_CANARY_STORE_CODE = 'ST169E7000'/)
assert.match(access, /process\.env\.QZ_RAW_CANARY_ENABLED === '1'/)
assert.match(access, /verifyPosDeviceRequest\(req, expectedStore\)/)
assert.match(access, /deviceAuth\?\.browserPosSessionId/)
assert.match(access, /browserPosDeviceId: deviceAuth\.browserPosSessionId/)
assert.match(access, /binding:\s*\{\s*tenantId: store\.tenantId,\s*storeId: store\.id/)
assert.match(cashier, /headers: posDeviceHeaders\(sc\)/)
assert.match(cashier, /setQzRawCanaryAuthorized\(body\.qzRawCanary === true\)/)

const rawHandoff = cashier.slice(
  cashier.indexOf('const submitRawTicket = useCallback'),
  cashier.indexOf('const handlePrintReceipt = useCallback'),
)
assert.doesNotMatch(rawHandoff, /printDesktopReceipt|printKitchenTicket\(/, 'RAW handoff must not call browser printing')

console.log('QZ cashier RAW handoff static checks passed')
