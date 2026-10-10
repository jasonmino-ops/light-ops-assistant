'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { formatMoney } from '@/lib/currency'
import type { DiningRecoverableMeal, DiningTableView } from '@/lib/dine-in/commands'
import { fill, type DiningDict } from '@/lib/dine-in/i18n'

type Area = 'ALL' | 'HALL' | 'ROOM'
export type TableDraft = { tableId?: string; name?: string; areaKind?: 'HALL' | 'ROOM'; sortOrder?: number; isActive?: boolean }

type Props = {
  t: DiningDict
  tables: DiningTableView[]
  /** Ended meals that still have a void notice a person can send or send again. */
  recoverable: DiningRecoverableMeal[]
  /** The server has more of them than are shown. */
  recoverableHasMore: boolean
  onLoadMoreRecoverable: () => void
  currencyCode: string
  now: number
  /** New business allowed and online: free tables can be opened. */
  canOpen: boolean
  /** Owner with new business allowed: table maintenance is offered. */
  canEdit: boolean
  busy: boolean
  onOpenRequest: (table: DiningTableView) => void
  onEnterMeal: (mealId: string) => void
  onSaveTable: (draft: TableDraft) => Promise<boolean>
}

const s: Record<string, CSSProperties> = {
  bar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  tab: { minHeight: 36, padding: '0 16px', borderRadius: 18, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  tabOn: { background: '#0f172a', borderColor: '#0f172a', color: '#fff' },
  spacer: { flex: 1 },
  ghost: { minHeight: 36, padding: '0 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(172px, 1fr))', gap: 12 },
  card: { textAlign: 'left', minHeight: 128, borderRadius: 16, padding: 14, border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'inherit' },
  cardDining: { background: '#fff7ed', borderColor: '#fdba74' },
  cardPaid: { background: '#ecfdf5', borderColor: '#6ee7b7' },
  cardOff: { background: '#f1f5f9', color: '#94a3b8', cursor: 'default' },
  name: { fontSize: 20, fontWeight: 900, lineHeight: 1.15, overflowWrap: 'anywhere' },
  area: { fontSize: 11, color: '#64748b', fontWeight: 700 },
  state: { marginTop: 'auto', fontSize: 13, fontWeight: 800 },
  meta: { fontSize: 12, color: '#475569' },
  amount: { fontSize: 16, fontWeight: 900 },
  warn: { fontSize: 11, fontWeight: 800, color: '#b45309' },
  empty: { padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14 },
  editRow: { display: 'grid', gridTemplateColumns: 'minmax(120px, 2fr) 120px 80px auto auto', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e2e8f0' },
  input: { minHeight: 38, borderRadius: 8, border: '1px solid #cbd5e1', padding: '0 10px', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  primary: { minHeight: 38, padding: '0 14px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  recover: { marginTop: 18, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 14, padding: 14 },
  recoverTitle: { fontSize: 15, fontWeight: 900, color: '#92400e' },
  recoverRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px dotted #fcd34d', fontSize: 14 },
  panel: { background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: 16 },
}

function EditRow({ t, table, busy, onSave }: { t: DiningDict; table: DiningTableView | null; busy: boolean; onSave: (draft: TableDraft) => Promise<boolean> }) {
  const [name, setName] = useState(table?.name ?? '')
  const [areaKind, setAreaKind] = useState<'HALL' | 'ROOM'>(table?.areaKind ?? 'HALL')
  const [sortOrder, setSortOrder] = useState(String(table?.sortOrder ?? 0))
  const order = Number.parseInt(sortOrder, 10)
  const valid = name.trim().length >= 1 && name.trim().length <= 40 && Number.isInteger(order) && order >= 0 && order <= 9999
  return (
    <div style={s.editRow}>
      <input style={s.input} value={name} maxLength={40} placeholder={t.tableName} aria-label={t.tableName} onChange={(event) => setName(event.target.value)} />
      <select style={s.input} value={areaKind} aria-label={t.areaHall} onChange={(event) => setAreaKind(event.target.value === 'ROOM' ? 'ROOM' : 'HALL')}>
        <option value="HALL">{t.areaHall}</option>
        <option value="ROOM">{t.areaRoom}</option>
      </select>
      <input style={s.input} value={sortOrder} inputMode="numeric" aria-label={t.sortOrder} onChange={(event) => setSortOrder(event.target.value.replace(/\D/g, '').slice(0, 4))} />
      <button
        type="button"
        style={{ ...s.primary, opacity: valid && !busy ? 1 : 0.5 }}
        disabled={!valid || busy}
        onClick={async () => {
          const saved = await onSave({ ...(table ? { tableId: table.id } : {}), name: name.trim(), areaKind, sortOrder: order })
          if (saved && !table) { setName(''); setSortOrder('0') }
        }}
      >
        {table ? t.save : t.addTable}
      </button>
      {table ? (
        <button
          type="button"
          style={{ ...s.ghost, opacity: busy || (table.isActive && table.meal) ? 0.5 : 1 }}
          disabled={busy || Boolean(table.isActive && table.meal)}
          onClick={() => { void onSave({ tableId: table.id, isActive: !table.isActive }) }}
        >
          {table.isActive ? t.disable : t.enable}
        </button>
      ) : <span />}
    </div>
  )
}

export default function DiningTableOverview({ t, tables, recoverable, recoverableHasMore, onLoadMoreRecoverable, currencyCode, now, canOpen, canEdit, busy, onOpenRequest, onEnterMeal, onSaveTable }: Props) {
  const [area, setArea] = useState<Area>('ALL')
  const [editing, setEditing] = useState(false)
  const visible = useMemo(
    () => tables.filter((table) => (table.isActive || table.meal) && (area === 'ALL' || table.areaKind === area)),
    [tables, area],
  )

  if (editing && canEdit) {
    return (
      <section style={s.panel} aria-label={t.editTables}>
        <div style={s.bar}>
          <strong style={{ fontSize: 16 }}>{t.editTables}</strong>
          <span style={s.spacer} />
          <button type="button" style={s.ghost} onClick={() => setEditing(false)}>{t.doneEditing}</button>
        </div>
        {tables.map((table) => <EditRow key={`${table.id}:${table.name}:${table.areaKind}:${table.sortOrder}`} t={t} table={table} busy={busy} onSave={onSaveTable} />)}
        <EditRow t={t} table={null} busy={busy} onSave={onSaveTable} />
      </section>
    )
  }

  return (
    <section aria-label={t.title}>
      <div style={s.bar}>
        {(['ALL', 'HALL', 'ROOM'] as const).map((value) => (
          <button key={value} type="button" style={{ ...s.tab, ...(area === value ? s.tabOn : {}) }} onClick={() => setArea(value)}>
            {value === 'ALL' ? t.areaAll : value === 'HALL' ? t.areaHall : t.areaRoom}
          </button>
        ))}
        <span style={s.spacer} />
        {canEdit && <button type="button" style={s.ghost} onClick={() => setEditing(true)}>{t.editTables}</button>}
      </div>
      {visible.length === 0 ? <div style={s.empty}>{t.noTables}</div> : (
        <div style={s.grid}>
          {visible.map((table) => {
            const meal = table.meal
            const free = !meal
            const disabled = free && (!canOpen || !table.isActive)
            const minutes = meal ? Math.max(0, Math.floor((now - Date.parse(meal.openedAt)) / 60_000)) : 0
            return (
              <button
                key={table.id}
                type="button"
                disabled={disabled}
                style={{ ...s.card, ...(meal?.state === 'OPEN' ? s.cardDining : meal?.state === 'PAID' ? s.cardPaid : {}), ...(disabled ? s.cardOff : {}) }}
                onClick={() => (meal ? onEnterMeal(meal.mealId) : onOpenRequest(table))}
              >
                <span style={s.area}>{table.areaKind === 'ROOM' ? t.areaRoom : t.areaHall}</span>
                <span style={s.name}>{table.name}</span>
                {meal ? (
                  <>
                    <span style={s.meta}>{meal.guestCount} {t.guests} · {minutes} {t.minutes} · {meal.batchCount} {t.batches}</span>
                    {meal.state === 'OPEN' && <span style={s.amount}>{t.unpaid} {formatMoney(Number(meal.unpaidAmount), currencyCode)}</span>}
                    {meal.pendingNoticeCount > 0 && <span style={s.warn}>{t.noticePending}</span>}
                    <span style={s.state}>{meal.state === 'PAID' ? t.tableAwaitingClear : t.tableDining}</span>
                  </>
                ) : (
                  <span style={s.state}>{table.isActive ? t.tableFree : t.tableDisabled}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {recoverable.length > 0 && (
        <div style={s.recover} data-recoverable-meals>
          <div style={s.recoverTitle}>{t.recoverTitle}</div>
          <div style={s.meta}>{t.recoverHint}</div>
          {recoverable.map((entry) => (
            <div key={entry.mealId} style={s.recoverRow}>
              <strong>{entry.tableName}</strong>
              <span style={s.meta}>{entry.state === 'VOIDED' ? t.mealEndedVoided : t.mealEndedCleared}{entry.billNo ? ` · ${t.billNo} ${entry.billNo}` : ''}</span>
              <span style={s.warn}>{fill(t.batchNo, { n: entry.voidNoticeSeqs.join(', ') })}</span>
              <span style={s.spacer} />
              <button type="button" style={s.ghost} onClick={() => onEnterMeal(entry.mealId)}>{t.recoverOpen}</button>
            </div>
          ))}
          {recoverableHasMore && (
            <div style={s.recoverRow}>
              <span style={s.spacer} />
              <button type="button" style={s.ghost} data-recoverable-more onClick={onLoadMoreRecoverable}>{t.recoverLoadMore}</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
