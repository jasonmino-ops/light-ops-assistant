import assert from 'node:assert/strict'
import {
  ESC_POS_BIT_IMAGE_BAND_HEIGHT,
  ESC_POS_BIT_IMAGE_MODE_24_DOUBLE_DENSITY,
  ESC_POS_FULL_CUT,
  encodeRgbaToEscPosEscStar24,
  qzRawBytesToBase64,
} from '../lib/qzEscPosBitImage'

function rgbaBitmap(width: number, height: number, isBlack: (x: number, y: number) => boolean) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const value = isBlack(x, y) ? 0 : 255
      rgba[offset] = value
      rgba[offset + 1] = value
      rgba[offset + 2] = value
      rgba[offset + 3] = 255
    }
  }
  return { width, height, rgba }
}

function testOneBlackColumnUsesEscStar24() {
  const result = encodeRgbaToEscPosEscStar24(rgbaBitmap(1, 24, () => true))
  assert.equal(ESC_POS_BIT_IMAGE_BAND_HEIGHT, 24)
  assert.equal(ESC_POS_BIT_IMAGE_MODE_24_DOUBLE_DENSITY, 0x21)
  assert.deepEqual(Array.from(result), [
    0x1b, 0x40,
    0x1b, 0x33, 0x18,
    0x1b, 0x2a, 0x21, 0x01, 0x00,
    0xff, 0xff, 0xff,
    0x0a,
    0x1b, 0x32,
    0x1b, 0x64, 0x03,
    0x1d, 0x56, 0x00,
  ])
  assert.deepEqual(ESC_POS_FULL_CUT, [0x1d, 0x56, 0x00])
}

function testMsbFirstPackingAndBandPadding() {
  const result = encodeRgbaToEscPosEscStar24(
    rgbaBitmap(1, 25, (_x, y) => y === 0 || y === 7 || y === 8 || y === 23 || y === 24),
  )
  const firstBandDataOffset = 10
  assert.deepEqual(Array.from(result.slice(firstBandDataOffset, firstBandDataOffset + 3)), [0x81, 0x80, 0x01])
  const secondBandHeaderOffset = 14
  assert.deepEqual(Array.from(result.slice(secondBandHeaderOffset, secondBandHeaderOffset + 5)), [0x1b, 0x2a, 0x21, 0x01, 0x00])
  assert.deepEqual(Array.from(result.slice(secondBandHeaderOffset + 5, secondBandHeaderOffset + 8)), [0x80, 0x00, 0x00])
}

function testBase64AndValidation() {
  assert.equal(qzRawBytesToBase64(Uint8Array.from([0x00, 0x01, 0x02])), 'AAEC')
  assert.equal(qzRawBytesToBase64(Uint8Array.from([0xff])), '/w==')
  assert.throws(
    () => encodeRgbaToEscPosEscStar24({ width: 2, height: 1, rgba: new Uint8ClampedArray(4) }),
    /ESCPOS_BIT_IMAGE_INVALID_RGBA_LENGTH/,
  )
}

function testFeedsThenCutsExactlyOnceAtPayloadEnd() {
  const result = encodeRgbaToEscPosEscStar24(rgbaBitmap(2, 48, (x, y) => x === y % 2))
  const cutOffsets: number[] = []
  for (let index = 0; index <= result.length - 3; index += 1) {
    if (result[index] === 0x1d && result[index + 1] === 0x56 && result[index + 2] === 0x00) {
      cutOffsets.push(index)
    }
  }

  assert.deepEqual(Array.from(result.slice(-8)), [
    0x1b, 0x32,
    0x1b, 0x64, 0x03,
    0x1d, 0x56, 0x00,
  ])
  assert.deepEqual(cutOffsets, [result.length - 3], 'the payload must contain one cutter command at its end')
}

testOneBlackColumnUsesEscStar24()
testMsbFirstPackingAndBandPadding()
testBase64AndValidation()
testFeedsThenCutsExactlyOnceAtPayloadEnd()
console.log('QZ ESC/POS ESC * 0x21 bit-image tests passed')
