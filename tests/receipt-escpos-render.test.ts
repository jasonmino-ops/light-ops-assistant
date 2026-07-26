import assert from 'node:assert/strict'
import { isAsciiPrintableLine } from '../lib/receipt/receipt-text-charset'
import {
  buildEscPosReceiptPlan,
  buildEscPosReceiptBase64,
  renderEscPosReceiptBytes,
  ESC_POS_DEFAULT_CHAR_WIDTH,
  type LineRasterizer,
} from '../lib/receipt/render-desktop-receipt-escpos'
import {
  DEFAULT_TAIL_FEED_LINES,
  buildEscPosAsciiTestTicketBase64,
  bytesToBase64,
  ESC,
  GS,
  type MonoBitmap,
} from '../lib/receipt/escpos-encoder'
import { splitReceiptTextByMeasuredWidth } from '../lib/receipt/rasterize-receipt-line-canvas'
import type { DesktopReceiptData } from '../app/components/DesktopReceipt'

function fakeRasterizer(calls: { text: string }[] = []): LineRasterizer {
  return (text) => {
    calls.push({ text })
    const widthPx = 16
    const heightPx = 1
    return [{ widthPx, heightPx, packedRows: new Uint8Array(Math.ceil(widthPx / 8) * heightPx) } as MonoBitmap]
  }
}

function sampleReceipt(overrides: Partial<DesktopReceiptData> = {}): DesktopReceiptData {
  return {
    storeName: 'Mino Pet Shop',
    orderNo: 'SO-20260726-001',
    createdAt: '2026-07-26T10:30:00.000Z',
    cashierName: 'Alice',
    paymentMethod: 'CASH',
    totalAmount: 12.5,
    currencyCode: 'USD',
    items: [
      { name: 'Dog Food', qty: 2, price: 5, lineAmount: 10 },
      { name: 'Leash', qty: 1, price: 2.5, lineAmount: 2.5 },
    ],
    ...overrides,
  }
}

function testIsAsciiPrintableLine() {
  assert.equal(isAsciiPrintableLine('Order No 123 $4.50'), true)
  assert.equal(isAsciiPrintableLine('订单号'), false)
  assert.equal(isAsciiPrintableLine('KHQR'), true)
  assert.equal(isAsciiPrintableLine('សូមអរគុណ'), false)
  assert.equal(isAsciiPrintableLine('space separated'), true)
  // Control characters (e.g. the tab used to join label/value for the
  // raster fallback) are correctly rejected — only 0x20-0x7E is printable.
  assert.equal(isAsciiPrintableLine('tab\tseparated'), false)
}

function testAllAsciiEnglishReceiptStaysOnTextPath() {
  const receipt = sampleReceipt()
  const plan = buildEscPosReceiptPlan(receipt, 'en')
  const rasterOps = plan.filter((op) => op.kind === 'raster')
  assert.equal(rasterOps.length, 0, 'a fully English/ASCII receipt must never need the bitmap fallback')
  assert.ok(plan.some((op) => op.kind === 'cut'), 'plan must end with a cut command')
  assert.ok(plan.some((op) => op.kind === 'divider'), 'plan must include dashed dividers')
}

function testChineseStoreNameAndLabelsUseBitmapFallback() {
  const receipt = sampleReceipt({ storeName: '猫舍宠物店', items: [{ name: '猫粮', qty: 1, price: 8, lineAmount: 8 }] })
  const plan = buildEscPosReceiptPlan(receipt, 'zh')
  const rasterTexts = plan.filter((op) => op.kind === 'raster').map((op) => (op as { text: string }).text)
  assert.ok(rasterTexts.some((text) => text.includes('猫舍宠物店')), 'Chinese store name must be rasterized')
  assert.ok(rasterTexts.some((text) => text.includes('猫粮')), 'Chinese item name must be rasterized')
  // Chinese labels are rasterized separately, while the ASCII order number
  // remains a native ESC/POS text line.
  assert.ok(!rasterTexts.some((text) => text.includes('SO-20260726-001')))
  // qty x price / amount has no label to pair with and stays pure ASCII text.
  const textOps = plan.filter((op) => op.kind === 'text').map((op) => (op as { text: string }).text)
  assert.ok(textOps.some((text) => text.includes('SO-20260726-001')))
  assert.ok(textOps.some((text) => text.includes('2026') && text.includes(':')), 'ASCII receipt time must remain native text')
  assert.ok(textOps.some((text) => text.includes('$8.00')), 'ASCII total amount must remain native text')
  assert.ok(textOps.some((text) => text.includes('1 x $8.00')))
}

