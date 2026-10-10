'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { formatMoney } from '@/lib/currency'
import type { DiningMealView } from '@/lib/dine-in/commands'
import type { DiningDict } from '@/lib/dine-in/i18n'

export type DiningProduct = { barcode: string; name: string; spec: string | null; sellPrice: number; categoryId: string | null; imageUrl: string | null }
export type DiningCategory = { id: string; name: string; parentId: string | null }

type Props = {
  t: DiningDict
  meal: DiningMealView
  products: DiningProduct[]
  categories: DiningCategory[]
  currencyCode: string
  /** barcode → quantity of the batch being built. Page memory only; never authoritative. */
  cart: Record<string, number>
  /** The last submit has no known result: the batch is frozen until that is resolved. */
  frozen: boolean
  submitting: boolean
  canSubmit: boolean
  onChange: (barcode: string, delta: number) => void
  onSubmit: () => void
  onBack: () => void
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 14, alignItems: 'start' },
  head: { gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  back: { minHeight: 40, padding: '0 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  title: { fontSize: 22, fontWeight: 900 },
  sub: { fontSize: 13, color: '#475569' },
  tabs: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  tab: { minHeight: 34, padding: '0 14px', borderRadius: 17, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  tabOn: { background: '#0f172a', borderColor: '#0f172a', color: '#fff' },
  search: { width: '100%', minHeight: 40, borderRadius: 10, border: '1px solid #cbd5e1', padding: '0 12px', fontSize: 14, marginBottom: 10, boxSizing: 'border-box', fontFamily: 'inherit' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 },
  product: { position: 'relative', textAlign: 'left', minHeight: 92, borderRadius: 14, padding: 12, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'inherit' },
  productOn: { borderColor: '#2563eb', boxShadow: '0 0 0 2px rgba(37,99,235,.18)' },
  pName: { fontSize: 15, fontWeight: 800, lineHeight: 1.25, overflowWrap: 'anywhere' },
  pSpec: { fontSize: 12, color: '#64748b' },
  pPrice: { marginTop: 'auto', fontSize: 15, fontWeight: 900, color: '#1d4ed8' },
  badge: { position: 'absolute', top: 8, right: 8, minWidth: 24, height: 24, borderRadius: 12, background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' },
  cart: { position: 'sticky', top: 12, background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100dvh - 120px)' },
  cartTitle: { fontSize: 16, fontWeight: 900 },
  cartList: { overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60 },
  line: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' },
  lineName: { fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' },
  lineSub: { fontSize: 12, color: '#64748b' },
  stepper: { display: 'flex', alignItems: 'center', gap: 6 },
  step: { width: 36, height: 36, borderRadius: 10, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 18, fontWeight: 900, cursor: 'pointer', color: '#0f172a' },
  qty: { minWidth: 24, textAlign: 'center', fontSize: 15, fontWeight: 900 },
  total: { display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 900, borderTop: '1px dashed #cbd5e1', paddingTop: 10 },
  submit: { minHeight: 52, borderRadius: 12, border: 'none', background: '#16a34a', color: '#fff', fontSize: 17, fontWeight: 900, cursor: 'pointer' },
  empty: { color: '#94a3b8', fontSize: 13, padding: '12px 0' },
}

export default function DiningProductPicker({ t, meal, products, categories, currencyCode, cart, frozen, submitting, canSubmit, onChange, onSubmit, onBack }: Props) {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const topCategories = useMemo(() => categories.filter((category) => !category.parentId), [categories])
  const shown = useMemo(() => {
    const family = categoryId ? new Set([categoryId, ...categories.filter((category) => category.parentId === categoryId).map((category) => category.id)]) : null
    const needle = query.trim().toLowerCase()
    return products.filter((product) =>
      (!family || (product.categoryId !== null && family.has(product.categoryId)))
      && (!needle || product.name.toLowerCase().includes(needle) || product.barcode.toLowerCase().includes(needle)))
  }, [products, categories, categoryId, query])
  const byBarcode = useMemo(() => new Map(products.map((product) => [product.barcode, product])), [products])
  const lines = Object.entries(cart).filter(([, quantity]) => quantity > 0)
  const total = lines.reduce((sum, [barcode, quantity]) => sum + (byBarcode.get(barcode)?.sellPrice ?? 0) * quantity, 0)
  const locked = frozen || submitting

  return (
    <section style={s.wrap} aria-label={t.menuTitle}>
      <div style={s.head}>
        <button type="button" style={s.back} onClick={onBack}>← {t.billTitle}</button>
        <span style={s.title}>{meal.table.name}</span>
        <span style={s.sub}>{meal.guestCount} {t.guests} · {t.orderedSoFar} {formatMoney(Number(meal.unpaidAmount), currencyCode)}</span>
      </div>

      <div>
        <div style={s.tabs}>
          <button type="button" style={{ ...s.tab, ...(categoryId === null ? s.tabOn : {}) }} onClick={() => setCategoryId(null)}>{t.allCategories}</button>
          {topCategories.map((category) => (
            <button key={category.id} type="button" style={{ ...s.tab, ...(categoryId === category.id ? s.tabOn : {}) }} onClick={() => setCategoryId(category.id)}>{category.name}</button>
          ))}
        </div>
        <input style={s.search} value={query} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} />
        <div style={s.grid}>
          {shown.map((product) => {
            const quantity = cart[product.barcode] ?? 0
            return (
              <button key={product.barcode} type="button" disabled={locked} style={{ ...s.product, ...(quantity > 0 ? s.productOn : {}), ...(locked ? { opacity: 0.6, cursor: 'default' } : {}) }} onClick={() => onChange(product.barcode, 1)}>
                {quantity > 0 && <span style={s.badge}>{quantity}</span>}
                <span style={s.pName}>{product.name}</span>
                {product.spec && <span style={s.pSpec}>{product.spec}</span>}
                <span style={s.pPrice}>{formatMoney(product.sellPrice, currencyCode)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <aside style={s.cart}>
        <div style={s.cartTitle}>{t.thisBatch}</div>
        <div style={s.cartList}>
          {lines.length === 0 && <div style={s.empty}>{t.emptyCart}</div>}
          {lines.map(([barcode, quantity]) => {
            const product = byBarcode.get(barcode)
            return (
              <div key={barcode} style={s.line}>
                <div>
                  <div style={s.lineName}>{product?.name ?? barcode}</div>
                  <div style={s.lineSub}>{[product?.spec, formatMoney(product?.sellPrice ?? 0, currencyCode)].filter(Boolean).join(' · ')}</div>
                </div>
                <div style={s.stepper}>
                  <button type="button" style={s.step} disabled={locked} aria-label="-" onClick={() => onChange(barcode, -1)}>−</button>
                  <span style={s.qty}>{quantity}</span>
                  <button type="button" style={s.step} disabled={locked || quantity >= 999} aria-label="+" onClick={() => onChange(barcode, 1)}>+</button>
                </div>
              </div>
            )
          })}
        </div>
        <div style={s.total}><span>{t.thisBatch}</span><span>{formatMoney(total, currencyCode)}</span></div>
        <button type="button" style={{ ...s.submit, opacity: lines.length > 0 && canSubmit && !locked ? 1 : 0.5 }} disabled={lines.length === 0 || !canSubmit || locked} onClick={onSubmit}>
          {submitting ? t.paySubmitting : t.submitBatch}
        </button>
      </aside>
    </section>
  )
}
