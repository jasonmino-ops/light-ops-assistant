import { describe, it, expect } from 'vitest'
import {
  computeRecoveryDelay,
  decideRecovery,
  initialRecoveryState,
  markStarted,
  DEFAULT_RECOVERY_POLICY,
} from '../src/shared/backoff'

describe('顾客窗口恢复退避策略（A7）', () => {
  it('指数退避：1s → 2s → 4s → 8s → 16s → 30s(封顶)', () => {
    expect(computeRecoveryDelay(1)).toBe(1000)
    expect(computeRecoveryDelay(2)).toBe(2000)
    expect(computeRecoveryDelay(3)).toBe(4000)
    expect(computeRecoveryDelay(4)).toBe(8000)
    expect(computeRecoveryDelay(5)).toBe(16000)
    expect(computeRecoveryDelay(6)).toBe(30000)
    expect(computeRecoveryDelay(99)).toBe(30000)
  })

  it('达到 maxAttempts 后 give-up，不产生无限重启循环', () => {
    let state = initialRecoveryState()
    const now = 1_000_000
    for (let i = 1; i <= DEFAULT_RECOVERY_POLICY.maxAttempts; i++) {
      const d = decideRecovery(state, now)
      expect(d.action).toBe('retry')
      state = d.state
      expect(state.attempts).toBe(i)
    }
    const final = decideRecovery(state, now)
    expect(final.action).toBe('give-up')
    expect(final.state.exhausted).toBe(true)
  })

  it('稳定运行超过 stableResetMs 后计数重置', () => {
    let state = initialRecoveryState()
    // 连续失败 3 次
    for (let i = 0; i < 3; i++) state = decideRecovery(state, 1_000_000).state
    expect(state.attempts).toBe(3)
    // 窗口成功启动并稳定运行 61s 后再次失败 → attempts 从 1 重新计
    state = markStarted(state, 1_000_000)
    const d = decideRecovery(state, 1_000_000 + 61_000)
    expect(d.action).toBe('retry')
    expect(d.state.attempts).toBe(1)
    if (d.action === 'retry') expect(d.delayMs).toBe(1000)
  })

  it('未达到稳定期的快速崩溃不重置计数', () => {
    let state = initialRecoveryState()
    state = decideRecovery(state, 1_000_000).state
    state = markStarted(state, 1_000_000)
    const d = decideRecovery(state, 1_000_000 + 5_000) // 5s 后又崩
    expect(d.state.attempts).toBe(2)
  })
})
