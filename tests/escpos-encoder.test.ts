import assert from 'node:assert/strict'
import {
  DEFAULT_TAIL_FEED_LINES,
  EscPosBuilder,
  buildEscPosAsciiTestTicketBase64,
  bytesToBase64,
  ESC,
  GS,
  type MonoBitmap,
} from '../lib/receipt/escpos-encoder'

function testInit() {
  const bytes = new EscPosBuilder().init().toBytes()
  assert.deepEqual(Array.from(bytes), [ESC, 0x40])
}

function testAlignCenterAndRight() {
  assert.deepEqual(Array.from(new EscPosBuilder().align('center').toBytes()), [ESC, 0x61, 1])
  assert.deepEqual(Array.from(new EscPosBuilder().align('right').toBytes()), [ESC, 0x61, 2])
  assert.deepEqual(Array.from(new EscPosBuilder().align('left').toBytes()), [ESC, 0x61, 0])
}

function testBoldToggle() {
  assert.deepEqual(Array.from(new EscPosBuilder().bold(true).toBytes()), [ESC, 0x45, 1])
  assert.deepEqual(Array.from(new EscPosBuilder().bold(false).toBytes()), [ESC, 0x45, 0])
}

function testTextAppendsAsciiBytes() {
  const bytes = new EscPosBuilder().text('AB').toBytes()
  assert.deepEqual(Array.from(bytes), [0x41, 0x42])
}

function testNewlineIsLineFeed() {
  assert.deepEqual(Array.from(new EscPosBuilder().newline().toBytes()), [0x0a])
}

function testFeedClampsToByteRange() {
  assert.deepEqual(
    Array.from(new EscPosBuilder().feed(DEFAULT_TAIL_FEED_LINES).toBytes()),
    [ESC, 0x64, DEFAULT_TAIL_FEED_LINES],
  )
  assert.deepEqual(Array.from(new EscPosBuilder().feed(999).toBytes()), [ESC, 0x64, 255])
  assert.deepEqual(Array.from(new EscPosBuilder().feed(-5).toBytes()), [ESC, 0x64, 0])
}

function testCutIsFullCut() {
  assert.deepEqual(Array.from(new EscPosBuilder().cut().toBytes()), [GS, 0x56, 0x00])
}

function testRasterHeaderAndPayload() {
  // 9px wide -> 2 bytes/row (ceil(9/8)); 2 rows.
  const bitmap: MonoBitmap = {
    widthPx: 9,
    heightPx: 2,
    packedRows: new Uint8Array([0b10000000, 0b00000000, 0b11111111, 0b10000000]),
  }
  const bytes = Array.from(new EscPosBuilder().raster(bitmap).toBytes())
  assert.deepEqual(bytes.slice(0, 4), [GS, 0x76, 0x30, 0x00])
  assert.deepEqual(bytes.slice(4, 6), [2, 0]) // bytesPerRow little-endian
  assert.deepEqual(bytes.slice(6, 8), [2, 0]) // heightPx little-endian
  assert.deepEqual(bytes.slice(8), [0b10000000, 0b00000000, 0b11111111, 0b10000000])
}

function testRasterRejectsMismatchedPayload() {
  const bitmap: MonoBitmap = { widthPx: 16, heightPx: 2, packedRows: new Uint8Array([0]) }
  assert.throws(() => new EscPosBuilder().raster(bitmap), /ESCPOS_RASTER_SIZE_MISMATCH/)
}

function testChainedBuildProducesExpectedOrder() {
  const bytes = new EscPosBuilder()
    .init()
    .align('center')
    .bold(true)
    .text('HI')
    .newline()
    .cut()
    .toBytes()
  assert.deepEqual(Array.from(bytes), [
    ESC, 0x40,
    ESC, 0x61, 1,
    ESC, 0x45, 1,
    0x48, 0x49,
    0x0a,
    GS, 0x56, 0x00,
  ])
}

function testBytesToBase64MatchesKnownVectors() {
  assert.equal(bytesToBase64(new TextEncoder().encode('')), '')
  assert.equal(bytesToBase64(new TextEncoder().encode('f')), 'Zg==')
  assert.equal(bytesToBase64(new TextEncoder().encode('fo')), 'Zm8=')
  assert.equal(bytesToBase64(new TextEncoder().encode('foo')), 'Zm9v')
  assert.equal(bytesToBase64(new TextEncoder().encode('foobar')), 'Zm9vYmFy')
}

function testToBase64MatchesToBytes() {
  const builder = new EscPosBuilder().init().text('Hi').cut()
  assert.equal(builder.toBase64(), bytesToBase64(builder.toBytes()))
}

function testAsciiTestTicketIsFixedAndSelfContained() {
  const bytes = new Uint8Array(Buffer.from(buildEscPosAsciiTestTicketBase64(), 'base64'))
  const text = String.fromCharCode(...bytes)
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [ESC, 0x40])
  assert.match(text, /E-SHOP ESC\/POS TEST/)
  assert.match(text, /ORDER: TEST-001/)
  assert.match(text, /ITEM: COFFEE x1/)
  assert.match(text, /TOTAL: 2\.00/)
  assert.equal(DEFAULT_TAIL_FEED_LINES, 5, 'the default receipt tail must feed five lines')
  assert.deepEqual(
    Array.from(bytes.slice(-6)),
    [ESC, 0x64, DEFAULT_TAIL_FEED_LINES, GS, 0x56, 0x00],
    'the shared receipt tail must feed five lines immediately before cutting',
  )
  let cutCount = 0
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === GS && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x00) cutCount++
  }
  assert.equal(cutCount, 1, 'the ASCII test ticket must have exactly one final cut')
}

function run() {
  testInit()
  testAlignCenterAndRight()
  testBoldToggle()
  testTextAppendsAsciiBytes()
  testNewlineIsLineFeed()
  testFeedClampsToByteRange()
  testCutIsFullCut()
  testRasterHeaderAndPayload()
  testRasterRejectsMismatchedPayload()
  testChainedBuildProducesExpectedOrder()
  testBytesToBase64MatchesKnownVectors()
  testToBase64MatchesToBytes()
  testAsciiTestTicketIsFixedAndSelfContained()
  console.log('escpos encoder tests passed')
}

run()
