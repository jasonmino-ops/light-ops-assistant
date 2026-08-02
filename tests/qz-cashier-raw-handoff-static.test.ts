import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cashier = readFileSync(new URL('../app/cashier/page.tsx', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../lib/qzPrinterAdapter.ts', import.meta.url), 'utf8')
const receipt = readFileSync(new URL('../app/components/DesktopReceipt.tsx', import.meta.url), 'utf8')

// The legacy browser renderer remains an asset, but /cashier must not import
// or invoke it from any normal sale-success action.
assert.match(receipt, /export function printDesktopReceipt/)
assert.doesNotMatch(cashier, /\bprintDesktopReceipt\b/)
assert.doesNotMatch(cashier, /\bhandlePrintReceipt\b/)
assert.doesNotMatch(cashier, /receiptPrintLockedRef|finishReceiptPrintFlow/)

// Both formal documents feed the same RAW adapter while preserving the two
// exact fixed routes.
assert.match(cashier, /const submitRawTicket = useCallback/)
assert.match(cashier, /printCustomerReceiptViaQz\(renderDesktopReceiptHtml\(receipt, lang\)\)/)
assert.match(cashier, /printKitchenTicketViaQz\(renderKitchenTicketHtml\(/)
assert.match(cashier, /items: receipt\.items\.map\(\(\{ name, spec, qty \}\) => \(\{ name, spec, qty \}\)\)/)
assert.match(adapter, /printHtmlAsEscPosBitImageViaFixedQzQueue\('receipt'/)
assert.match(adapter, /printHtmlAsEscPosBitImageViaFixedQzQueue\('kitchen'/)

// Sale overlay, receipt preview, Enter shortcut, and auto-print all use the
// same RAW customer path. Failures remain visible in independent state.
assert.match(cashier, /data-qz-print-kind="receipt"[\s\S]*handleControlledQzPrint\('receipt', saleResult\.receipt\)/)
assert.match(cashier, /data-qz-print-kind="kitchen"[\s\S]*handleControlledQzPrint\('kitchen', saleResult\.receipt\)/)
assert.match(cashier, /onPrint=\{\(\) => void handleControlledQzPrint\('receipt', saleResult\.receipt!\)\}/)
assert.match(cashier, /void handleControlledQzPrint\('receipt', printableReceipt\)/)
assert.match(cashier, /submitRawTicket\('receipt', receiptSnapshot\)/)
assert.match(cashier, /setQzReceiptTest\(\{ status: 'error', message \}\)/)
assert.match(cashier, /setQzKitchenTest/)
assert.match(cashier, /qzPrintInFlightRef = useRef<Set<QzPrintKind>>\(new Set\(\)\)/)
assert.match(cashier, /qzPrintInFlightRef\.current\.has\(kind\)/)
assert.match(cashier, /qzPrintInFlightRef\.current\.delete\(kind\)/)

// 02D is visibly and exclusively marked by Preview build environment values.
assert.match(cashier, /QZ_BUSINESS_RAW_PREVIEW_ACTIVE/)
assert.match(cashier, /QZ_PREVIEW_LABEL === 'QZ-PRINT-02D'/)
assert.match(cashier, /\^\[0-9a-f\]\{40\}\$/)
assert.match(cashier, /data-qz-business-preview="QZ-PRINT-02D"/)
assert.match(cashier, /Commit: \{QZ_PREVIEW_COMMIT\}/)
assert.match(cashier, /Environment: Preview/)
assert.match(cashier, /Print Mode: ESC\/POS RAW/)

// No automatic browser-print fallback is reachable from /cashier.
assert.doesNotMatch(cashier, /window\.print\s*\(/)
assert.doesNotMatch(cashier, /Open browser print after sale|自动打开浏览器打印|print browser បន្ទាប់ពីលក់/)

console.log('QZ cashier RAW handoff static checks passed')
