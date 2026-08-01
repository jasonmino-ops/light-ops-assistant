import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/qz-print-test/page.tsx', import.meta.url), 'utf8')
const client = readFileSync(new URL('../app/qz-print-test/QzPrintTestClient.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')

assert.match(page, /process\.env\.VERCEL_ENV === 'preview'/)
assert.match(page, /QZ-PRINT-01C/)
assert.match(page, /ba9e599/)
assert.match(page, /notFound\(\)/)

assert.match(layout, /isQzPrintTestPath \? children/)
assert.match(client, /data-qz-print-test-page="QZ-PRINT-01C"/)
assert.match(client, /Commit: ba9e599/)
assert.match(client, /Environment: Preview/)
assert.match(client, /data-qz-status=/)
assert.match(client, /data-qz-printer-list/)
assert.match(client, /顾客测试票 → 前台/)
assert.match(client, /厨房测试票 → 厨房/)
assert.match(client, /printCustomerReceiptViaQz/)
assert.match(client, /printKitchenTicketViaQz/)
assert.match(client, /QZ_STATUS_TIMEOUT_MS = 8_000/)
assert.match(client, /qzStatus !== 'online'/)
assert.match(client, /!printers\.includes\(queueName\)/)
assert.doesNotMatch(client, /apiFetch|fetch\(|axios|\/api\//)
assert.doesNotMatch(client, /window\.print|printDesktopReceipt|printKitchenTicket\(/)
assert.doesNotMatch(client, /getDefault|defaultPrinter/i)
assert.doesNotMatch(client, /ComputerBinding|PaymentIntent|SaleRecord|customerId|productId|inventory/)

console.log('QZ standalone print test static checks passed')
