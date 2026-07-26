import assert from 'node:assert/strict'
import fs from 'node:fs'

const cashier = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const qzAdapter = fs.readFileSync('lib/qzPrinterAdapter.ts', 'utf8')
const desktopReceipt = fs.readFileSync('app/components/DesktopReceipt.tsx', 'utf8')
const escposEncoder = fs.readFileSync('lib/receipt/escpos-encoder.ts', 'utf8')
const escposRenderer = fs.readFileSync('lib/receipt/render-desktop-receipt-escpos.ts', 'utf8')
const canvasRasterizer = fs.readFileSync('lib/receipt/rasterize-receipt-line-canvas.ts', 'utf8')

// --- Non-regression: the existing HTML pixel path must be untouched ---

assert.match(qzAdapter, /export async function printReceiptHtmlViaQz/, 'existing HTML pixel QZ path must still exist')
assert.match(qzAdapter, /type: 'pixel',\s*\n\s*format: 'html'/, 'existing HTML pixel job shape must be unchanged')
assert.match(qzAdapter, /export function shouldUseQzPrint/, 'existing QZ gate must be untouched')
assert.match(qzAdapter, /export async function submitDesktopReceiptPrint/, 'existing single choke-point submit function must still exist')
assert.match(desktopReceipt, /export function renderDesktopReceiptHtml/, 'existing HTML renderer used by both browser print and QZ pixel print must still exist')

// --- The experimental RAW path must be additive, not wired into the main gate ---

assert.match(qzAdapter, /export async function printReceiptEscPosBytesViaQz/, 'new ESC/POS RAW submit function must exist')
assert.match(qzAdapter, /type: 'raw',\s*\n\s*format: 'base64'/, 'RAW job must use QZ raw/base64, not the pixel HTML shape')

const shouldUseQzPrintBody = qzAdapter.slice(
  qzAdapter.indexOf('export function shouldUseQzPrint'),
  qzAdapter.indexOf('export async function submitDesktopReceiptPrint'),
)
assert.ok(
  !shouldUseQzPrintBody.includes('EscPos'),
  'the QZ print gate must not branch on the experimental ESC/POS path',
)

const submitDesktopReceiptPrintBody = qzAdapter.slice(qzAdapter.indexOf('export async function submitDesktopReceiptPrint'))
assert.ok(
  !submitDesktopReceiptPrintBody.includes('EscPos'),
  'the single production choke-point for customer receipt submission must not call the experimental RAW path',
)

// --- Cashier page wiring ---

assert.match(cashier, /printReceiptEscPosBytesViaQz/, 'cashier page must import the new RAW test function')
assert.match(cashier, /handleQzEscPosRawTest/, 'cashier page must expose the manual RAW test handler')
assert.match(
  cashier,
  /disabled=\{!qzSelectedPrinter \|\| !saleResult\?\.receipt\}/,
  'the RAW test button must require both a selected printer and a real completed-sale receipt snapshot',
)
assert.ok(
  !cashier.includes('handleQzEscPosRawTest()') || cashier.includes('void handleQzEscPosRawTest()'),
  'the RAW test must only run from an explicit manual click, never from an effect',
)

// The manual test handler itself must never call the production print
// choke point, so it cannot become a silent second auto-print path.
const handlerBody = cashier.slice(
  cashier.indexOf('async function handleQzEscPosRawTest'),
  cashier.indexOf('async function handleQzEscPosRawTest') + 900,
)
assert.ok(
  !handlerBody.includes('submitDesktopReceiptPrint('),
  'the experimental handler must not call the production submitDesktopReceiptPrint choke point',
)
assert.ok(
  !handlerBody.includes('finishReceiptPrintFlow'),
  'the experimental handler must not participate in the sale-completion print flow state machine',
)
assert.match(handlerBody, /const receipt = saleResult\?\.receipt/, 'the RAW receipt test must reuse the completed-sale receipt snapshot')
assert.match(
  handlerBody,
  /buildEscPosReceiptBase64\(receipt, lang, canvasLineRasterizer\)/,
  'the RAW receipt test must render the same receipt data with the local line rasterizer',
)
assert.match(
  handlerBody,
  /printReceiptEscPosBytesViaQz\(qzSelectedPrinter, base64\)/,
  'the manual RAW receipt test must submit only the rendered snapshot bytes',
)

// --- The database-free ASCII smoke test must stay outside the business flow ---

assert.match(cashier, /buildEscPosAsciiTestTicketBase64/, 'cashier must import the fixed ASCII RAW test-ticket builder')
assert.match(cashier, /handleQzEscPosAsciiTest/, 'cashier must expose the standalone ASCII RAW test handler')
assert.match(cashier, /ESC\/POS ASCII 通道测试/, 'the standalone ASCII RAW test button must remain visible in the QZ panel')

const asciiHandlerBody = cashier.slice(
  cashier.indexOf('async function handleQzEscPosAsciiTest'),
  cashier.indexOf('async function handleQzEscPosRawTest'),
)
assert.ok(!asciiHandlerBody.includes('saleResult'), 'ASCII RAW test must not read a completed sale snapshot')
assert.ok(!asciiHandlerBody.includes('buildEscPosReceiptBase64'), 'ASCII RAW test must not build a business receipt')
assert.ok(!asciiHandlerBody.includes('submitDesktopReceiptPrint('), 'ASCII RAW test must not use the production print choke point')
assert.ok(!asciiHandlerBody.includes('finishReceiptPrintFlow'), 'ASCII RAW test must not enter the completion print state machine')

// --- Non-ASCII labels and long text must preserve native ASCII values ---

assert.match(escposRenderer, /function rowOps/, 'mixed label/value rows must use the split operation builder')
assert.match(
  escposRenderer,
  /return \[leftOp\(label, bold\), leftOp\(value, bold\)\]/,
  'non-ASCII labels and ASCII values must be emitted separately',
)
assert.match(canvasRasterizer, /splitReceiptTextByMeasuredWidth/, 'canvas rasterizer must measure and split long text')
assert.match(canvasRasterizer, /measureCtx\.measureText\(value\)\.width/, 'wrapping must use Canvas measureText')
assert.doesNotMatch(canvasRasterizer, /fillText\([^\n]*style\.widthPx/, 'canvas must not use fillText maxWidth compression')

// --- All RAW tickets must share the five-line physical tail ---

assert.match(escposEncoder, /export const DEFAULT_TAIL_FEED_LINES = 5/, 'the shared tail default must be five lines')
assert.match(
  escposEncoder,
  /return builder\.feed\(DEFAULT_TAIL_FEED_LINES\)\.cut\(\)/,
  'the shared tail must feed immediately before cutting',
)
assert.doesNotMatch(escposEncoder, /\.feed\(3\)/, 'the encoder must not retain a hard-coded three-line tail')
assert.doesNotMatch(escposRenderer, /\.feed\(3\)/, 'the receipt renderer must not retain a separate hard-coded three-line tail')

console.log('escpos experiment static wiring tests passed')
