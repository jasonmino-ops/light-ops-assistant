'use client'

import React from 'react'
import { COPY, type ReportLang } from '@/lib/product-sales/copy'
import { IMAGE_COPY } from '@/lib/product-sales/image-copy'
import { reportPeriodPresentation } from '@/lib/product-sales/presentation'
import type { ProductSalesResult } from '@/lib/product-sales/contract'

// Like OrderShareCard, this is a fixed-width, offscreen capture surface. Amounts
// stay as the exact report strings; order/payment fields are never fabricated.
export const ReportImageCard = React.forwardRef<HTMLDivElement, { result: ProductSalesResult; lang: ReportLang }>(({ result, lang }, ref) => {
  const copy = COPY[lang]
  const period = reportPeriodPresentation(result, lang)
  const stores = new Map(result.stores.map((store) => [store.storeId, store]))
  const label: React.CSSProperties = { color: '#526079', fontSize: 12, lineHeight: 1.8 }
  return <div ref={ref} data-report-image-card lang={lang} style={{ width: 360, boxSizing: 'border-box', padding: 20, background: '#fff', color: '#172033', fontFamily: '"Noto Sans Khmer", -apple-system, BlinkMacSystemFont, "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.8, overflowWrap: 'anywhere' }}>
    <div style={{ fontSize: 11, color: '#526079', letterSpacing: 1 }}>E-SHOP</div>
    <div style={{ fontSize: 21, fontWeight: 700, margin: '4px 0 12px' }}>{IMAGE_COPY[lang].title}</div>
    {result.groupName && <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>{result.groupName}</div>}
    <div style={label}>{copy.stores}</div>
    {result.stores.map((store) => <div key={store.storeId}>{store.storeName} · {store.currencyCode}</div>)}
    <div style={{ ...label, marginTop: 12 }}>{period.interval}</div>
    <div style={label}>{period.status}</div>
    {period.legacy && <div style={label}>{period.legacy}</div>}
    <div style={label}>{copy.generated}: {new Date(result.generatedAt).toLocaleString(lang, { timeZone: result.range.timezone })}</div>
    <div style={{ ...label, margin: '12px 0' }}>{copy.moneyNote}</div>
    {!!result.unidentifiedSales && <div style={{ color: '#9f1239', fontSize: 12 }}>{copy.incomplete}</div>}
    {!!result.unidentifiedRefunds && <div style={{ color: '#9f1239', fontSize: 12 }}>{copy.refundIncomplete}</div>}
    {result.rows.map((row) => {
      const store = stores.get(row.storeId)
      return <div key={`${row.storeId}:${row.tenantId}:${row.productId}`} data-report-image-row style={{ borderTop: '1px solid #dce3eb', padding: '12px 0' }}>
        <div style={{ fontWeight: 600 }}>{row.name}</div>
        <div style={label}>{store?.storeName} · {row.barcode}</div>
        <div>{copy.quantity}: {row.quantity}</div>
        <div>{copy.amount}: <strong>{row.salesAmount} {store?.currencyCode}</strong></div>
        <div>{copy.refund}: {row.refundAmount} {store?.currencyCode}</div>
      </div>
    })}
    <div style={{ borderTop: '2px solid #172033', paddingTop: 12, marginTop: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 17 }}>{copy.totals}</div>
      {result.totals.map((total) => <div key={total.currencyCode} data-report-image-total style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 700 }}>{total.currencyCode}</div>
        <div>{copy.quantity}: {total.quantity}</div>
        <div>{copy.amount}: <strong>{total.salesAmount}</strong></div>
        <div>{copy.refund}: {total.refundAmount}</div>
      </div>)}
    </div>
  </div>
})
ReportImageCard.displayName = 'ReportImageCard'
