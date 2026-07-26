// ESC/POS RAW receipt layout for the POS-80 thermal print experiment
// (EP-BR-ESCPOS-01).
//
// This reuses the exact same `DesktopReceiptData` snapshot, label strings,
// time formatting and money formatting as the existing HTML pixel path
// (`renderDesktopReceiptHtml` in app/components/DesktopReceipt.tsx) — there
// is no second receipt data model here, only a different output encoder.
//
// Design: most receipt lines (order no, qty/price/amount, dashed dividers,
// English labels) are plain ASCII and are sent as real ESC/POS text so the
// printer renders them with its own fast built-in font. Lines that contain
// Chinese or Khmer text (store name, Chinese/Khmer labels, item names) are
// not assumed to be supported by the printer's active codepage, so they are
// rendered as a small local bitmap instead — never the whole receipt.
//
// This module only builds a plan (`EscPosLineOp[]`) and, given a rasterizer
// callback, assembles final bytes. It has no DOM dependency itself, so both
// the plan and the byte assembly are unit-testable in Node with a fake
// rasterizer. The real canvas-based rasterizer lives in
// rasterize-receipt-line-canvas.ts (browser-only).

import type { Lang } from '@/app/components/LangProvider'
import {
  LABELS,
  formatReceiptTime,
  paymentLabel,
  type DesktopReceiptData,
} from '@/app/components/DesktopReceipt'
import { formatMoney } from '@/lib/currency'
import {
  appendEscPosReceiptTail,
  EscPosBuilder,
  bytesToBase64,
  type EscPosAlign,
  type MonoBitmap,
} from './escpos-encoder'
import { isAsciiPrintableLine } from './receipt-text-charset'

// Assumption pending real POS-80 hardware confirmation (see the field
// verification plan's "长商品名称" and "同一订单分别打印 HTML 和 RAW" steps).
// 42 columns is a common Font-A default for an 80mm printer. Adjust once a
// real print sample confirms the actual character width for this device.
export const ESC_POS_DEFAULT_CHAR_WIDTH = 42

// Assumption pending real hardware confirmation: 576 dots is the common
// printable width for an 80mm head at 203dpi. Used only to size the small
// CJK/Khmer bitmap fallback lines, not the whole receipt.
export const ESC_POS_DEFAULT_RASTER_WIDTH_PX = 576

export type EscPosLineOp =
  | { kind: 'text'; align: EscPosAlign; bold?: boolean; text: string }
  | { kind: 'raster'; align: EscPosAlign; bold?: boolean; text: string }
  | { kind: 'divider'; width: number }
  | { kind: 'feed'; lines: number }
  | { kind: 'cut' }

function padTwoColumn(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length
  if (gap > 0) return left + ' '.repeat(gap) + right
  return `${left} ${right}`
}

function centeredOp(text: string, bold = false): EscPosLineOp {
  return isAsciiPrintableLine(text)
    ? { kind: 'text', align: 'center', bold, text }
    : { kind: 'raster', align: 'center', bold, text }
}

function leftOp(text: string, bold = false): EscPosLineOp {
  return isAsciiPrintableLine(text)
    ? { kind: 'text', align: 'left', bold, text }
    : { kind: 'raster', align: 'left', bold, text }
}

/**
 * A "label ... value" row. When both sides are ASCII-safe it becomes one
 * padded text line (fast, crisp printer font). When either side needs a
 * bitmap, keep each side independent: this avoids turning an ASCII order
 * number, time, or amount into an image merely because its label is Chinese
 * or Khmer. A compact single-line mixed-script layout is intentionally out
 * of scope for this experiment.
 */
function rowOps(label: string, value: string, charWidth: number, bold = false): EscPosLineOp[] {
  if (isAsciiPrintableLine(label) && isAsciiPrintableLine(value)) {
    return [{ kind: 'text', align: 'left', bold, text: padTwoColumn(label, value, charWidth) }]
  }
  return [leftOp(label, bold), leftOp(value, bold)]
}

