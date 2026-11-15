'use client'

import { useState, type ReactNode } from 'react'
import { dateLabel, message, money, path, request, RequestError, useInventory, type Access, type Item, type Movement } from './client'
import { Choices, Empty, Panel } from './ui'

export function ReadState({ data, error, retry, label, children }: { data: unknown; error: unknown; retry: () => void; label: string; children: ReactNode }) {
  if (error) return <div className="card"><Empty title={label}><div>{message(error)}</div><button className="btn primary" onClick={retry}>重试</button></Empty></div>
  if (data === undefined) return <div className="card"><Empty title="正在读取…" /></div>
  return children
}

const stockFilters = ['全部', '库存不足', '缺货', '待盘点', '未建账']
const kindFilters = ['全部', '可售商品', '原材料']
const adjustments = ['盘点差异', '损耗报废', '退回补录', '其他']

export type CatalogProduct = { id: string; name: string; barcode: string; sku?: string | null; mainUnitName?: string | null }
type StockOverview = { items: Item[]; catalog: CatalogProduct[]; registeredCount: number | null }

function stockStatus(item: Item) {
  if (item.onHand === null) return { label: '未建账', color: 'gray' }
  if (Number(item.onHand) < 0) return { label: '待盘点', color: 'amber' }
  if (Number(item.onHand) === 0) return { label: '缺货', color: 'red' }
  return item.lowStock ? { label: '库存不足', color: 'amber' } : { label: '正常', color: 'green' }
}

export function StockList({ access, refresh, reload, open, scan, query, setQuery, justReceived, setup }: {
  access: Access; refresh: number; reload: () => void; open: (item: Item) => void; scan: () => void
  query: string; setQuery: (q: string) => void; justReceived: Record<string, number>; setup: (product?: CatalogProduct) => void
}) {
  const [status, setStatus] = useState('全部')
  const [kind, setKind] = useState('全部')
  const [pages, setPages] = useState<{ key: string; items: Item[]; more: boolean }>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [pageError, setPageError] = useState('')
  const owner = access.role === 'OWNER'
  const showCatalog = owner && kind !== '原材料' && (status === '全部' || status === '未建账')
  const resource = path('stock-overview', { q: query.trim(), catalog: String(showCatalog) })
  const result = useInventory<StockOverview>(resource, refresh)
  const key = `${resource}#${refresh}`
  const appended = pages?.key === key ? pages : undefined
  const data = [...(result?.data?.items ?? []), ...(appended?.items ?? [])]
  const more = appended?.more ?? result?.data?.items.length === 100
  const visible = data.filter((item) => (status === '全部' || stockStatus(item).label === status)
    && (kind === '全部' || (kind === '原材料') === (item.kind === 'MATERIAL')))
  const resetFilters = () => { setQuery(''); setStatus('全部'); setKind('全部') }

  async function nextPage() {
    if (!data.length || loadingMore) return
    setLoadingMore(true)
    setPageError('')
    try {
      const next = await request<Item[]>(path('items', { q: query.trim(), after: data[data.length - 1].id }))
      setPages({ key, items: [...(appended?.items ?? []), ...next], more: next.length === 100 })
    } catch (error) { setPageError(message(error)) } finally { setLoadingMore(false) }
  }

  return <div className="scroll">
    <div className="searchbar"><input className="inp grow" aria-label="搜索商品" placeholder="搜索商品名称 / 条码" value={query} maxLength={120} onChange={(e) => setQuery(e.target.value)} />
      <button className="btn" onClick={scan}>扫码</button></div>
    <div className="frow"><Choices values={stockFilters} value={status} onChange={setStatus} /></div>
    <div className="frow"><span className="flabel">类型</span><Choices values={kindFilters} value={kind} onChange={setKind} />{owner && <button className="link" onClick={() => setup()}>库存建档</button>}</div>
    <ReadState data={result?.data} error={result?.error} retry={reload} label="库存数据暂时无法读取">
      <div className="card">
        <div className="head g-stock"><span>商品</span><span className="num">当前库存</span><span className="num">{owner && '平均进货成本'}</span><span>状态</span></div>
        {visible.map((item) => {
          const badge = stockStatus(item)
          return <button className="row g-stock" key={item.id} onClick={() => open(item)}>
            <span className="c-main"><b>{item.name}</b><small>{item.units[0]?.barcode ?? ''}</small></span>
            <span className="num"><span className="big">{item.onHand ?? '—'}</span> <small>{item.units[0]?.name}</small></span>
            <span className="stock-meta">
              {owner ? <span className="num"><small className="mo">成本 </small>{money(item.averageUnitCost, access.currencyCode)}</span> : <span className="dx" />}
              <span className="status"><span className={`tag ${badge.color}`}>{badge.label}</span>{item.kind === 'MATERIAL' && <span className="tag gray">原材料</span>}
              {justReceived[item.id] > 0 && <span className="tag blue">刚入库 +{justReceived[item.id]}</span>}</span>
            </span>
          </button>
        })}
        {showCatalog && result?.data ? <CatalogRows key={key} first={result.data.catalog} query={query.trim()} registeredCount={result.data.registeredCount} reload={reload}
          showEmpty={!visible.length && !more} registeredProductIds={new Set(data.map((item) => item.productId))}
          resetFilters={resetFilters} selectProduct={setup} />
          : !visible.length && <Empty title="没有找到符合条件的商品"><button className="btn" onClick={resetFilters}>清除搜索与筛选</button></Empty>}
        {more && <div className="pad"><button className="btn" disabled={loadingMore} onClick={nextPage}>加载更多</button>{pageError && <p className="err">{pageError}</p>}</div>}
      </div>
      <p className="hint">「未建账」表示还没有库存流水。不同单位的数量不合计。</p>
    </ReadState>
  </div>
}

