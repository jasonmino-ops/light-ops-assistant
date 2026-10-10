'use client'

import type { CSSProperties } from 'react'
import { formatMoney } from '@/lib/currency'
import type { DiningBatchView, DiningLineView, DiningMealView } from '@/lib/dine-in/commands'
import { diningErrorText, fill, noticeStatusText, type DiningDict, type DiningLang } from '@/lib/dine-in/i18n'
import type { DiningNoticeStatus } from '@/lib/dine-in/kitchen-notice'

type Props = {
  t: DiningDict
  lang: DiningLang
  meal: DiningMealView
  currencyCode: string
  isOwner: boolean
  online: boolean
  /** New business allowed: dishes can be added. */
  canAdd: boolean
  /** Batches whose kitchen notice is being submitted by this page right now. */
  submittingNotices: ReadonlySet<string>
  receiptMessage: string | null
  receiptBusy: boolean
  onBack: () => void
  onAdd: () => void
  onVoidLine: (line: DiningLineView) => void
  onCheckout: () => void
  onClear: () => void
  onVoidMeal: () => void
  onSubmitNotice: (batch: DiningBatchView) => void
  onRenotify: (batch: DiningBatchView) => void
  onPrintReceipt: () => void
}

const NOTICE_TONE: Record<DiningNoticeStatus, CSSProperties> = {
  NOT_REQUIRED: { background: '#f1f5f9', color: '#64748b' },
  PENDING_SUBMIT: { background: '#fef3c7', color: '#92400e' },
  WITHDRAWN: { background: '#f1f5f9', color: '#64748b' },
  NOT_NOTIFIED_SETTLED: { background: '#f1f5f9', color: '#64748b' },
  SENT: { background: '#dcfce7', color: '#166534' },
  NOT_SENT: { background: '#fee2e2', color: '#991b1b' },
  UNKNOWN: { background: '#ffedd5', color: '#9a3412' },
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 14, alignItems: 'start' },
  head: { gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  back: { minHeight: 40, padding: '0 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  title: { fontSize: 22, fontWeight: 900 },
  sub: { fontSize: 13, color: '#475569' },
  batch: { background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 14, marginBottom: 10 },
  batchHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  batchNo: { fontSize: 15, fontWeight: 900 },
  kind: { fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: '#e0e7ff', color: '#3730a3' },
  kindVoid: { background: '#fee2e2', color: '#991b1b' },
  kindRenotify: { background: '#fef3c7', color: '#92400e' },
  meta: { fontSize: 12, color: '#64748b' },
  line: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px dotted #e2e8f0' },
  lineName: { fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' },
  lineSpec: { fontSize: 12, color: '#64748b' },
  gone: { textDecoration: 'line-through', color: '#94a3b8' },
  qty: { fontSize: 14, fontWeight: 800, minWidth: 36, textAlign: 'right' },
  amount: { fontSize: 14, fontWeight: 800, minWidth: 72, textAlign: 'right' },
  tag: { fontSize: 11, fontWeight: 800, padding: '1px 6px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', marginLeft: 6 },
  small: { minHeight: 34, padding: '0 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  notice: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e2e8f0' },
  pill: { fontSize: 12, fontWeight: 800, padding: '4px 10px', borderRadius: 999 },
  side: { position: 'sticky', top: 12, background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  dueLabel: { fontSize: 13, color: '#64748b', fontWeight: 700 },
  due: { fontSize: 34, fontWeight: 900, lineHeight: 1.1 },
  primary: { minHeight: 56, borderRadius: 12, border: 'none', background: '#16a34a', color: '#fff', fontSize: 18, fontWeight: 900, cursor: 'pointer' },
  secondary: { minHeight: 48, borderRadius: 12, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', fontSize: 16, fontWeight: 900, cursor: 'pointer' },
  danger: { minHeight: 44, borderRadius: 12, border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontSize: 14, fontWeight: 800, cursor: 'pointer' },
  note: { fontSize: 12, color: '#475569', lineHeight: 1.5 },
  kitchenNote: { fontSize: 13, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 10, padding: 10, lineHeight: 1.5 },
  blocked: { fontSize: 13, fontWeight: 700, color: '#991b1b', background: '#fee2e2', borderRadius: 10, padding: 10, lineHeight: 1.5 },
  empty: { padding: 28, textAlign: 'center', color: '#64748b', fontSize: 14, background: '#fff', borderRadius: 14, border: '1px dashed #cbd5e1' },
  row: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14 },
}

function time(iso: string, lang: DiningLang) {
  return new Date(iso).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : lang === 'km' ? 'km-KH' : 'en-US', { hour: '2-digit', minute: '2-digit' })
}

export default function DiningMealBill(props: Props) {
  const { t, lang, meal, currencyCode, isOwner, online } = props
  const open = meal.state === 'OPEN'
  const blocked = meal.externalPaymentStatus !== null
  const money = (value: string) => formatMoney(Number(value), currencyCode)
  // An external payment that is live (taken or being taken) freezes the bill. One that ended without
  // money still blocks adding and settling here (the bill number is used up) but not voiding the table.
  const liveExternal = meal.externalPaymentStatus === 'PAID' || meal.externalPaymentStatus === 'PENDING'
  // Shown for as long as it is true, on every device that opens this bill.
  const kitchenNotes = (
    <>
      {!open && meal.noSendEvidence.orderSeqs.length > 0 && (
        <div style={s.kitchenNote} data-kitchen-not-notified>{fill(t.payKitchenNotNotified, { seqs: meal.noSendEvidence.orderSeqs.join(', ') })}</div>
      )}
      {!open && meal.noSendEvidence.voidSeqs.length > 0 && (
        <div style={s.kitchenNote} data-void-notice-pending>{fill(t.voidNoticePending, { seqs: meal.noSendEvidence.voidSeqs.join(', ') })}</div>
      )}
    </>
  )

  return (
    <section style={s.wrap} aria-label={t.billTitle}>
      <div style={s.head}>
        <button type="button" style={s.back} onClick={props.onBack}>← {t.title}</button>
        <span style={s.title}>{meal.table.name}</span>
        <span style={s.sub}>
          {meal.guestCount} {t.guests} · {t.opened} {time(meal.openedAt, lang)}
          {meal.billNo ? ` · ${t.billNo} ${meal.billNo}` : ''}{meal.note ? ` · ${meal.note}` : ''}
        </span>
      </div>

      <div>
        {meal.batches.length === 0 && <div style={s.empty}>{t.nothingOrdered}</div>}
        {meal.batches.map((batch) => {
          const busy = props.submittingNotices.has(batch.id)
          return (
            <article key={batch.id} style={s.batch}>
              <div style={s.batchHead}>
                <span style={s.batchNo}>{fill(t.batchNo, { n: batch.seq })}</span>
                <span style={{ ...s.kind, ...(batch.kind === 'VOID' ? s.kindVoid : batch.kind === 'RENOTIFY' ? s.kindRenotify : {}) }}>
                  {batch.kind === 'ORDER' ? t.kindOrder : batch.kind === 'VOID' ? t.kindVoid : t.kindRenotify}
                  {batch.refSeq !== null ? ` · ${fill(t.refOf, { n: batch.refSeq })}` : ''}
                </span>
                <span style={s.meta}>{time(batch.createdAt, lang)}{batch.operatorName ? ` · ${t.operator} ${batch.operatorName}` : ''}</span>
                {batch.reason && <span style={s.meta}>{t.reason}: {batch.reason}</span>}
              </div>

              {batch.lines.map((line) => {
                const voided = line.status === 'CANCELLED'
                const struck = voided && batch.kind === 'ORDER'
                return (
                  <div key={`${batch.id}:${line.saleRecordId}`} style={s.line}>
                    <div>
                      <span style={{ ...s.lineName, ...(struck ? s.gone : {}) }}>{line.name}</span>
                      {line.kitchen && <span style={s.tag}>{t.toKitchen}</span>}
                      {struck && <span style={s.tag}>{t.voided}</span>}
                      {line.status === 'COMPLETED' && <span style={s.tag}>{t.paidLine}</span>}
                      {line.spec && <div style={s.lineSpec}>{line.spec}</div>}
                    </div>
                    <span style={{ ...s.qty, ...(struck ? s.gone : {}) }}>×{line.quantity}</span>
                    <span style={{ ...s.amount, ...(struck ? s.gone : {}) }}>{money(line.lineAmount)}</span>
                    {batch.kind === 'ORDER' && open && line.status === 'PENDING_PAYMENT' ? (
                      <button type="button" style={{ ...s.small, opacity: isOwner && online && !liveExternal ? 1 : 0.5 }} disabled={!isOwner || !online || liveExternal} title={isOwner ? undefined : t.ownerOnly} onClick={() => props.onVoidLine(line)}>
                        {t.voidLine}
                      </button>
                    ) : <span />}
                  </div>
                )
              })}

              {batch.notice.required && (
                <div style={s.notice}>
                  <span style={s.meta}>{t.noticeLabel}</span>
                  <span style={{ ...s.pill, ...NOTICE_TONE[batch.notice.status] }}>{busy ? t.noticeSubmitting : noticeStatusText(lang, batch.notice.status)}</span>
                  {batch.notice.canClaim && !busy && (
                    <button type="button" style={{ ...s.small, opacity: online ? 1 : 0.5 }} disabled={!online} onClick={() => props.onSubmitNotice(batch)}>{t.noticeSubmit}</button>
                  )}
                  {batch.notice.canRenotify && !busy && (
                    <button type="button" style={{ ...s.small, opacity: online ? 1 : 0.5 }} disabled={!online} onClick={() => props.onRenotify(batch)}>{t.noticeRenotify}</button>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <aside style={s.side}>
        {open ? (
          <>
            <div style={s.dueLabel}>{t.due}</div>
            <div style={s.due}>{money(meal.unpaidAmount)}</div>
            {blocked && <div style={s.blocked} role="alert">{liveExternal ? diningErrorText(lang, 'EXTERNAL_PAYMENT_EXISTS') : t.externalPaymentEnded}</div>}
            <button type="button" style={{ ...s.secondary, opacity: props.canAdd && !blocked ? 1 : 0.5 }} disabled={!props.canAdd || blocked} onClick={props.onAdd}>{t.addDishes}</button>
            <button type="button" style={{ ...s.primary, opacity: meal.unpaidLineCount > 0 && online && !blocked ? 1 : 0.5 }} disabled={meal.unpaidLineCount === 0 || !online || blocked} onClick={props.onCheckout}>{t.checkout}</button>
            {meal.unpaidLineCount === 0 && (
              <button type="button" style={{ ...s.danger, opacity: isOwner && online && !liveExternal ? 1 : 0.5 }} disabled={!isOwner || !online || liveExternal} title={isOwner ? undefined : t.ownerOnly} onClick={props.onVoidMeal}>{t.voidMeal}</button>
            )}
          </>
        ) : (
          <>
            <div style={s.dueLabel}>{meal.state === 'VOIDED' ? t.mealEndedVoided : meal.state === 'CLOSED' ? t.mealEndedCleared : t.payDone}</div>
            {kitchenNotes}
            {meal.payment && (
              <>
                <div style={s.due}>{money(meal.payment.amount)}</div>
                <div style={s.row}><span>{t.paidWith}</span><strong>{meal.payment.paymentMethod === 'KHQR' ? t.payKhqr : t.payCash}</strong></div>
                <div style={s.row}><span>{t.billNo}</span><strong>{meal.payment.billNo}</strong></div>
                <button type="button" style={{ ...s.secondary, opacity: props.receiptBusy || !meal.payment.receiptPrint ? 0.5 : 1 }} disabled={props.receiptBusy || !meal.payment.receiptPrint} onClick={props.onPrintReceipt}>{t.receiptPrint}</button>
                {props.receiptMessage && <div style={s.note}>{props.receiptMessage}</div>}
              </>
            )}
            {meal.state === 'PAID' && (
              <button type="button" style={{ ...s.primary, opacity: online ? 1 : 0.5 }} disabled={!online} onClick={props.onClear}>{t.clearTable}</button>
            )}
          </>
        )}
      </aside>
    </section>
  )
}
