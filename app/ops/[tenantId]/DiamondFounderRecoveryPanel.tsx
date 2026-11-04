'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'

const STORE_ID = 'cmvulpn8r000106jvpo58kye4'
const STORE_CODE = 'ST883DC00C'
const DEVICE_ID = 'cmvyx1jes000208l14t5vf9ur'
const JOB_IDS = [
  'cmw0jlsme000v08kzgyiybcqg',
  'cmw0k7dgw001c08kz5xirfxzv',
  'cmw0kwwta001v08jv6q6rl2f4',
].sort()
const REASON = 'EXPIRED_UNEXECUTED_FRONT_RECOVERY'
const ID = /^[a-zA-Z0-9_-]{8,128}$/
const SHA256 = /^[a-f0-9]{64}$/
const REVIEW_WINDOW_MS = 30_000
const EXPIRE_WINDOW_MS = 5 * 60_000

type Capture = {
  captureId: string
  deviceId: string
  ownerEpoch: number
  releasedAt: string
  releasedBatchId: string
  jobs: { id: string; key: string; requestHash: string; updatedAt: string }[]
  capturedAt: string
  deviceObservedAt: string
  historyVerifiedFrom: string
  ledgerSha256: string
  outboxSha256: string
  verifiedNoLocalExecution: true
}
export type DiamondRecoveryReadout = {
  deviceId: string
  leasePresent: boolean | null
  jobs: {
    id: string
    status: string
    expiresAt: string | null
    claimAttempt: number | null
    attemptCount: number | null
    claimed: boolean | null
    executingAt: string | null
    completedAt: string | null
    resultStatus: string | null
    effectBoundary: string | null
    hasResultMetadata: boolean | null
    physicalCompletionKnown: boolean | null
  }[]
  review: {
    evidenceId: string | null
    requestId: string | null
    reviewedAt: string | null
    capturedAt: string | null
    stateVersion: number | null
    status: 'AVAILABLE' | 'CONSUMED' | 'EXPIRED' | 'UNKNOWN' | 'OTHER_REVIEWER'
    expireAuditId: string | null
    expireRequestId: string | null
  } | null
}
type PrintState = {
  controlPlane: {
    mode: string
    stateVersion: number
    ownerDeviceId: string | null
    ownerEpoch: number
    leaseExpiresAt: string | null
    handoffRequestedAt: string | null
    handoffQuarantineUntil: string | null
  }
  activeBatch: { id: string } | null
  v3Queue: { pending: number; claimed: number; executing: number; crossingUnknown: number }
}
type Props = {
  tenantId: string
  store: { id: string; code: string }
  state: PrintState
  recovery: DiamondRecoveryReadout
  disabled: boolean
  onUpdated: () => Promise<void>
}
type Grant = { evidenceId: string; requestId: string; capturedAtMs: number; stateVersion: number }

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function exactKeys(row: Record<string, unknown>, keys: string[]) {
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key))
}

function iso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

export function parseCapture(raw: string): Capture | null {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  const row = object(parsed)
  if (!row || !exactKeys(row, [
    'captureId', 'deviceId', 'ownerEpoch', 'releasedAt', 'releasedBatchId', 'jobs',
    'capturedAt', 'deviceObservedAt', 'historyVerifiedFrom', 'ledgerSha256',
    'outboxSha256', 'verifiedNoLocalExecution',
  ]) || typeof row.captureId !== 'string' || !ID.test(row.captureId)
    || row.deviceId !== DEVICE_ID || typeof row.releasedBatchId !== 'string' || !ID.test(row.releasedBatchId)
    || !Number.isSafeInteger(row.ownerEpoch) || typeof row.ownerEpoch !== 'number' || row.ownerEpoch < 1
    || !iso(row.releasedAt) || !iso(row.capturedAt) || !iso(row.deviceObservedAt)
    || !iso(row.historyVerifiedFrom) || typeof row.ledgerSha256 !== 'string'
    || !SHA256.test(row.ledgerSha256) || typeof row.outboxSha256 !== 'string'
    || !SHA256.test(row.outboxSha256) || row.verifiedNoLocalExecution !== true
    || !Array.isArray(row.jobs) || row.jobs.length !== JOB_IDS.length) return null
  const jobs = row.jobs.map(object)
  if (jobs.some(job => !job || !exactKeys(job, ['id', 'key', 'requestHash', 'updatedAt'])
    || typeof job.id !== 'string' || !ID.test(job.id)
    || typeof job.key !== 'string' || !/^network:[a-f0-9]{64}$/.test(job.key)
    || typeof job.requestHash !== 'string' || !SHA256.test(job.requestHash)
    || !iso(job.updatedAt))) return null
  if (jobs.map(job => job!.id).sort().join(',') !== JOB_IDS.join(',')) return null
  return row as Capture
}

