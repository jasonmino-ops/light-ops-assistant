import { COPY, type ReportLang } from './copy'
import type { ProductSalesResult } from './contract'
import { reportPeriodPresentation } from './presentation'

function escape(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!) }
export function reportPrintHtml(result: ProductSalesResult, lang: ReportLang) {
  const text = COPY[lang]
  const period = reportPeriodPresentation(result, lang)
  const stores = new Map(result.stores.map((store) => [store.storeId, store]))
  const rows = result.rows.map((row) => `<tr><td>${escape(row.name)}<br><small>${escape(row.barcode)}<br>${escape(stores.get(row.storeId)?.storeName ?? '')}</small></td><td>${escape(row.quantity)}</td><td>${escape(row.salesAmount)} ${escape(stores.get(row.storeId)?.currencyCode ?? '')}</td><td>${escape(row.refundAmount)}</td></tr>`).join('')
  // The existing receipt renderer rasterizes body.firstElementChild. Keep all
  // report content inside this single printable root, including the totals.
  return `<html lang="${lang}"><head><meta charset="utf-8"><title>${escape(text.title)}</title><style>
.report-ticket{box-sizing:border-box;width:72mm;margin:0 auto;font:12px sans-serif;color:#111;background:#fff;overflow-wrap:anywhere}
.report-ticket h1{font-size:18px}.report-ticket h2{font-size:15px}.report-ticket p{line-height:1.5}
.report-ticket table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px}.report-ticket td,.report-ticket th{border-bottom:1px solid #aaa;padding:4px 2px;text-align:left;vertical-align:top}
.report-ticket th:first-child{width:35%}.report-ticket thead{display:table-header-group}.report-ticket tr{break-inside:avoid}.report-ticket small{color:#333}
@page{size:80mm auto;margin:4mm}
</style></head><body><main class="report-ticket"><h1>${escape(result.groupName ?? text.title)}</h1><p class="meta">${escape(period.interval)}<br>${escape(period.status)}<br>${escape(text.generated)}: ${escape(new Date(result.generatedAt).toLocaleString(lang, { timeZone: result.range.timezone }))}</p>${period.legacy ? `<p>${escape(period.legacy)}</p>` : ''}<p>${escape(text.moneyNote)}</p>${result.unidentifiedSales ? `<p>${escape(text.incomplete)}</p>` : ''}${result.unidentifiedRefunds ? `<p>${escape(text.refundIncomplete)}</p>` : ''}<table><thead><tr>${[text.product, text.quantity, text.amount, text.refund].map((label) => `<th>${escape(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><h2>${escape(text.totals)}</h2>${result.totals.map((total) => `<p class="total-row">${escape(total.currencyCode)} · ${escape(text.quantity)} ${escape(total.quantity)} · ${escape(text.amount)} <strong class="total-value">${escape(total.salesAmount)}</strong> · ${escape(text.refund)} ${escape(total.refundAmount)}</p>`).join('')}</main></body></html>`
}
