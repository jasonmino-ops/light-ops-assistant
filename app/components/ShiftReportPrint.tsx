'use client'

export type ShiftReportData = {
  storeName: string
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
}

function fmtMoney(value: number) {
  return `$${value.toFixed(2)}`
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function shiftDuration(startIso: string, endIso: string) {
  const diffMs = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime())
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}小时${minutes}分钟`
}

function reportRows(report: ShiftReportData) {
  return [
    { label: '本班单数', value: `${report.orderCount} 单` },
    { label: 'CASH 金额', value: `${report.cashCount} 单 · ${fmtMoney(report.cashAmount)}` },
    { label: 'KHQR 金额', value: `${report.khqrCount} 单 · ${fmtMoney(report.khqrAmount)}` },
    { label: '其他支付金额', value: `${report.otherCount} 单 · ${fmtMoney(report.otherAmount)}` },
    { label: '离线待同步数量', value: `${report.offlinePendingCount} 笔`, warn: report.offlinePendingCount > 0 },
    { label: '未完成挂单数量', value: `${report.holdOrderCount} 单`, warn: report.holdOrderCount > 0 },
    { label: '班次开始时间', value: fmtDateTime(report.shiftStart) },
    { label: '本班时长', value: shiftDuration(report.shiftStart, report.generatedAt) },
    { label: '打印/生成时间', value: fmtDateTime(report.generatedAt) },
  ]
}

function summaryText(report: ShiftReportData) {
  const warnings = [
    report.offlinePendingCount > 0 ? `离线待同步 ${report.offlinePendingCount} 笔` : '',
    report.holdOrderCount > 0 ? `未完成挂单 ${report.holdOrderCount} 单` : '',
  ].filter(Boolean)

  return [
    `本班共 ${report.orderCount} 单，销售额 ${fmtMoney(report.salesAmount)}。`,
    `其中 CASH ${report.cashCount} 单 ${fmtMoney(report.cashAmount)}，KHQR ${report.khqrCount} 单 ${fmtMoney(report.khqrAmount)}。`,
    warnings.length > 0 ? `请注意：${warnings.join('，')}。` : '离线待同步与未完成挂单均为 0。',
  ]
}

export function ShiftReportPrint({ report }: { report: ShiftReportData }) {
  const rows = reportRows(report)
  const summary = summaryText(report)
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', color: '#111827' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{report.storeName || 'Store'}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: '#64748b' }}>本班交班报表</div>
      </div>
      <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#1e40af', marginBottom: 4 }}>本班销售额</div>
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
            <span style={{ color: row.warn ? '#92400e' : '#64748b', paddingLeft: row.warn ? 8 : 0 }}>{row.label}</span>
            <span style={{ fontWeight: 800, textAlign: 'right', paddingRight: row.warn ? 8 : 0 }}>{row.value}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 12, lineHeight: 1.6, color: '#334155' }}>
        {summary.map(line => <div key={line}>{line}</div>)}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
        仅统计本设备本地班次；离线待同步和挂单不计入销售额。
      </div>
    </div>
  )
}

export function printShiftReport(report: ShiftReportData) {
  const win = window.open('', '_blank', 'width=420,height=640')
  if (!win) throw new Error('PRINT_WINDOW_BLOCKED')

  const rows = reportRows(report)
  const summary = summaryText(report)

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
  <title>本班交班报表</title>
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
  </style>
</head>
<body>
  <div class="title">${escapeHtml(report.storeName || 'Store')}</div>
  <div class="sub">本班交班报表</div>
  <div class="hero">
    <div class="hero-label">本班销售额</div>
    <div class="hero-value">${escapeHtml(fmtMoney(report.salesAmount))}</div>
  </div>
  <div class="rows">
    ${rows.map(row => `<div class="row${row.warn ? ' warn' : ''}"><span class="label">${escapeHtml(row.label)}</span><span class="value">${escapeHtml(row.value)}</span></div>`).join('')}
  </div>
  <div class="summary">
    ${summary.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
  </div>
  <div class="hint">仅统计本设备本地班次；离线待同步和挂单不计入销售额。</div>
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
