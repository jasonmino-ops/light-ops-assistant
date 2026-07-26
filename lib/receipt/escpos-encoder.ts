// Minimal ESC/POS byte encoder for the POS-80 RAW print experiment (EP-BR-ESCPOS-01).
//
// Scope: a small, hand-rolled subset of ESC/POS covering what a receipt
// needs — init, alignment, bold, plain text, line feed, raster image, and
// cut. This is written from the public ESC/POS command tables (widely
// documented, vendor-neutral), not copied from any POS-Research-Lab sample.
//
// Pure byte assembly only: no DOM, no qz-tray import, so this is safe to
// unit test in Node.

export const ESC = 0x1b
export const GS = 0x1d

export type EscPosAlign = 'left' | 'center' | 'right'

// 1bpp raster image, MSB-first, rows padded to a byte boundary — the shape
// GS v 0 expects. Produced either by the canvas rasterizer (browser) or by
// a test double (Node).
export type MonoBitmap = {
  widthPx: number
  heightPx: number
  /** length must equal heightPx * ceil(widthPx / 8) */
  packedRows: Uint8Array
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Manual base64 encode so this module has no runtime dependency on
 * `Buffer` (Node) or `btoa` (browser) — it works identically in both the
 * browser bundle and the `tsx` test runner.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined
    result += BASE64_CHARS[b0 >> 2]
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)]
    result += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)]
    result += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f]
  }
  return result
}

export class EscPosBuilder {
  private bytes: number[] = []

  init(): this {
    this.bytes.push(ESC, 0x40) // ESC @ — initialize printer
    return this
  }

  align(align: EscPosAlign): this {
    const n = align === 'center' ? 1 : align === 'right' ? 2 : 0
    this.bytes.push(ESC, 0x61, n) // ESC a n
    return this
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0) // ESC E n
    return this
  }

  /**
   * Appends raw ASCII/codepage-safe bytes. Caller is responsible for only
   * passing text that `isAsciiPrintable` (see receipt-text-charset.ts)
   * accepted — this function does not itself guard against unsupported
   * characters, since higher bytes are still valid for printers whose
   * active codepage happens to cover them.
   */
  text(value: string): this {
    for (let i = 0; i < value.length; i++) {
      this.bytes.push(value.charCodeAt(i) & 0xff)
    }
    return this
  }

  newline(): this {
    this.bytes.push(0x0a)
    return this
  }

  /** ESC d n — print and feed n lines. */
  feed(lines: number): this {
    this.bytes.push(ESC, 0x64, Math.max(0, Math.min(255, lines)))
    return this
  }

  /** GS v 0 — print a raster bit image at native size (m=0). */
  raster(bitmap: MonoBitmap): this {
    const bytesPerRow = Math.ceil(bitmap.widthPx / 8)
    const expectedLength = bytesPerRow * bitmap.heightPx
    if (bitmap.packedRows.length !== expectedLength) {
      throw new Error(
        `ESCPOS_RASTER_SIZE_MISMATCH: expected ${expectedLength} bytes for ${bitmap.widthPx}x${bitmap.heightPx}, got ${bitmap.packedRows.length}`,
      )
    }
    this.bytes.push(GS, 0x76, 0x30, 0x00)
    this.bytes.push(bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff)
    this.bytes.push(bitmap.heightPx & 0xff, (bitmap.heightPx >> 8) & 0xff)
    for (let i = 0; i < bitmap.packedRows.length; i++) {
      this.bytes.push(bitmap.packedRows[i])
    }
    return this
  }

  /** GS V 0 — full cut. */
  cut(): this {
    this.bytes.push(GS, 0x56, 0x00)
    return this
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }

  toBase64(): string {
    return bytesToBase64(this.toBytes())
  }
}

/**
 * Fixed, database-free RAW smoke-test ticket for EP-BR-ESCPOS-01.
 *
 * This stays entirely within the experiment layer so operators can verify
 * the QZ RAW channel without creating a sale or requiring a receipt snapshot.
 */
export function buildEscPosAsciiTestTicketBase64(): string {
  return new EscPosBuilder()
    .init()
    .align('center')
    .bold(true)
    .text('E-SHOP ESC/POS TEST')
    .newline()
    .bold(false)
    .align('left')
    .text('ORDER: TEST-001')
    .newline()
    .text('ITEM: COFFEE x1')
    .newline()
    .text('TOTAL: 2.00')
    .newline()
    .feed(3)
    .cut()
    .toBase64()
}