export function buildEscPosReceiptPlan(
  data: DesktopReceiptData,
  lang: Lang,
  options?: { charWidth?: number },
): EscPosLineOp[] {
  const charWidth = options?.charWidth ?? ESC_POS_DEFAULT_CHAR_WIDTH
  const labels = LABELS[lang]
  const ops: EscPosLineOp[] = []

  ops.push(centeredOp(data.storeName || 'Store', true))
  ops.push(centeredOp(labels.title))
  ops.push({ kind: 'divider', width: charWidth })

  ops.push(...rowOps(labels.orderNo, data.orderNo || '-', charWidth))
  ops.push(...rowOps(labels.time, formatReceiptTime(data.createdAt, lang), charWidth))
  ops.push(...rowOps(labels.cashier, data.cashierName || 'Desktop POS', charWidth))
  for (const line of data.extraLines ?? []) {
    ops.push(...rowOps(line.label, line.value, charWidth))
  }

  ops.push({ kind: 'divider', width: charWidth })

  for (const item of data.items) {
    const name = [item.name, item.spec ? `(${item.spec})` : ''].filter(Boolean).join(' ')
    ops.push(leftOp(name))
    const calc = `${item.qty} x ${formatMoney(item.price, data.currencyCode)}`
    const amount = formatMoney(item.lineAmount, data.currencyCode)
    // qty/price/amount formatting is always plain ASCII (see lib/currency.ts),
    // so the calc/amount row never needs the raster fallback.
    ops.push({ kind: 'text', align: 'left', text: padTwoColumn(calc, amount, charWidth) })
  }

  ops.push({ kind: 'divider', width: charWidth })
  ops.push(...rowOps(labels.payment, paymentLabel(data.paymentMethod, lang), charWidth, true))
  ops.push(...rowOps(labels.total, formatMoney(data.totalAmount, data.currencyCode), charWidth, true))
  ops.push(centeredOp(labels.thanks, true))

  ops.push({ kind: 'cut' })
  return ops
}

export type LineRasterizer = (
  text: string,
  style: { align: EscPosAlign; bold: boolean; widthPx: number },
) => MonoBitmap[]

export function renderEscPosReceiptBytes(
  plan: EscPosLineOp[],
  rasterizeLine: LineRasterizer,
  options?: { rasterWidthPx?: number },
): Uint8Array {
  const rasterWidthPx = options?.rasterWidthPx ?? ESC_POS_DEFAULT_RASTER_WIDTH_PX
  const builder = new EscPosBuilder().init()

  for (const op of plan) {
    switch (op.kind) {
      case 'text':
        builder.align(op.align)
        builder.bold(!!op.bold)
        builder.text(op.text)
        builder.newline()
        break
      case 'raster': {
        builder.align(op.align)
        const bitmaps = rasterizeLine(op.text, { align: op.align, bold: !!op.bold, widthPx: rasterWidthPx })
        for (const bitmap of bitmaps) {
          builder.raster(bitmap)
          builder.newline()
        }
        break
      }
      case 'divider':
        builder.align('left')
        builder.bold(false)
        builder.text('-'.repeat(op.width))
        builder.newline()
        break
      case 'feed':
        builder.feed(op.lines)
        break
      case 'cut':
        appendEscPosReceiptTail(builder)
        break
    }
  }
  return builder.toBytes()
}

export function buildEscPosReceiptBase64(
  data: DesktopReceiptData,
  lang: Lang,
  rasterizeLine: LineRasterizer,
  options?: { charWidth?: number; rasterWidthPx?: number },
): string {
  const plan = buildEscPosReceiptPlan(data, lang, { charWidth: options?.charWidth })
  const bytes = renderEscPosReceiptBytes(plan, rasterizeLine, { rasterWidthPx: options?.rasterWidthPx })
  return bytesToBase64(bytes)
}