export function stateAllowsReview(state: PrintState, recovery: DiamondRecoveryReadout) {
  return state.controlPlane.mode === 'BLOCKED_UNKNOWN'
    && !state.controlPlane.ownerDeviceId && !state.controlPlane.leaseExpiresAt
    && recovery.leasePresent === false
    && !state.activeBatch && !state.controlPlane.handoffQuarantineUntil
    && !!state.controlPlane.handoffRequestedAt
    && state.v3Queue.pending === JOB_IDS.length && state.v3Queue.claimed === 0
    && state.v3Queue.executing === 0 && state.v3Queue.crossingUnknown === 0
}

export function captureIsFresh(capture: Capture, state: PrintState, recovery: DiamondRecoveryReadout, now: number) {
  const captured = Date.parse(capture.capturedAt)
  return stateAllowsReview(state, recovery) && capture.ownerEpoch === state.controlPlane.ownerEpoch
    && capture.releasedAt === state.controlPlane.handoffRequestedAt
    && captured >= Date.parse(capture.releasedAt) && captured <= now
    && now - captured < REVIEW_WINDOW_MS
    && Math.abs(Date.parse(capture.deviceObservedAt) - captured) <= REVIEW_WINDOW_MS
}

export function recoveryActions(input: {
  state: PrintState; recovery: DiamondRecoveryReadout; clock: number
  capture: Capture | null; installationId: string; grant: Grant | null
  disabled: boolean; busy: boolean; blocked: boolean
}) {
  const { state, recovery, clock, capture, installationId, grant, disabled, busy, blocked } = input
  const evidenceReady = !!capture && ID.test(installationId) && captureIsFresh(capture, state, recovery, clock)
  const jobsAppearUnexecuted = recovery.jobs.every(job => job.status === 'PENDING'
    && job.expiresAt && Date.parse(job.expiresAt) <= clock
    && job.claimAttempt === 0 && job.attemptCount === 0 && job.claimed === false
    && job.executingAt === null && job.completedAt === null && job.resultStatus === null
    && job.hasResultMetadata === false && job.effectBoundary === null
    && job.physicalCompletionKnown === false)
  const auditedGrant = recovery.review?.status === 'AVAILABLE' && recovery.review.evidenceId
    && recovery.review.capturedAt && recovery.review.stateVersion === state.controlPlane.stateVersion
    ? { evidenceId: recovery.review.evidenceId, requestId: recovery.review.requestId ?? '',
      capturedAtMs: Date.parse(recovery.review.capturedAt), stateVersion: recovery.review.stateVersion }
    : null
  const activeGrant = recovery.review && recovery.review.status !== 'AVAILABLE'
    ? null : auditedGrant ?? grant
  return {
    evidenceReady, activeGrant,
    mayReview: !disabled && !busy && !blocked && !recovery.review && !activeGrant
      && jobsAppearUnexecuted && evidenceReady,
    mayExpire: !disabled && !busy && !blocked && !!activeGrant && jobsAppearUnexecuted
      && stateAllowsReview(state, recovery) && state.controlPlane.stateVersion === activeGrant?.stateVersion
      && clock - activeGrant.capturedAtMs < EXPIRE_WINDOW_MS - 5000,
  }
}

