import { afterEach, describe, expect, it, vi } from 'vitest'

type ActivationState = {
  kind: string
  storeCodeHint?: string
  errorCode?: string
  retryAfterSeconds?: number
  isBusy: boolean
  canActivate: boolean
  canRetryVerify: boolean
  canResetLocal: boolean
  canQuit: boolean
}

type WindowListener = (event?: unknown) => void

class FakeElement {
  textContent = ''
  hidden = false
  disabled = false
  value = ''
  onclick: (() => void) | null = null

  readonly focus = vi.fn()
  private readonly listeners = new Map<string, WindowListener[]>()

  addEventListener(event: string, listener: WindowListener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  dispatch(event: string, payload: unknown = {}) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }
}

function activationState(kind: string, extra: Partial<ActivationState> = {}): ActivationState {
  return {
    kind,
    isBusy: kind === 'BOOTING' || kind === 'ACTIVATING' || kind === 'VERIFYING' || kind === 'AUTHORIZED_STARTING',
    canActivate: kind === 'UNACTIVATED',
    canRetryVerify: false,
    canResetLocal: false,
    canQuit: true,
    ...extra,
  }
}

function makeApi() {
  const stateListeners: ((state: unknown) => void)[] = []
  const checkpoints: unknown[] = []
  const api = {
    getState: vi.fn(async () => ({ ok: true, state: activationState('UNACTIVATED') })),
    activate: vi.fn(async () => ({ ok: true, state: activationState('VERIFYING') })),
    retryVerification: vi.fn(async () => ({ ok: true, state: activationState('VERIFYING') })),
    resetLocalActivation: vi.fn(async () => ({ ok: true, state: activationState('UNACTIVATED') })),
    quit: vi.fn(async () => ({ ok: true, state: activationState('QUITTING') })),
    onStateChanged: vi.fn((callback: (state: unknown) => void) => {
      stateListeners.push(callback)
      return vi.fn()
    }),
    reportStartupCheckpoint: vi.fn(async (checkpoint: unknown) => {
      checkpoints.push(checkpoint)
      return { ok: true }
    }),
  }
  return { api, stateListeners, checkpoints }
}

function installActivationDom(api?: unknown) {
  const selectors = [
    '#activation-form',
    '#store-code',
    '#pin',
    '#state-title',
    '#state-detail',
    '#status-code',
    '#activate-button',
    '#retry-button',
    '#reset-button',
    '#quit-button',
    '#busy',
  ]
  const elements = new Map<string, FakeElement>()
  for (const selector of selectors) elements.set(selector, new FakeElement())
  elements.get('#state-title')!.textContent = '正在启动'
  elements.get('#activation-form')!.hidden = true
  elements.get('#retry-button')!.hidden = true
  elements.get('#reset-button')!.hidden = true

  const documentStub = {
    querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
  }
  const windowListeners = new Map<string, WindowListener[]>()
  const windowStub: Record<string, unknown> = {
    location: { reload: vi.fn() },
    confirm: vi.fn(() => true),
    addEventListener: vi.fn((event: string, listener: WindowListener) => {
      windowListeners.set(event, [...(windowListeners.get(event) ?? []), listener])
    }),
  }
  if (api) windowStub.eshopDesktopActivation = api

  vi.stubGlobal('document', documentStub)
  vi.stubGlobal('window', windowStub)

  return {
    elements,
    documentStub,
    windowStub,
    dispatchWindow: (event: string, payload?: unknown) => {
      for (const listener of windowListeners.get(event) ?? []) listener(payload)
    },
  }
}

function element(elements: Map<string, FakeElement>, selector: string): FakeElement {
  const value = elements.get(selector)
  if (!value) throw new Error(`missing fake element ${selector}`)
  return value
}

async function importRenderer() {
  vi.resetModules()
  // @ts-expect-error activationRenderer.ts intentionally compiles as a classic browser script.
  await import('../src/renderer/activation/activationRenderer')
  await Promise.resolve()
  await Promise.resolve()
}

