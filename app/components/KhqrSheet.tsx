'use client'

/**
 * KhqrSheet — 统一 KHQR 收款弹层
 *
 * 展示优先级：
 *   1. khqrImageUrl 存在 → 展示老板上传的静态图片
 *   2. khqrPayload 存在  → 展示动态二维码（Bakong KHQR 生成）
 *   3. 两者均无          → 理论上上游已拦截，此处仅兜底显示提示
 *
 * Props:
 *   orderNo         — 订单号（展示用）
 *   totalAmount     — 应收金额
 *   paymentIntentId — PaymentIntent.id，用于 confirm / cancel API 调用
 *   khqrPayload     — EMV QR 字符串（可为 null）
 *   khqrImageUrl    — 静态 KHQR 图片 data URL（可为 null）
 *   onSuccess()     — 确认收款后回调
 *   onCancel()      — 取消收款后回调（KhqrSheet 已在内部调用 /cancel API）
 */

import { useState } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'

type Status = 'idle' | 'confirming' | 'cancelling'

export default function KhqrSheet({
  orderNo,
  totalAmount,
  paymentIntentId,
  khqrPayload,
  khqrImageUrl,
  onSuccess,
  onCancel,
}: {
  orderNo: string
  totalAmount: number
  paymentIntentId: string
  khqrPayload: string | null
  khqrImageUrl: string | null
  onSuccess: () => void
  onCancel: () => void
}) {
  const { t } = useLocale()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setStatus('confirming')
    setError(null)
    try {
      const res = await apiFetch(`/api/payments/${paymentIntentId}/confirm`, { method: 'POST' })
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
    setStatus('cancelling')
    try {
      await apiFetch(`/api/payments/${paymentIntentId}/cancel`, { method: 'POST' })
    } catch { /* ignore */ }
    onCancel()
  }

  const busy = status !== 'idle'

  return (
    <div style={cs.overlay}>
      <div style={cs.sheet}>
        <div style={cs.title}>{t('sale.khqrTitle')}</div>
        <div style={cs.hint}>{t('sale.khqrScanHint')}</div>

        <div style={cs.qrWrap}>
          {khqrImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={khqrImageUrl} alt="KHQR" style={cs.qrImage} />
          ) : khqrPayload ? (
            <QRCode value={khqrPayload} size={200} />
          ) : (
            <div style={cs.noQr}>{t('sale.khqrNotConfigured')}</div>
          )}
        </div>

        <div style={cs.infoGrid}>
          <div style={cs.infoRow}>
            <span style={cs.infoLabel}>{t('sale.khqrAmountLabel')}</span>
            <span style={cs.infoValue}>${totalAmount.toFixed(2)}</span>
          </div>
          <div style={cs.infoRow}>
            <span style={cs.infoLabel}>{t('sale.khqrOrderLabel')}</span>
            <span style={{ ...cs.infoValue, fontFamily: 'monospace', fontSize: 13 }}>{orderNo}</span>
          </div>
        </div>

        {error && <div style={cs.errorMsg}>{error}</div>}

        <button style={cs.confirmBtn} disabled={busy} onClick={handleConfirm}>
          {status === 'confirming' ? t('sale.khqrConfirming') : t('sale.khqrConfirmBtn')}
        </button>
        <button style={cs.cancelBtn} disabled={busy} onClick={handleCancel}>
          {status === 'cancelling' ? t('sale.khqrCancelling') : t('sale.khqrCancelBtn')}
        </button>
      </div>
    </div>
  )
}

const cs: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    zIndex: 750, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 480, background: '#fff',
    borderRadius: '16px 16px 0 0', padding: '20px 16px 40px',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 4, textAlign: 'center' },
  hint: { fontSize: 13, color: '#8c8c8c', textAlign: 'center', marginBottom: 16 },
  qrWrap: {
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    marginBottom: 16, minHeight: 200,
  },
  qrImage: {
    maxWidth: 240, maxHeight: 240, width: '100%', objectFit: 'contain',
    borderRadius: 8, border: '1px solid #f0f0f0',
  },
  noQr: {
    fontSize: 13, color: '#d97706', background: '#fffbeb',
    border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 16px',
    textAlign: 'center',
  },
  infoGrid: { marginBottom: 16 },
  infoRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #f5f5f5',
  },
  infoLabel: { fontSize: 13, color: '#8c8c8c' },
  infoValue: { fontSize: 15, fontWeight: 600, color: '#1a1a1a' },
  errorMsg: {
    fontSize: 13, color: '#d97706', background: '#fffbeb',
    border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px',
    textAlign: 'center', marginBottom: 10,
  },
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
