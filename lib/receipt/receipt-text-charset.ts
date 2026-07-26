// Character-set gate for the ESC/POS RAW experiment (EP-BR-ESCPOS-01).
//
// We do not know which codepage the real POS-80 firmware has active, so
// we cannot assume it can render Chinese or Khmer glyphs from ESC/POS text
// bytes. The only range guaranteed safe on effectively every ESC/POS
// codepage (CP437, CP850, GBK ASCII-compatible range, etc.) is printable
// ASCII. Anything outside it must fall back to a small local bitmap
// instead of being sent as text bytes — see render-desktop-receipt-escpos.ts.

const ASCII_PRINTABLE_MIN = 0x20
const ASCII_PRINTABLE_MAX = 0x7e

export function isAsciiPrintableChar(code: number): boolean {
  return code >= ASCII_PRINTABLE_MIN && code <= ASCII_PRINTABLE_MAX
}

/** True only if every character in `value` is plain printable ASCII. */
export function isAsciiPrintableLine(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (!isAsciiPrintableChar(value.charCodeAt(i))) return false
  }
  return true
}
