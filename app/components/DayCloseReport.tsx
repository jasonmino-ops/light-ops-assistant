'use client'

import { useState } from 'react'

export type DayCloseTopProduct = {
  name: string
  spec: string | null
  totalQty: number
}

export type DayCloseReportData = {
  date: string
  storeName: string
  netAmount: number
  saleOrderCount: number
  cashAmount: number
  khqrAmount: number
  otherAmount: number
  topProducts: DayCloseTopProduct[]
  holdOrderCount: number
  offlinePendingCount: number
  refundAmount: number
  otherDetails?: DayCloseOtherAmountDetail[]
}

export type DayCloseOtherAmountDetail = {
  orderNo: string
  amount: number
  source?: string
}

function fmtMoney(value: number) {
  const abs = Math.abs(value).toFixed(2)
  return value < 0 ? `-$${abs}` : `$${abs}`
}

function fmtDate(date: string) {
  return date
}

function productLabel(product: DayCloseTopProduct) {
  return product.spec ? `${product.name} · ${product.spec}` : product.name
}

function reportRows(report: DayCloseReportData) {
  return [
    { label: '日期', value: fmtDate(report.date) },
    { label: '门店名称', value: report.storeName || 'Store' },
    { label: '今日净销售额', value: fmtMoney(report.netAmount), strong: true },
    { label: '今日销售单数', value: `${report.saleOrderCount} 单` },
    { label: 'CASH 金额', value: fmtMoney(report.cashAmount) },
    { label: 'KHQR 金额', value: fmtMoney(report.khqrAmount) },
    { label: 'OTHER 金额', value: fmtMoney(report.otherAmount), otherInfo: true },
    { label: '退款金额', value: fmtMoney(report.refundAmount) },
    { label: '未完成挂单', value: `${report.holdOrderCount} 单`, warn: report.holdOrderCount > 0 },
    { label: '离线待同步', value: `${report.offlinePendingCount} 笔`, warn: report.offlinePendingCount > 0 },
  ]
}