function testKhmerLabelsUseBitmapFallbackForLabelOnly() {
  const receipt = sampleReceipt()
  const plan = buildEscPosReceiptPlan(receipt, 'km')
  const rasterOps = plan.filter((op) => op.kind === 'raster')
  assert.ok(rasterOps.length > 0, 'Khmer labels must trigger the bitmap fallback for label rows')
  const textOps = plan.filter((op) => op.kind === 'text').map((op) => (op as { text: string }).text)
  assert.ok(textOps.some((text) => text.includes('SO-20260726-001')), 'ASCII order number must remain native text')
}

function testMoneyAndQuantityLinesAreAlwaysAsciiText() {
  // Even in zh/km, qty/price/amount formatting (lib/currency.ts) is always
  // plain ASCII, so the calc/amount row must never be rasterized.
  for (const lang of ['zh', 'km'] as const) {
    const receipt = sampleReceipt({ items: [{ name: 'x', qty: 3, price: 1.25, lineAmount: 3.75 }] })
    const plan = buildEscPosReceiptPlan(receipt, lang)
    const textOps = plan.filter((op) => op.kind === 'text').map((op) => (op as { text: string }).text)
    assert.ok(textOps.some((text) => text.includes('3 x $1.25') && text.includes('$3.75')))
  }
}

function testLongItemNameIsPassedWholeToRasterizerForWrapping() {
  const longName = 'A'.repeat(80) + '长' // forces bitmap path via the trailing CJK char
  const receipt = sampleReceipt({ items: [{ name: longName, qty: 1, price: 1, lineAmount: 1 }] })
  const plan = buildEscPosReceiptPlan(receipt, 'en')
  const rasterOps = plan.filter((op) => op.kind === 'raster').map((op) => (op as { text: string }).text)
  assert.ok(rasterOps.some((text) => text === longName), 'the rasterizer receives the full name and owns wrapping/measurement')
}

function testChineseAndKhmerLongTextWrapWithoutLossOrOverflow() {
  const measure = (value: string) => Array.from(value).length * 10
  for (const text of [
    '这是一个非常非常长的中文商品名称用于验证位图逐字符换行不会丢失内容',
    'នេះជាឈ្មោះទំនិញភាសាខ្មែរវែងណាស់សម្រាប់សាកល្បងការបំបែកបន្ទាត់ដោយមិនបាត់អក្សរ',
  ]) {
    const lines = splitReceiptTextByMeasuredWidth(text, 80, measure)
    assert.ok(lines.length > 1, 'long non-ASCII text must split into multiple raster lines')
    assert.equal(lines.join(''), text, 'all original characters must remain in order')
    assert.ok(lines.every((line) => measure(line) <= 80), 'no raster line may exceed the target width')
  }
}

function testRendererWritesEachWrappedBitmapLine() {
  const receipt = sampleReceipt({ items: [{ name: '长商品名', qty: 1, price: 1, lineAmount: 1 }] })
  const plan = buildEscPosReceiptPlan(receipt, 'en')
  const rasterizer: LineRasterizer = () => [
    { widthPx: 16, heightPx: 1, packedRows: new Uint8Array(2) },
    { widthPx: 16, heightPx: 1, packedRows: new Uint8Array(2) },
  ]
  const bytes = Array.from(renderEscPosReceiptBytes(plan, rasterizer))
  let rasterCount = 0
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === GS && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) rasterCount++
  }
  assert.ok(rasterCount >= 2, 'multiple wrapped bitmap lines must become multiple GS v 0 commands')
}

function testDividerWidthMatchesConfiguredCharWidth() {
  const receipt = sampleReceipt()
  const customWidth = 32
  const plan = buildEscPosReceiptPlan(receipt, 'en', { charWidth: customWidth })
  const dividers = plan.filter((op) => op.kind === 'divider')
  assert.ok(dividers.length > 0)
  for (const divider of dividers) assert.equal((divider as { width: number }).width, customWidth)
}