function CatalogRows({ first, query, registeredCount, reload, showEmpty, registeredProductIds, resetFilters, selectProduct }: {
  first: CatalogProduct[]; query: string; registeredCount: number | null; reload: () => void
  showEmpty: boolean; registeredProductIds: Set<string | null>; resetFilters: () => void; selectProduct: (product: CatalogProduct) => void
}) {
  const [pages, setPages] = useState<CatalogProduct[][]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const products = [first, ...pages].flat()
  const lastPage = pages.at(-1) ?? first

  async function loadMore() {
    const after = products.at(-1)?.id
    if (!after || loading) return
    setLoading(true)
    setError('')
    try {
      const next = await request<StockOverview>(path('stock-overview', { q: query, catalog: 'true', after }))
      if (next.registeredCount !== registeredCount) {
        reload()
        return
      }
      setPages((previous) => [...previous, next.catalog])
    } catch (err) { setError(message(err)) } finally { setLoading(false) }
  }

  return <>
    {products.filter((product) => !registeredProductIds.has(product.id)).map((product) => <button type="button" className="row g-stock" key={product.id} onClick={() => selectProduct(product)}>
      <span className="c-main"><b>{product.name}</b><small>{[product.barcode, product.sku].filter(Boolean).join(' · ')}</small></span>
      <span className="num big">—</span>
      <span className="stock-meta"><span className="num"><small className="mo">成本 </small>—</span>
        <span className="status"><span className="tag gray">未建账</span></span></span>
    </button>)}
    {!products.length && showEmpty && <Empty title="没有找到符合条件的商品">
      <button className="btn" onClick={resetFilters}>清除搜索与筛选</button></Empty>}
    {lastPage.length === 100 && <div className="pad">
      <button className="btn" disabled={loading} onClick={loadMore}>加载更多未建档商品</button>
      {error && <p className="err" role="alert">{error}</p>}
    </div>}
  </>
}

const movementNames: Record<string, string> = {
  RECEIPT: '入库', ADJUSTMENT: '调整', SALE: '销售', REFUND: '退款', SALE_CANCEL: '取消销售',
  REFUND_CANCEL: '取消退款', CUSTOMER_SALE: '销售', CUSTOMER_SALE_CANCEL: '取消销售',
}

