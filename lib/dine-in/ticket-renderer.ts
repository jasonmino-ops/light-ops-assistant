/**
 * Ticket content for the dine-in module. Pure string building: the Desktop page
 * turns the HTML into printer bytes with the existing bitmap renderer and hands
 * them to the existing print bridge. The shared KitchenTicket component is left
 * untouched because it has no room for a table, a batch or a void mark.
 */
import { diningText, fill, type DiningLang } from './i18n'

export type DiningNoticeContent = {
  kind: 'ORDER' | 'VOID' | 'RENOTIFY'
  subject: 'ORDER' | 'VOID'
  seq: number
  refSeq: number | null
  billNo: string
  tableName: string
  areaKind: 'HALL' | 'ROOM'
  guestCount: number
  createdAt: string
  lines: { saleRecordId: string; name: string; spec: string | null; quantity: number }[]
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function ticketTime(iso: string, lang: DiningLang) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(lang === 'zh' ? 'zh-CN' : lang === 'km' ? 'km-KH' : 'en-US', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Heading lines of a notice, also used on screen. */
export function diningNoticeHeading(content: Pick<DiningNoticeContent, 'kind' | 'subject' | 'seq' | 'refSeq'>, lang: DiningLang) {
  const t = diningText(lang)
  const title = content.subject === 'VOID' ? t.ticketVoid : t.ticketOrder
  const resent = content.kind === 'RENOTIFY' && content.refSeq !== null
    ? `${t.ticketRenotify} · ${fill(t.refOf, { n: content.refSeq })}`
    : null
  return { title, resent }
}

export function renderDiningKitchenNoticeHtml(content: DiningNoticeContent, storeName: string, lang: DiningLang): string {
  const t = diningText(lang)
  const heading = diningNoticeHeading(content, lang)
  const isVoid = content.subject === 'VOID'
  const separator = lang === 'zh' ? '：' : ': '
  const items = content.lines.map((line) => `
      <div class="item">
        <div class="item-name">${isVoid ? `<span class="void-mark">${escapeHtml(t.ticketVoidMark)}</span> ` : ''}${escapeHtml(line.name)}</div>
        ${line.spec ? `<div class="item-spec">${escapeHtml(line.spec)}</div>` : ''}
        <div class="item-qty">${escapeHtml(t.ticketQty)}${separator}${line.quantity}</div>
      </div>`).join('')

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : lang}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(heading.title)}</title>
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
    .store { font-size: 13px; font-weight: 800; overflow-wrap: anywhere; }
    .title { margin-top: 1.5mm; font-size: 16px; font-weight: 900; }
    .title.void { border: 2px solid #000; padding: 1mm 0; }
    .resent { margin-top: 1.5mm; font-size: 14px; font-weight: 900; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1mm 0; }
    .table { margin-top: 2mm; font-size: 26px; font-weight: 900; line-height: 1.15; overflow-wrap: anywhere; }
    .meta { margin: 2.5mm 0; display: grid; gap: 1mm; }
    .row { display: flex; justify-content: space-between; gap: 3mm; }
    .row span:last-child { text-align: right; overflow-wrap: anywhere; }
    .divider { border-top: 1.2px dashed #000; margin: 2.5mm 0; }
    .items { border-top: 1px dashed #000; }
    .item { padding: 1.5mm 0; border-bottom: .7px dotted #777; }
    .item-name { font-size: 15px; font-weight: 900; overflow-wrap: break-word; }
    .item-spec { margin-top: .5mm; color: #333; overflow-wrap: break-word; }
    .item-qty { margin-top: .8mm; font-size: 15px; font-weight: 900; }
    .void-mark { border: 1.5px solid #000; padding: 0 1.2mm; }
    @media print {
      html, body { width: 80mm; height: auto !important; min-height: 0 !important; overflow: visible !important; }
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
    <div class="center store">${escapeHtml(storeName || 'Store')}</div>
    <div class="center title${isVoid ? ' void' : ''}">${escapeHtml(heading.title)}</div>
    ${heading.resent ? `<div class="center resent">${escapeHtml(heading.resent)}</div>` : ''}
    <div class="center table">${escapeHtml(content.tableName)}</div>
    <div class="meta">
      <div class="row"><span>${escapeHtml(t.ticketBatch)}</span><span>${escapeHtml(fill(t.batchNo, { n: content.seq }))}</span></div>
      <div class="row"><span>${escapeHtml(t.billNo)}</span><span>${escapeHtml(content.billNo)}</span></div>
      <div class="row"><span>${escapeHtml(t.ticketTime)}</span><span>${escapeHtml(ticketTime(content.createdAt, lang))}</span></div>
    </div>
    <div class="items">${items}</div>
    <div class="divider"></div>
  </div>
</body>
</html>`
}

/** Bytes → base64 in chunks, the way the cashier page feeds the print bridge. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