export function DayCloseReport({ report }: { report: DayCloseReportData }) {
  const [showOtherInfo, setShowOtherInfo] = useState(false)
  const [showOtherDetails, setShowOtherDetails] = useState(false)
  const rows = reportRows(report)
  const otherDetails = report.otherDetails ?? []
  const otherDetailsTotal = otherDetails.reduce((sum, detail) => sum + detail.amount, 0)
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', color: '#111827' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{report.storeName || 'Store'}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: '#64748b' }}>日结报表 · {fmtDate(report.date)}</div>
      </div>
      <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: '#ecfdf5', border: '1px solid #bbf7d0', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#047857', marginBottom: 4 }}>今日净销售额</div>
        <div style={{ fontSize: 36, lineHeight: 1.1, fontWeight: 950, color: '#111827' }}>{fmtMoney(report.netAmount)}</div>
      </div>
      <div style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
        {rows.map((row, index) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 0',
              borderBottom: index === rows.length - 1 ? 'none' : '1px solid #f1f5f9',
              background: row.warn ? '#fffbeb' : 'transparent',
              color: row.warn ? '#92400e' : '#111827',
              fontSize: 13,
            }}
          >
            <span style={{ color: row.warn ? '#92400e' : '#64748b', paddingLeft: row.warn ? 8 : 0 }}>
              {row.label}
              {row.otherInfo && (
                <button
                  type="button"
                  onClick={() => setShowOtherInfo((value) => !value)}
                  style={{ marginLeft: 5, border: 'none', background: 'transparent', color: '#2563eb', fontWeight: 900, cursor: 'pointer', padding: 0 }}
                  aria-label="OTHER 金额说明"
                >
                  ⓘ
                </button>
              )}
            </span>
            <span style={{ fontWeight: row.strong ? 950 : 800, textAlign: 'right', paddingRight: row.warn ? 8 : 0 }}>{row.value}</span>
          </div>
        ))}
      </div>
      {report.otherAmount > 0 && (
        <button
          type="button"
          onClick={() => setShowOtherDetails((value) => !value)}
          style={{ marginTop: 10, width: '100%', border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', padding: '8px 10px', color: '#1d4ed8', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}
        >
          {showOtherDetails ? '收起 OTHER 明细 ▲' : '查看 OTHER 明细 ▼'}
        </button>
      )}
      {showOtherDetails && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 12, color: '#334155' }}>
          <div style={{ fontWeight: 900, color: '#111827', marginBottom: 6 }}>OTHER 明细</div>
          {otherDetails.length === 0 ? (
            <div style={{ color: '#64748b' }}>暂无可展开订单明细</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {otherDetails.map((detail, index) => (
                <div key={`${detail.orderNo}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, borderBottom: '1px solid #e5e7eb', paddingBottom: 7 }}>
                  <div>
                    <div style={{ fontWeight: 900, color: '#111827' }}>订单 {detail.orderNo}</div>
                    {detail.source && <div style={{ marginTop: 2, color: '#64748b' }}>来源：{detail.source}</div>}
                  </div>
                  <div style={{ fontWeight: 900, color: '#111827' }}>{fmtMoney(detail.amount)}</div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontWeight: 950, color: '#111827' }}>
                <span>合计</span>
                <span>{fmtMoney(otherDetailsTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {showOtherInfo && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 12, lineHeight: 1.6, color: '#1e3a8a' }}>
          <div style={{ fontWeight: 900 }}>OTHER 金额 = 总销售额 - CASH - KHQR</div>
          <div>当前主要包含：会员余额、历史记录无法识别支付方式的数据、其他支付方式。</div>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>热销商品 Top3</div>
        {report.topProducts.length === 0 ? (
          <div style={{ padding: 10, borderRadius: 10, background: '#f8fafc', color: '#64748b', fontSize: 12 }}>暂无销售商品</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {report.topProducts.map((product, index) => (
              <div key={`${product.name}-${product.spec ?? ''}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 10px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 12 }}>
                <span style={{ fontWeight: 800, color: '#334155' }}>{index + 1}. {productLabel(product)}</span>
                <span style={{ fontWeight: 900 }}>{product.totalQty}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
        数据来自 /api/summary；挂单和离线待同步只显示数量，不计入销售额。
      </div>
    </div>
  )
}

export function printDayCloseReport(report: DayCloseReportData) {
  const win = window.open('', '_blank', 'width=420,height=720')
  if (!win) throw new Error('PRINT_WINDOW_BLOCKED')

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  const rows = reportRows(report)
  const otherDetails = report.otherDetails ?? []
  const otherDetailsTotal = otherDetails.reduce((sum, detail) => sum + detail.amount, 0)
  win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>日结报表</title>
  <style>
    @page { size: 80mm auto; margin: 6mm; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #111827; }
    .title { text-align: center; font-size: 18px; font-weight: 900; margin-bottom: 4px; }
    .sub { text-align: center; font-size: 13px; color: #64748b; margin-bottom: 14px; }
    .hero { margin-bottom: 14px; padding: 12px 10px; border: 1px solid #bbf7d0; background: #ecfdf5; text-align: center; border-radius: 10px; }
    .hero-label { font-size: 12px; font-weight: 800; color: #047857; margin-bottom: 4px; }
    .hero-value { font-size: 34px; line-height: 1.1; font-weight: 950; }
    .rows { border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .row:last-child { border-bottom: none; }
    .label { color: #64748b; }
    .value { font-weight: 800; text-align: right; }
    .warn { background: #fffbeb; color: #92400e; padding-left: 6px; padding-right: 6px; }
    .section { margin-top: 14px; font-size: 13px; font-weight: 900; }
    .product { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
    .hint { margin-top: 12px; font-size: 11px; color: #94a3b8; text-align: center; }
    .details { margin-top: 12px; padding: 10px; border: 1px solid #e5e7eb; background: #f8fafc; border-radius: 10px; font-size: 12px; }
    .detail-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-row:last-child { border-bottom: none; font-weight: 900; }
    .source { color: #64748b; font-size: 11px; margin-top: 2px; }
  </style>
</head>
<body>
  <div class="title">${escapeHtml(report.storeName || 'Store')}</div>
  <div class="sub">日结报表 · ${escapeHtml(fmtDate(report.date))}</div>
  <div class="hero">
    <div class="hero-label">今日净销售额</div>
    <div class="hero-value">${escapeHtml(fmtMoney(report.netAmount))}</div>
  </div>
  <div class="rows">
    ${rows.map(row => `<div class="row${row.warn ? ' warn' : ''}"><span class="label">${escapeHtml(row.label)}</span><span class="value">${escapeHtml(row.value)}</span></div>`).join('')}
  </div>
  <div class="section">热销商品 Top3</div>
  ${report.topProducts.length === 0
    ? '<div class="product"><span>暂无销售商品</span><span></span></div>'
    : report.topProducts.map((product, index) => `<div class="product"><span>${index + 1}. ${escapeHtml(productLabel(product))}</span><span>${escapeHtml(String(product.totalQty))}</span></div>`).join('')}
  ${otherDetails.length > 0 ? `<div class="details">
    <div style="font-weight:900;margin-bottom:6px;">OTHER 明细</div>
    ${otherDetails.map(detail => `<div class="detail-row"><div><div>订单 ${escapeHtml(detail.orderNo)}</div>${detail.source ? `<div class="source">来源：${escapeHtml(detail.source)}</div>` : ''}</div><div>${escapeHtml(fmtMoney(detail.amount))}</div></div>`).join('')}
    <div class="detail-row"><div>合计</div><div>${escapeHtml(fmtMoney(otherDetailsTotal))}</div></div>
  </div>` : ''}
  <div class="hint">数据来自 /api/summary；挂单和离线待同步只显示数量，不计入销售额。</div>
  <script>
    window.onload = function() {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`)
  win.document.close()
}
