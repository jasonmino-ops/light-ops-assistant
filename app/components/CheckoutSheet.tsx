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
import { apiFetch } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import KhqrSheet from '@/app/components/KhqrSheet'

type Step = 'selecting' | 'khqr_pending'
type Status = 'idle' | 'loading'

export default function CheckoutSheet({
  orderNo,
  totalAmount,
  onSuccess,
  onClose,
  onOverridePay,
}: {
  orderNo: string
  totalAmount: number
  onSuccess: () => void
  onClose: () => void
  /** 传入后完全接管付款逻辑（用于顾客订单等非主链场景），成功后由组件内部调用 onSuccess */
  onOverridePay?: (method: 'CASH' | 'KHQR') => Promise<void>
}) {
  const { t } = useLocale()
  const [step, setStep] = useState<Step>('selecting')
  const [status, setStatus] = useState<Status>('idle')
  const [khqrId, setKhqrId] = useState<string | null>(null)
  const [khqrPayload, setKhqrPayload] = useState<string | null>(null)
  const [khqrImageUrl, setKhqrImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleOverridePay(method: 'CASH' | 'KHQR') {
    setError(null)
    setStatus('loading')
    try {
      await onOverridePay!(method)
      onSuccess()
    } catch (e) {
      setError((e as Error).message ?? '操作失败，请重试')
      setStatus('idle')
    }
  }

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
          setKhqrPayload(body.khqrPayload ?? null)
          setKhqrImageUrl(body.khqrImageUrl ?? null)
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

  const busy = status !== 'idle'

  if (step === 'khqr_pending' && khqrId) {
    return (
      <KhqrSheet
        orderNo={orderNo}
        totalAmount={totalAmount}
        paymentIntentId={khqrId}
        khqrPayload={khqrPayload}
        khqrImageUrl={khqrImageUrl}
        onSuccess={onSuccess}
        onCancel={onClose}
      />
    )
  }

  return (
    <div style={cs.overlay} onClick={() => { if (!busy) onClose() }}>
      <div style={cs.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={cs.title}>{t('sale.paymentTitle')}</div>
        <div style={cs.amtRow}>
          <span style={cs.amtLabel}>{t('sale.total')}</span>
          <span style={cs.amtValue}>${totalAmount.toFixed(2)}</span>
        </div>

        <button style={cs.option} onClick={() => onOverridePay ? handleOverridePay('CASH') : handlePay('CASH')} disabled={busy}>
          <span style={cs.optIcon}>💵</span>
          <div style={cs.optText}>
            <div style={cs.optLabel}>{t('sale.paymentCash')}</div>
            <div style={cs.optDesc}>{busy ? t('common.submitting') : t('sale.paymentCashDesc')}</div>
          </div>
        </button>

        <button
          style={{ ...cs.option, ...((!onOverridePay && error) ? cs.optDisabled : {}) }}
          onClick={() => onOverridePay ? handleOverridePay('KHQR') : handlePay('KHQR')}
          disabled={busy || (!onOverridePay && !!error)}
        >
          <span style={cs.optIcon}>📱</span>
          <div style={cs.optText}>
            <div style={cs.optLabel}>{onOverridePay ? '收款码' : t('sale.paymentKhqr')}</div>
            <div style={cs.optDesc}>{onOverridePay ? '确认已通过收款码收款' : t('sale.paymentKhqrDesc')}</div>
          </div>
        </button>

        {error && <div style={cs.errorMsg}>{error}</div>}
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
}
