import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cashier = readFileSync(new URL('../app/cashier/page.tsx', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../lib/qzPrinterAdapter.ts', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../lib/qzHtmlBitmapRenderer.ts', import.meta.url), 'utf8')
const encoder = readFileSync(new URL('../lib/qzEscPosBitImage.ts', import.meta.url), 'utf8')
const receipt = readFileSync(new URL('../app/components/DesktopReceipt.tsx', import.meta.url), 'utf8')
const kitchen = readFileSync(new URL('../app/components/KitchenTicket.tsx', import.meta.url), 'utf8')

assert.match(adapter, /receipt:\s*'前台'/)
assert.match(adapter, /kitchen:\s*'厨房'/)
assert.match(adapter, /printers\.find\(\)/, 'the adapter must enumerate queues and check an exact controlled name')
assert.doesNotMatch(adapter, /getDefault|defaultPrinter/i, 'the RAW path must not use a default printer')
assert.match(adapter, /printHtmlAsEscPosBitImageViaFixedQzQueue/)
assert.match(adapter, /renderTicketHtmlToEscPosRaw/)
assert.match(adapter, /printCustomerReceiptViaQz[\s\S]*'receipt'/)
assert.match(adapter, /printKitchenTicketViaQz[\s\S]*'kitchen'/)
assert.match(adapter, /type:\s*'raw'/)
assert.match(adapter, /format:\s*'base64'/)

const rawLoader = adapter.slice(
  adapter.indexOf('async function loadRawQz'),
  adapter.indexOf('async function ensureConnected'),
)
assert.match(rawLoader, /import\('qz-tray\?raw-connection'\)/)
assert.doesNotMatch(rawLoader, /configureQzSigningSecurity\(/)
assert.doesNotMatch(rawLoader, /resolve\(''\)/)

const rawAdapter = adapter.slice(adapter.indexOf('export async function printEscPosBitImageViaFixedQzQueue'))
assert.match(rawAdapter, /loadRawQz\(\)/)
assert.doesNotMatch(rawAdapter, /window\.print|legacyPrint/, 'RAW failures must not fall back to browser printing')

const authenticatedRawSecurity = adapter.slice(
  adapter.indexOf('function configureRawAuthenticatedSecurity'),
  adapter.indexOf('async function loadRawQz'),
)
assert.match(authenticatedRawSecurity, /configureQzSigningSecurity\(qz\)/)

const rawConnection = adapter.slice(
  adapter.indexOf('async function ensureConnected'),
  adapter.indexOf('async function ensureFixedQueueConnected'),
)
assert.match(rawConnection, /if \(mode === 'raw'\) configureRawAuthenticatedSecurity\(qz\)[\s\S]*qz\.websocket\.connect/)

const rawEnumeration = adapter.slice(
  adapter.indexOf('export async function listQzPrinters'),
  adapter.indexOf('export async function printHelloWorldViaQz'),
)
assert.match(rawEnumeration, /ensureConnected\(qz, mode\)[\s\S]*if \(mode === 'raw'\) configureRawAuthenticatedSecurity\(qz\)[\s\S]*qz\.printers\.find\(\)/)

const rawPrint = adapter.slice(
  adapter.indexOf('export async function printEscPosBitImageViaFixedQzQueue'),
  adapter.indexOf('export type QzHtmlRasterizer'),
)
assert.match(rawPrint, /ensureFixedQueueConnected\(qz, queueName\)[\s\S]*configureRawAuthenticatedSecurity\(qz\)[\s\S]*assertQueueExists\(qz, queueName\)[\s\S]*qz\.print\(config/)

assert.match(renderer, /QZ_RAW_PRINTABLE_WIDTH_PX = 576/)
assert.match(renderer, /import\('html2canvas'\)/)
assert.match(renderer, /document\.fonts\.ready/)
assert.match(renderer, /document\.images/)
assert.match(renderer, /body\.firstElementChild/)
assert.match(renderer, /removeScreenPreviewCss/)
assert.match(renderer, /encodeRgbaToEscPosEscStar24/)
assert.match(renderer, /frame\.remove\(\)/)
assert.doesNotMatch(renderer, /window\.print|printHtmlViaFixedQzQueue/)

assert.match(encoder, /ESC_POS_BIT_IMAGE_MODE_24_DOUBLE_DENSITY = 0x21/)
assert.match(encoder, /ESC_POS_ESC, 0x64, 0x03/)
assert.match(encoder, /ESC_POS_FULL_CUT/)
assert.match(encoder, /\.\.\.ESC_POS_FULL_CUT/)

assert.match(receipt, /export function renderDesktopReceiptHtml/)
assert.match(kitchen, /getKitchenTicketHtmlForTest/)
assert.match(cashier, /data-qz-dual-queue-print="raw"/)
assert.match(cashier, /data-qz-print-kind="receipt"/)
assert.match(cashier, /data-qz-print-kind="kitchen"/)
assert.match(cashier, /顾客票 → 前台/)
assert.match(cashier, /厨房票 → 厨房/)

console.log('QZ dual-queue static tests passed')
