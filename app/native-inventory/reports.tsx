'use client'

import { useState } from 'react'
import { dateLabel, message, money, path, period, receiptNumber, request, RequestError, useInventory, type Access, type Draft, type Profit, type Purchases, type Receipt, type Supplier } from './client'
import { ReadState } from './stock'
import { Choices, Empty, Panel, ReceiptRow, ReceiptStatus, ReceiptSummary } from './ui'
import type { PendingReceipt } from './receiving'

const periods = ['今日', '本周', '本月']
export function Receipts({ access, refresh, reload, open, localDrafts, resumeLocal, pending, clearPending }: { access: Access; refresh: number; reload: () => void; open: (r: Receipt) => void; localDrafts: Draft[]; resumeLocal: (draft: Draft) => void; pending: PendingReceipt | null; clearPending: () => void }) {
  const [date, setDate] = useState('全部')
  const [status, setStatus] = useState('全部')
  const [supplier, setSupplier] = useState('全部')
  const [extra, setExtra] = useState<{ refresh: number; rows: Receipt[]; more: boolean }>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const result = useInventory<Receipt[]>('receipts', refresh)
  const suppliers = useInventory<Supplier[]>('suppliers', refresh)
  const appended = extra?.refresh === refresh ? extra : undefined
  const rows = [...(result?.data ?? []), ...(appended?.rows ?? [])]
  const range = date === '全部' ? null : period(date)
  const visible = rows.filter((r) => {
    const when = r.postedAt ?? r.createdAt
    return (!range || (when >= range.from && when < range.until))
      && (supplier === '全部' || supplier === r.supplierId)
      && (status === '全部' || (r.postedAt ? '已入库' : r.id === pending?.id ? '待确认' : '草稿') === status)
  })
  const more = appended?.more ?? result?.data?.length === 100
  async function loadMore() {
    const last = rows.at(-1)
    if (!last || loadingMore) return
    setLoadingMore(true)
    setError('')
    try {
      const next = await request<Receipt[]>(path('receipts', { before: last.createdAt, beforeId: last.id }))
      setExtra({ refresh, rows: [...(appended?.rows ?? []), ...next], more: next.length === 100 })
    } catch (err) { setError(message(err)) } finally { setLoadingMore(false) }
  }
  return <div className="scroll">
    {!!localDrafts.length && <div className="card pad">
      <h2>本地草稿</h2><div className="chips">{localDrafts.map((draft) => <button className="chip" key={draft.id} disabled={!!pending} onClick={() => resumeLocal(draft)}>
        {receiptNumber(draft.id)} · {draft.lines.length} 行
      </button>)}</div>
    </div>}
    {pending && <div className="banner amber"><b>有一张入库单待确认。</b> <button className="link" onClick={async () => {
      try { open(await request<Receipt>(path('receipt-result', { id: pending.id }))) }
      catch (err) {
        if (err instanceof RequestError && err.code === 'RECEIPT_NOT_FOUND') clearPending()
        setError(message(err))
      }
    }}>查询原单</button></div>}
    {error && <p className="err" role="alert">{error}</p>}
    <div className="frow"><span className="flabel">日期</span><Choices values={['全部', ...periods]} value={date} onChange={setDate} /></div>
    <div className="frow"><span className="flabel">状态</span><Choices values={['全部', '已入库', '草稿', '待确认']} value={status} onChange={setStatus} /></div>
    <div className="frow"><span className="flabel">供应商</span><select className="inp" aria-label="筛选供应商" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
      <option value="全部">全部</option>{suppliers?.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    <ReadState data={result?.data} error={result?.error} retry={reload} label="入库记录暂时无法读取">
      <div className="card"><div className="head g-rec"><span>入库单号</span><span>日期</span><span>供应商</span><span className="num">行数</span><span className="num">金额 {access.currencyCode}</span><span>状态</span></div>
        {visible.map((r) => <ReceiptRow key={r.id} receipt={r} pending={r.id === pending?.id} onOpen={() => open(r)} />)}
        {!visible.length && <Empty title="没有符合条件的入库单"><button className="btn" onClick={() => { setDate('全部'); setStatus('全部'); setSupplier('全部') }}>清除筛选</button></Empty>}
        {more && <div className="pad"><button className="btn" disabled={loadingMore} onClick={loadMore}>加载更多</button>{error && <p className="err">{error}</p>}</div>}
      </div>
    </ReadState>
  </div>
}

export function ReceiptDetail({ receipt: initial, pending, close, edit, changed, openStock, clearPending }: {
  receipt: Receipt; pending: PendingReceipt | null; close: () => void; edit: (r: Receipt) => void; changed: () => void; openStock: (r: Receipt) => void; clearPending: () => void
}) {
  const [receipt, setReceipt] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const waiting = pending?.id === receipt.id
  return <Panel drawer title={receiptNumber(receipt.id)} sub={<ReceiptStatus receipt={receipt} pending={waiting} />} onClose={close} footer={waiting ?
    <button className="btn primary" disabled={busy} onClick={async () => {
      setBusy(true)
      setError('')
      try {
        const checked = await request<Receipt>(path('receipt-result', { id: receipt.id }))
        setReceipt(checked)
        if (checked.postedAt) { clearPending(); changed() }
        else if (checked.revision === pending?.revision) {
          clearPending()
          setError('原单仍是草稿。可继续编辑并确认同一个请求号。')
        } else {
          clearPending()
          setError('原单版本已更新，请核对当前草稿。')
        }
      } catch (err) {
        if (err instanceof RequestError && err.code === 'RECEIPT_NOT_FOUND') { clearPending(); changed(); close() }
        else setError(message(err))
      } finally { setBusy(false) }
    }}>查询结果</button> : receipt.postedAt ?
    <button className="btn" onClick={() => openStock(receipt)}>查看库存变化</button> : <>
      <button className="btn danger" disabled={busy} onClick={async () => {
        if (!window.confirm('删除这张入库草稿？')) return
        setBusy(true)
        setError('')
        try { await request('receipt-delete', { id: receipt.id, revision: receipt.revision }); changed(); close() }
        catch (err) { setError(message(err)) } finally { setBusy(false) }
      }}>删除草稿</button>
      <button className="btn primary" disabled={busy} onClick={() => edit(receipt)}>继续编辑</button>
    </>}>
    {waiting && <div className="banner amber"><b>提交结果未确认。</b> 请使用同一个请求号查询。</div>}
    <ReceiptSummary receipt={receipt} metadata />
    {error && <p className="err" role="alert">{error}</p>}
  </Panel>
}

export function Suppliers({ access, refresh, reload, open, add }: { access: Access; refresh: number; reload: () => void; open: (s: Supplier) => void; add: () => void }) {
  const [query, setQuery] = useState('')
  const result = useInventory<Supplier[]>(path('suppliers', { q: query.trim() }), refresh)
  const owner = access.role === 'OWNER'
  return <section className="page">
    <div className="phead"><h1>供应商</h1><span className="grow" /><button className="btn primary" onClick={add}>＋ 新增供应商</button></div>
    <div className="scroll">
      <div className="searchbar"><input className="inp grow" value={query} maxLength={120} onChange={(e) => setQuery(e.target.value)} aria-label="搜索供应商" placeholder="搜索供应商名称 / 电话" /></div>
      <ReadState data={result?.data} error={result?.error} retry={reload} label="供应商暂时无法读取">
        <div className="card"><div className="head g-sup"><span>供应商</span><span className="num">{owner && '入库单'}</span><span className="num">{owner && '累计采购金额'}</span></div>
          {result?.data?.map((s) => <button className="row g-sup" key={s.id} onClick={() => open(s)}>
            <span className="c-main"><b>{s.name}</b><small>{s.contact}</small></span>
            {owner && <><span className="num dx">{s.postedCount}</span><span className="num"><b>{money(s.purchaseTotal, access.currencyCode)}</b></span></>}
          </button>)}
          {!result?.data?.length && <Empty title="没有找到供应商"><button className="btn" onClick={add}>＋ 新增供应商</button></Empty>}
        </div>
        {owner && <p className="hint">累计采购金额只统计已入库的单据。</p>}
      </ReadState>
    </div>
  </section>
}

export function SupplierDetail({ supplier, access, close, edit, open }: { supplier: Supplier; access: Access; close: () => void; edit: () => void; open: (r: Receipt) => void }) {
  const owner = access.role === 'OWNER'
  const [refresh, setRefresh] = useState(0)
  const result = useInventory<Purchases>(owner ? path('suppliers', { id: supplier.id }) : null, refresh)
  const purchases = result?.data
  return <Panel drawer title={supplier.name} sub={supplier.contact} onClose={close} footer={owner ? <button className="btn" onClick={edit}>编辑资料</button> : null}>
    {owner && <ReadState data={purchases} error={result?.error} retry={() => setRefresh((v) => v + 1)} label="采购记录暂时无法读取">
      <div className="stats s3">
        <div className="stat"><small>累计采购金额</small><b>{purchases?.totals.length ? purchases.totals.map((row) => money(row._sum.total, row.currencyCode)).join(' / ') : money(0, access.currencyCode)}</b></div>
        <div className="stat"><small>已入库单据</small><b>{purchases?.totals.reduce((sum, row) => sum + row._count, 0)}</b></div>
        <div className="stat"><small>最近入库</small><b>{purchases?.receipts[0]?.postedAt ? dateLabel(purchases.receipts[0].postedAt) : '—'}</b></div>
      </div>
      <div className="card"><div className="head" style={{ display: 'block' }}>历史入库单</div>
        {purchases?.receipts.map((r) => <button className="row g-sup-history" key={r.id} onClick={() => open(r)}><span className="c-main"><b>{receiptNumber(r.id)}</b><small>{dateLabel(r.postedAt ?? r.createdAt)}</small></span>
          <span className="dx"><ReceiptStatus receipt={r} /></span><span className="num"><b>{money(r.total, r.currencyCode)}</b></span></button>)}
        {!purchases?.receipts.length && <Empty title="还没有入库单">新建入库单时可选择此供应商。</Empty>}
      </div>
    </ReadState>}
  </Panel>
}

export function ProfitReport({ access, refresh, reload }: { access: Access; refresh: number; reload: () => void }) {
  const [range, setRange] = useState('今日')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [sort, setSort] = useState('销量')
  const result = useInventory<Profit[]>(path('profit', period(range)), refresh)
  const rows = result?.data ?? []
  const categories = [...new Set(rows.map((row) => row.category).filter((value): value is string => !!value))]
  const visible = rows.filter((r) => (category === '全部' || r.category === category) && r.name.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => sort === '毛利' ? Number(b.profit ?? -Infinity) - Number(a.profit ?? -Infinity) : Number(b.quantity) - Number(a.quantity))
  const covered = visible.filter((row) => row.cost != null && row.profit != null)
  const revenue = visible.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0)
  const netRevenue = covered.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0)
  const cost = covered.reduce((sum, row) => sum + Number(row.cost), 0)
  const profit = covered.reduce((sum, row) => sum + Number(row.profit), 0)
  const missing = visible.length - covered.length
  const currencyMissing = visible.some((row) => row.currencyMismatchCount > 0)
  const moneyHere = (value: string | number | null) => money(value, access.currencyCode)
  const tiles = [
    ['销售收入', moneyHere(currencyMissing ? null : revenue)],
    ['销售成本', moneyHere(covered.length || !visible.length ? cost : null)],
    ['毛利', moneyHere(covered.length || !visible.length ? profit : null)],
    ['毛利率', netRevenue > 0 ? (profit / netRevenue * 100).toFixed(1) + '%' : '—'],
    ['成本覆盖率', !currencyMissing && revenue > 0 ? (netRevenue / revenue * 100).toFixed(0) + '%' : '—'],
  ]
  return <section className="page"><div className="phead"><h1>成本与毛利</h1><span className="grow" /><Choices tabs values={periods} value={range} onChange={setRange} /></div>
    <div className="scroll">
      <ReadState data={result?.data} error={result?.error} retry={reload} label="成本与毛利数据暂时无法读取">
        <div className="kpis">{tiles.map(([label, value]) => <div className="kpi" key={label}><small>{label}</small><b>{value}</b></div>)}</div>
        {!!missing && <div className="banner amber"><b>{missing} 个商品成本或币种待核对</b>，未计入本期毛利。</div>}
        <div className="searchbar"><input className="inp grow" aria-label="搜索商品" placeholder="搜索商品" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="frow"><span className="flabel">分类</span><Choices values={['全部', ...categories]} value={category} onChange={setCategory} /></div>
        <div className="frow"><span className="flabel">排序</span><Choices values={['销量', '毛利']} value={sort} onChange={setSort} /></div>
        <div className="card"><div className="head g-pro"><span>商品</span>{['销量', '销售收入', '平均成本', '销售成本', '毛利', '毛利率'].map((s) => <span className="num" key={s}>{s}</span>)}</div>
          {visible.map((row) => <div className="row g-pro" key={row.itemId}>
            <span className="c-main"><b>{row.name}</b><small className="dx">{row.category}</small><small className="mo">{row.quantity} · 收入 {moneyHere(row.revenue)}</small></span>
            <span className="num dx">{row.quantity}</span><span className="num dx">{moneyHere(row.revenue)}</span>
            <span className="num dx">{moneyHere(row.cost != null && Number(row.quantity) > 0 ? Number(row.cost) / Number(row.quantity) : null)}</span>
            <span className="num dx">{moneyHere(row.cost)}</span>
            <span className="num">{row.profit == null ? <span className="tag amber">{row.currencyMismatchCount ? '币种待核对' : '成本缺失'}</span> : <b>{moneyHere(row.profit)}</b>}</span>
            <span className="num dx">{row.marginPercent == null ? '—' : row.marginPercent + '%'}</span>
          </div>)}
          {!visible.length && <Empty title="该条件下没有销售记录">换一个日期范围或分类试试。</Empty>}
        </div>
        <p className="hint">销售成本按销售时的移动加权平均成本计算。原材料不计入毛利。</p>
      </ReadState>
    </div>
  </section>
}
