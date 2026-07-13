/**
 * E-Shop Desktop — 本地购物车实时同步服务（Main 进程）
 *
 * 数据流（Electron 本地主通道）：
 *   员工窗口页面(/cashier via /desktop/pos) → BroadcastChannel(web 冻结契约)
 *     → 员工窗口 preload 旁路捕获 → IPC eshop:cart:publish
 *     → 本服务：权威校验 + 防倒序 + 缓存最新快照
 *     → IPC eshop:cart:apply → 顾客窗口 preload → BroadcastChannel 回放
 *     → /desktop/display 现有监听逻辑消费（含其自身 guard 去重）
 *
 * 云端 PosSession 800ms 轮询继续保留在 /desktop/display 页面中，作为恢复与兼容兜底。
 */

import {
  buildSnapshotGuard,
  isNewerSnapshot,
  validateCartSnapshotMessage,
  type CartSnapshotMessage,
  type SnapshotGuard,
} from '../shared/cartSnapshot'
import { logger } from './logger'
import { updateHealth, recordHealthError } from './runtimeHealth'

export type CartApplySender = (message: CartSnapshotMessage) => void

export class CartSyncService {
  private latest: CartSnapshotMessage | null = null
  private guard: SnapshotGuard | null = null
  private retiredEpochsByStore = new Map<string, Set<string>>()
  private sendToCustomer: CartApplySender | null = null

  /** WindowManager 在顾客窗口可用/重建后注入发送器 */
  setCustomerSender(sender: CartApplySender | null) {
    this.sendToCustomer = sender
  }

  /** 员工窗口 preload 上报的快照入口（payload 未受信任，必须校验） */
  ingest(raw: unknown): { accepted: boolean; reason?: string } {
    const result = validateCartSnapshotMessage(raw)
    if (!result.ok) {
      logger.warn('cart-sync.rejected-invalid', { reason: result.reason })
      recordHealthError('cart-sync', `invalid payload: ${result.reason}`)
      return { accepted: false, reason: result.reason }
    }
    const message = result.message
    if (this.isRetiredEpoch(message)) {
      logger.debug('cart-sync.rejected-retired-epoch', {
        storeCode: message.storeCode,
        desktopEpoch: message.desktopEpoch,
        sequence: message.sequence,
      })
      return { accepted: false, reason: 'retired-epoch' }
    }
    if (!isNewerSnapshot(this.guard, message)) {
      logger.debug('cart-sync.rejected-stale', {
        incoming: {
          storeCode: message.storeCode,
          desktopEpoch: message.desktopEpoch,
          sequence: message.sequence,
          sentAt: message.sentAt,
        },
        current: this.guard,
      })
      return { accepted: false, reason: 'stale' }
    }
    this.retirePreviousEpoch(message)
    this.latest = message
    this.guard = buildSnapshotGuard(message)
    updateHealth({ lastCartSequence: message.sequence }, 'cart-sync.accepted')
    this.forward(message)
    return { accepted: true }
  }

  private forward(message: CartSnapshotMessage) {
    if (!this.sendToCustomer) return
    try {
      this.sendToCustomer(message)
    } catch (error) {
      logger.error('cart-sync.forward-failed', { error: String(error) })
      recordHealthError('cart-sync', `forward failed: ${String(error)}`)
    }
  }

  /** 顾客窗口加载完成 / 恢复后重推最新快照 */
  replayLatest(reason: string): boolean {
    if (!this.latest) return false
    logger.info('cart-sync.replay', { reason, sequence: this.latest.sequence })
    this.forward(this.latest)
    return true
  }

  getLatest(): CartSnapshotMessage | null {
    return this.latest
  }

  private isRetiredEpoch(message: CartSnapshotMessage): boolean {
    if (!message.desktopEpoch) return false
    return this.retiredEpochsByStore.get(message.storeCode)?.has(message.desktopEpoch) ?? false
  }

  private retirePreviousEpoch(message: CartSnapshotMessage) {
    if (!this.guard?.desktopEpoch || !message.desktopEpoch) return
    if (this.guard.storeCode !== message.storeCode) return
    if (this.guard.desktopEpoch === message.desktopEpoch) return
    const retired = this.retiredEpochsByStore.get(message.storeCode) ?? new Set<string>()
    retired.add(this.guard.desktopEpoch)
    this.retiredEpochsByStore.set(message.storeCode, retired)
  }
}

export const cartSyncService = new CartSyncService()
