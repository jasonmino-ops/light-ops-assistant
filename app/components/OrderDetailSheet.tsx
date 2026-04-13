'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import CheckoutSheet from '@/app/components/CheckoutSheet'

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderItem = {
  id: string
  recordNo: string
  productNameSnapshot: string
  specSnapshot: string | null
  quantity: number
  unitPrice: number
  lineAmount: number
  saleType: string
}

type OrderDetail = {
  orderNo: string
  storeName: string
  operatorDisplayName: string
  createdAt: string
  saleStatus: string
  items: OrderItem[]
  totalAmount: number
  paymentMethod: 'CASH' | 'KHQR' | null
  paymentStatus: string | null
  paidAt: string | null
  cancelledAt: string | null
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderDetailSheet({
  orderNo,
  onClose,
}: {
  orderNo: string | null
  onClose: () => void
}) {
  const { t } = useLocale()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCheckout, setShowCheckout] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!orderNo) {
      setDetail(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    setDetail(null)
    apiFetch(`/api/orders/${encodeURIComponent(orderNo)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setDetail)
      .catch(() => setError(t('order.loadFailed')))
      .finally(() => setLoading(false))
  }, [orderNo, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!orderNo) return null

  const d = detail
  const isDeferred = d?.saleStatus === 'PENDING_PAYMENT' && !d?.paymentMethod
  const isPending = d?.paymentStatus === 'PENDING' || isDeferred
  const isCancelled = d?.paymentStatus === 'CANCELLED' || d?.saleStatus === 'CANCELLED'

  const payMethodLabel =
    d?.paymentMethod === 'KHQR' ? 'KHQR' :
    d?.paymentMethod === 'CASH' ? t('order.payMethodCash') :
    t('order.noPayment')
  const payStatusLabel =
    d?.paymentStatus === 'PENDING'   ? t('order.payStatusPending') :
    d?.paymentStatus === 'PAID'      ? t('order.payStatusPaid') :
    d?.paymentStatus === 'CANCELLED' ? t('order.payStatusCancelled') :
    d?.paymentStatus === 'FAILED'    ? t('order.payStatusFailed') :
    d?.paymentStatus === 'EXPIRED'   ? t('order.payStatusExpired') :
    isDeferred                       ? t('order.payStatusPending') :
    d?.paymentStatus ?? ''
  const saleStatusLabel =
    d?.saleStatus === 'COMPLETED'       ? t('order.saleStatusCompleted') :
    d?.saleStatus === 'PENDING_PAYMENT' ? t('order.saleStatusPending') :
    d?.saleStatus === 'CANCELLED'       ? t('order.saleStatusCancelled') :
    d?.saleStatus ?? ''

  return (
    <div style={sh.overlay} onClick={onClose}>
      <div style={sh.sheet} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={sh.header}>
          <span style={sh.title}>{t('order.detailTitle')}</span>
          <button style={sh.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={sh.loadingWrap}>
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
            {[18, 18, 18, 18, 80, 18].map((h, i) => (
              <div key={i} style={{ ...sh.skeleton, height: h, marginBottom: 10 }} />
            ))}
          </div>
        )}

        {/* Error */}
        {error && <div style={sh.errorText}>{error}</div>}

        {/* Detail body */}
        {d && (
          <div style={sh.body}>
            {/* Meta */}
            <div style={sh.metaGrid}>
              <InfoRow label={t('order.labelOrderNo')} value={d.orderNo} mono />
              <InfoRow label={t('order.labelStore')} value={d.storeName} />
              <InfoRow label={t('order.labelOperator')} value={d.operatorDisplayName} />
              <InfoRow label={t('order.labelCreatedAt')} value={fmtDateTime(d.createdAt)} />
            </div>

            {/* Items */}
            <div style={sh.section}>
              <div style={sh.sectionLabel}>{t('order.labelProduct')}</div>
              {d.items.map((item) => (
                <div key={item.id} style={sh.itemRow}>
                  <div style={sh.itemName}>
                    {item.productNameSnapshot}
                    {item.specSnapshot && <span style={sh.itemSpec}> · {item.specSnapshot}</span>}
                  </div>
                  <div style={sh.itemRight}>
                    <span style={sh.itemQty}>
                      {Math.abs(item.quantity)} × ${item.unitPrice.toFixed(2)}
                    </span>
                    <span style={sh.itemAmt}>${Math.abs(item.lineAmount).toFixed(2)}</span>
                  </div>
                </div>
              ))}
              <div style={sh.totalRow}>
                <span style={sh.totalLabel}>{t('order.labelTotal')}</span>
                <span style={sh.totalAmt}>${Math.abs(d.totalAmount).toFixed(2)}</span>
              </div>
            </div>

            {/* Payment */}
            <div style={sh.section}>
              <InfoRow label={t('order.labelPayMethod')} value={payMethodLabel} />
              <div style={sh.infoRowWrap}>
                <span style={sh.infoLabel}>{t('order.labelPayStatus')}</span>
                <span style={{
                  ...sh.statusBadge,
                  ...(isPending ? sh.statusPending : isCancelled ? sh.statusCancelled : sh.statusPaid),
                }}>
                  {payStatusLabel}
                </span>
              </div>
              {d.paidAt && (
                <InfoRow label={t('order.labelPaidAt')} value={fmtDateTime(d.paidAt)} />
              )}
            </div>

            {/* Sale status */}
            <div style={sh.section}>
              <div style={sh.infoRowWrap}>
                <span style={sh.infoLabel}>{t('order.labelSaleStatus')}</span>
                <span style={{
                  ...sh.statusBadge,
                  ...(d.saleStatus === 'CANCELLED' ? sh.statusCancelled :
                      d.saleStatus === 'PENDING_PAYMENT' ? sh.statusPending : sh.statusPaid),
                }}>
                  {saleStatusLabel}
                </span>
              </div>
            </div>

            {/* Checkout button for deferred unpaid orders */}
            {isDeferred && (
              <button style={sh.checkoutBtn} onClick={() => setShowCheckout(true)}>
                {t('sale.checkoutBtn')}
              </button>
            )}
          </div>
        )}
      </div>

      {showCheckout && d && (
        <CheckoutSheet
          orderNo={d.orderNo}
          totalAmount={d.totalAmount}
          onSuccess={() => { setShowCheckout(false); setReloadKey((k) => k + 1) }}
          onClose={() => setShowCheckout(false)}
        />
      )}
    </div>
  )
}

// ─── InfoRow ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={sh.infoRowWrap}>
      <span style={sh.infoLabel}>{label}</span>
      <span style={{ ...sh.infoValue, ...(mono ? sh.infoMono : {}) }}>{value}</span>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sh: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    zIndex: 600, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 480, background: '#fff',
    borderRadius: '16px 16px 0 0', maxHeight: '85vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 16px 12px', borderBottom: '1px solid #f0f0f0', flexShrink: 0,
  },
  title: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 18,
    color: '#8c8c8c', cursor: 'pointer', padding: '0 4px',
  },
  loadingWrap: { padding: '16px 16px 0' },
  skeleton: {
    background: '#e8e8e8', borderRadius: 6,
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  errorText: { padding: 16, color: '#ff4d4f', fontSize: 14, textAlign: 'center' },
  body: { padding: '12px 16px 32px', overflowY: 'auto', flex: 1 },
  metaGrid: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 4 },
  section: {
    borderTop: '1px solid #f0f0f0', paddingTop: 12,
    marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: 600, color: '#8c8c8c',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2,
  },
  itemRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  itemName: { fontSize: 14, color: '#1a1a1a', flex: 1 },
  itemSpec: { color: '#8c8c8c', fontWeight: 400 },
  itemRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  itemQty: { fontSize: 12, color: '#8c8c8c' },
  itemAmt: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  totalRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderTop: '1px dashed #e8e8e8', paddingTop: 8, marginTop: 4,
  },
  totalLabel: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  totalAmt: { fontSize: 20, fontWeight: 700, color: '#1677ff' },
  infoRowWrap: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  infoLabel: { fontSize: 13, color: '#8c8c8c', flexShrink: 0 },
  infoValue: { fontSize: 13, color: '#1a1a1a', textAlign: 'right' },
  infoMono: { fontFamily: 'monospace', fontSize: 12, color: '#595959' },
  statusBadge: { fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20 },
  statusPaid: { background: '#f6ffed', color: '#52c41a', border: '1px solid #b7eb8f' },
  statusPending: { background: '#fff7e6', color: '#fa8c16', border: '1px solid #ffd591' },
  statusCancelled: { background: '#f5f5f5', color: '#8c8c8c', border: '1px solid #d9d9d9' },
  checkoutBtn: {
    display: 'block', width: '100%', height: 48, marginTop: 16,
    background: '#fa8c16', color: '#fff', border: 'none',
    borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer',
  },
}
