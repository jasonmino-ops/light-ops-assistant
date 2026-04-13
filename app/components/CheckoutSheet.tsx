'use client'

/**
 * CheckoutSheet
 * 从首页/记录页发起挂单结账的共享弹层，复用 /api/orders/:orderNo/checkout 链路。
 * Props:
 *   orderNo      — 订单号
 *   totalAmount  — 应收金额
 *   onSuccess()  — 结账完成后回调（页面刷新数据）
 *   onClose()    — 关闭弹层（不结账）
 */

import { useState } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'

type Step = 'selecting' | 'khqr_pending'
type Status = 'idle' | 'loading' | 'confirming' | 'cancelling'

export default function CheckoutSheet({
  orderNo,
  totalAmount,
  onSuccess,
  onClose,
}: {
  orderNo: string
  totalAmount: number
  onSuccess: () => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const [step, setStep] = useState<Step>('selecting')
  const [status, setStatus] = useState<Status>('idle')
  const [khqrId, setKhqrId] = useState<string | null>(null)
  const [khqrPayload, setKhqrPayload] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePay(method: 'CASH' | 'KHQR') {
    setError(null)
    setStatus('loading')
    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(orderNo)}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ paymentMethod: method }),
      })
      const body = await res.json()
      if (res.ok) {
        if (method === 'CASH') {
          onSuccess()
        } else {
          setKhqrId(body.paymentIntentId)
          setKhqrPayload(body.khqrPayload)
          setStep('khqr_pending')
          setStatus('idle')
        }
      } else if (body.error === 'KHQR_NOT_CONFIGURED') {
        setError(body.message ?? t('sale.khqrNotConfigured'))
        setStatus('idle')
      } else {
        setError(body.message ?? body.error ?? t('common.networkError'))
        setStatus('idle')
      }
    } catch {
      setError(t('common.networkError'))
      setStatus('idle')
    }
  }

  async function handleConfirm() {
    if (!khqrId) return
    setStatus('confirming')
    try {
      const res = await apiFetch(`/api/payments/${khqrId}/confirm`, { method: 'POST' })
      if (res.ok) {
        onSuccess()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? t('common.networkError'))
        setStatus('idle')
      }
    } catch {
      setError(t('common.networkError'))
      setStatus('idle')
    }
  }

  async function handleCancel() {
    if (!khqrId) return
    setStatus('cancelling')
    try {
      await apiFetch(`/api/payments/${khqrId}/cancel`, { method: 'POST' })
    } catch { /* ignore */ }
    onClose()
  }

  const busy = status !== 'idle'

  return (
    <div style={cs.overlay} onClick={() => { if (!busy) onClose() }}>
      <div style={cs.sheet} onClick={(e) => e.stopPropagation()}>

        {step === 'selecting' && (
          <>
            <div style={cs.title}>{t('sale.paymentTitle')}</div>
            <div style={cs.amtRow}>
              <span style={cs.amtLabel}>{t('sale.total')}</span>
              <span style={cs.amtValue}>${totalAmount.toFixed(2)}</span>
            </div>

            <button style={cs.option} onClick={() => handlePay('CASH')} disabled={busy}>
              <span style={cs.optIcon}>💵</span>
              <div style={cs.optText}>
                <div style={cs.optLabel}>{t('sale.paymentCash')}</div>
                <div style={cs.optDesc}>{busy ? t('common.submitting') : t('sale.paymentCashDesc')}</div>
              </div>
            </button>

            <button
              style={{ ...cs.option, ...(error ? cs.optDisabled : {}) }}
              onClick={() => handlePay('KHQR')}
              disabled={busy || !!error}
            >
              <span style={cs.optIcon}>📱</span>
              <div style={cs.optText}>
                <div style={cs.optLabel}>{t('sale.paymentKhqr')}</div>
                <div style={cs.optDesc}>{t('sale.paymentKhqrDesc')}</div>
              </div>
            </button>

            {error && <div style={cs.errorMsg}>{error}</div>}
          </>
        )}

        {step === 'khqr_pending' && khqrPayload && (
          <>
            <div style={cs.title}>{t('sale.khqrTitle')}</div>
            <div style={cs.khqrHint}>{t('sale.khqrScanHint')}</div>
            <div style={cs.qrWrap}>
              <QRCode value={khqrPayload} size={200} />
            </div>
            <div style={cs.amtRow}>
              <span style={cs.amtLabel}>{t('sale.khqrAmountLabel')}</span>
              <span style={cs.amtValue}>${totalAmount.toFixed(2)}</span>
            </div>
            {error && <div style={cs.errorMsg}>{error}</div>}
            <button style={cs.confirmBtn} disabled={busy} onClick={handleConfirm}>
              {status === 'confirming' ? t('sale.khqrConfirming') : t('sale.khqrConfirmBtn')}
            </button>
            <button style={cs.cancelBtn} disabled={busy} onClick={handleCancel}>
              {status === 'cancelling' ? t('sale.khqrCancelling') : t('sale.khqrCancelBtn')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const cs: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    zIndex: 700, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 480, background: '#fff',
    borderRadius: '16px 16px 0 0', padding: '20px 16px 40px',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 12, textAlign: 'center' },
  amtRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16, padding: '8px 0', borderBottom: '1px solid #f0f0f0',
  },
  amtLabel: { fontSize: 14, color: '#8c8c8c' },
  amtValue: { fontSize: 22, fontWeight: 700, color: '#1677ff' },
  option: {
    display: 'flex', alignItems: 'center', gap: 14, width: '100%',
    padding: '14px 16px', border: '1.5px solid #e8e8e8', borderRadius: 12,
    background: '#fff', cursor: 'pointer', marginBottom: 10, textAlign: 'left',
  },
  optDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  optIcon: { fontSize: 28, flexShrink: 0 },
  optText: { flex: 1 },
  optLabel: { fontSize: 15, fontWeight: 600, color: '#1a1a1a' },
  optDesc: { fontSize: 12, color: '#8c8c8c', marginTop: 2 },
  errorMsg: {
    fontSize: 13, color: '#d97706', background: '#fffbeb',
    border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px',
    textAlign: 'center', marginTop: 4,
  },
  khqrHint: { fontSize: 13, color: '#8c8c8c', textAlign: 'center', marginBottom: 16 },
  qrWrap: { display: 'flex', justifyContent: 'center', marginBottom: 16 },
  confirmBtn: {
    display: 'block', width: '100%', height: 48,
    background: '#52c41a', color: '#fff', border: 'none',
    borderRadius: 10, fontSize: 16, fontWeight: 700, marginBottom: 10, cursor: 'pointer',
  },
  cancelBtn: {
    display: 'block', width: '100%', height: 44,
    background: 'transparent', color: '#8c8c8c',
    border: '1px solid #d9d9d9', borderRadius: 10, fontSize: 14, cursor: 'pointer',
  },
}
