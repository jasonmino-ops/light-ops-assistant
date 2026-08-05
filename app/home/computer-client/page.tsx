'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type PendingRequest = {
  requestId: string
  computerName: string
  agentVersion: string | null
  osVersion: string | null
  status: string
  requestedAt: string
}

type ManagedComputer = {
  computerId: string
  computerName: string
  agentVersion: string | null
  boundAt: string | null
  disabledAt: string | null
  status: 'ACTIVE' | 'DISABLED'
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function ComputerClientPage() {
  const router = useRouter()
  const { t } = useLocale()
  const { effectiveRole } = useWorkMode()

  const [requests, setRequests] = useState<PendingRequest[]>([])
  const [boundComputers, setBoundComputers] = useState<ManagedComputer[]>([])
  const [disabledComputers, setDisabledComputers] = useState<ManagedComputer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const res = await apiFetch('/api/computer-client/requests', { cache: 'no-store' })
      if (!res.ok) throw new Error('LOAD_FAILED')
      const data = await res.json()
      setRequests(Array.isArray(data.requests) ? data.requests : [])
      setBoundComputers(Array.isArray(data.boundComputers) ? data.boundComputers : [])
      setDisabledComputers(Array.isArray(data.disabledComputers) ? data.disabledComputers : [])
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (effectiveRole !== 'OWNER') router.replace('/home')
  }, [effectiveRole, router])

  useEffect(() => {
    if (effectiveRole === 'OWNER') void load()
  }, [effectiveRole, load])

  const decide = useCallback(
    async (requestId: string, action: 'approve' | 'reject') => {
      if (action === 'reject' && !window.confirm(t('home.computerClientConfirmReject'))) return
      setBusyId(requestId)
      setNotice(null)
      try {
        const res = await apiFetch(`/api/computer-client/requests/${requestId}/${action}`, {
          method: 'POST',
        })
        if (res.ok) {
          setRequests((list) => list.filter((item) => item.requestId !== requestId))
          setNotice({
            kind: 'ok',
            text: t(
              action === 'approve' ? 'home.computerClientApproved' : 'home.computerClientRejected',
            ),
          })
          return
        }
        // 状态已被其它端改变（超时、已处理）→ 刷新列表，避免界面与云端不一致
        if (res.status === 409 || res.status === 404) {
          setNotice({ kind: 'err', text: t('home.computerClientStateChanged') })
          void load()
          return
        }
        setNotice({ kind: 'err', text: t('home.computerClientActionFailed') })
      } catch {
        setNotice({ kind: 'err', text: t('home.computerClientActionFailed') })
      } finally {
        setBusyId(null)
      }
    },
    [load, t],
  )

  const disableComputer = useCallback(
    async (computerId: string) => {
      if (!window.confirm(t('home.computerClientConfirmDisable'))) return
      setBusyId(computerId)
      setNotice(null)
      try {
        const res = await apiFetch(
          `/api/computer-client/computers/${computerId}/disable`,
          { method: 'POST' },
        )
        if (!res.ok) {
          setNotice({ kind: 'err', text: t('home.computerClientDisableFailed') })
          if (res.status === 404 || res.status === 409) void load()
          return
        }
        setNotice({ kind: 'ok', text: t('home.computerClientDisabled') })
        await load()
      } catch {
        setNotice({ kind: 'err', text: t('home.computerClientDisableFailed') })
      } finally {
        setBusyId(null)
      }
    },
    [load, t],
  )

  if (effectiveRole !== 'OWNER') return null

  return (
    <main style={s.page}>
      <div style={s.content}>
        <Link href="/home" style={s.backLink}>
          ← {t('common.back')}
        </Link>

        <section style={s.intro} aria-labelledby="computer-client-management-title">
          <div style={s.introHeading}>
            <div style={s.icon} aria-hidden="true">🖥️</div>
            <div>
              <h1 id="computer-client-management-title" style={s.title}>
                {t('home.computerClientManagementTitle')}
              </h1>
              <p style={s.description}>{t('home.computerClientManagementDesc')}</p>
            </div>
          </div>
        </section>

        <section style={s.pendingSection} aria-labelledby="pending-computers-title">
          <div style={s.sectionHeading}>
            <span style={s.sectionIcon} aria-hidden="true">⌛</span>
            <h2 id="pending-computers-title" style={s.sectionTitle}>
              {t('home.computerClientPendingTitle')}
            </h2>
          </div>

          <div
            style={s.requestStateRegion}
            data-computer-request-region="loading-error-list"
            aria-live="polite"
          >
            {notice && (
              <div style={notice.kind === 'ok' ? s.noticeOk : s.noticeErr}>{notice.text}</div>
            )}

            {loading ? (
              <div style={s.emptyState}>
                <div style={s.emptyIcon} aria-hidden="true">⏳</div>
                <h3 style={s.emptyTitle}>{t('home.computerClientLoading')}</h3>
              </div>
            ) : loadFailed ? (
              <div style={s.emptyState}>
                <div style={s.emptyIcon} aria-hidden="true">⚠️</div>
                <h3 style={s.emptyTitle}>{t('home.computerClientLoadFailed')}</h3>
                <button type="button" style={s.retryBtn} onClick={() => void load()}>
                  {t('home.computerClientRetry')}
                </button>
              </div>
            ) : requests.length === 0 ? (
              <div style={s.emptyState}>
                <div style={s.emptyIcon} aria-hidden="true">🖥️</div>
                <h3 style={s.emptyTitle}>{t('home.computerClientEmptyTitle')}</h3>
                <p style={s.emptyDescription}>{t('home.computerClientEmptyDesc')}</p>
              </div>
            ) : (
              <div style={s.cardList}>
                {requests.map((item) => (
                  <div key={item.requestId} style={s.card}>
                    <div style={s.cardName}>{item.computerName}</div>
                    <dl style={s.metaList}>
                      <div style={s.metaRow}>
                        <dt style={s.metaKey}>{t('home.computerClientRequestedAt')}</dt>
                        <dd style={s.metaValue}>{formatTime(item.requestedAt)}</dd>
                      </div>
                      {item.osVersion && (
                        <div style={s.metaRow}>
                          <dt style={s.metaKey}>{t('home.computerClientSystem')}</dt>
                          <dd style={s.metaValue}>{item.osVersion}</dd>
                        </div>
                      )}
                      {item.agentVersion && (
                        <div style={s.metaRow}>
                          <dt style={s.metaKey}>{t('home.computerClientAgentVersion')}</dt>
                          <dd style={s.metaValue}>{item.agentVersion}</dd>
                        </div>
                      )}
                    </dl>
                    <div style={s.actionRow}>
                      <button
                        type="button"
                        style={busyId === item.requestId ? s.approveBtnBusy : s.approveBtn}
                        disabled={busyId !== null}
                        onClick={() => void decide(item.requestId, 'approve')}
                      >
                        {busyId === item.requestId
                          ? t('home.computerClientApproving')
                          : t('home.computerClientApprove')}
                      </button>
                      <button
                        type="button"
                        style={s.rejectBtn}
                        disabled={busyId !== null}
                        onClick={() => void decide(item.requestId, 'reject')}
                      >
                        {t('home.computerClientReject')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section style={s.pendingSection} aria-labelledby="bound-computers-title">
          <div style={s.sectionHeading}>
            <span style={s.sectionIconActive} aria-hidden="true">✓</span>
            <h2 id="bound-computers-title" style={s.sectionTitle}>
              {t('home.computerClientBoundTitle')}
            </h2>
          </div>
          {loading ? (
            <div style={s.compactEmpty}>{t('home.computerClientLoading')}</div>
          ) : loadFailed ? (
            <div style={s.compactEmpty}>{t('home.computerClientLoadFailed')}</div>
          ) : boundComputers.length === 0 ? (
            <div style={s.compactEmpty}>{t('home.computerClientBoundEmpty')}</div>
          ) : (
            <div style={s.cardList}>
              {boundComputers.map((item) => (
                <div key={item.computerId} style={s.card}>
                  <div style={s.cardHeader}>
                    <div style={s.cardName}>{item.computerName}</div>
                    <span style={s.statusActive}>{t('home.computerClientStatusActive')}</span>
                  </div>
                  <dl style={s.metaList}>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientComputerId')}</dt>
                      <dd style={s.metaValue}>{item.computerId}</dd>
                    </div>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientAgentVersion')}</dt>
                      <dd style={s.metaValue}>{item.agentVersion || '—'}</dd>
                    </div>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientBoundAt')}</dt>
                      <dd style={s.metaValue}>{formatTime(item.boundAt)}</dd>
                    </div>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientCurrentStatus')}</dt>
                      <dd style={s.metaValue}>{t('home.computerClientStatusActive')}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    style={s.disableBtn}
                    disabled={busyId !== null}
                    onClick={() => void disableComputer(item.computerId)}
                  >
                    {busyId === item.computerId
                      ? t('home.computerClientDisabling')
                      : t('home.computerClientDisable')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={s.pendingSection} aria-labelledby="disabled-computers-title">
          <div style={s.sectionHeading}>
            <span style={s.sectionIconDisabled} aria-hidden="true">⛔</span>
            <h2 id="disabled-computers-title" style={s.sectionTitle}>
              {t('home.computerClientDisabledTitle')}
            </h2>
          </div>
          {loading ? (
            <div style={s.compactEmpty}>{t('home.computerClientLoading')}</div>
          ) : loadFailed ? (
            <div style={s.compactEmpty}>{t('home.computerClientLoadFailed')}</div>
          ) : disabledComputers.length === 0 ? (
            <div style={s.compactEmpty}>{t('home.computerClientDisabledEmpty')}</div>
          ) : (
            <div style={s.cardList}>
              {disabledComputers.map((item) => (
                <div key={item.computerId} style={s.cardDisabled}>
                  <div style={s.cardHeader}>
                    <div style={s.cardName}>{item.computerName}</div>
                    <span style={s.statusDisabled}>
                      {t('home.computerClientStatusDisabled')}
                    </span>
                  </div>
                  <dl style={s.metaList}>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientComputerId')}</dt>
                      <dd style={s.metaValue}>{item.computerId}</dd>
                    </div>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientAgentVersion')}</dt>
                      <dd style={s.metaValue}>{item.agentVersion || '—'}</dd>
                    </div>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientBoundAt')}</dt>
                      <dd style={s.metaValue}>{formatTime(item.boundAt)}</dd>
                    </div>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientDisabledAt')}</dt>
                      <dd style={s.metaValue}>{formatTime(item.disabledAt)}</dd>
                    </div>
                    <div style={s.metaRow}>
                      <dt style={s.metaKey}>{t('home.computerClientCurrentStatus')}</dt>
                      <dd style={s.metaValue}>{t('home.computerClientStatusDisabled')}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: 'calc(100vh - 64px)',
    padding: '18px 16px calc(36px + env(safe-area-inset-bottom))',
    background: 'var(--bg)',
  },
  content: {
    width: '100%',
    maxWidth: 560,
    margin: '0 auto',
    boxSizing: 'border-box',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 36,
    marginBottom: 12,
    color: 'var(--blue)',
    fontSize: 13,
    fontWeight: 800,
    textDecoration: 'none',
  },
  intro: {
    padding: '20px 18px',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    background: 'var(--card)',
    boxShadow: '0 10px 28px rgba(15,23,42,0.06)',
  },
  introHeading: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 13,
  },
  icon: {
    width: 48,
    height: 48,
    display: 'grid',
    placeItems: 'center',
    flex: '0 0 auto',
    borderRadius: 15,
    background: '#f5f3ff',
    fontSize: 23,
  },
  title: {
    margin: 0,
    color: 'var(--text)',
    fontSize: 21,
    fontWeight: 900,
    lineHeight: 1.3,
  },
  description: {
    margin: '7px 0 0',
    color: 'var(--muted)',
    fontSize: 14,
    lineHeight: 1.65,
  },
  pendingSection: {
    marginTop: 14,
    padding: '18px 16px 16px',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    background: 'var(--card)',
    boxShadow: '0 10px 28px rgba(15,23,42,0.05)',
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    marginBottom: 14,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 10,
    background: '#fff7ed',
    fontSize: 16,
  },
  sectionIconActive: {
    width: 32,
    height: 32,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 10,
    background: '#dcfce7',
    color: '#15803d',
    fontSize: 16,
    fontWeight: 900,
  },
  sectionIconDisabled: {
    width: 32,
    height: 32,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 10,
    background: '#fee2e2',
    fontSize: 16,
  },
  sectionTitle: {
    margin: 0,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1.35,
  },
  requestStateRegion: {
    minHeight: 220,
  },
  emptyState: {
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '26px 18px',
    border: '1px dashed #cbd5e1',
    borderRadius: 16,
    background: '#f8fafc',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  emptyIcon: {
    width: 52,
    height: 52,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 16,
    background: '#eef2ff',
    fontSize: 24,
    opacity: 0.78,
  },
  emptyTitle: {
    margin: '14px 0 0',
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1.4,
  },
  emptyDescription: {
    maxWidth: 390,
    margin: '9px 0 0',
    padding: '11px 12px',
    border: '1px solid #ddd6fe',
    borderRadius: 12,
    background: '#f5f3ff',
    color: '#6d28d9',
    fontSize: 12.5,
    fontWeight: 700,
    lineHeight: 1.65,
  },
  noticeOk: {
    marginBottom: 12,
    padding: '10px 12px',
    border: '1px solid #bbf7d0',
    borderRadius: 12,
    background: '#f0fdf4',
    color: '#15803d',
    fontSize: 12.5,
    fontWeight: 800,
    lineHeight: 1.6,
  },
  noticeErr: {
    marginBottom: 12,
    padding: '10px 12px',
    border: '1px solid #fecaca',
    borderRadius: 12,
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: 12.5,
    fontWeight: 800,
    lineHeight: 1.6,
  },
  retryBtn: {
    marginTop: 14,
    minHeight: 40,
    padding: '0 20px',
    border: '1px solid #cbd5e1',
    borderRadius: 12,
    background: 'var(--card)',
    color: 'var(--text)',
    fontSize: 13.5,
    fontWeight: 800,
    cursor: 'pointer',
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  card: {
    padding: '14px 14px 13px',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    background: '#f8fafc',
  },
  cardDisabled: {
    padding: '14px 14px 13px',
    border: '1px solid #fecaca',
    borderRadius: 16,
    background: '#fff7f7',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardName: {
    color: 'var(--text)',
    fontSize: 15.5,
    fontWeight: 900,
    lineHeight: 1.35,
    wordBreak: 'break-word',
  },
  metaList: {
    margin: '10px 0 0',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    padding: '5px 0',
  },
  metaKey: {
    margin: 0,
    color: 'var(--muted)',
    fontSize: 12.5,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  metaValue: {
    margin: 0,
    color: 'var(--text)',
    fontSize: 12.5,
    fontWeight: 800,
    textAlign: 'right',
    wordBreak: 'break-word',
  },
  actionRow: {
    display: 'flex',
    gap: 10,
    marginTop: 13,
  },
  compactEmpty: {
    padding: '22px 16px',
    border: '1px dashed #cbd5e1',
    borderRadius: 14,
    background: '#f8fafc',
    color: 'var(--muted)',
    fontSize: 13,
    fontWeight: 700,
    textAlign: 'center',
  },
  statusActive: {
    flex: '0 0 auto',
    padding: '4px 8px',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#15803d',
    fontSize: 11,
    fontWeight: 900,
  },
  statusDisabled: {
    flex: '0 0 auto',
    padding: '4px 8px',
    borderRadius: 999,
    background: '#fee2e2',
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: 900,
  },
  disableBtn: {
    width: '100%',
    minHeight: 42,
    marginTop: 13,
    border: '1px solid #fecaca',
    borderRadius: 12,
    background: 'var(--card)',
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: 900,
    cursor: 'pointer',
  },
  approveBtn: {
    flex: 1,
    minHeight: 44,
    border: 'none',
    borderRadius: 12,
    background: 'var(--blue)',
    color: '#fff',
    fontSize: 14.5,
    fontWeight: 900,
    cursor: 'pointer',
  },
  approveBtnBusy: {
    flex: 1,
    minHeight: 44,
    border: 'none',
    borderRadius: 12,
    background: '#94a3b8',
    color: '#fff',
    fontSize: 14.5,
    fontWeight: 900,
    cursor: 'default',
  },
  rejectBtn: {
    minHeight: 44,
    padding: '0 18px',
    border: '1px solid #fecaca',
    borderRadius: 12,
    background: 'var(--card)',
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
}
