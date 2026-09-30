import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { NoPayloadEndpointReadiness, type ReadinessSocket } from '../src/main/printing/endpointReadiness'

function socket(outcome: 'connect' | 'timeout' | 'error') {
  const events = new EventEmitter()
  const value = {
    once: events.once.bind(events),
    destroy: vi.fn(),
    setTimeout: vi.fn(),
  } as unknown as ReadinessSocket
  queueMicrotask(() => events.emit(outcome))
  return value
}

describe('NoPayloadEndpointReadiness', () => {
  it('requires each configured role and performs connect-only checks without a payload API', async () => {
    const sockets: ReadinessSocket[] = []
    const create = vi.fn(() => {
      const created = socket('connect')
      sockets.push(created)
      return created
    })
    const readiness = new NoPayloadEndpointReadiness(500, create)
    await expect(readiness.check([
      { role: 'FRONT', endpointKey: '192.168.1.10:9100' },
      { role: 'KITCHEN', endpointKey: '192.168.1.11:9100' },
    ])).resolves.toEqual({ ok: true })
    expect(create.mock.calls).toEqual([
      [{ host: '192.168.1.10', port: 9100 }],
      [{ host: '192.168.1.11', port: 9100 }],
    ])
    for (const created of sockets) {
      expect('write' in created).toBe(false)
      expect(created.destroy).toHaveBeenCalledTimes(1)
    }
  })

  it('fails closed on one unavailable role and never substitutes another role', async () => {
    const create = vi.fn()
      .mockImplementationOnce(() => socket('connect'))
      .mockImplementationOnce(() => socket('timeout'))
    const readiness = new NoPayloadEndpointReadiness(500, create)
    await expect(readiness.check([
      { role: 'FRONT', endpointKey: '192.168.1.10:9100' },
      { role: 'KITCHEN', endpointKey: '192.168.1.11:9100' },
    ])).resolves.toEqual({ ok: false, code: 'ENDPOINT_KITCHEN_UNREACHABLE', role: 'KITCHEN' })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('rejects empty, duplicate-role, malformed and unknown socket outcomes', async () => {
    const readiness = new NoPayloadEndpointReadiness(500, () => socket('error'))
    await expect(readiness.check([])).resolves.toEqual({ ok: false, code: 'ENDPOINT_CONFIG_EMPTY' })
    await expect(readiness.check([
      { role: 'FRONT', endpointKey: '192.168.1.10:9100' },
      { role: 'FRONT', endpointKey: '192.168.1.11:9100' },
    ])).resolves.toEqual({ ok: false, code: 'ENDPOINT_ROLE_DUPLICATE' })
    await expect(readiness.check([
      { role: 'FRONT', endpointKey: 'not-an-endpoint' },
    ])).resolves.toEqual({ ok: false, code: 'ENDPOINT_FRONT_UNREACHABLE', role: 'FRONT' })
    await expect(readiness.check([
      { role: 'KITCHEN', endpointKey: '192.168.1.11:9100' },
    ])).resolves.toEqual({ ok: false, code: 'ENDPOINT_KITCHEN_UNREACHABLE', role: 'KITCHEN' })
  })
})
