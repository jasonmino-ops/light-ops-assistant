import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockDisplay = {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  size: { width: number; height: number }
  scaleFactor: number
  internal: boolean
}

const mock = vi.hoisted(() => {
  const listeners = new Map<string, Function[]>()
  const instances: any[] = []
  let displays: MockDisplay[] = []
  let primaryId = 1
  let nextWebContentsId = 1
  let userDataDir = '/tmp'
  class MockBrowserWindow {
    title: string
    bounds: MockDisplay['bounds']
    destroyed = false
    fullscreen = false
    maximized = false
    minimized = false
    focusCount = 0
    showCount = 0
    showInactiveCount = 0
    handlers = new Map<string, Function[]>()
    webContents = {
      id: nextWebContentsId++,
      on: vi.fn((event: string, handler: Function) => {
        this.webContentsHandlers.set(event, [...(this.webContentsHandlers.get(event) ?? []), handler])
      }),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn() },
    }
    webContentsHandlers = new Map<string, Function[]>()

    constructor(options: any) {
      this.title = options.title
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
      this.fullscreen = options.fullscreen === true
      instances.push(this)
    }

    loadURL = vi.fn(() => Promise.resolve())
    isDestroyed = () => this.destroyed
    getBounds = () => ({ ...this.bounds })
    setBounds = vi.fn((bounds: MockDisplay['bounds']) => { this.bounds = { ...bounds } })
    setFullScreen = vi.fn((next: boolean) => { this.fullscreen = next })
    isFullScreen = () => this.fullscreen
    isMaximized = () => this.maximized
    unmaximize = vi.fn(() => { this.maximized = false })
    isMinimized = () => this.minimized
    restore = vi.fn(() => { this.minimized = false })
    show = vi.fn(() => { this.showCount++ })
    showInactive = vi.fn(() => { this.showInactiveCount++ })
    focus = vi.fn(() => { this.focusCount++ })
    hide = vi.fn()
    close = vi.fn(() => {
      this.destroyed = true
      for (const handler of this.handlers.get('closed') ?? []) handler()
    })
    destroy = vi.fn(() => {
      this.destroyed = true
      for (const handler of this.handlers.get('closed') ?? []) handler()
    })
    on = vi.fn((event: string, handler: Function) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    })
  }
  return {
    listeners,
    instances,
    get displays() { return displays },
    setDisplays(next: MockDisplay[], nextPrimaryId = next[0]?.id ?? 1) {
      displays = next
      primaryId = nextPrimaryId
    },
    emit(event: string, display?: MockDisplay, metrics?: string[]) {
      for (const handler of listeners.get(event) ?? []) handler({}, display, metrics)
    },
    reset() {
      listeners.clear()
      instances.length = 0
      displays = []
      primaryId = 1
      nextWebContentsId = 1
      userDataDir = '/tmp'
    },
    setUserDataDir(dir: string) {
      userDataDir = dir
    },
    electron: {
      BrowserWindow: MockBrowserWindow,
      screen: {
        getAllDisplays: () => displays,
        getPrimaryDisplay: () => displays.find((display) => display.id === primaryId) ?? displays[0],
        on: vi.fn((event: string, handler: Function) => {
          listeners.set(event, [...(listeners.get(event) ?? []), handler])
        }),
      },
      app: {
        getPath: () => userDataDir,
        getVersion: () => '0.1.0-test',
      },
    },
  }
})

vi.mock('electron', () => mock.electron)

import { loadConfig } from '../src/main/config'
import { WindowManager } from '../src/main/windowManager'

function display(id: number, x: number): MockDisplay {
  return {
    id,
    label: `DISPLAY-${id}`,
    bounds: { x, y: 0, width: 1280, height: 720 },
    workArea: { x, y: 0, width: 1280, height: 680 },
    size: { width: 1280, height: 720 },
    scaleFactor: 1,
    internal: id === 1,
  }
}

function tempUserData(settings?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'window-manager-display-'))
  mock.setUserDataDir(dir)
  if (settings) writeFileSync(join(dir, 'display-settings.json'), JSON.stringify(settings), 'utf8')
  loadConfig(dir)
  return dir
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  mock.reset()
})

