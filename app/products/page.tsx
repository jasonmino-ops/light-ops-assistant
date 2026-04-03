'use client'

import { useState, KeyboardEvent, useRef } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import BarcodeScanner from '@/app/components/BarcodeScanner'

// ─── Types ────────────────────────────────────────────────────────────────────

type Product = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: number
  status: 'ACTIVE' | 'DISABLED'
}

type Mode = 'idle' | 'loading' | 'found' | 'not-found' | 'saved'

type ImportResult = {
  imported: number
  failed: number
  errors: Array<{ row: number; barcode: string; reason: string }>
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [mode, setMode] = useState<Mode>('idle')
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Import state
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Edit form
  const [editName, setEditName] = useState('')
  const [editSpec, setEditSpec] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editStatus, setEditStatus] = useState<'ACTIVE' | 'DISABLED'>('ACTIVE')

  // Create form
  const [newBarcode, setNewBarcode] = useState('')
  const [newName, setNewName] = useState('')
  const [newSpec, setNewSpec] = useState('')
  const [newPrice, setNewPrice] = useState('')

  // ── Import ────────────────────────────────────────────────────────────────

  async function downloadTemplate() {
    try {
      const res = await fetch('/api/products/import', {
        headers: { ...OWNER_CTX },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'products_template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silent fail — user can retry
    }
  }

  async function handleImport() {
    if (!importFile) return
    setImporting(true)
    setImportResult(null)
    setImportError(null)
    try {
      const form = new FormData()
      form.append('file', importFile)
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { ...OWNER_CTX },
        body: form,
      })
      const body = await res.json()
      if (res.ok) {
        setImportResult(body)
        setImportFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        setImportError(body.message ?? body.error ?? '导入失败')
      }
    } catch {
      setImportError('网络错误，请重试')
    } finally {
      setImporting(false)
    }
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  async function lookup(barcode: string) {
    const b = barcode.trim()
    if (!b) return
    setError(null)
    setProduct(null)
    setMode('loading')
    try {
      const res = await apiFetch(
        `/api/products?barcode=${encodeURIComponent(b)}`,
        undefined,
        OWNER_CTX,
      )
      if (res.ok) {
        const p: Product = await res.json()
        setProduct(p)
        setEditName(p.name)
        setEditSpec(p.spec ?? '')
        setEditPrice(String(p.sellPrice))
        setEditStatus(p.status)
        setMode('found')
      } else {
        const body = await res.json().catch(() => ({}))
        if (body.error === 'PRODUCT_NOT_FOUND') {
          setNewBarcode(b)
          setNewName('')
          setNewSpec('')
          setNewPrice('')
          setMode('not-found')
        } else {
          setError('查询失败，请重试')
          setMode('idle')
        }
      }
    } catch {
      setError('网络错误，请重试')
      setMode('idle')
    }
  }

  function handleScanned(barcode: string) {
    setScannerOpen(false)
    setBarcodeInput(barcode)
    lookup(barcode)
  }

  function handleBarcodeKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') lookup(barcodeInput)
  }

  function reset() {
    setBarcodeInput('')
    setProduct(null)
    setMode('idle')
    setError(null)
  }

  // ── Save (edit) ───────────────────────────────────────────────────────────

  async function handleSave() {
    if (!product) return
    const price = parseFloat(editPrice)
    if (!editName.trim()) { setError('商品名不能为空'); return }
    if (isNaN(price) || price <= 0) { setError('请输入有效的售价（大于 0）'); return }
    setError(null)

    try {
      const res = await apiFetch(
        `/api/products/${product.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: editName.trim(),
            spec: editSpec.trim() || null,
            sellPrice: price,
            status: editStatus,
          }),
        },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setProduct(body)
        setMode('saved')
      } else {
        setError(body.message ?? '保存失败')
      }
    } catch {
      setError('网络错误，请重试')
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    const price = parseFloat(newPrice)
    if (!newBarcode.trim()) { setError('条码不能为空'); return }
    if (!newName.trim()) { setError('商品名不能为空'); return }
    if (isNaN(price) || price <= 0) { setError('请输入有效的售价（大于 0）'); return }
    setError(null)

    try {
      const res = await apiFetch(
        '/api/products',
        {
          method: 'POST',
          body: JSON.stringify({
            barcode: newBarcode.trim(),
            name: newName.trim(),
            spec: newSpec.trim() || null,
            sellPrice: price,
          }),
        },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setProduct(body)
        setEditName(body.name)
        setEditSpec(body.spec ?? '')
        setEditPrice(String(body.sellPrice))
        setEditStatus(body.status)
        setMode('saved')
      } else {
        setError(body.message ?? '新增失败')
      }
    } catch {
      setError('网络错误，请重试')
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {scannerOpen && (
        <BarcodeScanner
          onScanned={handleScanned}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Header */}
      <div style={s.headerBar}>
        <span style={s.headerTitle}>商品管理</span>
      </div>

      <div style={s.body}>

        {/* ── 批量导入 ── */}
        <div style={s.importSection}>
          <button style={s.importToggle} onClick={() => { setImportOpen((v) => !v); setImportResult(null); setImportError(null) }}>
            <span style={s.importToggleText}>批量导入</span>
            <span style={s.importToggleArrow}>{importOpen ? '▲' : '▼'}</span>
          </button>

          {importOpen && (
            <div style={s.importBody}>
              <button style={s.templateBtn} onClick={downloadTemplate} type="button">
                下载 Excel 模板
              </button>

              <div style={s.uploadRow}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={s.fileInput}
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] ?? null)
                    setImportResult(null)
                    setImportError(null)
                  }}
                />
                <button
                  style={{ ...s.importBtn, opacity: (!importFile || importing) ? 0.5 : 1 }}
                  type="button"
                  disabled={!importFile || importing}
                  onClick={handleImport}
                >
                  {importing ? '导入中…' : '开始导入'}
                </button>
              </div>

              {importError && <div style={s.importErrorMsg}>{importError}</div>}

              {importResult && (
                <div style={s.importResult}>
                  <div style={s.importResultSummary}>
                    <span style={s.importOk}>✓ 成功 {importResult.imported} 条</span>
                    {importResult.failed > 0 && (
                      <span style={s.importFail}>✕ 失败 {importResult.failed} 条</span>
                    )}
                  </div>
                  {importResult.errors.length > 0 && (
                    <div style={s.importErrorList}>
                      {importResult.errors.map((e, i) => (
                        <div key={i} style={s.importErrorRow}>
                          <span style={s.importErrorRowNum}>第 {e.row} 行</span>
                          <span style={s.importErrorBarcode}>{e.barcode}</span>
                          <span style={s.importErrorReason}>{e.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 成功反馈 ── */}
        {mode === 'saved' && product && (
          <div style={s.savedCard}>
            <div style={s.savedCheck}>✓</div>
            <div style={s.savedTitle}>已保存</div>
            <div style={s.savedName}>{product.name}{product.spec ? ` · ${product.spec}` : ''}</div>
            <div style={s.savedPrice}>${product.sellPrice.toFixed(2)}</div>
            <div style={{
              ...s.savedBadge,
              background: product.status === 'ACTIVE' ? 'rgba(255,255,255,0.2)' : 'rgba(255,100,100,0.3)',
            }}>
              {product.status === 'ACTIVE' ? '✓ 已启用' : '✕ 已停用'}
            </div>
            <button style={s.nextBtn} onClick={reset}>继续查询 / 新增</button>
          </div>
        )}

        {mode !== 'saved' && (
          <>
            {/* 扫码 + 手动输入 */}
            <div style={s.card}>
              <button
                type="button"
                style={s.scanBtn}
                onClick={() => { setError(null); setScannerOpen(true) }}
                disabled={mode === 'loading'}
              >
                <span style={s.scanIcon}>⊡</span>
                <span>扫码查询 / 新增</span>
              </button>

              <div style={s.orRow}>
                <div style={s.orLine} /><span style={s.orText}>或手动输入条码</span><div style={s.orLine} />
              </div>

              <div style={s.inputRow}>
                <input
                  style={s.input}
                  type="text"
                  placeholder="条码"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={handleBarcodeKey}
                />
                <button
                  style={s.queryBtn}
                  type="button"
                  onClick={() => lookup(barcodeInput)}
                  disabled={mode === 'loading' || !barcodeInput.trim()}
                >
                  {mode === 'loading' ? '…' : '查询'}
                </button>
              </div>
            </div>

            {error && <div style={s.errorMsg}>{error}</div>}

            {/* ── 商品已存在：编辑表单 ── */}
            {mode === 'found' && product && (
              <div style={s.card}>
                <div style={s.sectionLabel}>修改商品信息</div>

                <div style={s.barcodeRow}>
                  <span style={s.barcodeLabel}>条码</span>
                  <span style={s.barcodeValue}>{product.barcode}</span>
                </div>

                <Field label="商品名 *">
                  <input
                    style={s.field}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="商品名称"
                  />
                </Field>

                <Field label="规格">
                  <input
                    style={s.field}
                    value={editSpec}
                    onChange={(e) => setEditSpec(e.target.value)}
                    placeholder="如 550ml（可留空）"
                  />
                </Field>

                <Field label="售价 *">
                  <input
                    style={s.field}
                    type="text"
                    inputMode="decimal"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                  />
                </Field>

                <Field label="状态">
                  <div style={s.statusRow}>
                    {(['ACTIVE', 'DISABLED'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        style={{
                          ...s.statusBtn,
                          ...(editStatus === st ? (st === 'ACTIVE' ? s.statusActive : s.statusDisabled) : {}),
                        }}
                        onClick={() => setEditStatus(st)}
                      >
                        {st === 'ACTIVE' ? '启用' : '停用'}
                      </button>
                    ))}
                  </div>
                </Field>

                <button style={s.saveBtn} onClick={handleSave}>保存修改</button>
              </div>
            )}

            {/* ── 商品不存在：快速新增 ── */}
            {mode === 'not-found' && (
              <div style={s.card}>
                <div style={s.noticeRow}>
                  <span style={s.noticeIcon}>＋</span>
                  <div>
                    <div style={s.noticeTitle}>未找到该条码，快速新增商品</div>
                    <div style={s.noticeSub}>条码：{newBarcode}</div>
                  </div>
                </div>

                <Field label="条码">
                  <input
                    style={s.field}
                    value={newBarcode}
                    onChange={(e) => setNewBarcode(e.target.value)}
                    placeholder="条码"
                  />
                </Field>

                <Field label="商品名 *">
                  <input
                    style={s.field}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="商品名称"
                    autoFocus
                  />
                </Field>

                <Field label="规格">
                  <input
                    style={s.field}
                    value={newSpec}
                    onChange={(e) => setNewSpec(e.target.value)}
                    placeholder="如 550ml（可留空）"
                  />
                </Field>

                <Field label="售价 *">
                  <input
                    style={s.field}
                    type="text"
                    inputMode="decimal"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                  />
                </Field>

                <button style={s.saveBtn} onClick={handleCreate}>确认新增</button>
              </div>
            )}

            {/* 空状态 */}
            {mode === 'idle' && (
              <div style={s.empty}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>扫码或输入条码</div>
                <div style={s.emptySub}>查询已有商品或新增商品</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={f.wrap}>
      <div style={f.label}>{label}</div>
      {children}
    </div>
  )
}

const f: Record<string, React.CSSProperties> = {
  wrap: { marginBottom: 12 },
  label: { fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 },
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  headerBar: {
    background: 'var(--blue)',
    padding: '16px 16px 18px',
    display: 'flex',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  body: {
    flex: 1,
    padding: '12px 12px 80px',
    maxWidth: 480,
    margin: '0 auto',
    width: '100%',
  },
  card: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    padding: '14px 16px',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    color: 'var(--muted)',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: 14,
  },
  scanBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    height: 48,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
  },
  scanIcon: { fontSize: 22 },
  orRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  orLine: { flex: 1, height: 1, background: 'var(--border)' },
  orText: { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' as const },
  inputRow: { display: 'flex', gap: 8 },
  input: {
    flex: 1,
    height: 44,
    minWidth: 0,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 16,
    outline: 'none',
    background: '#f7f8fa',
  },
  queryBtn: {
    flexShrink: 0,
    height: 44,
    padding: '0 18px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },
  field: {
    display: 'block',
    width: '100%',
    height: 44,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 12px',
    fontSize: 15,
    outline: 'none',
    background: '#f7f8fa',
    boxSizing: 'border-box' as const,
  },
  barcodeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    padding: '8px 12px',
    background: '#f7f8fa',
    borderRadius: 'var(--radius-sm)',
  },
  barcodeLabel: { fontSize: 12, color: 'var(--muted)' },
  barcodeValue: { fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' },
  statusRow: { display: 'flex', gap: 8 },
  statusBtn: {
    flex: 1,
    height: 40,
    border: '1.5px solid var(--border)',
    borderRadius: 20,
    background: '#f7f8fa',
    fontSize: 14,
    color: 'var(--muted)',
    fontWeight: 500,
  },
  statusActive: {
    background: '#e8f5e9',
    borderColor: '#4caf50',
    color: '#2e7d32',
    fontWeight: 700,
  },
  statusDisabled: {
    background: '#fff0f0',
    borderColor: '#e57373',
    color: '#c62828',
    fontWeight: 700,
  },
  saveBtn: {
    display: 'block',
    width: '100%',
    height: 48,
    marginTop: 4,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 16,
    fontWeight: 700,
  },
  noticeRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
    padding: '10px 12px',
    background: '#fffbe6',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid #ffe58f',
  },
  noticeIcon: { fontSize: 22, color: '#fa8c16', flexShrink: 0, lineHeight: 1.3 },
  noticeTitle: { fontSize: 14, fontWeight: 600, color: '#7c4a00', marginBottom: 2 },
  noticeSub: { fontSize: 12, color: '#ad6800', fontFamily: 'monospace' },
  errorMsg: {
    fontSize: 13,
    color: 'var(--red)',
    padding: '0 2px 8px',
  },
  // ── Saved / Success ──
  savedCard: {
    background: 'var(--blue)',
    borderRadius: 'var(--radius)',
    padding: '28px 20px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  savedCheck: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 26,
    color: '#fff',
    marginBottom: 4,
  },
  savedTitle: { fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 },
  savedName: { fontSize: 18, fontWeight: 700, color: '#fff' },
  savedPrice: { fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  savedBadge: {
    fontSize: 13,
    color: '#fff',
    padding: '4px 14px',
    borderRadius: 20,
    marginTop: 4,
  },
  nextBtn: {
    marginTop: 12,
    height: 44,
    padding: '0 28px',
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
  },
  // ── Import ──
  importSection: {
    background: 'var(--card)',
    borderRadius: 'var(--radius)',
    marginBottom: 10,
    overflow: 'hidden',
  },
  importToggle: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '13px 16px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  importToggleText: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
  },
  importToggleArrow: {
    fontSize: 10,
    color: 'var(--muted)',
  },
  importBody: {
    padding: '0 16px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    borderTop: '1px solid var(--border)',
  },
  templateBtn: {
    height: 40,
    background: '#f0f5ff',
    border: '1.5px solid #91caff',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--blue)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 12,
  },
  uploadRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  fileInput: {
    flex: 1,
    fontSize: 13,
    color: 'var(--text)',
    minWidth: 0,
  },
  importBtn: {
    flexShrink: 0,
    height: 40,
    padding: '0 16px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  },
  importErrorMsg: {
    fontSize: 13,
    color: 'var(--red)',
  },
  importResult: {
    background: '#f8f8f8',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  importResultSummary: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    fontSize: 14,
    fontWeight: 700,
  },
  importOk: {
    color: '#52c41a',
  },
  importFail: {
    color: 'var(--red)',
  },
  importErrorList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    maxHeight: 200,
    overflowY: 'auto' as const,
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
  },
  importErrorRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    fontSize: 12,
  },
  importErrorRowNum: {
    flexShrink: 0,
    color: 'var(--muted)',
    minWidth: 44,
  },
  importErrorBarcode: {
    flexShrink: 0,
    fontFamily: 'monospace',
    color: 'var(--text)',
    minWidth: 80,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  importErrorReason: {
    color: 'var(--red)',
    flex: 1,
  },
  // ── Empty ──
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 20px',
    gap: 8,
  },
  emptyIcon: { fontSize: 48, color: '#d0d0d0', lineHeight: 1, marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: '#bbb' },
  emptySub: { fontSize: 13, color: '#ccc' },
}
