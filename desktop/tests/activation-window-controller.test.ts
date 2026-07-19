import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../src/main/logger'
import { ActivationWindowController } from '../src/main/activation/activationWindowController'

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void

  class FakeEventEmitter {
    readonly handlers = new Map<string, Handler[]>()
    readonly onceHandlers = new Map<string, Handler[]>()

    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    }

    once(event: string, handler: Handler) {
      this.onceHandlers.set(event, [...(this.onceHandlers.get(event) ?? []), handler])
      return this
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
      const once = this.onceHandlers.get(event) ?? []
      this.onceHandlers.delete(event)
      for (const handler of once) handler(...args)
      return true
    }
  }

  let nextWebContentsId = 100

  class FakeWebContents extends FakeEventEmitter {
    readonly id = nextWebContentsId++
    readonly mainFrame = {}
    readonly session = {
      setPermissionRequestHandler: vi.fn(),
    }

    readonly send = vi.fn()
    readonly executeJavaScript = vi.fn(async (_script: string) => undefined)
    readonly setWindowOpenHandler = vi.fn((_handler: (input: { url: string }) => { action: string }) => undefined)
  }

  class FakeBrowserWindow extends FakeEventEmitter {
    static instances: FakeBrowserWindow[] = []

    readonly webContents = new FakeWebContents()
    readonly loadFile = vi.fn(async () => undefined)
    readonly restore = vi.fn(() => { this.minimized = false })
    readonly show = vi.fn()
    readonly focus = vi.fn()
    readonly close = vi.fn(() => { this.emit('closed') })
    readonly destroy = vi.fn(() => {
      this.destroyed = true
      this.emit('closed')
    })

    destroyed = false
    minimized = false

    constructor() {
      super()
      FakeBrowserWindow.instances.push(this)
    }

    isDestroyed() {
      return this.destroyed
    }

    isMinimized() {
      return this.minimized
    }
  }

  return { FakeBrowserWindow }
})

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.2.0-test',
  },
  BrowserWindow: electronMock.FakeBrowserWindow,
}))

function latestWindow() {
  const win = electronMock.FakeBrowserWindow.instances.at(-1)
  if (!win) throw new Error('missing fake BrowserWindow')
  return win
}

function makeController(options: { watchdogMs?: number } = {}) {
  const onStartupFailure = vi.fn()
  const controller = new ActivationWindowController({
    isAuthorized: () => false,
    onClosedBeforeAuthorization: vi.fn(),
    onStartupFailure,
    watchdogMs: options.watchdogMs ?? 25,
  })
  return { controller, onStartupFailure }
}

function stringify(value: unknown) {
  return JSON.stringify(value)
}

