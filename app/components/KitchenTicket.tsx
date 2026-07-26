'use client'

import type { Lang } from '@/app/components/LangProvider'

export type KitchenTicketItem = {
  name: string
  spec?: string | null
  qty: number
}

export type KitchenTicketData = {
  storeName: string
  orderNo?: string | null
  createdAt: string
  items: KitchenTicketItem[]
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatKitchenTicketTime(iso: string, lang: Lang) {
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'km' ? 'km-KH' : 'en-US'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function kitchenTicketHtml(data: KitchenTicketData, lang: Lang) {
  const itemsHtml = data.items.map((item) => `
      <div class="item">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${item.spec ? `<div class="item-spec">${escapeHtml(item.spec)}</div>` : ''}
        <div class="item-qty">数量：${item.qty}</div>
      </div>
    `).join('')

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : lang}">
<head>
  <meta charset="utf-8" />
  <title>厨房单</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    html { width: 80mm; margin: 0; padding: 0; background: #fff; }
    body {
      margin: 0;
      background: #fff;
      color: #000;
      font-family: "Arial", "Segoe UI", "Noto Sans Khmer", "Khmer OS Battambang", "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 12px;
      line-height: 1.42;
      font-weight: 600;
    }
    .ticket { width: 74mm; padding: 0; margin: 0 auto; }
    .center { text-align: center; }
    .store { font-size: 16px; font-weight: 900; line-height: 1.28; overflow-wrap: anywhere; }
    .title { margin-top: 2mm; font-size: 15px; font-weight: 900; }
    .meta { margin: 3mm 0; display: grid; gap: 1.2mm; }
    .row { display: flex; justify-content: space-between; gap: 3mm; }
    .row span:last-child { text-align: right; overflow-wrap: anywhere; }
    .divider { border-top: 1.2px dashed #000; margin: 2.5mm 0; }
    .items { border-top: 1px dashed #000; }
    .item { padding: 1.5mm 0; border-bottom: .7px dotted #777; }
    .item-name { font-size: 13px; font-weight: 900; overflow-wrap: break-word; }
    .item-spec { margin-top: .5mm; color: #333; overflow-wrap: break-word; }
    .item-qty { margin-top: .8mm; font-size: 13px; font-weight: 900; }
    @media print {
      html, body {
        width: 80mm;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
      }
      body { padding: 0; }
      .ticket { width: 74mm; }
    }
    @media screen {
      body { background: #f3f4f6; padding: 18px; }
      .ticket { background: #fff; padding: 4mm; box-shadow: 0 10px 30px rgba(15, 23, 42, .16); }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center store">${escapeHtml(data.storeName || 'Store')}</div>
    <div class="center title">厨房单</div>
    <div class="divider"></div>
    <div class="meta">
      <div class="row"><span>订单号</span><span>${escapeHtml(data.orderNo || '-')}</span></div>
      <div class="row"><span>交易时间</span><span>${escapeHtml(formatKitchenTicketTime(data.createdAt, lang))}</span></div>
    </div>
    <div class="items">${itemsHtml}</div>
    <div class="divider"></div>
  </div>
</body>
</html>`
}

export function getKitchenTicketHtmlForTest(data: KitchenTicketData, lang: Lang) {
  return kitchenTicketHtml(data, lang)
}

export function printKitchenTicket(
  data: KitchenTicketData,
  lang: Lang,
  options?: { onAfterPrint?: () => void; printWindow?: Window },
) {
  const win = options?.printWindow ?? window.open('', '_blank', 'width=420,height=720')
  if (!win) throw new Error('PRINT_WINDOW_BLOCKED')
  let finished = false
  let poll: number | null = null
  let printRequested = false
  const finish = () => {
    if (finished) return
    finished = true
    if (poll !== null) {
      window.clearInterval(poll)
      poll = null
    }
    options?.onAfterPrint?.()
  }
  const closePreviewAndFinish = () => {
    try {
      if (!win.closed) win.close()
    } catch {
      /* Ignore close failures; the completed transaction must remain usable. */
    }
    finish()
  }
  const handlePreviewFocus = () => {
    if (!printRequested || finished) return
    window.setTimeout(closePreviewAndFinish, 120)
  }
  win.document.open()
  win.document.write(kitchenTicketHtml(data, lang))
  win.document.close()
  win.addEventListener('afterprint', () => window.setTimeout(closePreviewAndFinish, 80), { once: true })
  win.addEventListener('focus', handlePreviewFocus)
  poll = window.setInterval(() => {
    if (win.closed) finish()
  }, 500)
  win.focus()
  window.setTimeout(() => {
    try {
      printRequested = true
      win.print()
    } catch (err) {
      console.warn('[kitchen-ticket] print failed', err)
      closePreviewAndFinish()
    }
  }, 250)
}