function testRenderBytesStartsWithInitAndEndsWithCut() {
  const receipt = sampleReceipt()
  const plan = buildEscPosReceiptPlan(receipt, 'en')
  const bytes = renderEscPosReceiptBytes(plan, fakeRasterizer())
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [ESC, 0x40])
  assert.deepEqual(
    Array.from(bytes.slice(-6)),
    [ESC, 0x64, DEFAULT_TAIL_FEED_LINES, GS, 0x56, 0x00],
    'the receipt tail must feed five lines immediately before cutting',
  )
}

function testRenderBytesInvokesRasterizerOnlyForNonAsciiLines() {
  const receipt = sampleReceipt({ storeName: '中文店铺' })
  const plan = buildEscPosReceiptPlan(receipt, 'en')
  const calls: { text: string }[] = []
  renderEscPosReceiptBytes(plan, fakeRasterizer(calls))
  assert.ok(calls.some((c) => c.text === '中文店铺'))
  assert.ok(!calls.some((c) => c.text.includes('SO-20260726-001')), 'ASCII order number must never reach the rasterizer')
}

function testBuildBase64MatchesManualPipeline() {
  const receipt = sampleReceipt()
  const rasterizer = fakeRasterizer()
  const base64 = buildEscPosReceiptBase64(receipt, 'en', rasterizer)
  const plan = buildEscPosReceiptPlan(receipt, 'en')
  const bytes = renderEscPosReceiptBytes(plan, rasterizer)
  assert.equal(base64, bytesToBase64(bytes))
}

function testExactlyOneCutAndNoTrailingBoldLeftOn() {
  const receipt = sampleReceipt()
  const plan = buildEscPosReceiptPlan(receipt, 'en')
  const bytes = Array.from(renderEscPosReceiptBytes(plan, fakeRasterizer()))
  let cutCount = 0
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === GS && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x00) cutCount++
  }
  assert.equal(cutCount, 1, 'exactly one cut command must be emitted')
  assert.deepEqual(bytes.slice(-3), [GS, 0x56, 0x00])
}

function testAsciiAndReceiptUseTheSameReceiptTail() {
  const asciiBytes = Array.from(new Uint8Array(Buffer.from(buildEscPosAsciiTestTicketBase64(), 'base64')))
  const receiptBytes = Array.from(renderEscPosReceiptBytes(buildEscPosReceiptPlan(sampleReceipt(), 'en'), fakeRasterizer()))
  const expectedTail = [ESC, 0x64, DEFAULT_TAIL_FEED_LINES, GS, 0x56, 0x00]
  assert.deepEqual(asciiBytes.slice(-expectedTail.length), expectedTail)
  assert.deepEqual(receiptBytes.slice(-expectedTail.length), expectedTail)
}

function testDefaultCharWidthIsExported() {
  assert.equal(typeof ESC_POS_DEFAULT_CHAR_WIDTH, 'number')
  assert.ok(ESC_POS_DEFAULT_CHAR_WIDTH > 0)
}

function run() {
  testIsAsciiPrintableLine()
  testAllAsciiEnglishReceiptStaysOnTextPath()
  testChineseStoreNameAndLabelsUseBitmapFallback()
  testKhmerLabelsUseBitmapFallbackForLabelOnly()
  testMoneyAndQuantityLinesAreAlwaysAsciiText()
  testLongItemNameIsPassedWholeToRasterizerForWrapping()
  testChineseAndKhmerLongTextWrapWithoutLossOrOverflow()
  testRendererWritesEachWrappedBitmapLine()
  testDividerWidthMatchesConfiguredCharWidth()
  testRenderBytesStartsWithInitAndEndsWithCut()
  testRenderBytesInvokesRasterizerOnlyForNonAsciiLines()
  testBuildBase64MatchesManualPipeline()
  testExactlyOneCutAndNoTrailingBoldLeftOn()
  testAsciiAndReceiptUseTheSameReceiptTail()
  testDefaultCharWidthIsExported()
  console.log('receipt escpos render tests passed')
}

run()
