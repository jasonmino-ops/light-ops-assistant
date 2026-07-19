'use client'

import type { CSSProperties } from 'react'
import { FormEvent, useState } from 'react'
import Link from 'next/link'

type StoreStatusResponse = {
  store: {
    id: string
    code: string
    name: string
    status: string
  }
  tenant: {
    id: string
    name: string
    status: string
    tier: string
  }
  subscription: {
    accessState: string
    status: string
    warning: string | null
    trialEndsAt?: string | null
    currentPeriodEndsAt?: string | null
  }
  activePin: {
    pinId: string
    status: string
    hasValidPin: boolean
    expiresAt: string
    lockedUntil: string | null
    failedAttempts: number
    createdAt: string
  } | null
  pinTtlHours: number
}

type IssueResponse = {
  pinId: string
  pin: string
  expiresAt: string
  pinTtlHours: number
  replacedActivePin: boolean
  store: StoreStatusResponse['store']
  tenant: StoreStatusResponse['tenant']
  subscription: {
    accessState: string
    status: string
    warning: string | null
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: '当前账号没有生成设备激活 PIN 的权限。',
  OPS_ADMIN_REQUIRED: '当前账号没有生成设备激活 PIN 的权限。',
  INVALID_STORE_CODE: '门店码格式不正确，请检查后重试。',
  MISSING_STORE_CODE: '请输入门店码。',
  STORE_NOT_FOUND: '未找到该门店，请检查门店码。',
  TENANT_INACTIVE: '该商户当前不可用，不能生成设备激活 PIN。',
  STORE_INACTIVE: '该门店当前不可用，不能生成设备激活 PIN。',
  STORE_OWNER_NOT_FOUND: '该门店缺少有效老板账号，不能生成设备激活 PIN。',
  SUBSCRIPTION_BLOCKED: '当前门店订阅状态不允许激活新设备。',
  TOKEN_SECRET_NOT_CONFIGURED: '设备激活密钥未配置，暂不能生成 PIN。',
  PIN_SECRET_NOT_CONFIGURED: '设备激活密钥未配置，暂不能生成 PIN。',
  CONFLICT_RETRY_REQUIRED: '同时生成请求发生冲突，请重新查询后再试。',
  INVALID_JSON: '请求格式错误，请刷新后重试。',
  INTERNAL_ERROR: '服务端暂时无法完成请求，请稍后重试。',
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '无'
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function errorText(code: string) {
  const message = ERROR_MESSAGES[code] ?? '请求失败，请稍后重试。'
  return `${message} Reference: ${code}`
}

function badgeStyle(kind: 'ok' | 'warn' | 'bad' | 'idle'): CSSProperties {
  return {
    ok: { color: '#166534', background: '#dcfce7', borderColor: '#86efac' },
    warn: { color: '#92400e', background: '#fef3c7', borderColor: '#fcd34d' },
    bad: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
    idle: { color: '#334155', background: '#f1f5f9', borderColor: '#cbd5e1' },
  }[kind]
}

function subscriptionKind(status: string, accessState: string): 'ok' | 'warn' | 'bad' | 'idle' {
  if (accessState === 'ALLOWED') return 'ok'
  if (status === 'EXPIRED' || status === 'CANCELLED') return 'bad'
  return 'warn'
}

export default function OpsDesktopActivationPage() {
  const [storeCode, setStoreCode] = useState('')
  const [status, setStatus] = useState<StoreStatusResponse | null>(null)
  const [issued, setIssued] = useState<IssueResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)

  function updateStoreCode(value: string) {
    setStoreCode(value)
    setIssued(null)
    setCopied(false)
    setShowReplaceConfirm(false)
    setError('')
  }

  async function readError(res: Response) {
    const body = await res.json().catch(() => ({}))
    return typeof body?.error === 'string' ? body.error : `HTTP_${res.status}`
  }

  async function lookupStore(event?: FormEvent) {
    event?.preventDefault()
    const code = storeCode.trim()
    setIssued(null)
    setCopied(false)
    setShowReplaceConfirm(false)
    setError('')
    if (!code) {
      setError(errorText('MISSING_STORE_CODE'))
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/ops/desktop-activation?storeCode=${encodeURIComponent(code)}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(await readError(res))
      setStatus(await res.json() as StoreStatusResponse)
    } catch (err) {
      setStatus(null)
      setError(errorText(err instanceof Error ? err.message : 'NETWORK_ERROR'))
    } finally {
      setLoading(false)
    }
  }

  function requestIssuePin() {
    if (issuing) return
    if (status?.activePin?.hasValidPin) {
      setShowReplaceConfirm(true)
      return
    }
    issuePin()
  }

  async function issuePin() {
    const code = status?.store.code ?? storeCode.trim()
    if (!code || issuing) return

    setIssuing(true)
    setIssued(null)
    setCopied(false)
    setShowReplaceConfirm(false)
    setError('')
    try {
      const res = await fetch('/api/ops/desktop-activation', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeCode: code }),
      })
      if (!res.ok) throw new Error(await readError(res))
      const body = await res.json() as IssueResponse
      setIssued(body)
      setStatus((current) => current ? {
        ...current,
        activePin: {
          pinId: body.pinId,
          status: 'ACTIVE',
          hasValidPin: true,
          expiresAt: body.expiresAt,
          lockedUntil: null,
          failedAttempts: 0,
          createdAt: new Date().toISOString(),
        },
      } : current)
    } catch (err) {
      setError(errorText(err instanceof Error ? err.message : 'NETWORK_ERROR'))
    } finally {
      setIssuing(false)
    }
  }

  async function copyPin() {
    if (!issued?.pin) return
    try {
      await navigator.clipboard.writeText(issued.pin)
      setCopied(true)
    } catch {
      setError('复制失败，请手动选中 PIN。Reference: COPY_FAILED')
    }
  }

  const canIssue = Boolean(status)
    && status?.tenant.status === 'ACTIVE'
    && status?.store.status === 'ACTIVE'
    && status?.subscription.accessState === 'ALLOWED'
    && !issuing

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <Link href="/ops" style={s.backLink}>返回运营后台</Link>
          <h1 style={s.title}>设备激活 PIN 发放</h1>
          <div style={s.subtitle}>Internal Activation PIN Issuance Console</div>
        </div>
        <div style={s.guardBadge}>OPS_ADMIN</div>
      </header>

      <main style={s.main}>
        <section style={s.panel}>
          <form onSubmit={lookupStore} style={s.searchRow}>
            <div style={s.inputWrap}>
              <label style={s.label} htmlFor="store-code">门店码</label>
              <input
                id="store-code"
                value={storeCode}
                onChange={(event) => updateStoreCode(event.target.value)}
                placeholder="ST169E7000"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                style={s.input}
              />
            </div>
            <button type="submit" style={s.primaryBtn} disabled={loading}>
              {loading ? '查询中' : '查询门店'}
            </button>
          </form>

          {error && <div style={s.errorBox}>{error}</div>}
        </section>

        {status && (
          <section style={s.panel}>
            <div style={s.sectionHeader}>
              <div>
                <div style={s.kicker}>目标门店</div>
                <h2 style={s.sectionTitle}>{status.store.name}</h2>
              </div>
              <span style={s.codeBadge}>{status.store.code}</span>
            </div>

            <div style={s.infoGrid}>
              <Info label="商户" value={status.tenant.name} />
              <Info label="商户状态" value={status.tenant.status} tone={status.tenant.status === 'ACTIVE' ? 'ok' : 'bad'} />
              <Info label="门店状态" value={status.store.status} tone={status.store.status === 'ACTIVE' ? 'ok' : 'bad'} />
              <Info
                label="订阅状态"
                value={status.subscription.status}
                tone={subscriptionKind(status.subscription.status, status.subscription.accessState)}
              />
            </div>

            <div style={s.pinState}>
              <div>
                <div style={s.kicker}>当前有效 PIN</div>
                <div style={s.pinStateText}>
                  {status.activePin?.hasValidPin ? '存在' : '不存在'}
                </div>
              </div>
              {status.activePin ? (
                <div style={s.pinMeta}>
                  过期时间 {formatDateTime(status.activePin.expiresAt)}
                  {status.activePin.lockedUntil ? ` · 锁定至 ${formatDateTime(status.activePin.lockedUntil)}` : ''}
                </div>
              ) : (
                <div style={s.pinMeta}>生成后有效 {status.pinTtlHours} 小时</div>
              )}
            </div>

            <div style={s.warningBox}>生成新的激活 PIN 会使旧 PIN 立即失效。PIN 只在生成成功后显示一次。</div>

            {showReplaceConfirm && status.activePin?.hasValidPin && (
              <div style={s.confirmBox}>
                <div style={s.confirmTitle}>确认生成新的激活 PIN？</div>
                <div style={s.confirmText}>当前门店已有有效 PIN。继续后，旧 PIN 将立即失效。</div>
                <div style={s.confirmActions}>
                  <button
                    type="button"
                    style={s.cancelConfirmBtn}
                    disabled={issuing}
                    onClick={() => setShowReplaceConfirm(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    style={{ ...s.confirmBtn, opacity: issuing ? 0.65 : 1 }}
                    disabled={issuing}
                    onClick={issuePin}
                  >
                    {issuing ? '生成中' : '确认生成'}
                  </button>
                </div>
              </div>
            )}

            <button type="button" style={{ ...s.issueBtn, opacity: canIssue ? 1 : 0.55 }} disabled={!canIssue} onClick={requestIssuePin}>
              {issuing ? '生成中' : '生成新的激活 PIN'}
            </button>
          </section>
        )}

        {issued && (
          <section style={s.resultPanel}>
            <div style={s.successText}>新的设备激活 PIN 已生成。旧 PIN 已失效。</div>
            <div style={s.pinDisplay} aria-label="activation pin">{issued.pin}</div>
            <div style={s.resultGrid}>
              <Info label="门店码" value={issued.store.code} />
              <Info label="过期时间" value={formatDateTime(issued.expiresAt)} />
              <Info label="有效期" value={`${issued.pinTtlHours} 小时`} />
              <Info label="覆盖旧 PIN" value={issued.replacedActivePin ? '是' : '否'} tone={issued.replacedActivePin ? 'warn' : 'ok'} />
            </div>
            <button type="button" style={s.copyBtn} onClick={copyPin}>{copied ? '已复制' : '复制 PIN'}</button>
          </section>
        )}
      </main>
    </div>
  )
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return (
    <div style={s.infoItem}>
      <div style={s.infoLabel}>{label}</div>
      {tone ? (
        <span style={{ ...s.badge, ...badgeStyle(tone) }}>{value}</span>
      ) : (
        <div style={s.infoValue}>{value}</div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f6f7fb',
    paddingBottom: 40,
  },
  header: {
    background: '#171923',
    color: '#fff',
    padding: '18px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  backLink: {
    color: 'rgba(255,255,255,0.72)',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 700,
  },
  title: {
    margin: '10px 0 0',
    fontSize: 22,
    lineHeight: 1.2,
    letterSpacing: 0,
  },
  subtitle: {
    marginTop: 5,
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
  },
  guardBadge: {
    flexShrink: 0,
    height: 28,
    padding: '0 10px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.22)',
    color: '#dbeafe',
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 800,
  },
  main: {
    width: 'min(760px, calc(100vw - 24px))',
    margin: '14px auto 0',
    display: 'grid',
    gap: 12,
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
    boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
  },
  resultPanel: {
    background: '#f0fdf4',
    border: '1px solid #86efac',
    borderRadius: 8,
    padding: 14,
    boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
  },
  searchRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 118px',
    gap: 10,
    alignItems: 'end',
  },
  inputWrap: { minWidth: 0 },
  label: {
    display: 'block',
    fontSize: 12,
    color: '#64748b',
    fontWeight: 800,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    height: 40,
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '0 11px',
    fontSize: 15,
    fontWeight: 700,
    color: '#111827',
    outline: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  primaryBtn: {
    height: 40,
    border: 'none',
    borderRadius: 6,
    background: '#2563eb',
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  issueBtn: {
    width: '100%',
    height: 42,
    border: 'none',
    borderRadius: 6,
    background: '#111827',
    color: '#fff',
    fontSize: 14,
    fontWeight: 900,
    cursor: 'pointer',
  },
  copyBtn: {
    width: '100%',
    height: 40,
    border: '1px solid #16a34a',
    borderRadius: 6,
    background: '#fff',
    color: '#166534',
    fontSize: 14,
    fontWeight: 900,
    cursor: 'pointer',
  },
  errorBox: {
    marginTop: 12,
    padding: '10px 12px',
    borderRadius: 6,
    background: '#fee2e2',
    border: '1px solid #fca5a5',
    color: '#991b1b',
    fontSize: 13,
    fontWeight: 700,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  kicker: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 900,
  },
  sectionTitle: {
    margin: '3px 0 0',
    color: '#111827',
    fontSize: 18,
    lineHeight: 1.2,
    letterSpacing: 0,
  },
  codeBadge: {
    flexShrink: 0,
    padding: '5px 9px',
    borderRadius: 6,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    color: '#1d4ed8',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    fontWeight: 900,
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 8,
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  infoItem: {
    minWidth: 0,
    border: '1px solid #edf2f7',
    borderRadius: 6,
    padding: '9px 10px',
    background: '#fafafa',
  },
  infoLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 800,
    marginBottom: 5,
  },
  infoValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: 800,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  badge: {
    display: 'inline-flex',
    maxWidth: '100%',
    height: 22,
    alignItems: 'center',
    padding: '0 8px',
    borderRadius: 6,
    border: '1px solid',
    fontSize: 12,
    fontWeight: 900,
  },
  pinState: {
    marginTop: 12,
    padding: '11px 12px',
    borderRadius: 6,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pinStateText: {
    marginTop: 3,
    fontSize: 16,
    color: '#111827',
    fontWeight: 900,
  },
  pinMeta: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 700,
    textAlign: 'right',
  },
  warningBox: {
    margin: '12px 0',
    padding: '10px 12px',
    borderRadius: 6,
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    color: '#92400e',
    fontSize: 13,
    fontWeight: 800,
  },
  confirmBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    background: '#fff7ed',
    border: '1px solid #fed7aa',
  },
  confirmTitle: {
    color: '#9a3412',
    fontSize: 14,
    fontWeight: 900,
  },
  confirmText: {
    marginTop: 6,
    color: '#7c2d12',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.45,
  },
  confirmActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
  },
  cancelConfirmBtn: {
    height: 34,
    padding: '0 13px',
    borderRadius: 6,
    border: '1px solid #fdba74',
    background: '#fff',
    color: '#9a3412',
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer',
  },
  confirmBtn: {
    height: 34,
    padding: '0 13px',
    borderRadius: 6,
    border: 'none',
    background: '#c2410c',
    color: '#fff',
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer',
  },
  successText: {
    color: '#166534',
    fontSize: 14,
    fontWeight: 900,
    marginBottom: 10,
  },
  pinDisplay: {
    height: 72,
    borderRadius: 8,
    background: '#fff',
    border: '1px solid #86efac',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#052e16',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 36,
    fontWeight: 900,
    letterSpacing: 0,
    marginBottom: 12,
  },
}
