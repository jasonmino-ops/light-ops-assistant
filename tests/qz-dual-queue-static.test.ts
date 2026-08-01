import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cashier = readFileSync(new URL('../app/cashier/page.tsx', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../lib/qzPrinterAdapter.ts', import.meta.url), 'utf8')
const receipt = readFileSync(new URL('../app/components/DesktopReceipt.tsx', import.meta.url), 'utf8')
const kitchen = readFileSync(new URL('../app/components/KitchenTicket.tsx', import.meta.url), 'utf8')

assert.match(adapter, /receipt:\s*'前台'/)
assert.match(adapter, /kitchen:\s*'厨房'/)
assert.match(adapter, /printers\.find\(\)/, 'the adapter must enumerate queues and check an exact controlled name')
assert.doesNotMatch(adapter, /getDefault|defaultPrinter/i, 'the dual-queue path must not use a default printer')
assert.doesNotMatch(adapter, /window\.print|legacyPrint/, 'QZ failures must not fall back to browser printing')

assert.match(receipt, /export function renderDesktopReceiptHtml/)
assert.match(kitchen, /export function renderKitchenTicketHtml/)
assert.doesNotMatch(kitchen, /window\.print|window\.open/, 'the QZ KitchenTicket renderer must remain pure HTML')

assert.match(cashier, /data-qz-dual-queue-test="controlled"/)
assert.match(cashier, /data-qz-print-kind="receipt"/)
assert.match(cashier, /data-qz-print-kind="kitchen"/)
assert.match(cashier, /handleControlledQzPrint\('receipt', saleResult\.receipt\)/)
assert.match(cashier, /handleControlledQzPrint\('kitchen', saleResult\.receipt\)/)
assert.match(cashier, /items: receipt\.items\.map\(\(\{ name, spec, qty \}\) => \(\{ name, spec, qty \}\)\)/)
assert.equal(
  (cashier.match(/printCustomerReceiptViaQz\(/g) ?? []).length,
  1,
  'customer QZ submission must only exist in the explicit controlled handler',
)
assert.equal(
  (cashier.match(/printKitchenTicketViaQz\(/g) ?? []).length,
  1,
  'kitchen QZ submission must only exist in the explicit controlled handler',
)
assert.match(cashier, /const \[qzReceiptTest, setQzReceiptTest\]/)
assert.match(cashier, /const \[qzKitchenTest, setQzKitchenTest\]/)
assert.match(cashier, /未找到 Windows 打印队列/)
assert.match(cashier, /QZ Tray 不可用/)

console.log('QZ dual-queue static tests passed')
