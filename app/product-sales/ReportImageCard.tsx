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
  // Only the image is condensed. Free sales still have quantity, and recorded
  // nonzero amounts must never disappear through floating-point conversion.
  const isZero = (value: string) => /^-?0+(?:\.0+)?$/.test(value)
  const rows = result.rows.filter((row) => !isZero(row.quantity) || !isZero(row.salesAmount))
  const zeroCount = result.rows.length - rows.length
  const label: React.CSSProperties = { color: '#526079', fontSize: 12, lineHeight: 1.8 }
  const columns: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 48px minmax(84px, .65fr)', gap: 8, alignItems: 'start' }
  return <div ref={ref} data-report-image-card lang={lang} style={{ width: 360, boxSizing: 'border-box', padding: 20, background: '#fff', color: '#172033', fontFamily: '"Noto Sans Khmer", -apple-system, BlinkMacSystemFont, "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.8, overflowWrap: 'anywhere' }}>
    <div style={{ fontSize: 21, fontWeight: 700, marginBottom: 8 }}>{IMAGE_COPY[lang].title}</div>
    {result.groupName && <div style={{ fontWeight: 600 }}>{result.groupName}</div>}
    <div style={label}>{result.stores.map((store) => store.storeName).join(' / ')}</div>
    <div style={{ ...label, margin: '8px 0' }}>{period.interval}</div>
    {period.legacy && <div style={label}>{period.legacy}</div>}
    {!!result.unidentifiedSales && <div style={{ color: '#9f1239', fontSize: 12 }}>{copy.incomplete}</div>}
    {rows.length > 0 && <div style={{ ...columns, ...label, padding: '8px 0', borderBottom: '1px solid #dce3eb' }}>
      <div>{copy.product}</div><div style={{ textAlign: 'right' }}>{IMAGE_COPY[lang].quantity}</div><div style={{ textAlign: 'right' }}>{copy.amount}</div>
    </div>}
    {rows.map((row) => {
      const store = stores.get(row.storeId)
      return <div key={`${row.storeId}:${row.tenantId}:${row.productId}`} data-report-image-row style={{ ...columns, borderBottom: '1px solid #dce3eb', padding: '8px 0' }}>
        <div><div style={{ fontWeight: 600 }}>{row.name}</div>{result.stores.length > 1 && <div style={label}>{store?.storeName}</div>}</div>
        <div style={{ textAlign: 'right' }}>{row.quantity}</div>
        <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.salesAmount} {store?.currencyCode}</div>
      </div>
    })}
    {zeroCount > 0 && <div data-report-image-zero-sales style={{ ...label, marginTop: 8 }}>{IMAGE_COPY[lang].zeroSales.replace('{count}', String(zeroCount))}</div>}
    <div style={{ borderTop: '2px solid #172033', paddingTop: 8, marginTop: 12 }}>
      {result.totals.map((total) => <div key={total.currencyCode} data-report-image-total style={{ ...columns, fontWeight: 700, marginTop: 4 }}>
        <div>{IMAGE_COPY[lang].total} · {total.currencyCode}</div>
        <div style={{ textAlign: 'right' }}>{total.quantity}</div>
        <div style={{ textAlign: 'right' }}>{total.salesAmount}</div>
      </div>)}
    </div>
  </div>
})
ReportImageCard.displayName = 'ReportImageCard'