function checkpointStages(checkpoints: unknown[]) {
  return checkpoints.map((checkpoint) => (checkpoint as { stage?: string }).stage)
}

describe('activation renderer startup fallback', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('subscribes before getState and renders the current UNACTIVATED snapshot', async () => {
    const order: string[] = []
    const { api, stateListeners, checkpoints } = makeApi()
    api.onStateChanged.mockImplementation((callback: (state: unknown) => void) => {
      order.push('subscribe')
      stateListeners.push(callback)
      return vi.fn()
    })
    api.getState.mockImplementation(async () => {
      order.push('getState')
      return { ok: true, state: activationState('UNACTIVATED', { storeCodeHint: 'STORE-A' }) }
    })
    const { elements } = installActivationDom(api)

    await importRenderer()

    expect(order).toEqual(['subscribe', 'getState'])
    expect(element(elements, '#state-title').textContent).toBe('激活此收银台')
    expect(element(elements, '#activation-form').hidden).toBe(false)
    expect(element(elements, '#store-code').value).toBe('STORE-A')
    expect(checkpointStages(checkpoints)).toEqual([
      'script-started',
      'bridge-detected',
      'subscribed',
      'get-state-started',
      'get-state-succeeded',
      'rendered',
    ])
  })

  it('shows a pure DOM startup component failure when the preload bridge is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { elements, windowStub } = installActivationDom()

    await importRenderer()

    expect(consoleError).toHaveBeenCalledWith('activation renderer bridge missing')
    expect(element(elements, '#state-title').textContent).toBe('启动组件加载失败')
    expect(element(elements, '#state-detail').textContent).toBe('请重新启动应用；若问题持续，请联系技术支持并提供日志。')
    expect(element(elements, '#activation-form').hidden).toBe(true)
    expect(element(elements, '#retry-button').hidden).toBe(false)
    expect(element(elements, '#retry-button').textContent).toBe('重新加载')
    element(elements, '#retry-button').onclick?.()
    expect((windowStub.location as { reload: ReturnType<typeof vi.fn> }).reload).toHaveBeenCalled()
  })

  it('shows startup failure when getState rejects', async () => {
    const { api, checkpoints } = makeApi()
    api.getState.mockRejectedValue(new Error('renderer getState failed'))
    const { elements } = installActivationDom(api)

    await importRenderer()

    expect(element(elements, '#state-title').textContent).toBe('启动失败')
    expect(element(elements, '#status-code').textContent).toBe('状态: ACTIVATION_GET_STATE_FAILED')
    expect(checkpointStages(checkpoints)).toContain('get-state-failed')
    expect(checkpointStages(checkpoints)).toContain('startup-error')
  })

  it('shows startup failure when subscribe throws before initial state load', async () => {
    const { api, checkpoints } = makeApi()
    api.onStateChanged.mockImplementation(() => {
      throw new Error('subscribe failed token raw-token PIN=123456')
    })
    const { elements } = installActivationDom(api)

    await importRenderer()

    expect(element(elements, '#state-title').textContent).toBe('启动失败')
    expect(element(elements, '#status-code').textContent).toBe('状态: ACTIVATION_RENDERER_INIT_FAILED')
    expect(api.getState).not.toHaveBeenCalled()
    expect(checkpointStages(checkpoints)).toEqual([
      'script-started',
      'bridge-detected',
      'startup-error',
    ])
  })

  it('shows startup failure for invalid initial state snapshots', async () => {
    const { api, checkpoints } = makeApi()
    api.getState.mockResolvedValue({ ok: true, state: { kind: 'UNACTIVATED' } as ActivationState })
    const { elements } = installActivationDom(api)

    await importRenderer()

    expect(element(elements, '#state-title').textContent).toBe('启动失败')
    expect(element(elements, '#status-code').textContent).toBe('状态: ACTIVATION_GET_STATE_FAILED')
    expect(checkpointStages(checkpoints)).toEqual([
      'script-started',
      'bridge-detected',
      'subscribed',
      'get-state-started',
      'get-state-succeeded',
      'get-state-failed',
      'startup-error',
    ])
  })

  it('shows startup failure for renderer state render errors', async () => {
    const { api, stateListeners, checkpoints } = makeApi()
    const { elements } = installActivationDom(api)

    await importRenderer()
    stateListeners[0]?.({ kind: 'UNACTIVATED' })

    expect(element(elements, '#state-title').textContent).toBe('启动失败')
    expect(element(elements, '#status-code').textContent).toBe('状态: ACTIVATION_RENDER_FAILED')
    expect(checkpointStages(checkpoints)).toContain('startup-error')
  })

  it('shows startup failure when renderer startup never completes', async () => {
    vi.useFakeTimers()
    const { api, checkpoints } = makeApi()
    api.getState.mockImplementation(() => new Promise(() => undefined))
    const { elements } = installActivationDom(api)

    await importRenderer()
    expect(element(elements, '#state-title').textContent).toBe('正在启动')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(element(elements, '#state-title').textContent).toBe('启动失败')
    expect(element(elements, '#status-code').textContent).toBe('状态: ACTIVATION_RENDERER_WATCHDOG_TIMEOUT')
    expect(checkpointStages(checkpoints)).toContain('startup-error')
  })

  it('keeps watchdog active for a BOOTING snapshot and fails visibly if no later state arrives', async () => {
    vi.useFakeTimers()
    const { api, checkpoints } = makeApi()
    api.getState.mockResolvedValue({ ok: true, state: activationState('BOOTING') })
    const { elements } = installActivationDom(api)

    await importRenderer()
    expect(element(elements, '#state-title').textContent).toBe('正在启动')

    await vi.advanceTimersByTimeAsync(8_000)

    expect(element(elements, '#state-title').textContent).toBe('启动失败')
    expect(checkpointStages(checkpoints)).toContain('startup-error')
  })

  it('cancels watchdog after a successful non-BOOTING render', async () => {
    vi.useFakeTimers()
    const { api, checkpoints } = makeApi()
    api.getState.mockResolvedValue({ ok: true, state: activationState('UNACTIVATED') })
    const { elements } = installActivationDom(api)

    await importRenderer()
    await vi.advanceTimersByTimeAsync(8_000)

    expect(element(elements, '#state-title').textContent).toBe('激活此收银台')
    expect(checkpointStages(checkpoints)).not.toContain('startup-error')
  })

  it('surfaces global renderer startup errors before first render', async () => {
    const { api, checkpoints } = makeApi()
    api.getState.mockImplementation(() => new Promise(() => undefined))
    const { elements, dispatchWindow } = installActivationDom(api)

    await importRenderer()
    dispatchWindow('error')

    expect(element(elements, '#state-title').textContent).toBe('启动失败')
    expect(element(elements, '#status-code').textContent).toBe('状态: ACTIVATION_RENDERER_UNCAUGHT_ERROR')
    expect(checkpointStages(checkpoints)).toContain('startup-error')
  })

  it('re-synchronizes current state on renderer reload', async () => {
    const { api } = makeApi()
    api.getState.mockResolvedValueOnce({ ok: true, state: activationState('UNACTIVATED') })
    const firstDom = installActivationDom(api)

    await importRenderer()
    expect(element(firstDom.elements, '#state-title').textContent).toBe('激活此收银台')

    api.getState.mockResolvedValueOnce({
      ok: true,
      state: activationState('NETWORK_ERROR', {
        canActivate: false,
        canRetryVerify: true,
        errorCode: 'NETWORK_TIMEOUT',
      }),
    })
    const secondDom = installActivationDom(api)

    await importRenderer()

    expect(api.getState).toHaveBeenCalledTimes(2)
    expect(element(secondDom.elements, '#state-title').textContent).toBe('网络暂时不可用')
    expect(element(secondDom.elements, '#retry-button').hidden).toBe(false)
    expect(element(secondDom.elements, '#status-code').textContent).toBe('状态: NETWORK_TIMEOUT')
  })
})
