'use client'

export type ShiftReportData = {
  storeName: string
  shiftStart: string
  generatedAt: string
  salesAmount: number
  orderCount: number
  cashAmount: number
  khqrAmount: number
  otherAmount: number
  offlinePendingCount: number
  holdOrderCount: number
}

function fmtMoney(value: number) {
  return `$${value.toFixed(2)}`
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ShiftReportPrint({ report }: { report: ShiftReportData }) {
  const rows = [
    ['本班销售额', fmtMoney(report.salesAmount)],
    ['本班单数', `${report.orderCount} 单`],
    ['CASH 金额', fmtMoney(report.cashAmount)],
    ['KHQR 金额', fmtMoney(report.khqrAmount)],
    ['其他支付金额', fmtMoney(report.otherAmount)],
    ['离线待同步数量', `${report.offlinePendingCount} 笔`],
    ['未完成挂单数量', `${report.holdOrderCount} 单`],
    ['班次开始时间', fmtDateTime(report.shiftStart)],
    ['当前时间', fmtDateTime(report.generatedAt)],
  ]

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', color: '#111827' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{report.storeName || 'Store'}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: '#64748b' }}>本班交班报表</div>
      </div>
      <div style={{ borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 0',
              borderBottom: label === '当前时间' ? 'none' : '1px solid #f1f5f9',
              fontSize: 13,
            }}
          >
            <span style={{ color: '#64748b' }}>{label}</span>
            <span style={{ fontWeight: 800, textAlign: 'right' }}>{value}</span>
          </div>
        ))}
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

  const rows = [
    ['本班销售额', fmtMoney(report.salesAmount)],
    ['本班单数', `${report.orderCount} 单`],
    ['CASH 金额', fmtMoney(report.cashAmount)],
    ['KHQR 金额', fmtMoney(report.khqrAmount)],
    ['其他支付金额', fmtMoney(report.otherAmount)],
    ['离线待同步数量', `${report.offlinePendingCount} 笔`],
    ['未完成挂单数量', `${report.holdOrderCount} 单`],
    ['班次开始时间', fmtDateTime(report.shiftStart)],
    ['当前时间', fmtDateTime(report.generatedAt)],
  ]

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
  </style>
</head>
<body>
  <div class="title">${escapeHtml(report.storeName || 'Store')}</div>
  <div class="sub">本班交班报表</div>
  <div class="rows">
    ${rows.map(([label, value]) => `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`).join('')}
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
