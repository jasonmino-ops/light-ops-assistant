'use client'

import { useState, useEffect } from 'react'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'

type Store = { id: string; name: string }

type BindTokenResult = {
  token: string
  role: string
  storeId: string
  storeName: string
  label: string | null
  expiresAt: string
  maxUses: number
  tgLink: string | null
}

function fmtExpiry(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function InvitePage() {
  const [stores, setStores] = useState<Store[]>([])
  const [storeId, setStoreId] = useState('')
  const [label, setLabel] = useState('')
  const [expiresInHours, setExpiresInHours] = useState(48)
  const [maxUses, setMaxUses] = useState(1)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BindTokenResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    apiFetch('/api/stores', undefined, OWNER_CTX)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Store[]) => {
        setStores(list)
        if (list.length > 0) setStoreId(list[0].id)
      })
      .catch(() => {})
  }, [])

  async function generate() {
    if (!storeId) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const r = await apiFetch('/api/admin/bind-tokens', {
        method: 'POST',
        body: JSON.stringify({ storeId, role: 'STAFF', label: label.trim() || undefined, expiresInHours, maxUses }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) {
        setResult(body)
      } else {
        setError(body.message ?? body.error ?? '生成失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    if (!result?.tgLink) return
    navigator.clipboard.writeText(result.tgLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function reset() {
    setResult(null)
    setError('')
    setLabel('')
  }

  const qrValue = result?.tgLink ?? ''

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerTitle}>生成绑定码</div>
        <div style={s.headerSub}>生成员工入驻邀请码，员工扫码后自动注册</div>
      </div>

      <div style={s.body}>
        {!result ? (
          <div style={s.card}>
            {/* Store selector */}
            <div style={s.field}>
              <label style={s.label}>所属门店</label>
              {stores.length === 0 ? (
                <div style={s.placeholder}>加载中…</div>
              ) : (
                <select
                  style={s.select}
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                >
                  {stores.map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Label */}
            <div style={s.field}>
              <label style={s.label}>备注（可选）</label>
              <input
                style={s.input}
                type="text"
                placeholder="如：新员工-小王"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={40}
              />
            </div>

            {/* Expires */}
            <div style={s.field}>
              <label style={s.label}>有效期</label>
              <div style={s.radioRow}>
                {[{ h: 24, t: '24 小时' }, { h: 48, t: '48 小时' }, { h: 168, t: '7 天' }].map(({ h, t }) => (
                  <button
                    key={h}
                    style={{ ...s.radioBtn, ...(expiresInHours === h ? s.radioBtnActive : {}) }}
                    onClick={() => setExpiresInHours(h)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Max uses */}
            <div style={s.field}>
              <label style={s.label}>使用次数</label>
              <div style={s.radioRow}>
                {[1, 3, 5].map((n) => (
                  <button
                    key={n}
                    style={{ ...s.radioBtn, ...(maxUses === n ? s.radioBtnActive : {}) }}
                    onClick={() => setMaxUses(n)}
                  >
                    {n} 次
                  </button>
                ))}
              </div>
            </div>

            {error && <div style={s.errorMsg}>{error}</div>}

            <button
              style={{ ...s.genBtn, opacity: loading ? 0.6 : 1 }}
              onClick={generate}
              disabled={loading || !storeId}
            >
              {loading ? '生成中…' : '生成 STAFF 绑定码'}
            </button>
          </div>
        ) : (
          <div style={s.resultWrap}>
            {/* QR code */}
            <div style={s.qrCard}>
              {qrValue ? (
                <QRCode value={qrValue} size={180} style={{ display: 'block' }} />
              ) : (
                <div style={s.noLink}>
                  未配置 TELEGRAM_BOT_USERNAME，无法生成二维码
                </div>
              )}
            </div>

            {/* Info */}
            <div style={s.infoCard}>
              <InfoRow label="角色" value={result.role} />
              <InfoRow label="门店" value={result.storeName} />
              <InfoRow label="备注" value={result.label ?? '—'} />
              <InfoRow label="过期时间" value={fmtExpiry(result.expiresAt)} />
              <InfoRow label="最多使用" value={`${result.maxUses} 次`} />
              <InfoRow label="状态" value="ACTIVE" color="#52c41a" />
            </div>

            {/* Copy link */}
            {result.tgLink && (
              <button style={s.copyBtn} onClick={copyLink}>
                {copied ? '已复制 ✓' : '复制邀请链接'}
              </button>
            )}

            <button style={s.resetBtn} onClick={reset}>
              再生成一个
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={ir.row}>
      <span style={ir.label}>{label}</span>
      <span style={{ ...ir.value, ...(color ? { color } : {}) }}>{value}</span>
    </div>
  )
}

const ir: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f5f5f5' },
  label: { fontSize: 13, color: '#8c8c8c' },
  value: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f7fa', display: 'flex', flexDirection: 'column' },
  header: {
    background: '#1677ff',
    padding: '18px 16px 22px',
  },
  headerTitle: { fontSize: 18, fontWeight: 700, color: '#fff' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  body: { flex: 1, padding: '16px 12px 80px', maxWidth: 480, margin: '0 auto', width: '100%' },

  card: {
    background: '#fff',
    borderRadius: 14,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },

  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 12, fontWeight: 600, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.04em' },

  select: {
    height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8,
    padding: '0 12px', fontSize: 15, background: '#fafafa', color: '#1a1a1a',
  },
  input: {
    height: 44, border: '1.5px solid #e8e8e8', borderRadius: 8,
    padding: '0 12px', fontSize: 15, background: '#fafafa', outline: 'none',
  },
  placeholder: { fontSize: 14, color: '#bbb', padding: '10px 0' },

  radioRow: { display: 'flex', gap: 8 },
  radioBtn: {
    flex: 1, height: 36, border: '1.5px solid #e8e8e8', borderRadius: 8,
    background: '#fafafa', fontSize: 13, color: '#666', cursor: 'pointer',
  },
  radioBtnActive: {
    borderColor: '#1677ff', background: '#e6f4ff', color: '#1677ff', fontWeight: 700,
  },

  errorMsg: { fontSize: 13, color: '#ff4d4f', textAlign: 'center' },

  genBtn: {
    height: 48, background: '#1677ff', color: '#fff', border: 'none',
    borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer',
  },

  resultWrap: { display: 'flex', flexDirection: 'column', gap: 12 },

  qrCard: {
    background: '#fff', borderRadius: 14, padding: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  noLink: { fontSize: 13, color: '#aaa', textAlign: 'center', padding: '16px 0' },

  infoCard: {
    background: '#fff', borderRadius: 14, padding: '4px 16px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },

  copyBtn: {
    height: 48, background: '#1677ff', color: '#fff', border: 'none',
    borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  resetBtn: {
    height: 44, background: 'transparent', color: '#666',
    border: '1.5px solid #e8e8e8', borderRadius: 10, fontSize: 14, cursor: 'pointer',
  },
}
