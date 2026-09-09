import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReportImageCard } from '../app/product-sales/ReportImageCard'
import { reportRange } from '../lib/product-sales/dates'
import type { ProductSalesResult } from '../lib/product-sales/contract'
import { COPY } from '../lib/product-sales/copy'
import { IMAGE_COPY } from '../lib/product-sales/image-copy'
import { canShareReportImage, downloadReportImage, reportImageFilename, reportImageScale, waitForReportImage } from '../lib/product-sales/image'

const now = new Date('2026-09-09T05:12:34Z')
const result: ProductSalesResult = {
  range: reportRange({ period: 'TODAY' }, now), generatedAt: now.toISOString(), groupName: '重点商品 ក្រុមកាហ្វេ',
  stores: [{ tenantId: 'ta', storeId: 'sa', storeName: '金边一店', currencyCode: 'USD' }, { tenantId: 'tb', storeId: 'sb', storeName: 'ហាងទី២', currencyCode: 'KHR' }],
  rows: [
    { tenantId: 'ta', storeId: 'sa', productId: 'p1', name: '同名 <script>bad()</script>', barcode: '100', quantity: '1.50', salesAmount: '9007199254740993.01', refundAmount: '0.25' },
    { tenantId: 'tb', storeId: 'sb', productId: 'p2', name: '同名 កាហ្វេ', barcode: '200', quantity: '2.00', salesAmount: '4000.00', refundAmount: '0.00' },
  ],
  totals: [{ currencyCode: 'USD', quantity: '1.50', salesAmount: '9007199254740993.01', refundAmount: '0.25' }, { currencyCode: 'KHR', quantity: '2.00', salesAmount: '4000.00', refundAmount: '0.00' }],
  unidentifiedSales: 1, unidentifiedRefunds: 1,
}

test('image card preserves current strings, store identity, currencies, cutoff and warnings in every locale', () => {
  const before = JSON.stringify(result)
  for (const lang of ['zh', 'en', 'km'] as const) {
    const html = renderToStaticMarkup(React.createElement(ReportImageCard, { result, lang }))
    for (const text of [IMAGE_COPY[lang].title, result.groupName!, '金边一店', 'ហាងទី២', '9007199254740993.01', '4000.00', '1.50', '2.00', '0.25', 'USD', 'KHR', '2026-09-09 00:00:00', '2026-09-09 12:12:34', COPY[lang].incomplete, COPY[lang].refundIncomplete]) assert.ok(html.includes(text), text)
    assert.equal((html.match(/data-report-image-row=/g) ?? []).length, 2)
    assert.equal((html.match(/data-report-image-total=/g) ?? []).length, 2)
    assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'))
    assert.ok(!html.includes('<script>'))
  }
  assert.equal(JSON.stringify(result), before)
})

test('historical report uses its own group and dates; long names and every row are retained', () => {
  const historical = { ...result, range: reportRange({ period: 'YESTERDAY' }, now), groupName: '历史日报' }
  const longName = 'កាហ្វេទឹកដោះគោ 中文 English '.repeat(25)
  historical.rows = Array.from({ length: 100 }, (_, i) => ({ ...result.rows[0], productId: `p${i}`, name: `${i}:${longName}` }))
  const html = renderToStaticMarkup(React.createElement(ReportImageCard, { result: historical, lang: 'zh' }))
  assert.ok(html.includes('历史日报'))
  assert.ok(html.includes('2026-09-08 00:00:00'))
  assert.ok(html.includes('2026-09-09 00:00:00'))
  assert.ok(html.includes(`99:${longName}`))
  assert.equal((html.match(/data-report-image-row=/g) ?? []).length, 100)
  assert.equal(reportImageFilename(historical), 'product-sales-2026-09-08-2026-09-08.png')
})

test('canvas bounds retain readable scale and reject oversized results instead of cropping', () => {
  assert.equal(reportImageScale(360, 1000), 2)
  const scale = reportImageScale(360, 18000)
  assert.ok(scale >= 1 && scale < 2)
  assert.ok(360 * 18000 * scale * scale <= 8_000_001)
  assert.throws(() => reportImageScale(360, 40000), /IMAGE_TOO_LARGE/)
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => reportImageScale(360, value), /IMAGE_FAILED/)
})

test('generation/share waits settle on success, failure, timeout and cancel; late failures stay observed', async () => {
  assert.equal(await waitForReportImage(Promise.resolve('ready'), new AbortController().signal, 100), 'ready')
  await assert.rejects(waitForReportImage(Promise.reject(new Error('render failed')), new AbortController().signal, 100), /render failed/)
  let rejectLate!: (error: Error) => void
  const late = new Promise<void>((_, reject) => { rejectLate = reject })
  await assert.rejects(waitForReportImage(late, new AbortController().signal, 5), /IMAGE_TIMEOUT/)
  rejectLate(new Error('late callback'))
  const controller = new AbortController()
  const pending = waitForReportImage(new Promise(() => {}), controller.signal, 100)
  controller.abort()
  await assert.rejects(pending, /IMAGE_CANCELLED/)
  await assert.rejects(waitForReportImage(Promise.reject(new Error('already aborted rejection')), controller.signal, 100), /IMAGE_CANCELLED/)
})

test('existing browser file-share detection and explicit download keep preview URL ownership', () => {
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const file = new File(['png'], 'report.png', { type: 'image/png' })
  let clicked = 0, removed = 0, appended = 0
  const anchor = { href: '', download: '', click: () => { clicked++ }, remove: () => { removed++ } }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { share: async () => {}, canShare: ({ files }: { files: File[] }) => files[0] === file } })
    assert.equal(canShareReportImage(file), true)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { share: async () => {}, canShare: () => { throw Error('unsupported') } } })
    assert.equal(canShareReportImage(file), false)
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    assert.equal(canShareReportImage(file), false)
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { appendChild: () => { appended++ } } } })
    downloadReportImage('blob:local-preview', 'report.png')
    assert.equal(anchor.href, 'blob:local-preview'); assert.equal(anchor.download, 'report.png')
    assert.equal(clicked, 1); assert.equal(appended, 1); assert.equal(removed, 1)
    anchor.click = () => { throw Error('save blocked') }
    assert.throws(() => downloadReportImage('blob:local-preview', 'report.png'), /save blocked/)
    assert.equal(removed, 2)
  } finally {
    if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else Reflect.deleteProperty(globalThis, 'navigator')
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document')
  }
})
