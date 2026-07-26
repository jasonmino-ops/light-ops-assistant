'use client'

import type { Lang } from '@/app/components/LangProvider'

export type KitchenTicketItem = {
  name: string
  spec?: string | null
  quantity: number
}

export type KitchenTicketData = {
  storeName: string
  orderNo: string
  createdAt: string
  items: KitchenTicketItem[]
  isReprint?: boolean
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatTicketTime(iso: string, lang: Lang) {
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

function labels(lang: Lang, reprint: boolean) {
  if (lang === 'en') {
    return {
      title: reprint ? 'Kitchen Ticket — Reprint' : 'Kitchen Ticket',
      orderNo: 'Order No.',
      time: 'Order time',
      quantity: 'Qty',
    }
  }
  if (lang === 'km') {
    return {
      title: reprint ? 'បង្កាន់ដៃផ្ទះបាយ (បោះពុម្ពឡើងវិញ)' : 'បង្កាន់ដៃផ្ទះបាយ',
      orderNo: 'លេខបញ្ជាទិញ',
      time: 'ពេលវេលាបញ្ជាទិញ',
      quantity: 'ចំនួន',
    }
  }
  return {
    title: reprint ? '补打厨房单' : '厨房单',
    orderNo: '订单号',
    time: '下单时间',
    quantity: '数量',
  }
}

function kitchenTicketHtml(data: KitchenTicketData, lang: Lang) {
  const text = labels(lang, !!data.isReprint)
  const isKhmer = lang === 'km'
  const itemsHtml = data.items.map((item) => {
    const details = item.spec ? `<div class="spec">${escapeHtml(item.spec)}</div>` : ''
    return `
      <div class="item">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${details}
        <div class="quantity">${escapeHtml(text.quantity)}: <strong>${item.quantity}</strong></div>
      </div>
    `
  }).join('')

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : lang}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(text.title)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    html, body { width: 80mm; margin: 0; padding: 0; background: #fff; }
    body {
      color: #000;
      font-family: "Arial", "Segoe UI", "Noto Sans Khmer", "Khmer OS Battambang", "Microsoft YaHei", "PingFang SC", sans-serif;
      font-size: 13px;
      line-height: ${isKhmer ? '1.65' : '1.38'};
      font-weight: 650;
      -webkit-text-size-adjust: 100%;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .ticket { width: 74mm; margin: 0 auto; }
    .center { text-align: center; }
    .store { font-size: 16px; font-weight: 900; overflow-wrap: anywhere; }
    .title { margin-top: 2mm; font-size: 16px; font-weight: 900; }
    .divider { border-top: 1.2px dashed #000; margin: 2.8mm 0; }
    .meta { display: grid; gap: 1.2mm; }
    .row { display: flex; justify-content: space-between; gap: 3mm; }
    .row span:last-child { text-align: right; overflow-wrap: anywhere; }
    .item { padding: 1.8mm 0; border-bottom: .8px dotted #555; }
    .item-name { font-size: 14px; font-weight: 900; overflow-wrap: break-word; }
    .spec { margin-top: .5mm; color: #111; overflow-wrap: break-word; }
    .quantity { margin-top: 1mm; font-size: 14px; text-align: right; }
    .quantity strong { font-size: 18px; }
    @media print { body { padding: 0; } }
    @media screen {
      body { padding: 18px; background: #f3f4f6; }
      .ticket { padding: 4mm; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, .16); }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center store">${escapeHtml(data.storeName || 'Store')}</div>
    <div class="center title">${escapeHtml(text.title)}</div>
    <div class="divider"></div>
    <div class="meta">
      <div class="row"><span>${escapeHtml(text.orderNo)}</span><span>${escapeHtml(data.orderNo)}</span></div>
      <div class="row"><span>${escapeHtml(text.time)}</span><span>${escapeHtml(formatTicketTime(data.createdAt, lang))}</span></div>
    </div>
    <div class="divider"></div>
    <div class="items">${itemsHtml}</div>
    <div class="divider"></div>
  </div>
</body>
</html>`
}

export function printKitchenTicket(
  data: KitchenTicketData,
  lang: Lang,
  options?: { onAfterPrint?: () => void },
) {
  const win = window.open('', '_blank', 'width=420,height=720')
  if (!win) throw new Error('PRINT_WINDOW_BLOCKED')
  let finished = false
  let poll: number | null = null
  let printRequested = false
  const finish = () => {
    if (finished) return
    finished = true
    if (poll !== null) window.clearInterval(poll)
    options?.onAfterPrint?.()
  }
  const closeAndFinish = () => {
    try {
      if (!win.closed) win.close()
    } catch {
      // The browser may reject close; continue the checkout flow either way.
    }
    finish()
  }
  win.document.open()
  win.document.write(kitchenTicketHtml(data, lang))
  win.document.close()
  win.addEventListener('afterprint', () => window.setTimeout(closeAndFinish, 80), { once: true })
  win.addEventListener('focus', () => {
    if (printRequested && !finished) window.setTimeout(closeAndFinish, 120)
  })
  poll = window.setInterval(() => {
    if (win.closed) finish()
  }, 500)
  win.focus()
  window.setTimeout(() => {
    try {
      printRequested = true
      win.print()
    } catch (error) {
      console.warn('[kitchen-ticket] print failed', error)
      closeAndFinish()
    }
  }, 250)
}

export function getKitchenTicketHtmlForTest(data: KitchenTicketData, lang: Lang) {
  return kitchenTicketHtml(data, lang)
}
