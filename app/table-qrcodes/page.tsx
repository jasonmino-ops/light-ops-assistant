'use client'

import { useState, useEffect, useRef, CSSProperties } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import QRCode from 'react-qr-code'
import { publicUrl } from '@/lib/public-url'

// ─── 解析桌号输入 ────────────────────────────────────────────────────────────

function parseTableInput(raw: string): string[] {
  const segments = raw.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
  const result: string[] = []

  for (const seg of segments) {
    const m = seg.match(/^([A-Za-z]*)(\d+)-([A-Za-z]*)(\d+)$/)
    if (m) {
      const prefix = m[1] || m[3]
      const start  = parseInt(m[2])
      const end    = parseInt(m[4])
      const pad    = Math.max(m[2].length, m[4].length)
      if (start <= end && end - start <= 200) {
        for (let i = start; i <= end; i++) {
          result.push(`${prefix}${String(i).padStart(pad, '0')}`)
        }
        continue
      }
    }
    result.push(seg)
  }

  const seen = new Set<string>()
  return result.filter((t) => { if (seen.has(t)) return false; seen.add(t); return true }).slice(0, 100)
}

// ─── 复制到剪贴板（兼容 WebView fallback） ──────────────────────────────────

function copyText(text: string, onDone: () => void) {
  const doFallback = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    try { document.execCommand('copy'); onDone() } catch {}
    document.body.removeChild(ta)
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onDone).catch(doFallback)
  } else {
    doFallback()
  }
}

// ─── 单张 PNG 下载（canvas） ─────────────────────────────────────────────────

async function downloadQRPng(tableNo: string, url: string, storeName: string) {
  const QRLib = (await import('qrcode')).default
  const QR_SIZE = 260
  const PAD = 20
  const TEXT_H = 90

  const canvas = document.createElement('canvas')
  canvas.width  = QR_SIZE + PAD * 2
  canvas.height = QR_SIZE + PAD * 2 + TEXT_H

  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const qrCanvas = document.createElement('canvas')
  await QRLib.toCanvas(qrCanvas, url, { width: QR_SIZE, margin: 1, color: { dark: '#111827', light: '#ffffff' } })
  ctx.drawImage(qrCanvas, PAD, PAD)

  const cx = canvas.width / 2
  const baseY = QR_SIZE + PAD * 2

  ctx.textAlign = 'center'
  ctx.fillStyle = '#111827'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText(`桌号 ${tableNo}`, cx, baseY + 26)

  ctx.fillStyle = '#6b7280'
  ctx.font = '14px sans-serif'
  ctx.fillText(storeName, cx, baseY + 50)
  ctx.fillText('扫码点单', cx, baseY + 72)

  const a = document.createElement('a')
  a.download = `table-${tableNo}.png`
  a.href = canvas.toDataURL('image/png')
  a.click()
}

