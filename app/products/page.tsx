'use client'

import { useState, KeyboardEvent, useRef, useCallback, useEffect } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import BarcodeScanner from '@/app/components/BarcodeScanner'
import { useLocale } from '@/app/components/LangProvider'
import LangToggleBtn from '@/app/components/LangToggleBtn'

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
}

type Product = {
  id: string
  barcode: string
  name: string
  spec: string | null
  sellPrice: number
  status: 'ACTIVE' | 'DISABLED'
  categoryId: string | null
}

type Mode = 'idle' | 'loading' | 'found' | 'not-found' | 'saved'

type DeleteConfirm =
  | { type: 'single'; id: string; name: string }
  | { type: 'batch'; ids: string[] }

type ImportResult = {
  imported: number
  failed: number
  errors: Array<{ row: number; barcode: string; reason: string }>
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { t } = useLocale()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [cameraFailCount, setCameraFailCount] = useState(0)
  const scanSucceededRef = useRef(false)
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
  const [editCategoryId, setEditCategoryId] = useState<string>('')

  // Create form
  const [newBarcode, setNewBarcode] = useState('')
  const [newName, setNewName] = useState('')
  const [newSpec, setNewSpec] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newCategoryId, setNewCategoryId] = useState<string>('')

  // Category management
  const [categories, setCategories] = useState<Category[]>([])
  const [catOpen, setCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatParentId, setNewCatParentId] = useState('')
  const [catSaving, setCatSaving] = useState(false)
  const [catError, setCatError] = useState<string | null>(null)

  // Product list + delete
  const [listOpen, setListOpen] = useState(false)
  const [productList, setProductList] = useState<Product[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null)

  // ── Load categories on mount ──────────────────────────────────────────────

  useEffect(() => {
    apiFetch('/api/categories', undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Category[]) => setCategories(list))
      .catch(() => {})
  }, [])

  // ── Add category ──────────────────────────────────────────────────────────

  async function handleAddCategory() {
    const name = newCatName.trim()
    if (!name) return
    setCatSaving(true)
    setCatError(null)
    try {
      const res = await apiFetch(
        '/api/categories',
        { method: 'POST', body: JSON.stringify({ name, parentId: newCatParentId || null }) },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setCategories((prev) => [...prev, body].sort((a, b) => a.name.localeCompare(b.name)))
        setNewCatName('')
        setNewCatParentId('')
      } else {
        setCatError(body.message ?? t('products.catSaveError'))
      }
    } catch {
      setCatError(t('products.catSaveError'))
    } finally {
      setCatSaving(false)
    }
  }

  // ── Product list ──────────────────────────────────────────────────────────

  async function loadProductList() {
    setListLoading(true)
    setDeleteMsg(null)
    try {
      const res = await apiFetch('/api/products?all=true', undefined, OWNER_CTX)
      if (res.ok) {
        const list: Product[] = await res.json()
        setProductList(list)
        setSelectedIds(new Set())
      }
    } catch {
      // silent fail
    } finally {
      setListLoading(false)
    }
  }

  function toggleList() {
    const next = !listOpen
    setListOpen(next)
    if (next && productList.length === 0) loadProductList()
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === productList.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(productList.map((p) => p.id)))
    }
  }

  async function executeDelete() {
    if (!deleteConfirm) return
    setDeleting(true)
    setDeleteMsg(null)
    try {
      if (deleteConfirm.type === 'single') {
        const res = await apiFetch(
          `/api/products/${deleteConfirm.id}`,
          { method: 'DELETE' },
          OWNER_CTX,
        )
        const body = await res.json()
        if (res.ok) {
          setProductList((prev) => prev.filter((p) => p.id !== deleteConfirm.id))
          setSelectedIds((prev) => { const next = new Set(prev); next.delete(deleteConfirm.id); return next })
          setDeleteConfirm(null)
        } else if (body.error === 'PRODUCT_HAS_SALES') {
          setDeleteMsg(t('products.hasSalesHint'))
          setDeleteConfirm(null)
        } else {
          setDeleteMsg(body.message ?? '删除失败')
          setDeleteConfirm(null)
        }
      } else {
        const res = await apiFetch(
          '/api/products/batch-delete',
          { method: 'POST', body: JSON.stringify({ ids: deleteConfirm.ids }) },
          OWNER_CTX,
        )
        const body = await res.json()
        if (res.ok) {
          const deletedSet = new Set<string>(body.deleted)
          setProductList((prev) => prev.filter((p) => !deletedSet.has(p.id)))
          setSelectedIds(new Set())
          setDeleteConfirm(null)
          const skippedCount: number = body.skipped?.length ?? 0
          if (skippedCount > 0) {
            setDeleteMsg(
              t('products.batchDeleteResult')
                .replace('{deleted}', String(body.deleted.length))
                .replace('{skipped}', String(skippedCount))
            )
          }
        } else {
          setDeleteMsg(body.message ?? '批量删除失败')
          setDeleteConfirm(null)
        }
      }
    } catch {
      setDeleteMsg(t('common.networkError'))
      setDeleteConfirm(null)
    } finally {
      setDeleting(false)
    }
  }

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
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // delay revoke so browser finishes reading the blob before it's released
      setTimeout(() => URL.revokeObjectURL(url), 2000)
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
        setEditCategoryId(p.categoryId ?? '')
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

  const handleScanned = useCallback((barcode: string) => {
    scanSucceededRef.current = true
    setCameraFailCount(0)
    setScannerOpen(false)
    setBarcodeInput(barcode)
    lookup(barcode)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleScannerClose() {
    if (!scanSucceededRef.current) setCameraFailCount((c) => Math.min(c + 1, 5))
    scanSucceededRef.current = false
    setScannerOpen(false)
  }

  function handleCameraError(msg: string) {
    setScannerOpen(false)
    setCameraFailCount((c) => Math.min(c + 1, 5))
    setError(msg)
  }

  function openScanner() {
    scanSucceededRef.current = false
    setError(null)
    setScannerOpen(true)
  }

  function handleBarcodeKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') lookup(barcodeInput)
  }

  function reset() {
    setBarcodeInput('')
    setProduct(null)
    setMode('idle')
    setError(null)
    setEditCategoryId('')
    setNewCategoryId('')
  }

  // ── Save (edit) ───────────────────────────────────────────────────────────

  async function handleSave() {
    if (!product) return
    const price = parseFloat(editPrice)
    if (!editName.trim()) { setError(t('products.nameRequired')); return }
    if (isNaN(price) || price <= 0) { setError(t('products.priceInvalid')); return }
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
            categoryId: editCategoryId || null,
          }),
        },
        OWNER_CTX,
      )
      const body = await res.json()
      if (res.ok) {
        setProduct(body)
        setMode('saved')
      } else {
        setError(body.message ?? t('products.saveFailed'))
      }
    } catch {
      setError(t('common.networkError'))
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async function handleCreate() {
    const price = parseFloat(newPrice)
    if (!newBarcode.trim()) { setError(t('products.barcodeRequired')); return }
    if (!newName.trim()) { setError(t('products.nameRequired')); return }
    if (isNaN(price) || price <= 0) { setError(t('products.priceInvalid')); return }
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
            categoryId: newCategoryId || null,
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
        setEditCategoryId(body.categoryId ?? '')
        setMode('saved')
      } else {
        setError(body.message ?? t('products.createFailed'))
      }
    } catch {
      setError(t('common.networkError'))
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {scannerOpen && (
        <BarcodeScanner
          onScanned={handleScanned}
          onClose={handleScannerClose}
          onCameraError={handleCameraError}
        />
      )}

      {/* Header */}
      <div style={{ ...s.headerBar, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={s.headerTitle}>{t('products.title')}</span>
        <LangToggleBtn />
      </div>

      <div style={s.body}>

        {/* ── 批量导入 ── */}
        <div style={s.importSection}>
          <button style={s.importToggle} onClick={() => { setImportOpen((v) => !v); setImportResult(null); setImportError(null) }}>
            <span style={s.importToggleText}>{t('products.importToggle')}</span>
            <span style={s.importToggleArrow}>{importOpen ? '▲' : '▼'}</span>
          </button>

          {importOpen && (
            <div style={s.importBody}>
              <button style={s.templateBtn} onClick={downloadTemplate} type="button">
                {t('products.downloadTemplate')}
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
                  {importing ? t('products.importing') : t('products.importBtn')}
                </button>
              </div>

              {importError && <div style={s.importErrorMsg}>{importError}</div>}

              {importResult && (
                <div style={s.importResult}>
                  <div style={s.importResultSummary}>
                    <span style={s.importOk}>{t('products.importOkPrefix')} {importResult.imported} {t('products.importCountSuffix')}</span>
                    {importResult.failed > 0 && (
                      <span style={s.importFail}>{t('products.importFailPrefix')} {importResult.failed} {t('products.importCountSuffix')}</span>
                    )}
                  </div>
                  {importResult.errors.length > 0 && (
                    <div style={s.importErrorList}>
                      {importResult.errors.map((e, i) => (
                        <div key={i} style={s.importErrorRow}>
                          <span style={s.importErrorRowNum}>{t('products.importRowPrefix')} {e.row} {t('products.importRowSuffix')}</span>
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

        {/* ── 分类管理 ── */}
        <div style={s.importSection}>
          <button style={s.importToggle} onClick={() => { setCatOpen((v) => !v); setCatError(null) }}>
            <span style={s.importToggleText}>{t('products.categories')}</span>
            <span style={s.importToggleArrow}>{catOpen ? '▲' : '▼'}</span>
          </button>

          {catOpen && (
            <div style={s.importBody}>
              {/* 分类列表 */}
              {categories.length > 0 && (
                <div style={s.catList}>
                  {(() => {
                    const l1 = categories.filter((c) => !c.parentId)
                    const l2Map = new Map<string, Category[]>()
                    categories.filter((c) => c.parentId).forEach((c) => {
                      const arr = l2Map.get(c.parentId!) ?? []
                      arr.push(c)
                      l2Map.set(c.parentId!, arr)
                    })
                    // Also collect l2 with no matching l1 parent (orphans)
                    const orphanL2 = categories.filter((c) => c.parentId && !l1.find((p) => p.id === c.parentId))

                    return (
                      <>
                        {l1.map((cat) => (
                          <div key={cat.id}>
                            <div style={s.catL1Row}>{cat.name}</div>
                            {(l2Map.get(cat.id) ?? []).map((sub) => (
                              <div key={sub.id} style={s.catL2Row}>└ {sub.name}</div>
                            ))}
                          </div>
                        ))}
                        {orphanL2.map((c) => (
                          <div key={c.id} style={s.catL2Row}>└ {c.name}</div>
                        ))}
                      </>
                    )
                  })()}
                </div>
              )}
              {categories.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0 8px' }}>暂无分类</div>
              )}

              {/* 添加分类 */}
              <div style={s.catAddRow}>
                <input
                  style={{ ...s.field, flex: 1, height: 40, marginBottom: 0 }}
                  placeholder={t('products.catAddPlaceholder')}
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory() }}
                />
                <select
                  style={s.catParentSelect}
                  value={newCatParentId}
                  onChange={(e) => setNewCatParentId(e.target.value)}
                >
                  <option value="">{t('products.catParentNone')}</option>
                  {categories.filter((c) => !c.parentId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <button
                style={{ ...s.importBtn, opacity: (!newCatName.trim() || catSaving) ? 0.5 : 1, height: 40, marginTop: 6 }}
                disabled={!newCatName.trim() || catSaving}
                onClick={handleAddCategory}
              >
                {catSaving ? '…' : t('products.catAddBtn')}
              </button>
              {catError && <div style={s.importErrorMsg}>{catError}</div>}
            </div>
          )}
        </div>

        {/* ── 商品列表（删除管理） ── */}
        <div style={s.importSection}>
          <button style={s.importToggle} onClick={toggleList}>
            <span style={s.importToggleText}>{t('products.productList')}</span>
            <span style={s.importToggleArrow}>{listOpen ? '▲' : '▼'}</span>
          </button>

          {listOpen && (
            <div style={s.importBody}>
              {listLoading && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0' }}>{t('common.loading')}</div>
              )}

              {!listLoading && productList.length > 0 && (
                <>
                  {/* Header row: select-all + batch delete */}
                  <div style={ls.headerRow}>
                    <label style={ls.checkLabel}>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === productList.length && productList.length > 0}
                        onChange={toggleSelectAll}
                        style={ls.checkbox}
                      />
                      <span style={ls.selectAllText}>{t('products.selectAll')}</span>
                    </label>
                    {selectedIds.size > 0 && (
                      <button
                        style={ls.batchDeleteBtn}
                        onClick={() => setDeleteConfirm({ type: 'batch', ids: Array.from(selectedIds) })}
                      >
                        {t('products.batchDelete')}（{selectedIds.size}）
                      </button>
                    )}
                  </div>

                  {/* Product rows */}
                  {productList.map((p) => (
                    <div key={p.id} style={ls.row}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        style={ls.checkbox}
                      />
                      <div style={ls.rowInfo}>
                        <span style={{ ...ls.rowName, color: p.status === 'DISABLED' ? 'var(--muted)' : 'var(--text)' }}>
                          {p.name}{p.spec ? ` · ${p.spec}` : ''}
                        </span>
                        <span style={ls.rowMeta}>
                          {p.barcode}
                          {p.status === 'DISABLED' && <span style={ls.disabledTag}> 停用</span>}
                        </span>
                      </div>
                      <button
                        style={ls.deleteRowBtn}
                        onClick={() => setDeleteConfirm({ type: 'single', id: p.id, name: p.name })}
                      >
                        {t('products.deleteBtn')}
                      </button>
                    </div>
                  ))}
                </>
              )}

              {!listLoading && productList.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 0 8px' }}>暂无商品</div>
              )}

              {deleteMsg && <div style={s.errorMsg}>{deleteMsg}</div>}
            </div>
          )}
        </div>

        {/* ── 删除确认弹框 ── */}
        {deleteConfirm && (
          <div style={dlg.overlay}>
            <div style={dlg.box}>
              <div style={dlg.title}>{t('products.deleteConfirmTitle')}</div>
              {deleteConfirm.type === 'single' && (
                <div style={dlg.body}>{deleteConfirm.name}</div>
              )}
              {deleteConfirm.type === 'batch' && (
                <div style={dlg.body}>{deleteConfirm.ids.length} 件商品</div>
              )}
              <div style={dlg.hint}>{t('products.deleteConfirmHint')}</div>
              <div style={dlg.actions}>
                <button style={dlg.cancelBtn} onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                  {t('products.deleteBack')}
                </button>
                <button style={dlg.confirmBtn} onClick={executeDelete} disabled={deleting}>
                  {deleting ? t('products.deleting') : t('products.deleteConfirmBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 成功反馈 ── */}
        {mode === 'saved' && product && (
          <div style={s.savedCard}>
            <div style={s.savedCheck}>✓</div>
            <div style={s.savedTitle}>{t('products.saved')}</div>
            <div style={s.savedName}>{product.name}{product.spec ? ` · ${product.spec}` : ''}</div>
            <div style={s.savedPrice}>${product.sellPrice.toFixed(2)}</div>
            <div style={{
              ...s.savedBadge,
              background: product.status === 'ACTIVE' ? 'rgba(255,255,255,0.2)' : 'rgba(255,100,100,0.3)',
            }}>
              {product.status === 'ACTIVE' ? t('products.statusActiveBadge') : t('products.statusDisabledBadge')}
            </div>
            <button style={s.nextBtn} onClick={reset}>{t('products.continueBtn')}</button>
          </div>
        )}

        {mode !== 'saved' && (
          <>
            {/* 扫码 + 手动输入 */}
            <div style={s.card}>
              <button
                type="button"
                style={s.scanBtn}
                onClick={openScanner}
                disabled={mode === 'loading'}
              >
                <span style={s.scanIcon}>⊡</span>
                <span>{t('products.scanBtn')}</span>
              </button>

              {cameraFailCount >= 5 && (
                <div style={s.scanHintMsg}>{t('sale.scanFailHint')}</div>
              )}

              <div style={s.orRow}>
                <div style={s.orLine} /><span style={s.orText}>{t('products.orInput')}</span><div style={s.orLine} />
              </div>

              <div style={s.inputRow}>
                <input
                  style={s.input}
                  type="text"
                  placeholder={t('products.barcodePlaceholder')}
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
                  {mode === 'loading' ? '…' : t('products.queryBtn')}
                </button>
              </div>
            </div>

            {error && <div style={s.errorMsg}>{error}</div>}

            {/* ── 商品已存在：编辑表单 ── */}
            {mode === 'found' && product && (
              <div style={s.card}>
                <div style={s.sectionLabel}>{t('products.editSection')}</div>

                <div style={s.barcodeRow}>
                  <span style={s.barcodeLabel}>{t('products.barcodeLabel')}</span>
                  <span style={s.barcodeValue}>{product.barcode}</span>
                </div>

                <Field label={t('products.fieldName')}>
                  <input
                    style={s.field}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={t('products.namePlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldSpec')}>
                  <input
                    style={s.field}
                    value={editSpec}
                    onChange={(e) => setEditSpec(e.target.value)}
                    placeholder={t('products.specPlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldPrice')}>
                  <input
                    style={s.field}
                    type="text"
                    inputMode="decimal"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                  />
                </Field>

                <Field label={t('products.fieldCategory')}>
                  <CategorySelect
                    categories={categories}
                    value={editCategoryId}
                    onChange={setEditCategoryId}
                    noneLabel={t('products.noCategory')}
                  />
                </Field>

                <Field label={t('products.fieldStatus')}>
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
                        {st === 'ACTIVE' ? t('products.statusActiveBtn') : t('products.statusDisabledBtn')}
                      </button>
                    ))}
                  </div>
                </Field>

                <button style={s.saveBtn} onClick={handleSave}>{t('products.saveBtn')}</button>
                <button
                  style={s.dangerBtn}
                  onClick={() => setDeleteConfirm({ type: 'single', id: product.id, name: product.name })}
                >
                  {t('products.deleteBtn')}
                </button>
              </div>
            )}

            {/* ── 商品不存在：快速新增 ── */}
            {mode === 'not-found' && (
              <div style={s.card}>
                <div style={s.noticeRow}>
                  <span style={s.noticeIcon}>＋</span>
                  <div>
                    <div style={s.noticeTitle}>{t('products.notFoundTitle')}</div>
                    <div style={s.noticeSub}>{t('products.barcodeLabel')}：{newBarcode}</div>
                  </div>
                </div>

                <Field label={t('products.barcodeLabel')}>
                  <input
                    style={s.field}
                    value={newBarcode}
                    onChange={(e) => setNewBarcode(e.target.value)}
                    placeholder={t('products.barcodePlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldName')}>
                  <input
                    style={s.field}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('products.namePlaceholder')}
                    autoFocus
                  />
                </Field>

                <Field label={t('products.fieldSpec')}>
                  <input
                    style={s.field}
                    value={newSpec}
                    onChange={(e) => setNewSpec(e.target.value)}
                    placeholder={t('products.specPlaceholder')}
                  />
                </Field>

                <Field label={t('products.fieldPrice')}>
                  <input
                    style={s.field}
                    type="text"
                    inputMode="decimal"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                  />
                </Field>

                <Field label={t('products.fieldCategory')}>
                  <CategorySelect
                    categories={categories}
                    value={newCategoryId}
                    onChange={setNewCategoryId}
                    noneLabel={t('products.noCategory')}
                  />
                </Field>

                <button style={s.saveBtn} onClick={handleCreate}>{t('products.createBtn')}</button>
              </div>
            )}

            {/* 空状态 */}
            {mode === 'idle' && (
              <div style={s.empty}>
                <div style={s.emptyIcon}>⊡</div>
                <div style={s.emptyTitle}>{t('products.emptyTitle')}</div>
                <div style={s.emptySub}>{t('products.emptySub')}</div>
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

// ─── CategorySelect ───────────────────────────────────────────────────────────
// 扁平 select，L1 直接显示，L2 用"└ "前缀缩进，视觉清晰。

function CategorySelect({
  categories, value, onChange, noneLabel,
}: {
  categories: Category[]
  value: string
  onChange: (v: string) => void
  noneLabel: string
}) {
  const l1 = categories.filter((c) => !c.parentId)
  const l2ByParent = new Map<string, Category[]>()
  categories.filter((c) => c.parentId).forEach((c) => {
    const arr = l2ByParent.get(c.parentId!) ?? []
    arr.push(c)
    l2ByParent.set(c.parentId!, arr)
  })
  // Orphan L2 (parent removed) shown at bottom
  const knownL1Ids = new Set(l1.map((c) => c.id))
  const orphans = categories.filter((c) => c.parentId && !knownL1Ids.has(c.parentId))

  return (
    <select
      style={cs.catSelectField}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{noneLabel}</option>
      {l1.map((cat) => (
        <optgroup key={cat.id} label={cat.name}>
          <option value={cat.id}>{cat.name}（大类）</option>
          {(l2ByParent.get(cat.id) ?? []).map((sub) => (
            <option key={sub.id} value={sub.id}>└ {sub.name}</option>
          ))}
        </optgroup>
      ))}
      {orphans.map((c) => (
        <option key={c.id} value={c.id}>└ {c.name}</option>
      ))}
    </select>
  )
}

const cs: Record<string, React.CSSProperties> = {
  catSelectField: {
    display: 'block', width: '100%', height: 44,
    border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '0 12px', fontSize: 15, outline: 'none',
    background: '#f7f8fa', boxSizing: 'border-box',
    color: 'var(--text)',
  },
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
  dangerBtn: {
    display: 'block',
    width: '100%',
    height: 40,
    marginTop: 8,
    background: 'none',
    color: 'var(--red)',
    border: '1.5px solid var(--red)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 14,
    fontWeight: 600,
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
  scanHintMsg: {
    fontSize: 12, color: '#fa8c16', background: '#fff7e6',
    border: '1px solid #ffd591', borderRadius: 6, padding: '6px 10px', marginBottom: 8,
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
  // ── Category management ──
  catList: {
    borderBottom: '1px solid var(--border)',
    paddingBottom: 10,
    marginBottom: 10,
  },
  catL1Row: {
    fontSize: 13, fontWeight: 700, color: 'var(--text)',
    padding: '4px 0',
  },
  catL2Row: {
    fontSize: 13, color: 'var(--muted)',
    padding: '2px 0 2px 12px',
  },
  catAddRow: {
    display: 'flex', gap: 8, alignItems: 'center',
  },
  catParentSelect: {
    flexShrink: 0,
    height: 40,
    border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 8px',
    fontSize: 13,
    background: '#f7f8fa',
    color: 'var(--text)',
    maxWidth: 130,
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

// ─── Product list row styles ──────────────────────────────────────────────────

const ls: Record<string, React.CSSProperties> = {
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
    marginBottom: 4,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  checkbox: {
    width: 16,
    height: 16,
    flexShrink: 0,
    cursor: 'pointer',
  },
  selectAllText: {
    fontSize: 13,
    color: 'var(--muted)',
    fontWeight: 600,
  },
  batchDeleteBtn: {
    height: 32,
    padding: '0 12px',
    background: 'none',
    border: '1.5px solid var(--red)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--red)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  rowName: {
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  rowMeta: {
    fontSize: 12,
    color: 'var(--muted)',
    fontFamily: 'monospace',
  },
  disabledTag: {
    fontSize: 11,
    color: 'var(--red)',
    fontFamily: 'inherit',
  },
  deleteRowBtn: {
    flexShrink: 0,
    height: 30,
    padding: '0 10px',
    background: 'none',
    border: '1px solid var(--red)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--red)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

// ─── Delete confirm dialog styles ────────────────────────────────────────────

const dlg: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 800,
    padding: '0 24px',
  },
  box: {
    background: '#fff',
    borderRadius: 'var(--radius)',
    padding: '24px 20px 20px',
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: 'var(--text)',
  },
  body: {
    fontSize: 15,
    color: 'var(--text)',
    fontWeight: 600,
    wordBreak: 'break-all' as const,
  },
  hint: {
    fontSize: 13,
    color: 'var(--muted)',
    marginBottom: 4,
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    background: '#f5f5f5',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text)',
    cursor: 'pointer',
  },
  confirmBtn: {
    flex: 1,
    height: 44,
    background: 'var(--red)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontSize: 15,
    fontWeight: 700,
    color: '#fff',
    cursor: 'pointer',
  },
}