export function StockDetail({ item, access, close, changed }: { item: Item; access: Access; close: () => void; changed: () => void }) {
  const owner = access.role === 'OWNER'
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState(false)
  const [target, setTarget] = useState(item.onHand ?? '')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<{ id: string; itemId: string; quantity: string; expectedOnHand: string; reason: string; unitCost: string | null }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const result = useInventory<Movement[]>(owner ? path('movements', { id: item.id }) : null, refresh)
  const last = result?.data?.find((move) => move.type === 'RECEIPT')
  const unit = item.units[0]?.name
  const currency = access.currencyCode

  async function apply() {
    if (busy || item.onHand === null) return
    const value = target.trim()
    const delta = Number((Number(value) - Number(item.onHand)).toFixed(6))
    if (!pending && (!/^\d{1,9}(\.\d{1,6})?$/.test(value) || !reason || !delta || (delta > 0 && item.averageUnitCost == null))) {
      setError('请输入有效的调整数量和原因。成本未录入时，请先完成入库再调增。')
      return
    }
    const body = pending ?? { id: crypto.randomUUID(), itemId: item.id, quantity: delta.toFixed(6), expectedOnHand: item.onHand, reason: [reason, note.trim()].filter(Boolean).join(' · '), unitCost: delta > 0 && item.averageUnitCost != null ? Number(item.averageUnitCost).toFixed(6) : null }
    setBusy(true)
    setError('')
    try { await request('adjustments', body); changed() } catch (err) {
      if (err instanceof RequestError && err.unknown) setPending(body)
      else setPending(undefined)
      setError(message(err))
    } finally { setBusy(false) }
  }

  return <Panel drawer title={item.name} sub={item.units[0]?.barcode ?? ''} onClose={busy ? undefined : close}
    footer={owner && item.onHand !== null && !editing ? <button className="btn" onClick={() => setEditing(true)}>库存调整</button> : null}>
    <div className="stats">
      <div className="stat"><small>当前库存</small><b>{item.onHand ?? '—'} {unit}</b></div>
      {owner && <><div className="stat"><small>平均进货成本</small><b>{money(item.averageUnitCost, currency)}</b></div>
        <div className="stat"><small>最近进货价</small><b>{money(last?.unitCost, currency)}</b></div></>}
      <div className="stat"><small>零售价</small><b>{money(item.sellPrice, currency)}</b></div>
    </div>
    {editing ? <div className="card pad"><h2>库存调整</h2>
      <label className="field">调整后的实际数量（{unit}）<input className="inp" inputMode="decimal" value={target} disabled={busy || !!pending} onChange={(e) => setTarget(e.target.value)} /></label>
      <div className="field">调整原因（必选）<fieldset disabled={busy || !!pending} style={{ border: 0, padding: 0, margin: 0 }}><Choices values={adjustments} value={reason} onChange={setReason} /></fieldset></div>
      <label className="field">备注（可选）<input className="inp" value={note} maxLength={200} disabled={busy || !!pending} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="hint">当前 {item.onHand} → {target || '—'} {unit}</p>{error && <p className="err" role="alert">{error}</p>}
      <div className="mfoot"><button className="btn" disabled={busy || !!pending} onClick={() => setEditing(false)}>取消</button><button className="btn primary" disabled={busy} onClick={apply}>{pending ? '重试原调整请求' : '确认调整'}</button></div>
    </div> : owner && <ReadState data={result?.data} error={result?.error} retry={() => setRefresh((v) => v + 1)} label="库存流水暂时无法读取">
      <div className="card">
        <div className="head" style={{ display: 'flex', justifyContent: 'space-between' }}><span>库存流水（新 → 旧）</span><span>变动 / 结存</span></div>
        {result?.data?.map((move) => <div className="mv" key={`${move.type}:${move.sourceId}`}>
          <span className={`tag ${move.type === 'RECEIPT' ? 'green' : move.type === 'ADJUSTMENT' ? 'amber' : 'blue'}`}>{movementNames[move.type] ?? move.type}</span>
          <span className="c-main"><b>{movementNames[move.type] ?? move.type}</b><small>{dateLabel(move.createdAt)}{move.reason ? ` · ${move.reason}` : ''}</small></span>
          <span className="qty">{Number(move.quantity) > 0 ? '+' : ''}{move.quantity}<br /><small>结存 {move.balance}</small></span>
        </div>)}
        {!result?.data?.length && <Empty title="尚未建账">完成第一次入库后开始计算库存和成本。</Empty>}
      </div>
    </ReadState>}
  </Panel>
}

export function CatalogSetup({ initialProduct, close, saved }: {
  initialProduct?: CatalogProduct; close: () => void; saved: () => void
}) {
  const [kind, setKind] = useState('可售商品')
  const [query, setQuery] = useState(initialProduct?.name ?? '')
  const [product, setProduct] = useState(initialProduct)
  const [materialName, setMaterialName] = useState('')
  const [baseUnitName, setUnitName] = useState(initialProduct?.mainUnitName ?? '')
  const [threshold, setThreshold] = useState('0')
  const [operationId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const catalog = useInventory<CatalogProduct[]>(kind === '可售商品' && !product ? path('catalog', { q: query.trim() }) : null)
  return <Panel title="库存建档" onClose={busy ? undefined : close}>
    <form style={{ marginTop: 12 }} onSubmit={async (e) => {
      e.preventDefault()
      if (busy) return
      if (kind === '可售商品' && !product) { setError('请选择已有商品。'); return }
      setBusy(true)
      setError('')
      try {
        await request('items', { id: operationId, productId: kind === '可售商品' ? product?.id : undefined, materialName: kind === '原材料' ? materialName : undefined, baseUnitName, lowStockAt: threshold })
        saved()
      } catch (err) { setError(message(err)) } finally { setBusy(false) }
    }}>
      <div className="frow"><Choices values={kindFilters.slice(1)} value={kind} onChange={(next) => { setKind(next); setUnitName(next === '可售商品' ? product?.mainUnitName ?? '' : '') }} /></div>
      {kind === '可售商品' ? <>
        <label className="field">商品名称 / 条码<input className="inp" maxLength={120} value={query} onChange={(e) => { setQuery(e.target.value); setProduct(undefined); setUnitName('') }} /></label>
        {!product && <div className="results" style={{ maxHeight: 240, overflow: 'auto' }}>{catalog?.data?.map((p) => <button className="res" type="button" key={p.id} onClick={() => setProduct(p)}><b>{p.name}</b><small>{p.barcode}</small></button>)}
          {catalog?.data?.length === 0 && <Empty title="没有需要建档的商品" />}{!!catalog?.error && <p className="err">{message(catalog.error)}</p>}</div>}
        {product && <p className="hint">{product.name} · {product.barcode}</p>}
      </> : <label className="field">原材料名称<input className="inp" required maxLength={120} value={materialName} onChange={(e) => setMaterialName(e.target.value)} /></label>}
      <label className="field">基本单位<input className="inp" required maxLength={40} value={baseUnitName} onChange={(e) => setUnitName(e.target.value)} /></label>
      <label className="field">低库存阈值<input className="inp" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="mfoot"><button className="btn" type="button" disabled={busy} onClick={close}>取消</button><button className="btn primary" disabled={busy}>建档</button></div>
    </form>
  </Panel>
}