// ─── 样式 ────────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  page:      { minHeight: '100vh', background: '#f5f7fa', fontFamily: 'system-ui, sans-serif' },
  header:    { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', borderBottom: '1px solid #e5e7eb' },
  backBtn:   { fontSize: 14, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' },
  title:     { fontSize: 17, fontWeight: 700, color: '#111827' },
  body:      { maxWidth: 680, margin: '0 auto', padding: '16px 12px 40px' },
  card:      { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  label:     { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
  infoRow:   { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#111827', marginBottom: 4 },
  infoKey:   { color: '#9ca3af', minWidth: 60 },
  textarea:  { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: 14, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' as const, outline: 'none' },
  hint:      { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  parseBtn:  { marginTop: 10, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  actionRow: { display: 'flex', gap: 10, marginBottom: 16 },
  printBtn:  { padding: '9px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  grid:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 },
  qrCard:    { background: '#fff', borderRadius: 12, padding: '16px 12px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 },
  qrTableNo: { fontSize: 16, fontWeight: 700, color: '#111827', marginTop: 10, marginBottom: 2 },
  qrStore:   { fontSize: 12, color: '#6b7280', marginBottom: 2 },
  qrScan:    { fontSize: 12, color: '#2563eb', marginBottom: 8 },
  linkBox:   { width: '100%', background: '#f8f8f8', borderRadius: 6, padding: '6px 8px', marginTop: 8, marginBottom: 4, wordBreak: 'break-all' as const, fontSize: 10, color: '#6b7280', lineHeight: 1.4 },
  copyBtn:   { width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 12, cursor: 'pointer', fontWeight: 500 },
  copyBtnOk: { width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid #86efac', background: '#f0fdf4', color: '#15803d', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  dlBtn:     { marginTop: 6, padding: '5px 0', width: '100%', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: 12, cursor: 'pointer' },
  empty:     { textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 14 },
}

// ─── 页面 ────────────────────────────────────────────────────────────────────

export default function TableQRCodesPage() {
  const [storeCode,  setStoreCode]  = useState('')
  const [storeName,  setStoreName]  = useState('')
  const [input,      setInput]      = useState('A01-A10')
  const [tables,     setTables]     = useState<string[]>([])
  const [copiedMap,  setCopiedMap]  = useState<Record<string, boolean>>({})

  useEffect(() => {
    apiFetch('/api/me', { headers: OWNER_CTX }).then(async (res) => {
      const data = await res.json()
      if (data.storeCode) setStoreCode(data.storeCode)
      if (data.storeName) setStoreName(data.storeName)
    }).catch(() => {})
  }, [])

  function tableUrl(t: string) {
    return publicUrl(`/menu?code=${encodeURIComponent(storeCode)}&table=${encodeURIComponent(t)}`)
  }

  function handleCopy(t: string) {
    const url = tableUrl(t)
    copyText(url, () => {
      setCopiedMap((prev) => ({ ...prev, [t]: true }))
      setTimeout(() => setCopiedMap((prev) => ({ ...prev, [t]: false })), 2000)
    })
  }

  function handleParse() {
    setTables(parseTableInput(input))
    setCopiedMap({})
  }

  const qrGridRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .qr-grid { display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 12px !important; padding: 12px !important; }
          .qr-card { break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 8px 8px; box-shadow: none !important; }
          .qr-card-btns { display: none !important; }
          .qr-card-link { display: none !important; }
          .print-header { display: flex !important; justify-content: center; margin-bottom: 8px; font-size: 14px; color: #6b7280; }
        }
        @media screen { .print-header { display: none; } }
      `}</style>

      <div style={s.page}>
        <div style={s.header} className="no-print">
          <button style={s.backBtn} onClick={() => window.location.href = '/invite'}>← 返回</button>
          <span style={s.title}>🪑 桌号二维码</span>
        </div>

        <div style={s.body}>
          {/* 门店信息 */}
          <div style={s.card} className="no-print">
            <div style={s.label}>门店信息</div>
            <div style={s.infoRow}>
              <span style={s.infoKey}>门店编号</span>
              <span style={{ fontWeight: 600, fontFamily: 'monospace', color: storeCode ? '#111827' : '#9ca3af' }}>
                {storeCode || '加载中…'}
              </span>
            </div>
            <div style={s.infoRow}>
              <span style={s.infoKey}>门店名称</span>
              <span>{storeName || '—'}</span>
            </div>
          </div>

          {/* 输入区 */}
          <div style={s.card} className="no-print">
            <div style={s.label}>输入桌号</div>
            <textarea
              style={s.textarea}
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={'A01-A20\n或：A01,A02,B01,B02'}
            />
            <div style={s.hint}>
              支持范围（A01-A20）或逗号分隔（A01,A02,B01），最多生成 100 张。
            </div>
            <button style={s.parseBtn} onClick={handleParse}>
              生成二维码
            </button>
          </div>

          {/* 操作栏 */}
          {tables.length > 0 && (
            <div style={s.actionRow} className="no-print">
              <button style={s.printBtn} onClick={() => window.print()}>
                🖨️ 批量打印（{tables.length} 张）
              </button>
            </div>
          )}

          {/* 打印页眉 */}
          <div className="print-header">{storeName} · 桌号二维码</div>

          {/* 二维码网格 */}
          {tables.length === 0 ? (
            <div style={s.empty} className="no-print">输入桌号后点击「生成二维码」</div>
          ) : (
            <div style={s.grid} ref={qrGridRef} className="qr-grid">
              {tables.map((t) => {
                const url = storeCode ? tableUrl(t) : `table:${t}`
                const isCopied = copiedMap[t] ?? false
                return (
                  <div key={t} style={s.qrCard} className="qr-card">
                    <QRCode
                      value={url}
                      size={140}
                      style={{ height: 'auto', maxWidth: '100%', width: '100%' }}
                      viewBox="0 0 256 256"
                    />
                    <div style={s.qrTableNo}>桌号 {t}</div>
                    <div style={s.qrStore}>{storeName || '—'}</div>
                    <div style={s.qrScan}>扫码点单</div>

                    {/* 链接区（屏幕可见，打印隐藏） */}
                    <div style={s.linkBox} className="qr-card-link">{url}</div>

                    {/* 操作按钮（打印时隐藏） */}
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }} className="qr-card-btns">
                      <button
                        style={isCopied ? s.copyBtnOk : s.copyBtn}
                        onClick={() => handleCopy(t)}
                      >
                        {isCopied ? '✓ 已复制' : '复制链接'}
                      </button>
                      <button
                        style={s.dlBtn}
                        onClick={() => storeCode && downloadQRPng(t, url, storeName)}
                        disabled={!storeCode}
                      >
                        ↓ 下载 PNG
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
