import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cashier = readFileSync(new URL('../app/cashier/page.tsx', import.meta.url), 'utf8')
const access = readFileSync(new URL('../app/api/cashier/access/route.ts', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../lib/qzPrinterAdapter.ts', import.meta.url), 'utf8')
const receipt = readFileSync(new URL('../app/components/DesktopReceipt.tsx', import.meta.url), 'utf8')

// The legacy renderer remains the unchanged path for every non-canary store.
assert.match(receipt, /export function printDesktopReceipt/)
assert.match(cashier, /import[\s\S]*printDesktopReceipt,[\s\S]*from '@\/app\/components\/DesktopReceipt'/)
assert.match(cashier, /const handleLegacyReceiptPrint = useCallback/)
assert.match(cashier, /if \(!qzRawBusinessActive\)[\s\S]*printDesktopReceipt\(receiptSnapshot/)
assert.match(cashier, /!qzRawBusinessActive && \([\s\S]*handleLegacyReceiptPrint\(saleResult\.receipt\)/)

// Both formal documents feed the same RAW adapter while preserving the two
// exact fixed routes.
assert.match(cashier, /const submitRawTicket = useCallback/)
assert.match(cashier, /printCustomerReceiptViaQz\(renderDesktopReceiptHtml\(receipt, lang\)\)/)
assert.match(cashier, /printKitchenTicketViaQz\(renderKitchenTicketHtml\(/)
assert.match(cashier, /items: receipt\.items\.map\(\(\{ name, spec, qty \}\) => \(\{ name, spec, qty \}\)\)/)
assert.match(adapter, /printHtmlAsEscPosBitImageViaFixedQzQueue\('receipt'/)
assert.match(adapter, /printHtmlAsEscPosBitImageViaFixedQzQueue\('kitchen'/)

// Canary sale overlay, receipt preview, Enter shortcut, and auto-print all use
// the same RAW customer path. Failures remain visible in independent state.
assert.match(cashier, /data-qz-print-kind="receipt"[\s\S]*handleControlledQzPrint\('receipt', saleResult\.receipt\)/)
assert.match(cashier, /data-qz-print-kind="kitchen"[\s\S]*handleControlledQzPrint\('kitchen', saleResult\.receipt\)/)
assert.match(cashier, /if \(qzRawBusinessActive\) \{[\s\S]*handleControlledQzPrint\('receipt', saleResult\.receipt!\)/)
assert.match(cashier, /if \(qzRawBusinessActive\) \{[\s\S]*handleControlledQzPrint\('receipt', printableReceipt\)/)
assert.match(cashier, /submitRawTicket\('receipt', receiptSnapshot\)/)
assert.match(cashier, /setQzReceiptTest\(\{ status: 'error', message \}\)/)
assert.match(cashier, /setQzKitchenTest/)
assert.match(cashier, /qzPrintInFlightRef = useRef<Set<QzPrintKind>>\(new Set\(\)\)/)
assert.match(cashier, /qzPrintInFlightRef\.current\.has\(kind\)/)
assert.match(cashier, /qzPrintInFlightRef\.current\.delete\(kind\)/)

// 02D remains available in Preview and is separately gated in Production.
assert.match(cashier, /QZ_BUSINESS_RAW_PREVIEW_ACTIVE/)
assert.match(cashier, /QZ_PREVIEW_LABEL === 'QZ-PRINT-02D'/)
assert.match(cashier, /\^\[0-9a-f\]\{40\}\$/)
assert.match(cashier, /data-qz-business-preview="QZ-PRINT-02D"/)
assert.match(cashier, /Commit: \{QZ_PREVIEW_COMMIT\}/)
assert.match(cashier, /Environment: Preview/)
assert.match(cashier, /Print Mode: ESC\/POS RAW/)

// Production canary is server-authorized: exact store + active signed Browser
// POS Session + a Launch Ticket / Computer Identity relationship. URL alone,
// an account session alone, and legacy device tokens all return false.
assert.match(access, /const QZ_RAW_CANARY_STORE_CODE = 'ST169E7000'/)
assert.match(access, /process\.env\.QZ_RAW_CANARY_ENABLED === '1'/)
assert.match(access, /verifyPosDeviceRequest\(req, expectedStore\)/)
assert.match(access, /deviceAuth\?\.browserPosSessionId/)
assert.match(access, /browserPosDeviceId: deviceAuth\.browserPosSessionId/)
assert.match(access, /binding:\s*\{\s*tenantId: store\.tenantId,\s*storeId: store\.id/)
assert.match(cashier, /headers: posDeviceHeaders\(sc\)/)
assert.match(cashier, /setQzRawCanaryAuthorized\(body\.qzRawCanary === true\)/)
assert.match(cashier, /QZ_BUSINESS_RAW_PREVIEW_ACTIVE \|\| qzRawCanaryAuthorized/)
assert.match(cashier, /data-qz-business-canary="QZ-PRINT-02D"/)
assert.match(cashier, /QZ-PRINT-02D CANARY/)
assert.match(cashier, /Store: ST169E7000/)

// Canary failures never fall through to browser printing. The only browser
// print calls are in the explicit !qzRawBusinessActive legacy branches.
assert.doesNotMatch(cashier, /window\.print\s*\(/)
assert.doesNotMatch(cashier, /catch[\s\S]{0,300}printDesktopReceipt/)

console.log('QZ cashier RAW handoff static checks passed')
