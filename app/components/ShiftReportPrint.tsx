'use client'

import { useState } from 'react'

type Lang = 'zh' | 'en' | 'km'

export type ShiftReportData = {
  storeName: string
  operator: string
  shiftStart: string
  generatedAt: string
  salesAmount: number
  orderCount: number
  cashAmount: number
  cashCount: number
  khqrAmount: number
  khqrCount: number
  otherAmount: number
  otherCount: number
  offlinePendingCount: number
  holdOrderCount: number
  otherDetails?: OtherAmountDetail[]
}

export type OtherAmountDetail = {
  orderNo: string
  amount: number
  source?: string
}

function fmtMoney(value: number) {
  return `$${value.toFixed(2)}`
}

function localeFor(lang: Lang) {
  return lang === 'en' ? 'en-US' : lang === 'km' ? 'km-KH' : 'zh-CN'
}

function fmtDateTime(iso: string, lang: Lang) {
  return new Date(iso).toLocaleString(localeFor(lang), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function shiftDuration(startIso: string, endIso: string, lang: Lang) {
  const diffMs = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime())
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (lang === 'en') return `${hours}h ${minutes}m`
  if (lang === 'km') return `${hours} ម៉ោង ${minutes} នាទី`
  return `${hours}小时${minutes}分钟`
}

function copy(lang: Lang) {
  if (lang === 'en') {
    return {
      title: 'Shift report',
      storeFallback: 'Store',
      operator: 'Operator',
      shiftStart: 'Shift start',
      currentTime: 'Current time',
      salesAmount: 'Shift sales',
      orderCount: 'Shift orders',
      cashAmount: 'CASH',
      khqrAmount: 'KHQR',
      otherAmount: 'OTHER',
      offlinePending: 'Offline pending',
      holdOrders: 'Open holds',
      shiftDuration: 'Shift duration',
      summaryTitle: 'Shift summary',
      otherInfo: 'OTHER amount = Total sales - CASH - KHQR',
      otherDesc: 'Currently includes member balance, records with unidentified payment methods, and other payment methods.',
      detailsTitle: 'OTHER details',
      detailsEmpty: 'No detailed orders available',
      detailsTotal: 'Total',
      detailOrder: 'Order',
      detailSource: 'Source',
      detailToggleOpen: 'View OTHER details ▼',
      detailToggleClose: 'Hide OTHER details ▲',
      summaryLine1: (count: number, sales: string) => `This shift had ${count} orders and sales ${sales}.`,
      summaryLine2: (cashCount: number, cash: string, khqrCount: number, khqr: string) => `CASH ${cashCount} orders ${cash}, KHQR ${khqrCount} orders ${khqr}.`,
      summaryLine3: (offline: number, holds: number) => offline > 0 || holds > 0
        ? `Note: offline pending ${offline} orders, open holds ${holds}.`
        : 'Offline pending and open holds are both 0.',
      remaining: 'remaining',
    }
  }
  if (lang === 'km') {
    return {
      title: 'របាយការណ៍ប្តូរវេន',
      storeFallback: 'ហាង',
      operator: 'ប្រតិបត្តិករ',
      shiftStart: 'ពេលចាប់ផ្តើមវេន',
      currentTime: 'ពេលបច្ចុប្បន្ន',
      salesAmount: 'ការលក់ក្នុងវេន',
      orderCount: 'បញ្ជាទិញក្នុងវេន',
      cashAmount: 'CASH',
      khqrAmount: 'KHQR',
      otherAmount: 'OTHER',
      offlinePending: 'រង់ចាំ sync offline',
      holdOrders: 'មាត់ស្នើដែលមិនទាន់បញ្ចប់',
      shiftDuration: 'រយៈពេលវេន',
      summaryTitle: 'សរុបវេន',
      otherInfo: 'OTHER amount = Total sales - CASH - KHQR',
      otherDesc: 'បច្ចុប្បន្នរួមមាន សមតុល្យសមាជិក ទិន្នន័យដែលមិនស្គាល់វិធីទូទាត់ និងវិធីទូទាត់ផ្សេងៗ។',
      detailsTitle: 'OTHER details',
      detailsEmpty: 'មិនមានព័ត៌មានបញ្ជាទិញលម្អិត',
      detailsTotal: 'សរុប',
      detailOrder: 'Order',
      detailSource: 'Source',
      detailToggleOpen: 'មើលព័ត៌មាន OTHER ▼',
      detailToggleClose: 'បិទព័ត៌មាន OTHER ▲',
      summaryLine1: (count: number, sales: string) => `វេននេះមាន ${count} បញ្ជាទិញ និងការលក់ ${sales}។`,
      summaryLine2: (cashCount: number, cash: string, khqrCount: number, khqr: string) => `CASH ${cashCount} បញ្ជាទិញ ${cash}，KHQR ${khqrCount} បញ្ជាទិញ ${khqr}។`,
      summaryLine3: (offline: number, holds: number) => offline > 0 || holds > 0
        ? `ចំណាំ៖ រង់ចាំ sync offline ${offline} បញ្ជាទិញ, មាត់ស្នើមិនទាន់បញ្ចប់ ${holds}។`
        : 'រង់ចាំ sync offline និងមាត់ស្នើមិនទាន់បញ្ចប់ស្មើ 0។',
      remaining: 'នៅសល់',
    }
  }
  return {
    title: '本班交班报表',
    storeFallback: 'Store',
    operator: '操作员',
    shiftStart: '开班时间',
    currentTime: '当前时间',
    salesAmount: '本班销售额',
    orderCount: '本班单数',
    cashAmount: 'CASH 金额',
    khqrAmount: 'KHQR 金额',
    otherAmount: 'OTHER 金额',
    offlinePending: '离线待同步',
    holdOrders: '未完成挂单',
    shiftDuration: '本班时长',
    summaryTitle: '本班交班报表',
    otherInfo: 'OTHER 金额 = 总销售额 - CASH - KHQR',
    otherDesc: '当前主要包含：会员余额、历史记录无法识别支付方式的数据、其他支付方式。',
    detailsTitle: 'OTHER 明细',
    detailsEmpty: '暂无可展开订单明细',
    detailsTotal: '合计',
    detailOrder: '订单',
    detailSource: '来源',
    detailToggleOpen: '查看 OTHER 明细 ▼',
    detailToggleClose: '收起 OTHER 明细 ▲',
    summaryLine1: (count: number, sales: string) => `本班共 ${count} 单，销售额 ${sales}。`,
    summaryLine2: (cashCount: number, cash: string, khqrCount: number, khqr: string) => `其中 CASH ${cashCount} 单 ${cash}，KHQR ${khqrCount} 单 ${khqr}。`,
    summaryLine3: (offline: number, holds: number) => offline > 0 || holds > 0
      ? `请注意：离线待同步 ${offline} 笔，未完成挂单 ${holds} 单。`
      : '离线待同步与未完成挂单均为 0。',
    remaining: '剩余',
  }
}

function reportRows(report: ShiftReportData, lang: Lang) {
  const t = copy(lang)
  return [
    { label: t.operator, value: report.operator || 'Desktop POS' },
    { label: t.shiftStart, value: fmtDateTime(report.shiftStart, lang) },
    { label: t.currentTime, value: fmtDateTime(report.generatedAt, lang) },
    { label: t.salesAmount, value: fmtMoney(report.salesAmount) },
    { label: t.orderCount, value: `${report.orderCount}${lang === 'en' ? '' : lang === 'km' ? '' : ' 单'}` },
    { label: t.cashAmount, value: `${report.cashCount}${lang === 'en' ? '' : lang === 'km' ? '' : ' 单'} · ${fmtMoney(report.cashAmount)}` },
    { label: t.khqrAmount, value: `${report.khqrCount}${lang === 'en' ? '' : lang === 'km' ? '' : ' 单'} · ${fmtMoney(report.khqrAmount)}` },
    { label: t.otherAmount, value: `${report.otherCount}${lang === 'en' ? '' : lang === 'km' ? '' : ' 单'} · ${fmtMoney(report.otherAmount)}`, otherInfo: true },
    { label: t.offlinePending, value: `${report.offlinePendingCount}${lang === 'en' ? '' : lang === 'km' ? '' : ' 笔'}`, warn: report.offlinePendingCount > 0 },
    { label: t.holdOrders, value: `${report.holdOrderCount}${lang === 'en' ? '' : lang === 'km' ? '' : ' 单'}`, warn: report.holdOrderCount > 0 },
    { label: t.shiftDuration, value: shiftDuration(report.shiftStart, report.generatedAt, lang) },
  ]
}

function summaryText(report: ShiftReportData, lang: Lang) {
  const t = copy(lang)
  const warnings = [
    report.offlinePendingCount > 0 ? `${t.offlinePending} ${report.offlinePendingCount} ${t.remaining}` : '',
    report.holdOrderCount > 0 ? `${t.holdOrders} ${report.holdOrderCount} ${lang === 'en' ? 'orders' : lang === 'km' ? 'បញ្ជាទិញ' : '单'}` : '',
  ].filter(Boolean)

  return [
    t.summaryLine1(report.orderCount, fmtMoney(report.salesAmount)),
    t.summaryLine2(report.cashCount, fmtMoney(report.cashAmount), report.khqrCount, fmtMoney(report.khqrAmount)),
    warnings.length > 0 ? `${lang === 'en' ? 'Note:' : lang === 'km' ? 'ចំណាំ៖' : '请注意：'}${warnings.join(lang === 'en' ? ', ' : '，')}` : t.summaryLine3(report.offlinePendingCount, report.holdOrderCount),
  ]
}

export function ShiftReportPrint({ report, lang = 'zh' }: { report: ShiftReportData; lang?: Lang }) {
  const [showOtherInfo, setShowOtherInfo] = useState(false)
  const [showOtherDetails, setShowOtherDetails] = useState(false)
  const t = copy(lang)
  const rows = reportRows(report, lang)
  const summary = summaryText(report, lang)
  const otherDetails = report.otherDetails ?? []
  const otherDetailsTotal = otherDetails.reduce((sum, detail) => sum + detail.amount, 0)
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', color: '#111827' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{report.storeName || t.storeFallback}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: '#64748b' }}>{t.title}</div>
      </div>
      <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#1e40af', marginBottom: 4 }}>{t.salesAmount}</div>
        <div style={{ fontSize: 36, lineHeight: 1.1, fontWeight: 950, color: '#111827' }}>{fmtMoney(report.salesAmount)}</div>
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
            <span style={{ fontWeight: 800, textAlign: 'right', paddingRight: row.warn ? 8 : 0 }}>{row.value}</span>
          </div>
        ))}
      </div>
      {report.otherAmount > 0 && (
        <button
          type="button"
          onClick={() => setShowOtherDetails((value) => !value)}
          style={{ marginTop: 10, width: '100%', border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff', padding: '8px 10px', color: '#1d4ed8', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}
        >
          {showOtherDetails ? t.detailToggleClose : t.detailToggleOpen}
        </button>
      )}
      {showOtherDetails && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 12, color: '#334155' }}>
                  <div style={{ fontWeight: 900, color: '#111827', marginBottom: 6 }}>{t.detailsTitle}</div>
                  {otherDetails.length === 0 ? (
            <div style={{ color: '#64748b' }}>{t.detailsEmpty}</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {otherDetails.map((detail, index) => (
                <div key={`${detail.orderNo}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, borderBottom: '1px solid #e5e7eb', paddingBottom: 7 }}>
                  <div>
                    <div style={{ fontWeight: 900, color: '#111827' }}>{t.detailOrder} {detail.orderNo}</div>
                    {detail.source && <div style={{ marginTop: 2, color: '#64748b' }}>{t.detailSource}：{detail.source}</div>}
                  </div>
                  <div style={{ fontWeight: 900, color: '#111827' }}>{fmtMoney(detail.amount)}</div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontWeight: 950, color: '#111827' }}>
                <span>{t.detailsTotal}</span>
                <span>{fmtMoney(otherDetailsTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {showOtherInfo && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 12, lineHeight: 1.6, color: '#1e3a8a' }}>
          <div style={{ fontWeight: 900 }}>{t.otherInfo}</div>
          <div>{t.otherDesc}</div>
        </div>
      )}
      <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 12, lineHeight: 1.6, color: '#334155' }}>
        {summary.map(line => <div key={line}>{line}</div>)}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
        仅统计本设备本地班次；离线待同步和挂单不计入销售额。
      </div>
    </div>
  )
}

export function printShiftReport(report: ShiftReportData, lang: Lang = 'zh') {
  const win = window.open('', '_blank', 'width=420,height=640')
  if (!win) throw new Error('PRINT_WINDOW_BLOCKED')

  const t = copy(lang)
  const rows = reportRows(report, lang)
  const summary = summaryText(report, lang)
  const otherDetails = report.otherDetails ?? []
  const otherDetailsTotal = otherDetails.reduce((sum, detail) => sum + detail.amount, 0)

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(t.title)}</title>
  <style>
    @page { size: 80mm auto; margin: 6mm; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #111827; }
    .title { text-align: center; font-size: 18px; font-weight: 900; margin-bottom: 4px; }
    .sub { text-align: center; font-size: 13px; color: #64748b; margin-bottom: 14px; }
    .rows { border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .row:last-child { border-bottom: none; }
    .label { color: #64748b; }
    .value { font-weight: 800; text-align: right; }
    .hint { margin-top: 12px; font-size: 11px; color: #94a3b8; text-align: center; }
    .hero { margin-bottom: 14px; padding: 12px 10px; border: 1px solid #bfdbfe; background: #eff6ff; text-align: center; border-radius: 10px; }
    .hero-label { font-size: 12px; font-weight: 800; color: #1e40af; margin-bottom: 4px; }
    .hero-value { font-size: 34px; line-height: 1.1; font-weight: 950; color: #111827; }
    .warn { background: #fffbeb; color: #92400e; padding-left: 6px; padding-right: 6px; }
    .summary { margin-top: 12px; padding: 10px; border: 1px solid #e5e7eb; background: #f8fafc; border-radius: 10px; font-size: 12px; line-height: 1.6; color: #334155; }
    .details { margin-top: 12px; padding: 10px; border: 1px solid #e5e7eb; background: #f8fafc; border-radius: 10px; font-size: 12px; }
    .detail-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-row:last-child { border-bottom: none; font-weight: 900; }
    .source { color: #64748b; font-size: 11px; margin-top: 2px; }
  </style>
</head>
<body>
  <div class="title">${escapeHtml(report.storeName || t.storeFallback)}</div>
  <div class="sub">${escapeHtml(t.title)}</div>
  <div class="hero">
    <div class="hero-label">${escapeHtml(t.salesAmount)}</div>
    <div class="hero-value">${escapeHtml(fmtMoney(report.salesAmount))}</div>
  </div>
  <div class="rows">
    ${rows.map(row => `<div class="row${row.warn ? ' warn' : ''}"><span class="label">${escapeHtml(row.label)}</span><span class="value">${escapeHtml(row.value)}</span></div>`).join('')}
  </div>
  <div class="summary">
    ${summary.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
  </div>
  ${otherDetails.length > 0 ? `<div class="details">
    <div style="font-weight:900;margin-bottom:6px;">${escapeHtml(t.detailsTitle)}</div>
    ${otherDetails.map(detail => `<div class="detail-row"><div><div>${escapeHtml(t.detailOrder)} ${escapeHtml(detail.orderNo)}</div>${detail.source ? `<div class="source">${escapeHtml(t.detailSource)}：${escapeHtml(detail.source)}</div>` : ''}</div><div>${escapeHtml(fmtMoney(detail.amount))}</div></div>`).join('')}
    <div class="detail-row"><div>${escapeHtml(t.detailsTotal)}</div><div>${escapeHtml(fmtMoney(otherDetailsTotal))}</div></div>
  </div>` : ''}
  <div class="hint">${escapeHtml(lang === 'en' ? 'Only this device local shift is counted. Offline pending and holds are not included in sales.' : lang === 'km' ? 'គិតតែវេនលើឧបករណ៍នេះប៉ុណ្ណោះ។ រង់ចាំ sync offline និងមាត់ស្នើមិនគិតចូលការលក់។' : '仅统计本设备本地班次；离线待同步和挂单不计入销售额。')}</div>
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