describe('activation window startup diagnostics', () => {
  beforeEach(() => {
    electronMock.FakeBrowserWindow.instances.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('logs window startup and shows fallback when the renderer never acknowledges startup', async () => {
    vi.useFakeTimers()
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { controller, onStartupFailure } = makeController({ watchdogMs: 25 })

    controller.show()
    const win = latestWindow()
    expect(info).toHaveBeenCalledWith('activation-window.create.started')
    expect(info).toHaveBeenCalledWith('activation-window.created')

    await vi.advanceTimersByTimeAsync(25)

    expect(error).toHaveBeenCalledWith('activation-window.startup-watchdog-triggered', { timeoutMs: 25 })
    expect(onStartupFailure).toHaveBeenCalledWith('ACTIVATION_RENDERER_STARTUP_TIMEOUT')
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(win.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain('启动失败')
  })

  it('cancels the startup watchdog after a non-BOOTING renderer checkpoint', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { controller, onStartupFailure } = makeController({ watchdogMs: 25 })

    controller.show()
    controller.handleRendererCheckpoint({ stage: 'rendered', stateKind: 'UNACTIVATED' })
    await vi.advanceTimersByTimeAsync(50)

    expect(error).not.toHaveBeenCalledWith('activation-window.startup-watchdog-triggered', expect.any(Object))
    expect(onStartupFailure).not.toHaveBeenCalled()
    expect(latestWindow().webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('records preload failure with sanitized source and visible startup fallback', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { controller, onStartupFailure } = makeController()

    controller.show()
    const win = latestWindow()
    win.webContents.emit(
      'preload-error',
      {},
      '/Users/jason/app/dist/preload/activationPreload.js?token=raw-token',
      new Error('token raw-token PIN=123456 at C:\\Users\\Jason\\app.js:1:2'),
    )

    expect(onStartupFailure).toHaveBeenCalledWith('ACTIVATION_PRELOAD_ERROR')
    expect(error).toHaveBeenCalledWith('activation-window.preload-error', expect.objectContaining({
      source: 'activationPreload.js',
      message: expect.any(String),
    }))
    expect(stringify(error.mock.calls)).not.toMatch(/raw-token|123456|\/Users\/jason|C:\\Users\\Jason|activationPreload\.js\?token/i)
    expect(win.webContents.executeJavaScript).toHaveBeenCalled()
  })

  it('records did-fail-load safely and only fails visibly for the main frame', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const { controller, onStartupFailure } = makeController()

    controller.show()
    const win = latestWindow()
    win.webContents.emit(
      'did-fail-load',
      {},
      -105,
      'failed https://elifekh.com/desktop/pos?storeCode=STORE-A&pin=123456 C:\\Users\\Jason\\app.js:1:2',
      'https://elifekh.com/desktop/pos?storeCode=STORE-A&deviceToken=raw-token',
      false,
    )
    expect(onStartupFailure).not.toHaveBeenCalled()

    win.webContents.emit(
      'did-fail-load',
      {},
      -6,
      'failed https://elifekh.com/desktop/pos?storeCode=STORE-A&pin=123456',
      'https://elifekh.com/desktop/pos?storeCode=STORE-A&deviceToken=raw-token',
      true,
    )

    expect(onStartupFailure).toHaveBeenCalledWith('ACTIVATION_WINDOW_DID_FAIL_LOAD')
    expect(error).toHaveBeenCalledWith('activation-window.did-fail-load', expect.objectContaining({
      code: -6,
      isMainFrame: true,
      urlCategory: 'BUSINESS_PAGE',
      originHostHash: expect.stringMatching(/^host-[a-f0-9]{12}$/),
      message: expect.any(String),
    }))
    expect(stringify(error.mock.calls)).not.toMatch(/https:\/\/elifekh\.com|STORE-A|123456|raw-token|deviceToken|C:\\Users\\Jason/)
  })

  it('records render-process-gone as a visible startup failure without rebuilding the window', () => {
    const { controller, onStartupFailure } = makeController()

    controller.show()
    const win = latestWindow()
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 })

    expect(onStartupFailure).toHaveBeenCalledWith('ACTIVATION_RENDER_PROCESS_GONE')
    expect(electronMock.FakeBrowserWindow.instances).toHaveLength(1)
    expect(win.webContents.executeJavaScript).toHaveBeenCalled()
  })

  it('records only warning/error console messages and sanitizes message/source fields', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const { controller } = makeController()

    controller.show()
    const win = latestWindow()
    win.webContents.emit(
      'console-message',
      {},
      1,
      'debug should not cross diagnostics',
      7,
      '/Users/jason/app/dist/activationRenderer.js?token=raw-token',
    )
    expect(warn).not.toHaveBeenCalledWith('activation-window.console-error', expect.any(Object))

    win.webContents.emit(
      'console-message',
      {},
      3,
      'token raw-token PIN=123456 https://elifekh.com/desktop/pos?storeCode=STORE-A C:\\Users\\Jason\\app.js:1:2',
      42,
      'C:\\Users\\Jason\\app\\activationRenderer.js?token=raw-token',
    )

    expect(warn).toHaveBeenCalledWith('activation-window.console-error', {
      level: 'error',
      message: expect.any(String),
      source: 'activationRenderer.js',
      line: 42,
    })
    expect(stringify(warn.mock.calls)).not.toMatch(/raw-token|123456|https:\/\/elifekh\.com|STORE-A|C:\\Users\\Jason|activationRenderer\.js\?token/i)
  })

  it('preserves safe renderer error names and messages for bootstrap diagnosis', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const { controller } = makeController()

    controller.show()
    latestWindow().webContents.emit(
      'console-message',
      {},
      3,
      'Uncaught ReferenceError: exports is not defined',
      2,
      'activationRenderer.js',
    )

    expect(warn).toHaveBeenCalledWith('activation-window.console-error', {
      level: 'error',
      message: 'ReferenceError: exports is not defined',
      source: 'activationRenderer.js',
      line: 2,
    })
  })

  it('redacts renderer error messages that contain secrets or local paths', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const { controller } = makeController()

    controller.show()
    latestWindow().webContents.emit(
      'console-message',
      {},
      3,
      'Uncaught TypeError: failed for STORE-A with PIN=123456 token raw-token at C:\\Users\\Jason\\app.js:1:2',
      2,
      'C:\\Users\\Jason\\app\\activationRenderer.js?token=raw-token',
    )

    const serialized = stringify(warn.mock.calls)
    expect(serialized).toContain('diagnostic message redacted')
    expect(serialized).not.toMatch(/STORE-A|123456|raw-token|C:\\Users\\Jason|activationRenderer\.js\?token/i)
  })

  it('does not log raw external URLs from activation window hardening', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const { controller } = makeController()

    controller.show()
    const win = latestWindow()
    const windowOpenHandler = win.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (input: { url: string }) => { action: string }
    expect(windowOpenHandler({
      url: 'https://elifekh.com/desktop/pos?storeCode=STORE-A&pin=123456',
    })).toEqual({ action: 'deny' })

    const navigationEvent = { preventDefault: vi.fn() }
    win.webContents.emit(
      'will-navigate',
      navigationEvent,
      'https://elifekh.com/desktop/pos?storeCode=STORE-A&deviceToken=raw-token',
    )

    expect(navigationEvent.preventDefault).toHaveBeenCalled()
    expect(stringify(warn.mock.calls)).not.toMatch(/https:\/\/elifekh\.com|STORE-A|123456|raw-token|deviceToken/)
  })
})
