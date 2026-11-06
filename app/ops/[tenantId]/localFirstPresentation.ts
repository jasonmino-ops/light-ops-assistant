/** Presentation only. These descriptions never grant authority or enable an action. */
import type { DiamondRecoveryReadout } from './DiamondFounderRecoveryPanel'

export const LOCAL_FIRST_TONES = {
  neutral: { color: '#334155', bg: '#f1f5f9', border: '#cbd5e1' },
  info: { color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' },
  warning: { color: '#854d0e', bg: '#fffbeb', border: '#fde68a' },
  error: { color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
  success: { color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
} as const

type Queue = { pending: number; claimed: number; executing: number; crossingUnknown: number }
type Plane = {
  mode: string; stateVersion: number; ownerDeviceId: string | null; ownerEpoch: number
  leaseExpiresAt: string | null; handoffRequestedAt: string | null; handoffQuarantineUntil: string | null
}
type ModeState = {
  controlPlane: Plane
  ownerDevice: { status: string } | null
  activeBatch: { ownerDeviceId: string; ownerEpoch: number; expiresAt: string } | null
  v2Queue: Queue; v3Queue: Queue
  blocking: { ownerActive: boolean; activeExecutionBatch: boolean; handoffOrReconciliation: boolean;
    v2Drain: boolean; v2DrainWindowActive: boolean; v2ExecutionAmbiguous: boolean; v3Drain: boolean }
  actions: { startActivation: boolean; startDeactivation: boolean; enterManualReview: boolean;
    finalizeV3Active: boolean; finalizeV2Active: boolean }
}

export function describePrintMode(state: ModeState, now: number) {
  const { controlPlane: plane, blocking: b, actions: a } = state
  const mode = plane.mode
  const waitingForConfirmation = mode === 'BLOCKED_UNKNOWN' && (a.finalizeV3Active || a.finalizeV2Active)
  const labels: Record<string, string> = {
    V2_ACTIVE: '传统打印 · 未启用 Local First', V2_DRAINING: '正在切换到 Local First',
    V3_ACTIVE: 'Local First 模式已启用', V3_DRAINING: '正在切回传统打印',
    BLOCKED_UNKNOWN: waitingForConfirmation ? '等待人工确认' : '需要人工处理',
  }
  const tone: keyof typeof LOCAL_FIRST_TONES = mode === 'V2_ACTIVE' ? 'neutral'
    : waitingForConfirmation || mode === 'V3_ACTIVE' || mode === 'V3_DRAINING' ? 'info'
      : mode === 'BLOCKED_UNKNOWN' ? 'error' : mode === 'V2_DRAINING' ? 'warning' : 'neutral'
  let owner = '尚未取得执行权；需在门店电脑核对 Desktop。'
  if (mode === 'V2_ACTIVE') owner = '传统打印模式不要求 V3 Owner 接管。'
  else if (plane.ownerDeviceId) {
    const lease = Date.parse(plane.leaseExpiresAt ?? '')
    const batch = state.activeBatch
    owner = Number.isFinite(lease) && lease > now && state.ownerDevice?.status === 'ACTIVE'
      && batch?.ownerDeviceId === plane.ownerDeviceId && batch.ownerEpoch === plane.ownerEpoch && Date.parse(batch.expiresAt) > now
      ? '云端记录已有 Owner 和有效执行批次；不代表本地打印正常。'
      : '云端仍有 Owner 归属；租约或批次需核对，不能据此让另一台电脑接管。'
  }
  const next = mode === 'V2_ACTIVE' ? '当前使用传统打印；需要切换时再按现有流程启用。'
    : waitingForConfirmation ? '云端已开放最终确认；授权人员核对现场后，另行选择最终模式。'
      : mode === 'V3_ACTIVE' ? '现场核对 Desktop 与前台打印配置；云端模式不证明打印机已出票。'
        : mode === 'BLOCKED_UNKNOWN' ? '先核对下方阻塞原因与审计，不自动重试或跳过安全闸。'
          : '等待排空与安全条件满足，刷新后由授权人员确认；不会自动完成切换。'
  const reasons = [
    b.handoffOrReconciliation ? '交接／核对尚未完成。' : '',
    b.ownerActive ? '当前仍有 Owner 归属，需按既有流程安全释放或核验交接。' : '',
    b.activeExecutionBatch ? '仍有有效执行批次，需等待结束或按既有流程撤销。' : '',
  ].filter(Boolean)
  const v2Reason = b.v2Drain ? '旧 V2 队列尚未排空。' : ''
  const v3Reason = b.v3Drain ? '仍有可执行或状态不明的 V3 任务。' : ''
  const unavailable: { label: string; reason: string }[] = []
  const add = (allowed: boolean, label: string, facts: string[]) => {
    if (!allowed) unavailable.push({ label, reason: facts.filter(Boolean).join(' ') || '服务端尚未开放；请刷新安全状态核对，勿绕过校验。' })
  }
  if (mode === 'V2_ACTIVE') add(a.startActivation, '启用 Local First', reasons)
  if (mode === 'V3_ACTIVE') add(a.startDeactivation, '切回传统打印', [b.handoffOrReconciliation ? '交接／核对尚未完成。' : '', v3Reason])
  if (mode === 'V2_DRAINING' || mode === 'V3_DRAINING') add(a.enterManualReview, '进入人工确认闸', [
    ...reasons, mode === 'V2_DRAINING' && b.v2DrainWindowActive ? '120 秒安全排空窗口尚未结束。' : '',
    mode === 'V2_DRAINING' ? v2Reason : v3Reason,
    b.v2ExecutionAmbiguous ? '旧 V2 存在已领取、执行中或执行结果不明的任务。' : '',
  ])
  if (mode === 'BLOCKED_UNKNOWN') {
    add(a.finalizeV3Active, '确认启用 Local First', [...reasons, v2Reason, v3Reason])
    add(a.finalizeV2Active, '确认恢复传统打印', [...reasons, v3Reason,
      b.v2ExecutionAmbiguous ? '旧 V2 存在执行结果不明的任务。' : ''])
  }
  return { label: labels[mode] ?? '模式未知，请刷新核对', tone, owner, next, waitingForConfirmation, unavailable }
}

/** Invalid/future timestamps never start a new window. No fallback to page load or REVIEW time. */
export function captureWindow(capturedAt: string | number | null | undefined, now: number, durationMs: number) {
  const at = typeof capturedAt === 'number' ? capturedAt : Date.parse(capturedAt ?? '')
  if (!Number.isFinite(at) || !Number.isFinite(now) || at > now) return null
  const deadline = at + durationMs
  return { deadline, seconds: Math.max(0, Math.floor((deadline - now) / 1000)), closed: now >= deadline }
}

type FounderInput = {
  state: { controlPlane: Plane; activeBatch: { id: string } | null; v3Queue: Queue }
  recovery: DiamondRecoveryReadout; clock: number
  capture: { capturedAt: string; releasedAt: string; ownerEpoch: number; deviceObservedAt: string } | null
  capturePresent: boolean; installationValid: boolean; evidenceReady: boolean
  activeGrant: { capturedAtMs: number; stateVersion: number } | null
  mayReview: boolean; mayExpire: boolean; disabled: boolean; busy: boolean; blocked: boolean
  stateReviewable: boolean; parentReason?: string
}

export function describeFounderRecovery(input: FounderInput) {
  const { state, recovery, clock, capture, activeGrant } = input
  const review = recovery.review
  const jobsExpired = recovery.jobs.length === 3 && recovery.jobs.every(job => job.status === 'EXPIRED'
    && job.resultStatus === 'EXPIRED' && job.effectBoundary === 'NOT_CROSSED' && !!job.completedAt)
  const terminalAudit = jobsExpired && review?.status === 'CONSUMED' && !!review.expireAuditId
  const recovered = !input.disabled && !input.busy && !input.blocked && terminalAudit && state.controlPlane.mode === 'V3_ACTIVE'
    && !state.controlPlane.handoffQuarantineUntil && Object.values(state.v3Queue).every(count => count === 0)
  const status = recovered ? '三笔任务恢复记录已核验，云端模式已确认；本地出票仍需现场验证。'
    : terminalAudit ? '三笔任务已终结，等待核对最终模式；尚不能视为恢复完成。'
      : review?.status === 'AVAILABLE' ? activeGrant && activeGrant.stateVersion === state.controlPlane.stateVersion
        ? clock - activeGrant.capturedAtMs >= 295_000
          ? '已审核；EXPIRE 的前端提交窗口已关闭。先查询审计，不得重新 REVIEW。'
          : '审核记录可用；EXPIRE 仍需单独确认。'
        : '已有审核记录，但版本或采集信息不完整／不匹配；先核对审计，不得重新 REVIEW。'
        : review?.status === 'CONSUMED' ? '审核已使用，但最终任务或模式尚未核验；保持展开。'
          : review?.status === 'EXPIRED' ? '一次性审核证据已过期；不能通过重新采集获得第二次授权。'
            : review?.status === 'OTHER_REVIEWER' ? '另一名 SUPER_ADMIN 已审核；本身份不能再次审核或执行 EXPIRE。'
              : review?.status === 'UNKNOWN' ? '审核状态未知；先查询服务端审计，不假定已恢复。'
                : '尚无可用审核记录；先核对范围、现场证据和前置条件。'
  const shared = input.blocked ? '本页已停止提交；先查询服务端审计和任务状态，不自动重试。'
    : input.busy ? '请求正在提交，请等待结果，勿重复点击。'
      : input.disabled ? input.parentReason || '上级控制面暂不可操作；先刷新并核对审计。' : ''
  const conditions = !input.stateReviewable ? '模式、Owner／Lease、有效批次、交接或三笔任务队列不符合预检；请核对安全详情。' : ''
  const jobsUnexecuted = recovery.jobs.every(job => job.status === 'PENDING' && job.expiresAt
    && Date.parse(job.expiresAt) <= clock && job.claimAttempt === 0 && job.attemptCount === 0
    && job.claimed === false && job.executingAt === null && job.completedAt === null
    && job.resultStatus === null && job.hasResultMetadata === false && job.effectBoundary === null
    && job.physicalCompletionKnown === false)
  const jobReason = !jobsUnexecuted ? '三笔任务未全部满足过期、未领取且无执行／结果记录的预检；不能假定未打印。' : ''
  const reviewReason = input.mayReview ? '' : shared || (review ? status : activeGrant ? '已有审核授权；不能再次 REVIEW。'
    : conditions || jobReason || (!input.capturePresent ? '请先由授权人员采集并粘贴本地证据。'
      : !capture ? '证据 JSON 格式或固定设备／任务范围不符，请核对原始采集结果。'
        : !input.installationValid ? '请核对 Installation ID；它必须来自目标 Windows 安装身份。'
          : !input.evidenceReady ? '证据已超过 30 秒，或采集时钟／释权版本不匹配；未审核成功时可重新采集。'
            : 'REVIEW 暂不可用；先刷新核对。'))
  const expireReason = input.mayExpire ? '' : shared || (review && review.status !== 'AVAILABLE' ? status
    : !activeGrant ? review ? '已有审核记录，但版本或采集信息不完整／不匹配；先核对审计，不得重新 REVIEW。'
      : '先完成 REVIEW 并取得本身份可用的一次性审核记录。'
      : conditions || jobReason || (activeGrant.stateVersion !== state.controlPlane.stateVersion ? '控制面版本已变化；先查询审计，不沿用旧授权。'
        : clock - activeGrant.capturedAtMs >= 295_000 ? 'EXPIRE 提交窗口已关闭；前端提前 5 秒关闭，不延长服务端 5 分钟有效期。'
          : 'EXPIRE 暂不可用；先刷新核对。'))
  const matchingCapture = capture && capture.ownerEpoch === state.controlPlane.ownerEpoch
    && capture.releasedAt === state.controlPlane.handoffRequestedAt
    && Date.parse(capture.capturedAt) >= Date.parse(capture.releasedAt)
    && Math.abs(Date.parse(capture.deviceObservedAt) - Date.parse(capture.capturedAt)) <= 30_000
  return {
    recovered, status, reviewReason, expireReason,
    reviewWindow: matchingCapture ? captureWindow(capture.capturedAt, clock, 30_000) : null,
    expireWindow: captureWindow(activeGrant?.capturedAtMs ?? (review?.status === 'EXPIRED' ? review.capturedAt : null), clock, 300_000),
  }
}
