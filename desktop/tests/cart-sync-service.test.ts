import { describe, it, expect, beforeEach } from 'vitest'
import { CartSyncService } from '../src/main/cartSyncService'
import type { CartSnapshotMessage } from '../src/shared/cartSnapshot'

function snapshot(sequence: number, overrides: Partial<CartSnapshotMessage> = {}): CartSnapshotMessage {
  return {
    type: 'CART_SNAPSHOT',
    storeCode: 'STORE-A',
    sentAt: new Date(1_752_000_000_000 + sequence * 1000).toISOString(),
    sequence,
    items: [],
    totalAmount: 0,
    itemCount: 0,
    currencyCode: 'USD',
    status: 'DRAFT',
    paymentMethod: null,
    paymentStatus: null,
    ...overrides,
  }
}

describe('CartSyncService（A5 本地实时同步核心）', () => {
  let service: CartSyncService
  let sent: CartSnapshotMessage[]

  beforeEach(() => {
    service = new CartSyncService()
    sent = []
    service.setCustomerSender((m) => sent.push(m))
  })

  it('合法快照被接受并转发给顾客窗口', () => {
    expect(service.ingest(snapshot(1)).accepted).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].sequence).toBe(1)
  })

  it('非法 payload 被拒绝且不转发', () => {
    const r = service.ingest({ type: 'CART_SNAPSHOT', storeCode: 123 })
    expect(r.accepted).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('旧消息不会覆盖新消息', () => {
    service.ingest(snapshot(5))
    const r = service.ingest(snapshot(3))
    expect(r.accepted).toBe(false)
    expect(r.reason).toBe('stale')
    expect(service.getLatest()?.sequence).toBe(5)
    expect(sent).toHaveLength(1)
  })

  it('顾客窗口恢复后 replayLatest 重推最新快照', () => {
    service.ingest(snapshot(1))
    service.ingest(snapshot(2))
    sent.length = 0
    expect(service.replayLatest('display-ready')).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].sequence).toBe(2)
  })

  it('无快照时 replayLatest 返回 false（空购物车启动场景）', () => {
    expect(service.replayLatest('startup')).toBe(false)
  })

  it('顾客窗口销毁（sender 为 null）时 ingest 不抛异常，快照继续缓存', () => {
    service.setCustomerSender(null)
    expect(service.ingest(snapshot(7)).accepted).toBe(true)
    expect(service.getLatest()?.sequence).toBe(7)
    // 窗口重建后 replay 可用
    service.setCustomerSender((m) => sent.push(m))
    service.replayLatest('recovered')
    expect(sent[0].sequence).toBe(7)
  })

  it('CLEAR（完成/取消销售清屏）作为普通快照流转，sequence 继续递增', () => {
    service.ingest(snapshot(1, { itemCount: 2, totalAmount: 5 }))
    service.ingest(snapshot(2, { type: 'CLEAR' }))
    expect(service.getLatest()?.type).toBe('CLEAR')
    expect(sent).toHaveLength(2)
  })
})