export default function DiamondFounderRecoveryPanel({ tenantId, store, state, recovery, disabled, onUpdated }: Props) {
  const [clock, setClock] = useState(Date.now())
  const [, setInputRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [grant, setGrant] = useState<Grant | null>(null)
  const [feedback, setFeedback] = useState('')
  const captureRef = useRef<HTMLTextAreaElement>(null)
  const installationRef = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const exactStore = store.id === STORE_ID && store.code === STORE_CODE
  const endpoint = `/api/ops/tenants/${encodeURIComponent(tenantId)}/stores/${encodeURIComponent(store.id)}/v3-print-control-plane`

  useEffect(() => {
    if (!exactStore) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [exactStore])

  useEffect(() => {
    const clearOnLeave = () => {
      if (captureRef.current) captureRef.current.value = ''
      if (installationRef.current) installationRef.current.value = ''
    }
    window.addEventListener('pagehide', clearOnLeave)
    return () => {
      window.removeEventListener('pagehide', clearOnLeave)
      clearOnLeave()
    }
  }, [])

  if (!exactStore || recovery.deviceId !== DEVICE_ID
    || recovery.jobs.length !== JOB_IDS.length
    || recovery.jobs.map(job => job.id).sort().join(',') !== JOB_IDS.join(',')) return null
  const capture = parseCapture(captureRef.current?.value ?? '')
  const installationId = installationRef.current?.value ?? ''
  const { evidenceReady, activeGrant, mayReview, mayExpire } = recoveryActions({
    state, recovery, clock, capture, installationId, grant, disabled, busy, blocked,
  })

  function clearEvidence() {
    if (captureRef.current) captureRef.current.value = ''
    if (installationRef.current) installationRef.current.value = ''
    setInputRevision(value => value + 1)
  }

  async function postOnce(body: Record<string, unknown>) {
    if (inFlight.current) return null
    inFlight.current = true
    setBusy(true)
    setFeedback('')
    try {
      const response = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) }, OWNER_CTX)
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.ok) {
        // Keep the exact server error. A failed one-time grant is never retried automatically.
        setFeedback(`操作拒绝：${result?.code ?? result?.error ?? 'UNKNOWN_RESPONSE'}；requestId ${body.requestId ?? '缺失'}`)
        setBlocked(true)
        return null
      }
      return result as { requestId: string; evidenceId: string; jobIds: string[] }
    } catch {
      setFeedback(`请求结果未知；requestId ${body.requestId ?? '缺失'}。请先核对服务端审计与任务状态，不得重复提交。`)
      setBlocked(true)
      return null
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function review() {
    const current = parseCapture(captureRef.current?.value ?? '')
    const installation = installationRef.current?.value ?? ''
    if (!current || !ID.test(installation) || !captureIsFresh(current, state, recovery, Date.now())
      || !mayReview || inFlight.current) return
    if (!window.confirm(`Diamond Founder REVIEW：仅审核以下三笔 FRONT 任务的本地未执行证据，不终结任务。\n${JOB_IDS.join('\n')}\n\n确认已独立核对真实 Windows ledger/outbox、Installation Identity 和历史覆盖区间？`)) return
    if (!captureIsFresh(current, state, recovery, Date.now())) {
      setFeedback('本地证据在确认期间过期；请重新采集。')
      return
    }
    const requestId = crypto.randomUUID()
    const result = await postOnce({
      action: 'FOUNDER_REVIEW_DIAMOND_EXPIRED_FRONT', confirmed: true, requestId,
      expectedStateVersion: state.controlPlane.stateVersion, jobIds: JOB_IDS,
      reason: REASON, capture: current, installationId: installation,
    })
    clearEvidence()
    if (!result) return
    setGrant({
      evidenceId: result.evidenceId, requestId: result.requestId,
      capturedAtMs: Date.parse(current.capturedAt), stateVersion: state.controlPlane.stateVersion,
    })
    setFeedback(`REVIEW 成功，审计 evidenceId：${result.evidenceId}。EXPIRE 仍需单独确认。`)
    await onUpdated()
  }

  async function expire() {
    if (!mayExpire || !activeGrant || inFlight.current) return
    if (!window.confirm(`Diamond Founder EXPIRE：将以下三笔过期且未执行的 FRONT 任务终结为 EXPIRED / NOT_CROSSED。\n${JOB_IDS.join('\n')}\n\n此操作不会删除订单或付款。服务端将重新核验全部安全条件。确认执行？`)) return
    if (Date.now() - activeGrant.capturedAtMs >= EXPIRE_WINDOW_MS - 5000) {
      setFeedback('EXPIRE 时效窗口已关闭；操作未提交。')
      return
    }
    const result = await postOnce({
      action: 'FOUNDER_EXPIRE_DIAMOND_UNEXECUTED_FRONT', confirmed: true,
      requestId: crypto.randomUUID(), expectedStateVersion: activeGrant.stateVersion,
      jobIds: JOB_IDS, reason: REASON, evidenceId: activeGrant.evidenceId,
    })
    if (!result) return
    setGrant(null)
    setFeedback(`EXPIRE 成功，审计 requestId：${result.requestId}。请刷新核验三笔最终状态后，另行使用既有 FINALIZE_V3_ACTIVE 控件。`)
    await onUpdated()
  }

  return (
    <section aria-label="Diamond Founder V3 恢复" style={{ marginTop: 12, padding: 12, border: '1px solid rgba(251,191,36,0.5)', borderRadius: 8, color: '#fde68a', fontSize: 11 }}>
      <strong>Diamond 专属 Founder FRONT 恢复</strong>
      <p>目标 Device：{DEVICE_ID}。当前 V3：{state.controlPlane.mode}；stateVersion：{state.controlPlane.stateVersion}；
        V3 队列：PENDING {state.v3Queue.pending} / CLAIMED {state.v3Queue.claimed} / EXECUTING {state.v3Queue.executing} / UNKNOWN {state.v3Queue.crossingUnknown}。</p>
      <p>精确任务集合（只读快照；记录的 TTL 与执行事实会在服务端事务中重新核验）：</p>
      <ul>{recovery.jobs.map(job => <li key={job.id}>
        <code>{job.id}</code> · {job.status} · TTL {job.expiresAt ?? '缺失'} ·
        claim {job.claimAttempt ?? '?'} / claimed {String(job.claimed)} · execution {job.attemptCount ?? '?'} ·
        boundary {job.effectBoundary ?? '未记录'} / physicalKnown {String(job.physicalCompletionKnown)} ·
        result {job.resultStatus ?? '未记录'}
      </li>)}</ul>
      <p>审核审计：{recovery.review?.status === 'OTHER_REVIEWER'
        ? '另一名 SUPER_ADMIN 已使用本门店的一次性 Founder REVIEW；本身份不能再次审核或执行 EXPIRE。'
        : recovery.review
        ? `${recovery.review.status} · evidenceId ${recovery.review.evidenceId} · REVIEW ${recovery.review.reviewedAt}`
        : '尚无本身份可用的 Founder REVIEW 记录'}。
        {recovery.review?.expireAuditId ? ` EXPIRE auditId ${recovery.review.expireAuditId}` : ''}
      </p>
      <p>请粘贴刚从 Diamond Windows 正式只读采集的 capture JSON，并输入 Installation ID。内容只在本页内存和输入框中短暂存在；不写入浏览器持久存储。页面校验不能替代服务端核验。</p>
      <textarea ref={captureRef} aria-label="新鲜 Windows capture JSON" autoComplete="off" spellCheck={false}
        onInput={() => setInputRevision(value => value + 1)} rows={4}
        style={{ width: '100%', background: '#111827', color: '#fff', border: '1px solid #6b7280' }} />
      <input ref={installationRef} aria-label="Installation ID" type="password" autoComplete="new-password"
        data-1p-ignore="true" data-lpignore="true"
        onInput={() => setInputRevision(value => value + 1)}
        style={{ display: 'block', width: '100%', marginTop: 6, background: '#111827', color: '#fff', border: '1px solid #6b7280' }} />
      <p aria-live="polite">证据状态：{evidenceReady ? '结构、范围及 30 秒时效预检通过；等待服务端核验' : '缺少新鲜且匹配的本地证据，REVIEW 不可用'}。
        {activeGrant ? ` 已审核；EXPIRE 窗口剩余约 ${Math.max(0, Math.floor((EXPIRE_WINDOW_MS - (clock - activeGrant.capturedAtMs)) / 1000))} 秒。` : ''}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!mayReview} onClick={review}>Founder REVIEW</button>
        <button type="button" disabled={!mayExpire} onClick={expire}>Founder EXPIRE</button>
      </div>
      {feedback && <p role="status" style={{ whiteSpace: 'pre-wrap' }}>{feedback}</p>}
      {blocked && <p>已停止本页后续提交。请刷新只读状态，核对服务端审计；本页不会自动重试。</p>}
    </section>
  )
}
