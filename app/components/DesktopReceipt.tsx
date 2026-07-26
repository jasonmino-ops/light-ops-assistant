'use client'

import type { CSSProperties } from 'react'
import type { Lang } from '@/app/components/LangProvider'
import { formatMoney } from '@/lib/currency'

export type DesktopReceiptItem = {
  name: string
  spec?: string | null
  qty: number
  price: number
  lineAmount: number
}

export type DesktopReceiptData = {
  storeName: string
  orderNo?: string | null
  createdAt: string
  cashierName?: string | null
  paymentMethod: string
  totalAmount: number
  currencyCode?: string | null
  extraLines?: { label: string; value: string }[]
  items: DesktopReceiptItem[]
}

export type ReceiptLabels = {
  title: string
  orderNo: string
  time: string
  cashier: string
  item: string
  qty: string
  unit: string
  amount: string
  total: string
  payment: string
  thanks: string
  print: string
  close: string
  previewTitle: string
}

export const LABELS: Record<Lang, ReceiptLabels> = {
  zh: {
    title: '销售小票',
    orderNo: '订单号',
    time: '时间',
    cashier: '收银员',
    item: '商品',
    qty: '数量',
    unit: '单价',
    amount: '金额',
    total: '合计',
    payment: '支付方式',
    thanks: '谢谢光临',
    print: '打印小票',
    close: '关闭预览',
    previewTitle: '80mm 小票预览',
  },
  en: {
    title: 'Receipt',
    orderNo: 'Order No.',
    time: 'Time',
    cashier: 'Cashier',
    item: 'Item',
    qty: 'Qty',
    unit: 'Unit',
    amount: 'Amount',
    total: 'Total',
    payment: 'Payment',
    thanks: 'Thank you',
    print: 'Print receipt',
    close: 'Close preview',
    previewTitle: '80mm receipt preview',
  },
  km: {
    title: 'វិក្កយបត្រ',
    orderNo: 'លេខបញ្ជាទិញ',
    time: 'ពេលវេលា',
    cashier: 'អ្នកគិតលុយ',
    item: 'ទំនិញ',
    qty: 'ចំនួន',
    unit: 'តម្លៃ',
    amount: 'សរុប',
    total: 'សរុប',
    payment: 'ការទូទាត់',
    thanks: 'សូមអរគុណ',
    print: 'បោះពុម្ពវិក្កយបត្រ',
    close: 'បិទ',
    previewTitle: 'មើលវិក្កយបត្រ 80mm',
  },
}

