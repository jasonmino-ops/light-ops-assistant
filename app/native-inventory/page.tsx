'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { useInventory, type Access, type Draft, type Item, type Receipt, type Supplier } from './client'
import { newDraft, openDraft, Receiving, SupplierForm, type PendingReceipt } from './receiving'
import { ProfitReport, ReceiptDetail, Receipts, SupplierDetail, Suppliers } from './reports'
import { CatalogSetup, ReadState, StockDetail, StockList } from './stock'
import { Choices, Icon } from './ui'
import './inventory.css'

const BarcodeScanner = dynamic(() => import('@/app/components/BarcodeScanner'), { ssr: false })
type Destination = 'stock' | 'suppliers' | 'profit'
type Overlay = { kind: 'catalog' } | { kind: 'stock'; item: Item } | { kind: 'receipt'; receipt: Receipt } | { kind: 'supplier'; supplier: Supplier } | { kind: 'supplier-form'; supplier?: Supplier }

const nav = [
  { kind: 'stock', desktop: '库存管理', mobile: '库存' },
  { kind: 'suppliers', desktop: '供应商', mobile: '供应商' },
  { kind: 'profit', desktop: '成本与毛利', mobile: '毛利' },
] as const

export default function NativeInventoryPage() {
  const [refresh, setRefresh] = useState(0)
  const access = useInventory<Access>('access', refresh)
  return <div className="native-inventory">
    <ReadState data={access?.data} error={access?.error} retry={() => setRefresh((v) => v + 1)} label="暂时无法访问进销存">
      {access?.data && <Inventory key={access.data.storeId + ':' + access.data.userId} access={access.data} />}
    </ReadState>
  </div>
}

