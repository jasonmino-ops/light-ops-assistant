// Pure ESC/POS bit-image encoder for the controlled QZ-PRINT-02A Preview.
//
// The browser owns rasterization. This module only converts an RGBA bitmap
// into the legacy ESC * 0x21 (24-dot, double-density) byte stream expected by
// the two receipt printers. It has no QZ, DOM, order, or payment dependency.

export const ESC_POS_ESC = 0x1b
export const ESC_POS_BIT_IMAGE_MODE_24_DOUBLE_DENSITY = 0x21
export const ESC_POS_BIT_IMAGE_BAND_HEIGHT = 24

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export type RgbaBitmap = {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

function assertBitmap(bitmap: RgbaBitmap) {
  if (!Number.isInteger(bitmap.width) || bitmap.width <= 0 || bitmap.width > 0xffff) {
    throw new Error('ESCPOS_BIT_IMAGE_INVALID_WIDTH')
  }
  if (!Number.isInteger(bitmap.height) || bitmap.height <= 0) {
    throw new Error('ESCPOS_BIT_IMAGE_INVALID_HEIGHT')
  }
  if (bitmap.rgba.length !== bitmap.width * bitmap.height * 4) {
    throw new Error('ESCPOS_BIT_IMAGE_INVALID_RGBA_LENGTH')
  }
}

function isBlackPixel(bitmap: RgbaBitmap, x: number, y: number, threshold: number) {
  if (y >= bitmap.height) return false
  const offset = (y * bitmap.width + x) * 4
  const alpha = bitmap.rgba[offset + 3]
  if (alpha < 128) return false
  const luminance =
    bitmap.rgba[offset] * 0.299 +
    bitmap.rgba[offset + 1] * 0.587 +
    bitmap.rgba[offset + 2] * 0.114
  return luminance < threshold
}

/**
 * Encodes a monochrome image using ESC * 0x21.
 *
 * Each 24-dot horizontal band is emitted as:
 *   ESC * 0x21 nL nH + (width * 3 data bytes) + LF
 * Bit 7 is the top pixel of each 8-dot slice, matching ESC/POS bit-image
 * ordering. The line spacing is set to 24 dots for the image and restored
 * afterwards.
 */
export function encodeRgbaToEscPosEscStar24(
  bitmap: RgbaBitmap,
  threshold = 180,
): Uint8Array {
  assertBitmap(bitmap)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) {
    throw new Error('ESCPOS_BIT_IMAGE_INVALID_THRESHOLD')
  }

  const bytes: number[] = [
    ESC_POS_ESC, 0x40, // ESC @ — initialize
    ESC_POS_ESC, 0x33, ESC_POS_BIT_IMAGE_BAND_HEIGHT, // ESC 3 24 — band spacing
  ]
  const widthLow = bitmap.width & 0xff
  const widthHigh = (bitmap.width >> 8) & 0xff

  for (let bandY = 0; bandY < bitmap.height; bandY += ESC_POS_BIT_IMAGE_BAND_HEIGHT) {
    bytes.push(
      ESC_POS_ESC,
      0x2a,
      ESC_POS_BIT_IMAGE_MODE_24_DOUBLE_DENSITY,
      widthLow,
      widthHigh,
    )

    for (let x = 0; x < bitmap.width; x += 1) {
      for (let slice = 0; slice < 3; slice += 1) {
        let packed = 0
        for (let bit = 0; bit < 8; bit += 1) {
          const y = bandY + slice * 8 + bit
          if (isBlackPixel(bitmap, x, y, threshold)) packed |= 0x80 >> bit
        }
        bytes.push(packed)
      }
    }
    bytes.push(0x0a)
  }

  bytes.push(
    ESC_POS_ESC, 0x32, // ESC 2 — restore default line spacing
    ESC_POS_ESC, 0x64, 0x03, // ESC d 3 — feed three lines, no cutter command
  )
  return Uint8Array.from(bytes)
}

/** Browser/Node-neutral base64 encoding for QZ RAW payloads. */
export function qzRawBytesToBase64(bytes: Uint8Array): string {
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : undefined
    const third = index + 2 < bytes.length ? bytes[index + 2] : undefined
    encoded += BASE64_ALPHABET[first >> 2]
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | (second === undefined ? 0 : second >> 4)]
    encoded += second === undefined
      ? '='
      : BASE64_ALPHABET[((second & 0x0f) << 2) | (third === undefined ? 0 : third >> 6)]
    encoded += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f]
  }
  return encoded
}
