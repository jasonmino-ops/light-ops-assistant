import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReceivedPrintJob } from '../src/cloudRelayClient'
import { NETWORK_MAX_BYTES, NETWORK_PROFILE, type NetworkRequest } from '../src/networkContract'
import type { NetworkPrinterConfig } from '../src/networkNodeConfig'
import { NetworkDeliveryError } from '../src/printing/networkRawTcpTransport'
import { createGuardedNetworkClient, createNetworkRenderer, createNetworkStrategy, activateNetworkPrinting } from '../src/networkRuntime'

const request: NetworkRequest = { profile: NETWORK_PROFILE, requestId: 'network-runtime-0001', role: 'FRONT', mode: 'SHARED_PRINTER', rendererVersion: 1,
  order: { storeCode: 'STORE-A', storeName: 'Test', orderNo: 'ORDER-001', createdAt: '2026-09-07T00:00:00.000Z',
    cashierName: 'Cashier', paymentMethod: 'CASH', currencyCode: 'USD', totalAmount: 3, lang: 'zh',
    items: [{ name: '小票', spec: null, qty: 1, price: 3, lineAmount: 3 }] } }
function job(): ReceivedPrintJob {
  return { id: 'network-job-0001', schemaVersion: 2, requestId: request.requestId,
    idempotencyKey: request.requestId, requestHash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    orderNo: request.order.orderNo, documentName: 'FRONT', commandStream: new Uint8Array(), network: request,
    claimAttempt: 1, claimToken: `ecp_v1_${'a'.repeat(43)}`, leaseExpiresAt: new Date(Date.now() + 30000).toISOString() }
}
function strategyHarness() {
  const config: NetworkPrinterConfig = { mode: 'SHARED_PRINTER', endpoint: { host: '10.20.30.2', port: 9100 } }
  const bytes = Uint8Array.from([27, 64, 29, 86, 0])
  const options = {
    assertIdentity: vi.fn(async () => {}), identity: { storeCode: 'STORE-A' },
    nodes: { read: vi.fn(async () => config) }, validateEndpoint: vi.fn(async () => {}),
    render: vi.fn(async (_request: NetworkRequest) => bytes), recorder: { record: vi.fn(async (_event: unknown) => {}) },
    transport: { deliver: vi.fn(async (_bytes: Uint8Array, _endpoint: unknown) => ({
      bytesWritten: bytes.length, durationMs: 1, effectBoundary: 'CROSSED' as const, physicalCompletionKnown: false as const,
    })) },
  }
  return { options, bytes, config, strategy: createNetworkStrategy(options) }
}

afterEach(() => vi.useRealTimers())

