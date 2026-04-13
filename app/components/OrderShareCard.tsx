'use client'

import React from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShareItem = {
  id: string
  productNameSnapshot: string
  specSnapshot: string | null
  quantity: number
  unitPrice: number
  lineAmount: number
}

export type ShareData = {
  orderNo: string
  storeName: string
  operatorDisplayName: string
  createdAt: string
  saleStatus: string
  items: ShareItem[]
  totalAmount: number
  paymentMethod: 'CASH' | 'KHQR' | null
  paymentStatus: string | null
  paidAt: string | null
}

export type ShareLabels = {
  orderNo: string
  time: string
  operator: string
  products: string
  qty: string
  unitPrice: string
  total: string
  payMethod: string
  payStatus: string
  cash: string
  khqr: string
  noPayment: string
  completed: string
  pending: string
  cancelled: string
  paid: string
  unpaidHint: string
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtFull(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function resolveStatus(data: ShareData, labels: ShareLabels) {
  const isDeferred = data.saleStatus === 'PENDING_PAYMENT' && !data.paymentMethod
  const isCancelled = data.saleStatus === 'CANCELLED'
  return {
    isDeferred,
    isCancelled,
    text: isCancelled ? labels.cancelled : isDeferred ? labels.pending : labels.completed,
    color: isCancelled ? '#8c8c8c' : isDeferred ? '#fa8c16' : '#52c41a',
    bg: isCancelled ? '#f5f5f5' : isDeferred ? '#fff7e6' : '#f6ffed',
    border: isCancelled ? '#d9d9d9' : isDeferred ? '#ffd591' : '#b7eb8f',
  }
}

// ─── Visual Card (for html2canvas capture) ───────────────────────────────────

const OrderShareCard = React.forwardRef<HTMLDivElement, {
  data: ShareData
  labels: ShareLabels
}>(({ data, labels }, ref) => {
  const st = resolveStatus(data, labels)
  const pmLabel = data.paymentMethod === 'KHQR' ? labels.khqr : data.paymentMethod === 'CASH' ? labels.cash : labels.noPayment
  const psLabel = data.paymentStatus === 'PAID' ? labels.paid : st.isDeferred ? labels.pending : data.paymentStatus === 'CANCELLED' ? labels.cancelled : (data.paymentStatus ?? '-')

  return (
    <div ref={ref} style={{
      width: 360, background: '#fff', padding: '20px 18px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', paddingBottom: 12, borderBottom: '1.5px solid #f0f0f0', marginBottom: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>{data.storeName}</div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>E-Shop 店小二助手</div>
      </div>

      {/* Status badge */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <span style={{
          display: 'inline-block', padding: '3px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
          color: st.color, background: st.bg, border: `1px solid ${st.border}`,
        }}>
          {st.text}
        </span>
        {st.isDeferred && (
          <div style={{ fontSize: 11, color: '#fa8c16', marginTop: 4 }}>{labels.unpaidHint}</div>
        )}
      </div>

      {/* Meta */}
      <div style={{ fontSize: 12, marginBottom: 10 }}>
        <CardRow label={labels.orderNo} value={data.orderNo} mono />
        <CardRow label={labels.time} value={fmtFull(data.createdAt)} />
        <CardRow label={labels.operator} value={data.operatorDisplayName} />
      </div>

      <div style={{ borderTop: '1px dashed #e8e8e8', margin: '10px 0' }} />

      {/* Items */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: '#aaa', letterSpacing: '0.05em', marginBottom: 6 }}>
          {labels.products.toUpperCase()}
        </div>
        {data.items.map((item) => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 7 }}>
            <div style={{ flex: 1, paddingRight: 8 }}>
              <div style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>
                {item.productNameSnapshot}
                {item.specSnapshot && <span style={{ color: '#8c8c8c', fontWeight: 400 }}> · {item.specSnapshot}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                {labels.qty} {Math.abs(item.quantity)} · {labels.unitPrice} ${item.unitPrice.toFixed(2)}
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', flexShrink: 0 }}>
              ${Math.abs(item.lineAmount).toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '1px dashed #e8e8e8', paddingTop: 8, marginTop: 4, marginBottom: 12,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{labels.total}</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: '#1677ff' }}>${Math.abs(data.totalAmount).toFixed(2)}</span>
      </div>

      {/* Payment info */}
      <div style={{ background: '#f7f8fa', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
        <CardRow label={labels.payMethod} value={pmLabel} />
        <CardRow label={labels.payStatus} value={psLabel} last />
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 14, fontSize: 10, color: '#ccc' }}>
        {fmtFull(data.createdAt)}
      </div>
    </div>
  )
})
OrderShareCard.displayName = 'OrderShareCard'
export default OrderShareCard

function CardRow({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: last ? 0 : 4 }}>
      <span style={{ color: '#8c8c8c' }}>{label}</span>
      <span style={{ color: '#1a1a1a', fontFamily: mono ? 'monospace' : undefined, maxWidth: '60%', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// ─── Print HTML builder ───────────────────────────────────────────────────────

export function buildPrintHTML(data: ShareData, labels: ShareLabels & { title: string; subtotal: string }): string {
  const st = resolveStatus(data, labels)
  const pmLabel = data.paymentMethod === 'KHQR' ? 'KHQR' : data.paymentMethod === 'CASH' ? labels.cash : labels.noPayment
  const psLabel = data.paymentStatus === 'PAID' ? labels.paid : st.isDeferred ? labels.pending : data.paymentStatus === 'CANCELLED' ? labels.cancelled : '-'
  const badgeStyle = st.isCancelled
    ? 'background:#f5f5f5;color:#8c8c8c;border:1px solid #d9d9d9'
    : st.isDeferred
    ? 'background:#fff7e6;color:#fa8c16;border:1px solid #ffd591'
    : 'background:#f6ffed;color:#52c41a;border:1px solid #b7eb8f'

  const itemsHtml = data.items.map(item => `
    <tr>
      <td>${escHtml(item.productNameSnapshot)}${item.specSnapshot ? ` <span style="color:#888"> · ${escHtml(item.specSnapshot)}</span>` : ''}</td>
      <td style="text-align:center">×${Math.abs(item.quantity)}</td>
      <td style="text-align:right">$${item.unitPrice.toFixed(2)}</td>
      <td style="text-align:right">$${Math.abs(item.lineAmount).toFixed(2)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(data.orderNo)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,Arial,sans-serif;max-width:380px;margin:0 auto;padding:16px 14px;font-size:13px;color:#1a1a1a}
  h1{font-size:17px;text-align:center;margin-bottom:2px}
  .sub{text-align:center;color:#aaa;font-size:11px;margin-bottom:10px}
  .badge-row{text-align:center;margin-bottom:10px}
  .badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;${badgeStyle}}
  .hint{text-align:center;font-size:11px;color:#fa8c16;margin-top:3px}
  .meta{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}
  .meta span:first-child{color:#888}
  hr{border:none;border-top:1px dashed #e0e0e0;margin:8px 0}
  table{width:100%;border-collapse:collapse;margin:6px 0}
  th{font-size:11px;color:#888;text-align:left;padding:3px 0;border-bottom:1px solid #eee}
  td{padding:5px 0;border-bottom:1px dashed #eee;font-size:13px;vertical-align:top}
  .total-row{display:flex;justify-content:space-between;align-items:center;padding-top:8px;margin-top:4px;border-top:2px solid #1a1a1a}
  .total-label{font-size:14px;font-weight:700}
  .total-value{font-size:22px;font-weight:800;color:#1677ff}
  .pay-box{background:#f7f8fa;border-radius:6px;padding:8px 10px;margin-top:10px}
  .footer{text-align:center;font-size:10px;color:#ccc;margin-top:14px}
  @media print{@page{margin:8mm}body{padding:0}}
</style></head><body>
<h1>${escHtml(data.storeName)}</h1>
<div class="sub">E-Shop 店小二助手</div>
<div class="badge-row">
  <span class="badge">${escHtml(st.text)}</span>
  ${st.isDeferred ? `<div class="hint">${escHtml(labels.unpaidHint)}</div>` : ''}
</div>
<div class="meta"><span>${escHtml(labels.orderNo)}</span><span style="font-family:monospace">${escHtml(data.orderNo)}</span></div>
<div class="meta"><span>${escHtml(labels.time)}</span><span>${escHtml(fmtFull(data.createdAt))}</span></div>
<div class="meta"><span>${escHtml(labels.operator)}</span><span>${escHtml(data.operatorDisplayName)}</span></div>
<hr>
<table>
  <thead><tr>
    <th>${escHtml(labels.products)}</th>
    <th style="text-align:center">${escHtml(labels.qty)}</th>
    <th style="text-align:right">${escHtml(labels.unitPrice)}</th>
    <th style="text-align:right">${escHtml(labels.subtotal)}</th>
  </tr></thead>
  <tbody>${itemsHtml}</tbody>
</table>
<div class="total-row">
  <span class="total-label">${escHtml(labels.total)}</span>
  <span class="total-value">$${Math.abs(data.totalAmount).toFixed(2)}</span>
</div>
<div class="pay-box">
  <div class="meta"><span>${escHtml(labels.payMethod)}</span><span>${escHtml(pmLabel)}</span></div>
  <div class="meta" style="margin-bottom:0"><span>${escHtml(labels.payStatus)}</span><span>${escHtml(psLabel)}</span></div>
</div>
<div class="footer">${escHtml(fmtFull(data.createdAt))}</div>
</body></html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
