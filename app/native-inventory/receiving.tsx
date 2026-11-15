'use client'

import { useRef, useState } from 'react'
import { message, money, path, request, RequestError, useInventory, type Access, type Draft, type DraftLine, type Item, type Receipt, type Supplier, type Unit } from './client'
import { Empty, Panel, ReceiptSummary } from './ui'

export type PendingReceipt = { id: string; revision: number }
type Phase = 'review' | 'submitting' | 'failed' | 'unknown' | 'success'
type ImportMatch = { row: number; barcode: string; error?: string; itemId?: string; unitId?: string; quantity?: string; unitPrice?: string }

export function SupplierForm({ supplier, close, saved }: { supplier?: Supplier; close: () => void; saved: (supplier: Supplier) => void }) {
  const [id] = useState(() => supplier?.id ?? crypto.randomUUID())
  const [name, setName] = useState(supplier?.name ?? '')
  const [contact, setContact] = useState(supplier?.contact ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Panel title={supplier ? '编辑供应商' : '新增供应商'} onClose={busy ? undefined : close}>
    <form style={{ marginTop: 14 }} onSubmit={async (e) => {
      e.preventDefault()
      if (busy) return
      setBusy(true)
      setError('')
      try { saved(await request<Supplier>('suppliers', { id, name, contact })) } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <label className="field">名称（必填）<input className="inp" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="field">联系人 / 电话 / Telegram<input className="inp" value={contact} maxLength={250} onChange={(e) => setContact(e.target.value)} /></label>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="mfoot"><button className="btn" type="button" disabled={busy} onClick={close}>取消</button><button className="btn primary" disabled={busy}>保存</button></div>
    </form>
  </Panel>
}

export function newDraft(): Draft {
  return { id: crypto.randomUUID(), revision: 0, supplierId: '', lines: [] }
}

export function openDraft(receipt: Receipt): Draft {
  return { id: receipt.id, revision: receipt.revision, supplierId: receipt.supplierId, lines: receipt.lines }
}

function makeLine(item: Item, unit: Unit, quantity = '1', unitPrice = '', imported = false): DraftLine {
  return { itemId: item.id, unitId: unit.id, itemName: item.name, unitName: unit.name, units: item.units, oldCost: item.averageUnitCost, sellPrice: item.sellPrice, quantity, unitPrice, imported }
}

const countFormat = /^\d{1,9}(\.\d{1,6})?$/
function canSave(draft: Draft) {
  return !!draft.supplierId && draft.lines.length > 0 && draft.lines.length <= 100
    && draft.lines.every((line) => countFormat.test(line.quantity) && Number(line.quantity) > 0 && countFormat.test(line.unitPrice))
}
function lineTotal(line: DraftLine) {
  return Math.round((Number(line.quantity) * Number(line.unitPrice) + Number.EPSILON) * 100) / 100
}

export function Receiving({ draft, setDraft, access, refresh, reload, close, openStock, openRecords, pending, setPending, saveLocal, scan }: {
  draft: Draft; setDraft: (d: Draft | ((d: Draft) => Draft)) => void; access: Access; refresh: number; reload: () => void
  close: () => void; openStock: (receipt: Receipt) => void; openRecords: () => void
  pending: PendingReceipt | null; setPending: (p: PendingReceipt | null) => void; saveLocal: (id: string, draft: Draft | null) => void; scan: (done: (barcode: string) => void) => void
}) {
  const [query, setQuery] = useState('')
  const [supplierForm, setSupplierForm] = useState(false)
  const [supplierError, setSupplierError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [margin, setMargin] = useState('30')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [phase, setPhase] = useState<Phase | null>(pending?.id === draft.id ? 'unknown' : null)
  const [reviewed, setReviewed] = useState<Receipt>()
  const [saveUncertain, setSaveUncertain] = useState(false)
  const supplierResult = useInventory<Supplier[]>('suppliers', refresh)
  const itemResult = useInventory<Item[]>(query.trim() ? path('items', { q: query.trim() }) : null, refresh)
  const owner = access.role === 'OWNER'
  const currency = access.currencyCode
  const editable = !busy && phase !== 'unknown' && !saveUncertain

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try { await action() } catch (err) { setError(message(err)) } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function add(item: Item, unit: Unit) {
    setDraft((current) => {
      const found = current.lines.findIndex((line) => line.itemId === item.id && line.unitId === unit.id && !line.imported)
      const lines = [...current.lines]
      if (found >= 0) lines[found] = { ...lines[found], quantity: String(Number((Number(lines[found].quantity || 0) + 1).toFixed(6))) }
      else if (lines.length < 100) lines.push(makeLine(item, unit))
      return { ...current, lines }
    })
    setQuery('')
  }

  async function addBarcode(value: string) {
    if (!value.trim()) return
    await run(async () => {
      const matches = (await request<Item[]>(path('items', { q: value.trim(), mode: 'barcode' })))
        .flatMap((item) => item.units.filter((unit) => unit.barcode === value.trim()).map((unit) => ({ item, unit })))
      if (matches.length === 1) add(matches[0].item, matches[0].unit)
      else {
        setQuery(value)
        if (matches.length > 1) setError('条码对应多个商品或单位，请从搜索结果中选择。')
      }
    })
  }

  function patch(index: number, data: Partial<DraftLine>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...data } : line) }))
  }

  async function save(action: 'review' | 'close' | 'stay') {
    if (!canSave(draft)) {
      if (action === 'review') {
        setError('请选择供应商，并核对每行数量和进货价。')
      } else {
        if (draft.supplierId || draft.lines.length) saveLocal(draft.id, draft)
        if (action === 'close') close()
        else setError('未填完的内容已暂存于当前标签页。填完后可保存为门店草稿。')
      }
      return
    }
    await run(async () => {
      try {
        const stored = await request<Receipt>('receipts', draft)
        setSaveUncertain(false)
        saveLocal(draft.id, null)
        setDraft({ ...draft, revision: stored.revision })
        reload()
        if (action === 'review') { setReviewed(stored); setPhase('review') }
        if (action === 'close') close()
      } catch (err) {
        if (err instanceof RequestError && err.unknown) setSaveUncertain(true)
        throw err
      }
    })
  }

  async function confirm() {
    if (!reviewed) return
    await run(async () => {
      const original = { id: reviewed.id, revision: reviewed.revision }
      setPending(original)
      setPhase('submitting')
      try {
        const receipt = await request<Receipt>('receipt-confirmation', original)
        setReviewed(receipt)
        setPending(null)
        reload()
        setPhase('success')
      } catch (err) {
        if (err instanceof RequestError && err.unknown) setPhase('unknown')
        else { setPending(null); setPhase('failed') }
        setError(message(err))
      }
    })
  }

  async function check() {
    await run(async () => {
      let receipt: Receipt
      try { receipt = await request<Receipt>(path('receipt-result', { id: draft.id })) }
      catch (err) {
        if (err instanceof RequestError && err.code === 'RECEIPT_NOT_FOUND') {
          setPending(null)
          openRecords()
          return
        }
        throw err
      }
      setReviewed(receipt)
      if (receipt.postedAt) {
        setPending(null)
        reload()
        setPhase('success')
      } else {
        if (receipt.revision !== pending?.revision) {
          setDraft(openDraft(receipt))
          setPending(null)
          setPhase(null)
          setError('原单版本已更新，请核对当前草稿。')
          return
        }
        setPending(null)
        setPhase('review')
        setError('原单仍是草稿。可以继续确认同一请求号。')
      }
    })
  }

  async function importFile(file: File) {
    await run(async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件太大')
      const xlsx = await import('xlsx')
      const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array', raw: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })
        .map((row) => row.map((field) => String(field).trim())).filter((row) => row.some(Boolean))
      const data = rows[0] && /^(条码|barcode)$/i.test(rows[0][0]) ? rows.slice(1) : rows
      const matches = await request<ImportMatch[]>('import-preview', { rows: data.map(([barcode, quantity, unitPrice]) => ({ barcode, quantity, unitPrice })) })
      const valid = matches.filter((row) => row.itemId && row.unitId && row.quantity && row.unitPrice)
      const barcodes = [...new Set(valid.map((row) => row.barcode))]
      const resolved = await Promise.all(barcodes.map((barcode) => request<Item[]>(path('items', { q: barcode, mode: 'barcode' }))))
      const items = new Map(resolved.flat().map((item) => [item.id, item]))
      const lines = valid.flatMap((row) => {
        const item = items.get(row.itemId!)
        const unit = item?.units.find((u) => u.id === row.unitId)
        return item && unit ? [makeLine(item, unit, row.quantity, row.unitPrice, true)] : []
      })
      if (draft.lines.length + lines.length > 100) throw new RequestError('INVALID_RECEIPT_LINES')
      setDraft((current) => ({ ...current, lines: [...current.lines, ...lines] }))
      setUnmatched(matches.filter((row) => row.error || !items.has(row.itemId ?? '')).map((row) => `第 ${row.row} 行 ${row.barcode}`))
      setImportOpen(false)
    })
  }

  return <>
    <section className="page">
      <div className="phead"><button className="link" disabled={!editable} onClick={() => {
        void save('close')
      }}>‹ 返回</button><h1>{draft.revision ? '编辑入库单' : '新建入库单'}</h1><span className="grow" /><button className="btn" disabled={!editable} onClick={() => setImportOpen(true)}>批量导入</button></div>
      <div className="scroll">
        <div className="card pad"><h2>1 · 供应商</h2>
          <div className="chips">
            {supplierResult?.data?.map((supplier) => <button className={`chip ${draft.supplierId === supplier.id ? 'on' : ''}`} aria-pressed={draft.supplierId === supplier.id} key={supplier.id} disabled={!editable} onClick={() => { setSupplierError(''); setDraft({ ...draft, supplierId: supplier.id }) }}>{supplier.name}</button>)}
            <button className="chip dashed" disabled={!editable} onClick={() => setSupplierForm(true)}>＋ 新增供应商</button>
          </div>
          {(supplierError || !!supplierResult?.error) && <p className="err">{supplierError || message(supplierResult?.error)} <button className="link" onClick={reload}>重试</button></p>}
        </div>
        <div className="card pad"><h2>2 · 商品</h2>
          <form className="searchbar" onSubmit={(e) => { e.preventDefault(); void addBarcode(query) }}>
            <input className="inp grow" aria-label="添加商品" placeholder="扫码枪直接扫，或输入名称 / 条码 / SKU 后回车" value={query} maxLength={120} disabled={!editable} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className="btn" disabled={!editable} onClick={() => scan((barcode) => { void addBarcode(barcode) })}>扫码</button>
          </form>
          {itemResult?.data?.length ? <div className="results">{itemResult.data.map((item) => <button className="res" key={item.id} disabled={!editable}
            onClick={() => add(item, item.units.find((unit) => unit.barcode === query.trim()) ?? item.units[0])}>
            <span><b>{item.name}</b> <small>{item.units[0]?.barcode}</small></span><small>{item.tracked ? item.onHand : '—'} {item.units[0]?.name}</small>
          </button>)}</div> : itemResult?.data && query.trim() && <p className="hint">没有匹配的商品。请先在库存中建档。</p>}
          {!!itemResult?.error && <p className="err" role="alert">{message(itemResult.error)}</p>}
          {!!unmatched.length && <div className="banner amber"><b>未加入本单</b> {unmatched.join('、')} <button className="link" onClick={() => setUnmatched([])}>知道了</button></div>}
          {owner && !!draft.lines.length && <div className="pricing"><span className="flabel">建议零售价</span><label>加价率 <input className="inp sm" aria-label="加价率百分比" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} /> %</label><small>建议价供核对参考，入库时同步改价未实现。</small></div>}
          {!draft.lines.length && <Empty title="还没有商品">扫码或搜索添加，同一商品重复扫码会自动累加数量。</Empty>}
          {draft.lines.map((line, index) => {
            const cost = Number(line.unitPrice)
            const suggested = Math.round(cost * (1 + Number(margin) / 100) * 100) / 100
            return <div className="line" key={`${line.itemId}:${index}`}>
              <div className="line-grid">
                <div className="l-main"><b>{line.itemName}</b><small>{line.unitName}</small></div>
                <div className="l-cell"><small>{owner ? '原进货成本' : '单位'}</small><span>{owner ? money(line.oldCost, currency) : line.unitName}</span></div>
                <div className="l-qty">
                  <button className="step" disabled={!editable} aria-label="减少数量" onClick={() => patch(index, { quantity: String(Math.max(0, Number(line.quantity) - 1)) })}>−</button>
                  <input className="inp" aria-label="数量" inputMode="decimal" disabled={!editable} value={line.quantity} onChange={(e) => patch(index, { quantity: e.target.value })} />
                  <button className="step" disabled={!editable} aria-label="增加数量" onClick={() => patch(index, { quantity: String(Number(line.quantity) + 1) })}>+</button>
                  {line.units && line.units.length > 1 ? <select className="inp" aria-label="单位" disabled={!editable} value={line.unitId} onChange={(e) => {
                    const unit = line.units?.find((u) => u.id === e.target.value)
                    if (unit) patch(index, { unitId: unit.id, unitName: unit.name, unitPrice: '' })
                  }}>{line.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select> : <small>{line.unitName}</small>}
                </div>
                <label className="l-cell"><small>本次进货价 {currency}</small><input className="inp" aria-label="本次进货单价" inputMode="decimal" disabled={!editable} value={line.unitPrice} onChange={(e) => patch(index, { unitPrice: e.target.value })} /></label>
                <div className="l-cell"><small>小计</small><b>{money(line.unitPrice === '' ? null : lineTotal(line), currency)}</b></div>
                <button className="l-del" aria-label="删除此行" disabled={!editable} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}>×</button>
              </div>
              {line.imported && <p className="hint"><span className="tag amber">导入 · 请核对数量与进货价</span></p>}
              {owner && line.sellPrice != null && suggested > 0 && <p className="hint">售价 {money(line.sellPrice, currency)} → 建议 {money(suggested, currency)}（销售毛利率 {((suggested - cost) / suggested * 100).toFixed(1)}%）</p>}
            </div>
          })}
        </div>
        {error && !phase && !importOpen && <div className="banner amber" role="alert">{error}</div>}
      </div>
      <div className="foot"><div className="foot-sum"><small>{draft.lines.length} 行 · 合计</small><b>{money(draft.lines.reduce((total, line) => total + (lineTotal(line) || 0), 0), currency)}</b></div>
        <span className="grow" />
        <button className="btn" disabled={busy || phase === 'unknown'} onClick={() => save('stay')}>{saveUncertain ? '重试保存原草稿' : '保存草稿'}</button>
        <button className="btn primary" disabled={!editable} onClick={() => {
          if (!draft.supplierId) setSupplierError('请先选择供应商')
          void save('review')
        }}>核对并入库</button>
      </div>
    </section>
    {supplierForm && <SupplierForm close={() => setSupplierForm(false)} saved={(supplier) => { setDraft({ ...draft, supplierId: supplier.id }); setSupplierForm(false); setSupplierError(''); reload() }} />}
    {importOpen && <Panel title="批量导入" onClose={busy ? undefined : () => setImportOpen(false)} footer={<button className="btn" disabled={busy} onClick={() => setImportOpen(false)}>取消</button>}>
      <p className="hint">按条码、数量、进货价三列导入，结果加入当前入库单，确认后才增加库存。</p>
      <div className="impgrid" style={{ marginTop: 12 }}>
        {['Excel', 'CSV'].map((format) => <label className="impbtn" key={format}>{format}<input type="file" accept={format === 'Excel' ? '.xlsx,.xls' : '.csv'} disabled={busy} aria-label={`导入 ${format}`} onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importFile(file)
          e.target.value = ''
        }} /></label>)}
        <button className="impbtn" disabled>PDF<small>识别未实现</small></button>
        <button className="impbtn" disabled>拍照<small>识别未实现</small></button>
      </div>
      {busy && <p className="hint" role="status">正在读取单据…</p>}{error && <p className="err" role="alert">{error}</p>}
    </Panel>}
    {phase && <Panel title={phase === 'review' ? '核对入库单' : '入库结果'} onClose={phase === 'review' || phase === 'failed' ? () => setPhase(null) : undefined}>
      {phase === 'review' && reviewed && <>
        <div style={{ marginTop: 12 }}><ReceiptSummary receipt={reviewed} /></div>
        <small>请求号 {reviewed.id} · 同一请求号只会入库一次</small>{error && <p className="hint" role="status">{error}</p>}
        <div className="mfoot"><button className="btn" onClick={() => setPhase(null)}>返回修改</button><button className="btn primary" onClick={confirm}>确认入库</button></div>
      </>}
      {phase === 'submitting' && <div className="result" role="status"><span className="spin" /><h2>正在入库，请稍候</h2>请不要关闭页面。<div className="mfoot"><button className="btn busy" disabled>提交中…</button></div></div>}
      {phase === 'success' && reviewed && <><div className="result"><span className="mark green">✓</span><h2>已入库</h2><b>{reviewed.lines.length} 行 · {money(reviewed.total, currency)}</b></div>
        <div className="mfoot"><button className="btn" onClick={() => { setDraft(newDraft()); setPhase(null) }}>再建一张</button><button className="btn" onClick={openRecords}>查看入库记录</button><button className="btn primary" onClick={() => openStock(reviewed)}>查看库存变化</button></div></>}
      {phase === 'failed' && <><div className="result"><span className="mark red">!</span><h2>未入库</h2><p className="err" role="alert">{error}</p></div>
        <div className="mfoot"><button className="btn" onClick={() => setPhase(null)}>返回修改</button><button className="btn" onClick={openRecords}>存为草稿</button><button className="btn primary" onClick={confirm}>重试（同一请求号）</button></div></>}
      {phase === 'unknown' && <><div className="result"><span className="mark amber">?</span><h2>结果未确认</h2>请用原请求号查询，避免重复录入。<p className="hint receipt-number">{draft.id}</p>{error && <p className="err" role="alert">{error}</p>}</div>
        <div className="mfoot"><button className="btn" disabled={busy} onClick={openRecords}>稍后在入库记录中查询</button><button className="btn primary" disabled={busy} onClick={check}>查询结果</button></div></>}
    </Panel>}
  </>
}
