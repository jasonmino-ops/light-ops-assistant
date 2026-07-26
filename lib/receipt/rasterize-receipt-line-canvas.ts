// Browser canvas rasterizer for the ESC/POS RAW experiment's CJK/Khmer
// bitmap fallback lines (EP-BR-ESCPOS-01).
//
// Only used for lines render-desktop-receipt-escpos.ts could not send as
// plain ESC/POS text (i.e. lines containing Chinese or Khmer characters).
// This never rasterizes the whole receipt — see that module for the
// text/bitmap split.
//
// Browser-only (uses `document.createElement('canvas')`); not imported by
// the pure layout/byte-assembly tests, which inject a fake rasterizer
// instead. Real bitmap output (actual glyph shapes, wrapping thresholds)
// can only be judged against a real printed sample — see the field
// verification plan.

import type { EscPosAlign } from './escpos-encoder'
import type { MonoBitmap } from './escpos-encoder'
import type { LineRasterizer } from './render-desktop-receipt-escpos'

const FONT_FAMILY =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans Khmer", "Khmer OS Battambang", "Arial", sans-serif'

/** Packs a 1bpp threshold of canvas ImageData into GS-v-0 row bytes (MSB first). */
function packMonochrome(imageData: ImageData, threshold: number): Uint8Array {
  const { width, height, data } = imageData
  const bytesPerRow = Math.ceil(width / 8)
  const packed = new Uint8Array(bytesPerRow * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      const a = data[offset + 3]
      const luminance = a === 0 ? 255 : (r * 299 + g * 587 + b * 114) / 1000
      if (luminance < threshold) {
        const byteIndex = y * bytesPerRow + (x >> 3)
        packed[byteIndex] |= 0x80 >> (x & 7)
      }
    }
  }
  return packed
}

/**
 * Splits text into display lines without dropping or horizontally scaling
 * characters. The caller supplies CanvasRenderingContext2D#measureText so
 * this pure helper can be covered by Node tests as well as the browser path.
 */
export function splitReceiptTextByMeasuredWidth(
  text: string,
  maxWidthPx: number,
  measure: (value: string) => number,
): string[] {
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    throw new Error('ESCPOS_RASTER_INVALID_WIDTH')
  }

  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }

    let line = ''
    for (const character of paragraph) {
      if (measure(character) > maxWidthPx) {
        throw new Error('ESCPOS_RASTER_GLYPH_TOO_WIDE')
      }
      const candidate = line + character
      if (line && measure(candidate) > maxWidthPx) {
        lines.push(line)
        line = character
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

export function rasterizeReceiptLineViaCanvas(
  text: string,
  style: { align: EscPosAlign; bold: boolean; widthPx: number },
): MonoBitmap[] {
  const fontSizePx = style.bold ? 30 : 26
  const lineHeightPx = Math.ceil(fontSizePx * 1.35)
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('ESCPOS_CANVAS_CONTEXT_UNAVAILABLE')
  measureCtx.font = `${style.bold ? '700' : '400'} ${fontSizePx}px ${FONT_FAMILY}`
  const lines = splitReceiptTextByMeasuredWidth(text, style.widthPx, (value) => measureCtx.measureText(value).width)

  return lines.map((line) => {
    const canvas = document.createElement('canvas')
    canvas.width = style.widthPx
    canvas.height = lineHeightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('ESCPOS_CANVAS_CONTEXT_UNAVAILABLE')

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000'
    ctx.font = `${style.bold ? '700' : '400'} ${fontSizePx}px ${FONT_FAMILY}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = style.align === 'center' ? 'center' : style.align === 'right' ? 'right' : 'left'
    const x = style.align === 'center' ? style.widthPx / 2 : style.align === 'right' ? style.widthPx : 0
    ctx.fillText(line, x, lineHeightPx / 2)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return {
      widthPx: canvas.width,
      heightPx: canvas.height,
      packedRows: packMonochrome(imageData, 200),
    }
  })
}

export const canvasLineRasterizer: LineRasterizer = rasterizeReceiptLineViaCanvas