function money(value: number, currencyCode?: string | null) {
  return formatMoney(value, currencyCode)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function formatReceiptTime(iso: string, lang: Lang) {
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'km' ? 'km-KH' : 'en-US'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function paymentLabel(method: string, lang: Lang) {
  const normalized = method.toUpperCase()
  if (normalized === 'KHQR') return 'KHQR'
  if (normalized === 'MEMBER_BALANCE') {
    if (lang === 'en') return 'Member balance'
    if (lang === 'km') return 'សមតុល្យសមាជិក'
    return '会员余额'
  }
  if (normalized === 'CASH') {
    if (lang === 'en') return 'Cash'
    if (lang === 'km') return 'សាច់ប្រាក់'
    return '现金'
  }
  return method
}

function receiptHtml(data: DesktopReceiptData, lang: Lang) {
  const labels = LABELS[lang]
  const isKhmer = lang === 'km'
  const extraLinesHtml = (data.extraLines ?? []).map((line) => `
      <div class="row"><span>${escapeHtml(line.label)}</span><span>${escapeHtml(line.value)}</span></div>
  `).join('')
  const itemsHtml = data.items.map((item) => {
    const name = [item.name, item.spec ? `(${item.spec})` : ''].filter(Boolean).join(' ')
    return `
      <div class="item">
        <div class="item-name">${escapeHtml(name)}</div>
        <div class="item-line">
          <span class="item-calc">${item.qty} × ${money(item.price, data.currencyCode)}</span>
          <span class="item-amount">${money(item.lineAmount, data.currencyCode)}</span>
        </div>
      </div>
    `
  }).join('')

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : lang}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(labels.title)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    html {
      width: 80mm;
      margin: 0;
      padding: 0;
      background: #fff;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }
    body {
      margin: 0;
      background: #fff;
      color: #000;
      font-family: "Arial", "Segoe UI", "Noto Sans Khmer", "Khmer OS Battambang", "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 12px;
      line-height: ${isKhmer ? '1.7' : '1.42'};
      font-weight: 600;
      -webkit-font-smoothing: none;
      text-rendering: geometricPrecision;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .receipt {
      width: 74mm;
      padding: 0;
      margin: 0 auto;
      transform: none;
    }
    .center { text-align: center; }
    .store { font-size: 16px; font-weight: 900; line-height: ${isKhmer ? '1.55' : '1.28'}; overflow-wrap: anywhere; color: #000; }
    .title { margin-top: 2mm; font-size: 13px; font-weight: 900; color: #000; }
    .meta { margin: 3mm 0; display: grid; gap: 1.2mm; }
    .row { display: flex; justify-content: space-between; gap: 3mm; }
    .row span:last-child { text-align: right; overflow-wrap: anywhere; }
    .divider { border-top: 1.2px dashed #000; margin: 2.5mm 0; }
    .items {
      display: grid;
      gap: 0;
      border-top: 1px dashed #000;
    }
    .item {
      padding: 1mm 0 .9mm;
      border-bottom: .7px dotted #777;
    }
    .item-name {
      width: 100%;
      font-size: 11.8px;
      line-height: ${isKhmer ? '1.45' : '1.2'};
      font-weight: 750;
      color: #000;
      word-break: normal;
      overflow-wrap: break-word;
      hyphens: auto;
    }
    .item-line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: baseline;
      gap: 4mm;
      margin-top: .45mm;
      padding-left: 18mm;
      font-size: 11.5px;
      line-height: 1.15;
      color: #000;
      font-variant-numeric: tabular-nums;
    }
    .item-calc {
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
    }
    .item-amount {
      min-width: 14mm;
      text-align: right;
      white-space: nowrap;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }
    strong { font-weight: 900; color: #000; }
    .total { font-size: 16px; font-weight: 900; color: #000; margin-top: 1mm; }
    .thanks { margin-top: 4mm; font-weight: 900; color: #000; }
    @media print {
      html, body {
        width: 80mm;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
      }
      body { padding: 0; }
      .receipt { width: 74mm; box-shadow: none; }
    }
    @media screen {
      body { background: #f3f4f6; padding: 18px; }
      .receipt { background: #fff; padding: 4mm; box-shadow: 0 10px 30px rgba(15, 23, 42, .16); }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="center store">${escapeHtml(data.storeName || 'Store')}</div>
    <div class="center title">${escapeHtml(labels.title)}</div>
    <div class="divider"></div>
    <div class="meta">
      <div class="row"><span>${escapeHtml(labels.orderNo)}</span><span>${escapeHtml(data.orderNo || '-')}</span></div>
      <div class="row"><span>${escapeHtml(labels.time)}</span><span>${escapeHtml(formatReceiptTime(data.createdAt, lang))}</span></div>
      <div class="row"><span>${escapeHtml(labels.cashier)}</span><span>${escapeHtml(data.cashierName || 'Desktop POS')}</span></div>
      ${extraLinesHtml}
    </div>
    <div class="items">${itemsHtml}</div>
    <div class="divider"></div>
    <div class="row"><span>${escapeHtml(labels.payment)}</span><strong>${escapeHtml(paymentLabel(data.paymentMethod, lang))}</strong></div>
    <div class="row total"><span>${escapeHtml(labels.total)}</span><span>${money(data.totalAmount, data.currencyCode)}</span></div>
    <div class="center thanks">${escapeHtml(labels.thanks)}</div>
  </div>
</body>
</html>`
}

/**
 * Exposes the same receipt markup `printDesktopReceipt` uses, for
 * callers that submit through a different print channel (e.g. the QZ
 * Tray adapter) instead of opening a browser print window.
 */
export function renderDesktopReceiptHtml(data: DesktopReceiptData, lang: Lang): string {
  return receiptHtml(data, lang)
}

export function printDesktopReceipt(
  data: DesktopReceiptData,
  lang: Lang,
  options?: {
    onAfterPrint?: () => void
    onAfterPrintWithWindow?: (printWindow: Window) => void
    onFirstPrintTimeout?: () => void
    firstPrintCompletionTimeoutMs?: number
  },
) {
  // Native print dialogs can occasionally fail to emit every completion signal.
  // Keep the completed sale recoverable without shortening normal dialog use.
  const firstPrintCompletionTimeoutMs = options?.firstPrintCompletionTimeoutMs ?? 90_000
  const win = window.open('', '_blank', 'width=420,height=720')
  if (!win) throw new Error('PRINT_WINDOW_BLOCKED')
  let finished = false
  let poll: number | null = null
  let firstPrintTimeout: number | null = null
  let completionSignalTimers: number[] = []
  let printRequested = false

  const clearCompletionWatchers = () => {
    if (poll !== null) {
      window.clearInterval(poll)
      poll = null
    }
    if (firstPrintTimeout !== null) {
      window.clearTimeout(firstPrintTimeout)
      firstPrintTimeout = null
    }
    completionSignalTimers.forEach((timer) => window.clearTimeout(timer))
    completionSignalTimers = []
    win.removeEventListener('afterprint', handleAfterPrint)
    win.removeEventListener('focus', handlePreviewFocus)
  }

  const finish = () => {
    if (finished) return
    finished = true
    clearCompletionWatchers()
    options?.onAfterPrint?.()
  }

  const closePreviewAndFinish = () => {
    try {
      if (!win.closed) win.close()
    } catch {
      /* Ignore close failures; POS should still continue. */
    }
    finish()
  }

  const continuePrintInSameWindow = () => {
    if (finished) return
    if (!options?.onAfterPrintWithWindow) {
      closePreviewAndFinish()
      return
    }
    finished = true
    clearCompletionWatchers()
    try {
      options.onAfterPrintWithWindow(win)
    } catch (err) {
      console.warn('[desktop-receipt] next print failed', err)
      try {
        if (!win.closed) win.close()
      } catch {
        /* Ignore close failures; POS should still return to its completed state. */
      }
      options?.onAfterPrint?.()
    }
  }

  const scheduleCompletion = (delay: number) => {
    const timer = window.setTimeout(() => {
      completionSignalTimers = completionSignalTimers.filter((entry) => entry !== timer)
      continuePrintInSameWindow()
    }, delay)
    completionSignalTimers.push(timer)
  }
  function handleAfterPrint() {
    scheduleCompletion(80)
  }
  function handlePreviewFocus() {
    if (!printRequested || finished) return
    scheduleCompletion(120)
  }

  win.document.open()
  win.document.write(renderDesktopReceiptHtml(data, lang))
  win.document.close()
  win.addEventListener('afterprint', handleAfterPrint, { once: true })
  win.addEventListener('focus', handlePreviewFocus)
  poll = window.setInterval(() => {
    if (win.closed) finish()
  }, 500)
  win.focus()
  window.setTimeout(() => {
    try {
      printRequested = true
      firstPrintTimeout = window.setTimeout(() => {
        if (finished) return
        finished = true
        clearCompletionWatchers()
        try {
          if (!win.closed) win.close()
        } catch {
          /* Ignore close failures; the completed sale must remain recoverable. */
        }
        try {
          options?.onFirstPrintTimeout?.()
        } catch (err) {
          console.warn('[desktop-receipt] timeout notification failed', err)
        }
        options?.onAfterPrint?.()
      }, firstPrintCompletionTimeoutMs)
      win.print()
    } catch (err) {
      console.warn('[desktop-receipt] print failed', err)
      closePreviewAndFinish()
    }
  }, 250)
}

export function DesktopReceiptPreview({
  data,
  lang,
  onClose,
  onPrint,
}: {
  data: DesktopReceiptData
  lang: Lang
  onClose: () => void
  onPrint: () => void
}) {
  const labels = LABELS[lang]
  return (
    <div style={styles.mask} onClick={onClose}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <div style={styles.head}>
          <div style={styles.headTitle}>{labels.previewTitle}</div>
          <button type="button" style={styles.closeIcon} onClick={onClose}>×</button>
        </div>
        <div style={styles.paperWrap}>
          <iframe
            title={labels.previewTitle}
            srcDoc={receiptHtml(data, lang)}
            style={styles.frame}
          />
        </div>
        <div style={styles.actions}>
          <button type="button" style={styles.secondary} onClick={onClose}>{labels.close}</button>
          <button type="button" style={styles.primary} onClick={onPrint}>{labels.print}</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  mask: {
    position: 'fixed',
    inset: 0,
    zIndex: 140,
    background: 'rgba(15,23,42,.52)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  panel: {
    width: 'min(560px, 94vw)',
    maxHeight: '92vh',
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 18px 60px rgba(15,23,42,.28)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  head: {
    padding: '14px 18px',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headTitle: { fontSize: 15, fontWeight: 900, color: '#111827' },
  closeIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    border: '1px solid #e5e7eb',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 22,
    lineHeight: 1,
    color: '#475569',
  },
  paperWrap: {
    flex: 1,
    minHeight: 0,
    background: '#f8fafc',
    padding: 18,
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
  },
  frame: {
    width: '92mm',
    minHeight: 520,
    maxHeight: '64vh',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    background: '#fff',
  },
  actions: {
    padding: 14,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
  },
  primary: {
    border: 'none',
    borderRadius: 10,
    padding: '12px 14px',
    background: '#2563eb',
    color: '#fff',
    fontSize: 14,
    fontWeight: 900,
    cursor: 'pointer',
  },
  secondary: {
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    padding: '12px 14px',
    background: '#fff',
    color: '#334155',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
}