function Inventory({ access }: { access: Access }) {
  const [destination, setDestination] = useState<Destination>('stock')
  const [tab, setTab] = useState('当前库存')
  const [refresh, setRefresh] = useState(0)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [query, setQuery] = useState('')
  const [received, setReceived] = useState<Record<string, number>>({})
  const [localDrafts, setLocalDrafts] = useState<Draft[]>([])
  const localDraft = localDrafts[0]
  const [pending, setPendingState] = useState<PendingReceipt | null>(null)
  const [scanner, setScanner] = useState<((barcode: string) => void) | null>(null)
  const storageKey = `native-inventory:pending-receipt:v1:${access.storeId}:${access.userId}`
  const localKey = `native-inventory:partial-drafts:v2:${access.storeId}:${access.userId}`
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (value && typeof value.id === 'string' && Number.isInteger(value.revision)) setPendingState(value)
    } catch {}
    try {
      const value = JSON.parse(sessionStorage.getItem(localKey) ?? '[]')
      if (Array.isArray(value)) setLocalDrafts(value.filter((draft) => draft && typeof draft.id === 'string' && Array.isArray(draft.lines)))
    } catch {}
  }, [localKey, storageKey])

  function saveLocal(id: string, next: Draft | null) {
    const remaining = localDrafts.filter((saved) => saved.id !== id)
    const updated = next ? [next, ...remaining] : remaining
    setLocalDrafts(updated)
    try {
      if (updated.length) sessionStorage.setItem(localKey, JSON.stringify(updated))
      else sessionStorage.removeItem(localKey)
    } catch {}
  }

  function setPending(next: PendingReceipt | null) {
    setPendingState(next)
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next))
      else localStorage.removeItem(storageKey)
    } catch {}
  }

  const reload = () => setRefresh((n) => n + 1)
  const close = () => setOverlay(null)
  const beginScan = (done: (barcode: string) => void) => setScanner(() => done)
  const closeScan = useCallback(() => setScanner(null), [])
  const onScanned = useCallback((barcode: string) => {
    setScanner(null)
    scanner?.(barcode)
  }, [scanner])
  const openReceipt = (receipt: Receipt) => setOverlay({ kind: 'receipt', receipt })
  const available = nav.filter(({ kind }) => kind !== 'profit' || access.role === 'OWNER')

  function showRecords() {
    setDraft(null)
    close()
    setDestination('stock')
    setTab('入库记录')
    reload()
  }

  function showStock(receipt: Receipt) {
    const quantities: Record<string, number> = {}
    for (const line of receipt.lines) {
      const baseQty = Number(line.baseQty)
      quantities[line.itemId] = (quantities[line.itemId] ?? 0) + baseQty
    }
    setReceived(quantities)
    setDraft(null)
    close()
    setDestination('stock')
    setTab('当前库存')
    setQuery('')
    reload()
  }

  return <>
    <div className="shell">
      <nav className="side" aria-label="主导航">
        <div className="brand">店小二 E-Shop</div><div className="store">{access.storeName} · 库存与采购</div>
        {available.map(({ kind, desktop }) => <button className={`nav-btn ${destination === kind ? 'on' : ''}`} disabled={!!draft} aria-current={destination === kind ? 'page' : undefined} key={kind} onClick={() => { setDestination(kind); reload() }}><Icon kind={kind} />{desktop}</button>)}
      </nav>
      <main className="main">
        {draft ? <Receiving key={draft.id} draft={draft} setDraft={(value) => setDraft((current) => current ? typeof value === 'function' ? value(current) : value : current)}
          access={access} refresh={refresh} reload={reload} close={showRecords} openStock={showStock} openRecords={showRecords} pending={pending} setPending={setPending} saveLocal={saveLocal} scan={beginScan} />
          : destination === 'stock' ? <section className="page">
            <div className="phead"><h1>库存管理</h1><Choices tabs values={['当前库存', '入库记录']} value={tab} onChange={(t) => { setTab(t); reload() }} />
              <span className="grow" /><button className="btn primary" disabled={!!pending} onClick={() => setDraft(localDraft ?? newDraft())}>＋ {localDraft ? '继续本地草稿' : '新建入库单'}</button></div>
            {tab === '当前库存' ? <StockList access={access} refresh={refresh} reload={reload} query={query} setQuery={setQuery} justReceived={received}
              scan={() => beginScan(setQuery)} setup={() => setOverlay({ kind: 'catalog' })} open={(item) => setOverlay({ kind: 'stock', item })} />
              : <Receipts access={access} refresh={refresh} reload={reload} open={openReceipt} localDrafts={localDrafts} resumeLocal={setDraft} pending={pending} clearPending={() => setPending(null)} />}
            {pending && tab === '当前库存' && <div className="foot"><button className="btn" onClick={showRecords}>查看待确认入库单</button></div>}
          </section> : destination === 'suppliers' ? <Suppliers access={access} refresh={refresh} reload={reload} open={(supplier) => setOverlay({ kind: 'supplier', supplier })} add={() => setOverlay({ kind: 'supplier-form' })} />
            : <ProfitReport access={access} refresh={refresh} reload={reload} />}
      </main>
    </div>
    <nav className="tabbar" aria-label="主导航">
      {available.map(({ kind, mobile }) => <button className={`tab-btn ${destination === kind ? 'on' : ''}`} disabled={!!draft} aria-current={destination === kind ? 'page' : undefined} key={kind} onClick={() => { setDestination(kind); reload() }}><Icon kind={kind} />{mobile}</button>)}
    </nav>
    {overlay?.kind === 'catalog' && <CatalogSetup close={close} saved={() => { close(); setQuery(''); reload() }} />}
    {overlay?.kind === 'stock' && <StockDetail key={overlay.item.id} item={overlay.item} access={access} close={close} changed={() => { close(); reload() }} />}
    {overlay?.kind === 'receipt' && <ReceiptDetail key={overlay.receipt.id} receipt={overlay.receipt} pending={pending}
      close={close} changed={reload} clearPending={() => setPending(null)} openStock={showStock} edit={(receipt) => { close(); setDraft(openDraft(receipt)) }} />}
    {overlay?.kind === 'supplier' && <SupplierDetail key={overlay.supplier.id} supplier={overlay.supplier} access={access} close={close}
      edit={() => setOverlay({ kind: 'supplier-form', supplier: overlay.supplier })} open={openReceipt} />}
    {overlay?.kind === 'supplier-form' && <SupplierForm supplier={overlay.supplier} close={close} saved={() => { close(); reload() }} />}
    {scanner && <BarcodeScanner onScanned={onScanned} onClose={closeScan} />}
  </>
}