describe('shared Network preparation and receive gates', () => {
  it('rejects repeated enable before any journal reload or change to an active claim', async () => {
    const options = { isEnabled: () => true, stopAndWait: vi.fn(), validate: vi.fn(), persistEnabled: vi.fn(), start: vi.fn() }
    await expect(activateNetworkPrinting(options)).rejects.toThrow('ADDON_ALREADY_ENABLED')
    expect(options.stopAndWait).not.toHaveBeenCalled(); expect(options.persistEnabled).not.toHaveBeenCalled()
    expect(options.start).not.toHaveBeenCalled()
  })
  it('a paused-but-still-finishing delivery/ACK must settle before reloading the journal on enable', async () => {
    let idle!: () => void
    const pending = new Promise<void>(resolve => { idle = resolve })
    const calls: string[] = []
    const activation = activateNetworkPrinting({ isEnabled: () => false,
      stopAndWait: async () => { calls.push('pause'); await pending; calls.push('ack-idle') },
      validate: async () => { calls.push('validate') }, persistEnabled: async () => { calls.push('journal-load-enable') },
      start: () => { calls.push('start') } })
    await Promise.resolve(); expect(calls).toEqual(['pause'])
    idle(); await activation
    expect(calls).toEqual(['pause', 'ack-idle', 'validate', 'journal-load-enable', 'start'])
  })
  it('validates identity/config/current route before rendering and again immediately before delivery', async () => {
    const h = strategyHarness(), events: string[] = []
    h.options.assertIdentity.mockImplementation(async () => { events.push('identity') })
    h.options.nodes.read.mockImplementation(async () => { events.push('config'); return h.config })
    h.options.validateEndpoint.mockImplementation(async () => { events.push('route') })
    h.options.render.mockImplementation(async () => { events.push('render'); return h.bytes })
    const deliver = await h.strategy.prepare(job())
    expect(h.options.transport.deliver).not.toHaveBeenCalled()
    await deliver()
    expect(events).toEqual(['identity', 'config', 'route', 'render', 'identity', 'config', 'route'])
    expect(h.options.transport.deliver).toHaveBeenCalledWith(h.bytes, h.config.endpoint)
  })

  it.each(['identity', 'config', 'route', 'render'] as const)('never swallows a preparation %s failure', async stage => {
    const h = strategyHarness()
    const operation = { identity: h.options.assertIdentity, config: h.options.nodes.read,
      route: h.options.validateEndpoint, render: h.options.render }[stage]
    operation.mockRejectedValueOnce(new Error(`failed ${stage}`))
    await expect(h.strategy.prepare(job())).rejects.toThrow(`failed ${stage}`)
    expect(h.options.transport.deliver).not.toHaveBeenCalled()
  })

  it('rejects protocol, store, mode and malformed render output before transport', async () => {
    const h = strategyHarness()
    await expect(h.strategy.prepare({ ...job(), schemaVersion: 1, network: undefined })).rejects.toThrow('NETWORK_JOB_REQUIRED')
    await expect(h.strategy.prepare({ ...job(), network: { ...request, order: { ...request.order, storeCode: 'OTHER' } } })).rejects.toThrow('NETWORK_STORE_MISMATCH')
    h.options.nodes.read.mockResolvedValueOnce({ ...h.config, mode: 'FRONT_ONLY' })
    await expect(h.strategy.prepare(job())).rejects.toThrow('NETWORK_MODE_MISMATCH')
    h.options.render.mockResolvedValueOnce(new Uint8Array())
    await expect(h.strategy.prepare(job())).rejects.toThrow('NETWORK_RENDER_SIZE')
    expect(h.options.transport.deliver).not.toHaveBeenCalled()
  })

  it('keeps normal recorder failures best-effort and seals the rendered bytes before delivery', async () => {
    const h = strategyHarness()
    h.options.recorder.record.mockRejectedValue(new Error('ENOSPC'))
    const expected = Uint8Array.from(h.bytes), deliver = await h.strategy.prepare(job())
    h.bytes[0] = 0
    await deliver()
    expect(h.options.transport.deliver.mock.calls[0][0]).toEqual(expected)
  })

  it.each(['identity', 'config', 'route'] as const)('classifies revalidation %s failure as NOT_CROSSED', async stage => {
    const h = strategyHarness(), deliver = await h.strategy.prepare(job())
    const operation = { identity: h.options.assertIdentity, config: h.options.nodes.read, route: h.options.validateEndpoint }[stage]
    operation.mockRejectedValueOnce(new Error('NETWORK_CHANGED'))
    await expect(deliver()).rejects.toMatchObject({ code: 'NETWORK_CHANGED', effectBoundary: 'NOT_CROSSED' })
    expect(h.options.transport.deliver).not.toHaveBeenCalled()
  })

  it.each(['mode', 'host', 'port'] as const)('seals config values so mutable %s cannot silently redirect delivery', async field => {
    const h = strategyHarness(), deliver = await h.strategy.prepare(job())
    const changed = structuredClone(h.config) as { mode: 'FRONT_ONLY' | 'SHARED_PRINTER'; endpoint: { host: string; port: number } }
    if (field === 'mode') changed.mode = 'FRONT_ONLY'
    if (field === 'host') changed.endpoint.host = '10.20.30.3'
    if (field === 'port') changed.endpoint.port = 9101
    h.options.nodes.read.mockResolvedValueOnce(changed)
    await expect(deliver()).rejects.toMatchObject({ code: 'NETWORK_CONFIG_CHANGED', effectBoundary: 'NOT_CROSSED' })
    expect(h.options.transport.deliver).not.toHaveBeenCalled()
  })

  it('preserves transport uncertainty and never promotes TCP submission to paper confirmation', async () => {
    const h = strategyHarness(), deliver = await h.strategy.prepare(job())
    expect(await deliver()).toMatchObject({ physicalCompletionKnown: false })
    expect(h.strategy.failure(new NetworkDeliveryError('NETWORK_TCP_TIMEOUT', 'CROSSING_UNKNOWN'))).toEqual({
      resultCode: 'NETWORK_TCP_TIMEOUT', effectBoundary: 'CROSSING_UNKNOWN',
    })
    expect(h.strategy.failure(new Error('unknown transport failure')).effectBoundary).toBe('CROSSING_UNKNOWN')
  })

  it('keeps UNKNOWN receive barrier separate from ACK recovery and route checks', async () => {
    const h = strategyHarness()
    const client = { receive: vi.fn(async () => null), markExecuting: vi.fn(async () => {}), reportResult: vi.fn(async () => {}) }
    const records = vi.fn(() => [{ effectBoundary: 'CROSSING_UNKNOWN', reported: true }] as never[])
    const guarded = createGuardedNetworkClient({ ...h.options, journal: { records }, client })
    await expect(guarded.receive()).rejects.toThrow('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
    expect(client.receive).not.toHaveBeenCalled()
    expect(h.options.validateEndpoint).toHaveBeenCalledTimes(1)
    h.options.assertIdentity.mockRejectedValue(new Error('identity offline'))
    await guarded.reportResult(job(), { state: 'FAILED', resultCode: 'INTERRUPTED', effectBoundary: 'CROSSING_UNKNOWN', physicalCompletionKnown: false })
    expect(client.reportResult).toHaveBeenCalledTimes(1)
  })

  it('checks routes before consuming a new claim', async () => {
    const h = strategyHarness()
    const client = { receive: vi.fn(async () => null), markExecuting: vi.fn(async () => {}), reportResult: vi.fn(async () => {}) }
    const guarded = createGuardedNetworkClient({ ...h.options, journal: { records: () => [] }, client })
    h.options.validateEndpoint.mockRejectedValueOnce(new Error('NETWORK_ROUTE_ESCAPE'))
    await expect(guarded.receive()).rejects.toThrow('NETWORK_ROUTE_ESCAPE')
    expect(client.receive).not.toHaveBeenCalled()
    await guarded.receive()
    expect(client.receive).toHaveBeenCalledTimes(1)
  })
})

function rendererHarness() {
  const ipcMain = new EventEmitter(), windows: FakeWindow[] = []
  let load: () => Promise<void> = async () => {}
  class FakeWindow extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {}, send: vi.fn((_channel: string, _value: { renderId: string; request: NetworkRequest }) => {}),
      setWindowOpenHandler: vi.fn(), session: { setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } },
    })
    constructor(readonly options: unknown) { super(); windows.push(this) }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
    loadFile = vi.fn((_file: string) => load())
  }
  const renderer = createNetworkRenderer({ electron: { BrowserWindow: FakeWindow, ipcMain } as unknown as
    Parameters<typeof createNetworkRenderer>[0]['electron'], distDirectory: '/test/network-dist' })
  const reply = (bytes: unknown, override: { sender?: unknown; senderFrame?: unknown; renderId?: string } = {}) => {
    const window = windows.at(-1)!, message = window.webContents.send.mock.calls.at(-1)![1]
    ipcMain.emit('network:rendered', { sender: override.sender ?? window.webContents,
      senderFrame: override.senderFrame ?? window.webContents.mainFrame }, { renderId: override.renderId ?? message.renderId, bytes })
  }
  return { renderer, ipcMain, windows, reply, setLoad: (next: typeof load) => { load = next } }
}

