'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { describeFounderRecovery } from './localFirstPresentation'

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
  disabledReason?: string
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

export default function DiamondFounderRecoveryPanel({ tenantId, store, state, recovery, disabled, disabledReason, onUpdated }: Props) {
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
  const presentation = describeFounderRecovery({
    state, recovery, clock, capture, activeGrant, mayReview, mayExpire, evidenceReady,
    capturePresent: !!captureRef.current?.value.trim(), installationValid: ID.test(installationId),
    disabled, busy, blocked, stateReviewable: stateAllowsReview(state, recovery), parentReason: disabledReason,
  })
  const reasonPrefix = `diamond-recovery-${store.id}`

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
    <details open={!presentation.recovered} aria-label="Diamond Founder V3 恢复"
      style={{ marginTop: 12, padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#334155', fontSize: 14, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
      <summary style={{ cursor: 'pointer', minHeight: 44, fontWeight: 700 }}>Diamond 专属 Founder FRONT 恢复{presentation.recovered ? ' · 查看已读取到的记录' : ' · 需要核对'}</summary>
      <p role="status">{presentation.status}</p>
      <p style={{ padding: 10, background: '#fffbeb', color: '#854d0e', borderRadius: 6 }}>
        一次性风险：Founder REVIEW 成功后即占用本门店的一次性审核授权。即使后续 EXPIRE 失败或过期，也不能通过刷新、重新采集或修改时间再次授权；需另行授权恢复。
        REVIEW 只登记审核，不终结任务；EXPIRE 与 FINALIZE 必须分别确认。
      </p>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', minHeight: 32 }}>步骤 1 · 核对固定范围与审计详情</summary>
        <p>目标 Device：{DEVICE_ID}。当前 V3：{state.controlPlane.mode}；stateVersion：{state.controlPlane.stateVersion}；
          V3 队列：PENDING {state.v3Queue.pending} / CLAIMED {state.v3Queue.claimed} / EXECUTING {state.v3Queue.executing} / UNKNOWN {state.v3Queue.crossingUnknown}。</p>
        <p>精确任务集合（只读快照；记录的 TTL 与执行事实会在服务端事务中重新核验）：</p>
        <ul style={{ paddingLeft: 18 }}>{recovery.jobs.map(job => <li key={job.id}>
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
      </details>
      <h4 style={{ fontSize: 14, marginTop: 12 }}>步骤 2 · 准备现场证据并审核</h4>
      <p>仅由授权人员操作：请粘贴刚从 Diamond Windows 正式只读采集的 capture JSON，并输入 Installation ID。
        安装身份必须来自目标电脑，不自动填充。内容只在本页内存和输入框中短暂存在；不写入浏览器持久存储。页面校验不能替代服务端核验。</p>
      <label htmlFor={`${reasonPrefix}-capture`}>Windows 本地采集证据（JSON）</label>
      <textarea id={`${reasonPrefix}-capture`} ref={captureRef} aria-label="Windows 本地采集证据（JSON）" autoComplete="off" spellCheck={false}
        aria-describedby={`${reasonPrefix}-review-reason`}
        onInput={() => setInputRevision(value => value + 1)} rows={4}
        style={{ width: '100%', padding: 8, fontSize: 16, background: '#fff', color: '#0f172a', border: '1px solid #64748b', borderRadius: 6 }} />
      <label htmlFor={`${reasonPrefix}-installation`}>目标电脑 Installation ID（安装身份）</label>
      <input id={`${reasonPrefix}-installation`} ref={installationRef} aria-label="目标电脑 Installation ID（安装身份）" type="password" autoComplete="new-password"
        data-1p-ignore="true" data-lpignore="true"
        aria-describedby={`${reasonPrefix}-review-reason`}
        onInput={() => setInputRevision(value => value + 1)}
        style={{ display: 'block', width: '100%', minHeight: 44, padding: 8, marginTop: 6, fontSize: 16, background: '#fff', color: '#0f172a', border: '1px solid #64748b', borderRadius: 6 }} />
      <p>REVIEW：证据采集后 30 秒内提交；确认对话框期间也会重新检查，页面不会延长有效期。</p>
      {presentation.reviewWindow && <p role="timer" aria-live="off">本地采集时间：{capture?.capturedAt}（尚待服务端核验）。
        REVIEW 剩余 {presentation.reviewWindow.seconds} 秒；截止 {new Date(presentation.reviewWindow.deadline).toLocaleString('zh-CN')}。
        {presentation.reviewWindow.closed ? '证据已过期；尚未审核成功时可重新采集。' : ''}</p>}
      <p aria-live="polite">证据状态：{evidenceReady ? '结构、范围及 30 秒时效预检通过；等待服务端核验' : '缺少新鲜且匹配的本地证据，REVIEW 不可用'}。</p>
      <button type="button" disabled={!mayReview} onClick={review} aria-describedby={`${reasonPrefix}-review-reason`}
        style={{ minHeight: 44, padding: '8px 12px', border: '1px solid #1e40af', borderRadius: 6, background: '#eff6ff', color: '#1e40af', fontSize: 14 }}>Founder REVIEW</button>
      <p id={`${reasonPrefix}-review-reason`}>{presentation.reviewReason || '预检允许提交；服务端将重新验证全部条件。'}</p>
      <h4 style={{ fontSize: 14, marginTop: 12 }}>步骤 3 · 单独确认终结三笔过期未执行任务</h4>
      <p>EXPIRE：5 分钟从原始证据采集时间计算，不从 REVIEW 成功时间重新计时。前端提前 5 秒关闭提交，服务端仍独立核验时效。</p>
      {presentation.expireSubmitWindow && <p role="timer" aria-live="off">EXPIRE 实际可提交时间剩余 {presentation.expireSubmitWindow.seconds} 秒；
        {presentation.expireSubmitWindow.closed ? '提交窗口已关闭。' : ''}
        前端提交截止（采集后 295 秒）：{new Date(presentation.expireSubmitWindow.deadline).toLocaleString('zh-CN')}。</p>}
      {presentation.expireWindow && <p>服务端证据有效期截止（采集后 5 分钟）：{new Date(presentation.expireWindow.deadline).toLocaleString('zh-CN')}；此时限不是按钮可提交截止时间。</p>}
      <button type="button" disabled={!mayExpire} onClick={expire} aria-describedby={`${reasonPrefix}-expire-reason`}
        style={{ minHeight: 44, padding: '8px 12px', border: '1px solid #991b1b', borderRadius: 6, background: '#fef2f2', color: '#991b1b', fontSize: 14 }}>Founder EXPIRE</button>
      <p id={`${reasonPrefix}-expire-reason`}>{presentation.expireReason || '审核证据可用；终结操作仍需单独确认。'}</p>
      <h4 style={{ fontSize: 14, marginTop: 12 }}>步骤 4 · 刷新核验后，另行确认最终模式</h4>
      <p>先核对三笔任务的最终状态和 EXPIRE 审计，再使用上方既有 FINALIZE_V3_ACTIVE 控件确认启用 Local First。
        终结任务不等于恢复打印；云端模式确认后仍需现场验证。</p>
      {feedback && <p role="status" style={{ marginTop: 10, padding: 10, background: '#f1f5f9', color: '#334155', borderRadius: 6, whiteSpace: 'pre-wrap' }}>{feedback}</p>}
      {blocked && <p style={{ color: '#991b1b' }}>已停止本页后续提交。请求可能已到达服务端；请先查询服务端审计与任务状态。本页不会自动重试，也不要直接重新提交。</p>}
    </details>
  )
}