describe('WindowManager display behavior', () => {
  it('starts single mode without a customer window', () => {
    mock.setDisplays([display(1, 0)], 1)
    const dir = tempUserData({ version: 1, displayMode: 'single', swapped: false })
    const wm = new WindowManager()
    wm.initDisplaySettings(dir)
    wm.createEmployeeWindow()
    wm.applyDisplayLayout('test')
    expect(mock.instances).toHaveLength(1)
    expect(mock.instances[0].title).toContain('POS')
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts dual mode with customer fullscreen shown inactive', () => {
    mock.setDisplays([display(1, 0), display(2, 1300)], 1)
    const dir = tempUserData()
    const wm = new WindowManager()
    wm.initDisplaySettings(dir)
    wm.createEmployeeWindow()
    wm.applyDisplayLayout('test')
    expect(mock.instances).toHaveLength(2)
    const customer = mock.instances[1]
    expect(customer.title).toContain('Customer Display')
    expect(customer.fullscreen).toBe(true)
    expect(customer.showInactiveCount).toBeGreaterThan(0)
    expect(customer.focusCount).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('swaps by moving existing windows and keeps employee webContents', () => {
    mock.setDisplays([display(1, 0), display(2, 1300)], 1)
    const dir = tempUserData()
    const wm = new WindowManager()
    wm.initDisplaySettings(dir)
    const employee = wm.createEmployeeWindow()
    wm.applyDisplayLayout('test')
    const employeeWebContentsId = employee.webContents.id
    const customer = wm.getCustomerWindow()!
    const result = wm.swapDisplays()
    expect(result.ok).toBe(true)
    expect(wm.getEmployeeWindow()?.webContents.id).toBe(employeeWebContentsId)
    expect(wm.getCustomerWindow()).toBe(customer)
    expect(mock.instances).toHaveLength(2)
    expect(employee.getBounds().x).toBe(1300)
    expect(customer.getBounds().x).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('closes customer when customer display is removed and does not move it to the only screen', () => {
    mock.setDisplays([display(1, 0), display(2, 1300)], 1)
    const dir = tempUserData()
    const wm = new WindowManager()
    wm.initDisplaySettings(dir)
    wm.createEmployeeWindow()
    wm.applyDisplayLayout('test')
    const customer = wm.getCustomerWindow()!
    mock.setDisplays([display(1, 0)], 1)
    wm.applyDisplayLayout('removed')
    expect(customer.close).toHaveBeenCalled()
    expect(wm.getCustomerWindow()).toBeNull()
    expect(wm.getEmployeeWindow()?.isDestroyed()).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('moves employee to remaining display when employee display is removed', () => {
    mock.setDisplays([display(1, 0), display(2, 1300)], 1)
    const dir = tempUserData({
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 1 },
      customerDisplay: { id: 2 },
    })
    const wm = new WindowManager()
    wm.initDisplaySettings(dir)
    const employee = wm.createEmployeeWindow()
    wm.applyDisplayLayout('test')
    mock.setDisplays([display(2, 1300)], 2)
    wm.applyDisplayLayout('employee-removed')
    expect(employee.getBounds().x).toBe(1300)
    expect((employee as unknown as { focusCount: number }).focusCount).toBeGreaterThanOrEqual(0)
    expect(wm.getCustomerWindow()).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('debounces repeated display-added events and avoids duplicate customer windows', () => {
    vi.useFakeTimers()
    mock.setDisplays([display(1, 0), display(2, 1300)], 1)
    const dir = tempUserData()
    const wm = new WindowManager()
    wm.initDisplaySettings(dir)
    wm.createEmployeeWindow()
    wm.watchDisplays()
    mock.emit('display-added', display(2, 1300))
    mock.emit('display-added', display(2, 1300))
    vi.advanceTimersByTime(300)
    expect(mock.instances.filter((win) => win.title.includes('Customer Display'))).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('responds to display-metrics-changed without creating another customer window', () => {
    vi.useFakeTimers()
    mock.setDisplays([display(1, 0), display(2, 1300)], 1)
    const dir = tempUserData()
    const wm = new WindowManager()
    wm.initDisplaySettings(dir)
    wm.createEmployeeWindow()
    wm.applyDisplayLayout('test')
    wm.watchDisplays()
    mock.emit('display-metrics-changed', display(2, 1300), ['bounds'])
    vi.advanceTimersByTime(300)
    expect(mock.instances.filter((win) => win.title.includes('Customer Display'))).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
