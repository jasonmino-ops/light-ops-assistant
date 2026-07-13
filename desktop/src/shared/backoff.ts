/**
 * E-Shop Desktop — 窗口恢复退避策略（纯函数，便于单元测试）
 *
 * 用于顾客窗口崩溃/误关闭后的自动重建：
 * 有限次数 + 指数退避 + 稳定期重置，防止无限重启循环。
 */

export type RecoveryPolicyConfig = {
  baseDelayMs: number
  maxDelayMs: number
  maxAttempts: number
  /** 窗口存活超过该时长后，重试计数重置 */
  stableResetMs: number
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicyConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  maxAttempts: 6,
  stableResetMs: 60_000,
}

export type RecoveryState = {
  attempts: number
  lastStartedAtMs: number | null
  exhausted: boolean
}

export function initialRecoveryState(): RecoveryState {
  return { attempts: 0, lastStartedAtMs: null, exhausted: false }
}

/** 第 n 次重试（n 从 1 开始）的延迟毫秒数 */
export function computeRecoveryDelay(attempt: number, config: RecoveryPolicyConfig = DEFAULT_RECOVERY_POLICY): number {
  const capped = Math.max(1, attempt)
  return Math.min(config.baseDelayMs * 2 ** (capped - 1), config.maxDelayMs)
}

export type RecoveryDecision =
  | { action: 'retry'; delayMs: number; state: RecoveryState }
  | { action: 'give-up'; state: RecoveryState }

/**
 * 窗口意外销毁时调用：决定是否重试以及延迟多久。
 * nowMs 与窗口最近一次成功启动时间比较，超过 stableResetMs 视为稳定运行，计数重置。
 */
export function decideRecovery(
  state: RecoveryState,
  nowMs: number,
  config: RecoveryPolicyConfig = DEFAULT_RECOVERY_POLICY,
): RecoveryDecision {
  let attempts = state.attempts
  if (state.lastStartedAtMs !== null && nowMs - state.lastStartedAtMs >= config.stableResetMs) {
    attempts = 0
  }
  const nextAttempt = attempts + 1
  if (nextAttempt > config.maxAttempts) {
    return { action: 'give-up', state: { ...state, attempts, exhausted: true } }
  }
  return {
    action: 'retry',
    delayMs: computeRecoveryDelay(nextAttempt, config),
    state: { attempts: nextAttempt, lastStartedAtMs: state.lastStartedAtMs, exhausted: false },
  }
}

/** 窗口成功创建并加载后调用 */
export function markStarted(state: RecoveryState, nowMs: number): RecoveryState {
  return { ...state, lastStartedAtMs: nowMs, exhausted: false }
}
