import { describe, it, expect } from 'vitest'
import {
  validateCartSnapshotMessage,
  isNewerSnapshot,
  buildSnapshotGuard,
  type CartSnapshotMessage,
} from '../src/shared/cartSnapshot'

const valid: CartSnapshotMessage = {
  type: 'CART_SNAPSHOT',
  storeCode: 'STORE-A',
  sentAt: '2026-07-13T01:00:01.000Z',
  sequence: 2,
  items: [{ productId: 'p1', name: 'Iced Coffee', spec: null, imageUrl: null, price: 2.5, qty: 2, lineAmount: 5 }],
  totalAmount: 5,
  itemCount: 2,
  currencyCode: 'USD',
  status: 'DRAFT',
  paymentMethod: null,
  paymentStatus: null,
}

describe('validateCartSnapshotMessage（A6 payload 运行时校验）', () => {
  it('接受合法 CART_SNAPSHOT', () => {
    const r = validateCartSnapshotMessage(valid)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.message.sequence).toBe(2)
  })

  it('接受 CLEAR 与空购物车', () => {
    const r = validateCartSnapshotMessage({ ...valid, type: 'CLEAR', items: [], totalAmount: 0, itemCount: 0 })
    expect(r.ok).toBe(true)
  })

  it('接受带额外字段的消息（如 relayedByDesktop），且输出中剥离额外字段', () => {
    const r = validateCartSnapshotMessage({ ...valid, relayedByDesktop: true, evil: 'x' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect('relayedByDesktop' in r.message).toBe(false)
      expect('evil' in r.message).toBe(false)
    }
  })

  it.each([
    ['null', null],
    ['字符串', 'hello'],
    ['缺 type', { ...valid, type: undefined }],
    ['非法 type', { ...valid, type: 'EXEC' }],
    ['空 storeCode', { ...valid, storeCode: '' }],
    ['storeCode 超长', { ...valid, storeCode: 'x'.repeat(65) }],
    ['非法 sentAt', { ...valid, sentAt: 'not-a-date' }],
    ['负 sequence', { ...valid, sequence: -1 }],
    ['sequence 非数字', { ...valid, sequence: '5' }],
    ['items 非数组', { ...valid, items: {} }],
    ['item 缺字段', { ...valid, items: [{ productId: 'p1' }] }],
    ['item price 非法', { ...valid, items: [{ ...valid.items[0], price: Number.NaN }] }],
    ['totalAmount 非法', { ...valid, totalAmount: Number.POSITIVE_INFINITY }],
    ['非法 status', { ...valid, status: 'HACKED' }],
    ['非法 paymentMethod', { ...valid, paymentMethod: 'BITCOIN' }],
    ['items 超过 500 条', { ...valid, items: Array.from({ length: 501 }, () => valid.items[0]) }],
  ])('拒绝非法 payload：%s', (_name, payload) => {
    expect(validateCartSnapshotMessage(payload).ok).toBe(false)
  })
})

describe('isNewerSnapshot（A5 sequence 防倒序）', () => {
  const guard = buildSnapshotGuard(valid) // sequence=2

  it('无历史时接受任何合法快照', () => {
    expect(isNewerSnapshot(null, valid)).toBe(true)
  })

  it('接受更大 sequence', () => {
    expect(isNewerSnapshot(guard, { ...valid, sequence: 3 })).toBe(true)
  })

  it('拒绝更小 sequence（旧消息不能覆盖新消息）', () => {
    expect(isNewerSnapshot(guard, { ...valid, sequence: 1 })).toBe(false)
  })

  it('相同 sequence：sentAt 更新才接受', () => {
    expect(isNewerSnapshot(guard, { ...valid, sequence: 2, sentAt: '2026-07-13T01:00:00.000Z' })).toBe(false)
    expect(isNewerSnapshot(guard, { ...valid, sequence: 2, sentAt: valid.sentAt })).toBe(false)
    expect(isNewerSnapshot(guard, { ...valid, sequence: 2, sentAt: '2026-07-13T01:00:02.000Z' })).toBe(true)
  })

  it('sentAt 不可解析时拒绝', () => {
    expect(isNewerSnapshot(guard, { ...valid, sequence: 99, sentAt: 'garbage' })).toBe(false)
  })

  it('连续快速扫码：乱序到达时最终状态为最大 sequence', () => {
    let g = null as ReturnType<typeof buildSnapshotGuard> | null
    let applied: number[] = []
    for (const seq of [1, 3, 2, 5, 4]) {
      const msg = { ...valid, sequence: seq, sentAt: `2026-07-13T01:00:0${seq}.000Z` }
      if (isNewerSnapshot(g, msg)) {
        g = buildSnapshotGuard(msg)
        applied.push(seq)
      }
    }
    expect(applied).toEqual([1, 3, 5])
    expect(g?.sequence).toBe(5)
  })
})