describe('actual shared sandbox renderer factory with fake Electron boundaries', () => {
  it('uses one hidden sandbox window, denies network/navigation/permissions, and reuses shared local assets', async () => {
    const h = rendererHarness(), pending = h.renderer.render(request)
    await Promise.resolve()
    const win = h.windows[0]
    expect(win.options).toMatchObject({ show: false, webPreferences: { sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, partition: 'network-print-render', preload: '/test/network-dist/network-render.cjs' } })
    expect(win.loadFile).toHaveBeenCalledWith('/test/network-dist/network-render.html')
    expect(win.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    win.webContents.emit('will-navigate', event); win.webContents.emit('will-attach-webview', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    const permission = vi.fn(); win.webContents.session.setPermissionRequestHandler.mock.calls[0][0]({}, 'camera', permission)
    expect(permission).toHaveBeenCalledWith(false)
    const blocked = vi.fn(); win.webContents.session.webRequest.onBeforeRequest.mock.calls[0][1]({}, blocked)
    expect(blocked).toHaveBeenCalledWith({ cancel: true })
    const original = Uint8Array.from([27, 64, 1])
    h.reply(original)
    const bytes = await pending
    expect(bytes).toEqual(original); expect(bytes).not.toBe(original)
    const second = h.renderer.render({ ...request, role: 'KITCHEN' }); await Promise.resolve(); h.reply(original); await second
    expect(h.windows).toHaveLength(1); expect(win.loadFile).toHaveBeenCalledTimes(1)
    expect(h.ipcMain.listenerCount('network:rendered')).toBe(0)
    h.renderer.dispose()
  })

  it('ignores forged sender, subframe and render ID and rejects concurrent rendering', async () => {
    const h = rendererHarness(), pending = h.renderer.render(request)
    await Promise.resolve()
    await expect(h.renderer.render(request)).rejects.toThrow('NETWORK_RENDER_BUSY')
    h.reply(new Uint8Array([1]), { sender: {} }); h.reply(new Uint8Array([1]), { senderFrame: {} })
    h.reply(new Uint8Array([1]), { renderId: 'wrong-request' })
    expect(h.ipcMain.listenerCount('network:rendered')).toBe(1)
    h.reply(new Uint8Array([27, 64])); expect(await pending).toEqual(new Uint8Array([27, 64]))
    h.renderer.dispose()
  })

  it.each([new Uint8Array(), [27, 64], new Uint8Array(NETWORK_MAX_BYTES + 1), undefined])('rejects malformed rendered bytes and destroys the failed window', async bytes => {
    const h = rendererHarness(), pending = h.renderer.render(request)
    await Promise.resolve(); h.reply(bytes)
    await expect(pending).rejects.toThrow('NETWORK_RENDER_FAILED')
    expect(h.windows[0].destroyed).toBe(true); expect(h.ipcMain.listenerCount('network:rendered')).toBe(0)
    const next = h.renderer.render(request); await Promise.resolve(); h.reply(new Uint8Array([1])); await next
    expect(h.windows).toHaveLength(2)
    h.renderer.dispose()
  })

  it.each(['crash', 'close', 'dispose'] as const)('cleans up an in-flight %s immediately', async failure => {
    const h = rendererHarness(), pending = h.renderer.render(request)
    await Promise.resolve()
    if (failure === 'crash') h.windows[0].webContents.emit('render-process-gone')
    if (failure === 'close') h.windows[0].destroy()
    if (failure === 'dispose') h.renderer.dispose()
    await expect(pending).rejects.toThrow('NETWORK_RENDER_FAILED')
    expect(h.ipcMain.listenerCount('network:rendered')).toBe(0)
    expect(h.windows[0].destroyed).toBe(true)
    h.renderer.dispose()
    await expect(h.renderer.render(request)).rejects.toThrow('NETWORK_RENDER_DISPOSED')
  })

  it('destroys a window after load failure and bounds an unresponsive load to 12 seconds', async () => {
    const failed = rendererHarness(); failed.setLoad(async () => { throw new Error('missing renderer') })
    await expect(failed.renderer.render(request)).rejects.toThrow('NETWORK_RENDER_FAILED')
    expect(failed.windows[0].destroyed).toBe(true)
    vi.useFakeTimers()
    const hanging = rendererHarness(); hanging.setLoad(() => new Promise(() => {}))
    const pending = hanging.renderer.render(request), rejected = expect(pending).rejects.toThrow('NETWORK_RENDER_FAILED')
    await vi.advanceTimersByTimeAsync(12_000); await rejected
    expect(hanging.windows[0].destroyed).toBe(true)
    expect(hanging.ipcMain.listenerCount('network:rendered')).toBe(0)
  })
})
