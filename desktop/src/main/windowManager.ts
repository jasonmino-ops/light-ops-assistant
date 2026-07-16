/**
 * E-Shop Desktop — Window Manager
 *
 * 职责：员工主窗口、顾客窗口、双屏识别与布局、全屏/无边框、
 * 窗口恢复、误关闭保护、窗口状态持久化、单屏调试。
 *
 * 双屏判定基于 Electron screen 模块动态计算（primary vs 其他 display），
 * 不依赖固定屏幕编号。
 */

import { BrowserWindow, screen, app, type Display } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { customerUrl, employeeUrl, getConfig, isAllowedNavigation } from './config'
import { logger } from './logger'
import { updateHealth, recordHealthError } from './runtimeHealth'
import { cartSyncService } from './cartSyncService'
import { IPC_CHANNELS, type WindowRole } from '../shared/ipcChannels'
import {
  boundsForWindow,
  displayContainsRect,
  fullDisplayBounds,
  planDisplayAssignment,
  referenceFromDisplay,
  settingsForMode,
  settingsForSwap,
  type DisplayAssignmentPlan,
  type DisplayAssignmentSettings,
  type DisplayMode,
  type DisplaySnapshot,
} from './displayAssignment'
import { loadDisplaySettings, saveDisplaySettings } from './displaySettings'
import {
  decideRecovery,
  initialRecoveryState,
  markStarted,
  type RecoveryState,
} from '../shared/backoff'

type WindowState = { x?: number; y?: number; width: number; height: number }

const EMPLOYEE_DEFAULT: WindowState = { width: 1280, height: 800 }
const DISPLAY_EVENT_DEBOUNCE_MS = 250

export type DesktopDisplayState = {
  configuredMode: DisplayMode
  effectiveMode: DisplayMode
  displayCount: number
  primaryDisplayId: number | null
  employeeDisplayId: number | null
  customerDisplayId: number | null
  customerVisible: boolean
  canSwap: boolean
  degraded: boolean
  reason: string
}

export type DesktopDisplayCommandResult = {
  ok: boolean
  state: DesktopDisplayState
  errorCode?: string
}

export class WindowManager {
  private employeeWindow: BrowserWindow | null = null
  private customerWindow: BrowserWindow | null = null
  private customerRecovery: RecoveryState = initialRecoveryState()
  private customerRetryTimer: NodeJS.Timeout | null = null
  private displayEventTimer: NodeJS.Timeout | null = null
  private replayTimers: NodeJS.Timeout[] = []
  private quitting = false
  private customerEnabled = true
  private closingCustomerForLayout = false
  private suppressNextCustomerRecovery = false
  private displaySettingsPathValue: string | null = null
  private displaySettings: DisplayAssignmentSettings = { version: 1, displayMode: 'dual', swapped: false }
  private readonly roleByWebContentsId = new Map<number, WindowRole>()

  /** IPC 层用于校验发送者身份 */
  getRole(webContentsId: number): WindowRole | undefined {
    return this.roleByWebContentsId.get(webContentsId)
  }

  setQuitting() {
    this.quitting = true
    if (this.customerRetryTimer) clearTimeout(this.customerRetryTimer)
    if (this.displayEventTimer) clearTimeout(this.displayEventTimer)
    for (const t of this.replayTimers) clearTimeout(t)
  }

  getEmployeeWindow() {
    return this.employeeWindow
  }

  getCustomerWindow() {
    return this.customerWindow
  }

  initDisplaySettings(userDataDir: string) {
    const result = loadDisplaySettings(userDataDir)
    this.displaySettings = result.settings
    this.displaySettingsPathValue = result.path
    if (result.recovered) {
      logger.warn('display-settings.recovered', { path: result.path, error: result.error })
    } else {
      logger.info('display-settings.loaded', { path: result.path, displayMode: result.settings.displayMode })
    }
  }

  // ── 屏幕识别 ───────────────────────────────────────────────────────────────

  private describeDisplays() {
    const all = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const externals = all.filter((d) => d.id !== primary.id)
    return { all, primary, externals }
  }

  private publishDisplayHealth() {
    const { all, primary, externals } = this.describeDisplays()
    updateHealth({
      displays: { count: all.length, primaryId: primary.id, externalIds: externals.map((d) => d.id) },
    }, 'displays.changed')
  }

  watchDisplays() {
    this.publishDisplayHealth()
    screen.on('display-added', (_event, display) => {
      logger.info('displays.added')
      this.scheduleDisplayReconcile('display-added', display)
    })
    screen.on('display-removed', (_event, display) => {
      logger.info('displays.removed')
      this.scheduleDisplayReconcile('display-removed', display)
    })
    screen.on('display-metrics-changed', (_event, display, metrics) => {
      logger.info('displays.metrics-changed', { displayId: display.id, metrics })
      this.scheduleDisplayReconcile('display-metrics-changed', display)
    })
  }

  private scheduleDisplayReconcile(reason: string, display?: Display) {
    if (this.displayEventTimer) clearTimeout(this.displayEventTimer)
    this.displayEventTimer = setTimeout(() => {
      this.displayEventTimer = null
      this.applyDisplayLayout(reason, { focusEmployee: true })
    }, DISPLAY_EVENT_DEBOUNCE_MS)
    this.publishDisplayHealth()
    if (display) logger.info('display-reconcile.scheduled', { reason, displayId: display.id })
  }

  private displaySnapshots(): { all: DisplaySnapshot[]; primary: DisplaySnapshot | null } {
    const { all, primary } = this.describeDisplays()
    const snapshots = all.map((display) => this.toSnapshot(display))
    return {
      all: snapshots,
      primary: snapshots.find((display) => display.id === primary.id) ?? snapshots[0] ?? null,
    }
  }

  private toSnapshot(display: Display): DisplaySnapshot {
    return {
      id: display.id,
      label: display.label,
      bounds: { ...display.bounds },
      workArea: { ...display.workArea },
      size: { ...display.size },
      scaleFactor: display.scaleFactor,
      internal: display.internal,
    }
  }

  private currentPlan(): DisplayAssignmentPlan {
    const { all, primary } = this.displaySnapshots()
    return planDisplayAssignment(all, primary?.id ?? null, this.displaySettings)
  }

  getDisplayState(): DesktopDisplayState {
    return this.describePlan(this.currentPlan())
  }

  setDisplayMode(mode: DisplayMode): DesktopDisplayCommandResult {
    if (mode !== 'single' && mode !== 'dual') {
      return { ok: false, state: this.getDisplayState(), errorCode: 'INVALID_DISPLAY_MODE' }
    }
    const plan = this.currentPlan()
    this.displaySettings = settingsForMode(this.displaySettings, mode, plan)
    this.persistDisplaySettings('set-mode')
    const next = this.applyDisplayLayout(`set-mode:${mode}`, { focusEmployee: true })
    return { ok: true, state: this.describePlan(next) }
  }

  swapDisplays(): DesktopDisplayCommandResult {
    const plan = this.currentPlan()
    const nextSettings = settingsForSwap(this.displaySettings, plan)
    if (!nextSettings) {
      return { ok: false, state: this.describePlan(plan), errorCode: 'SWAP_UNAVAILABLE' }
    }
    this.displaySettings = nextSettings
    const next = this.applyDisplayLayout('swap', { focusEmployee: true })
    if (!next.canSwap) {
      return { ok: false, state: this.describePlan(next), errorCode: 'SWAP_FAILED' }
    }
    this.persistDisplaySettings('swap')
    return { ok: true, state: this.describePlan(next) }
  }

  applyDisplayLayout(reason: string, options: { focusEmployee?: boolean } = {}): DisplayAssignmentPlan {
    const plan = this.currentPlan()
    this.publishDisplayHealth()
    updateHealth({
      customerWindow: plan.customerVisible ? 'starting' : 'closed',
    }, `display-layout.${reason}`)

    if (!plan.employeeDisplay) {
      recordHealthError('display-layout', `no employee display available (${reason})`)
      this.closeCustomerWindow('no-employee-display')
      return plan
    }

    const employee = this.employeeWindow && !this.employeeWindow.isDestroyed()
      ? this.employeeWindow
      : this.createEmployeeWindow()
    this.placeEmployeeWindow(employee, plan.employeeDisplay)

    if (plan.effectiveMode !== 'dual' || !plan.customerDisplay) {
      this.closeCustomerWindow(`layout:${reason}`)
    } else {
      const customer = this.ensureCustomerWindowOn(plan.customerDisplay, reason)
      if (customer) this.placeCustomerWindow(customer, plan.customerDisplay)
    }

    if (options.focusEmployee) this.focusEmployeeWindow()
    this.rememberPlan(plan)
    if (plan.effectiveMode === 'dual') this.persistDisplaySettings(`layout:${reason}`)
    logger.info('display-layout.applied', {
      reason,
      configuredMode: plan.configuredMode,
      effectiveMode: plan.effectiveMode,
      employeeDisplayId: plan.employeeDisplay?.id,
      customerDisplayId: plan.customerDisplay?.id,
    })
    return plan
  }

  private describePlan(plan: DisplayAssignmentPlan): DesktopDisplayState {
    return {
      configuredMode: plan.configuredMode,
      effectiveMode: plan.effectiveMode,
      displayCount: plan.displayCount,
      primaryDisplayId: plan.primaryDisplayId,
      employeeDisplayId: plan.employeeDisplay?.id ?? null,
      customerDisplayId: plan.customerDisplay?.id ?? null,
      customerVisible: plan.customerVisible,
      canSwap: plan.canSwap,
      degraded: plan.degraded,
      reason: plan.reason,
    }
  }

  private rememberPlan(plan: DisplayAssignmentPlan) {
    if (!plan.employeeDisplay) return
    this.displaySettings = {
      ...this.displaySettings,
      employeeDisplay: referenceFromDisplay(plan.employeeDisplay),
      customerDisplay: plan.customerDisplay ? referenceFromDisplay(plan.customerDisplay) : this.displaySettings.customerDisplay,
    }
  }

  private persistDisplaySettings(reason: string) {
    if (!this.displaySettingsPathValue) return
    try {
      saveDisplaySettings(this.displaySettingsPathValue, this.displaySettings)
      logger.info('display-settings.saved', { reason, path: this.displaySettingsPathValue })
    } catch (error) {
      recordHealthError('display-settings', `save failed: ${String(error)}`)
    }
  }

  // ── 员工窗口 ───────────────────────────────────────────────────────────────

  private employeeStatePath() {
    return join(app.getPath('userData'), 'window-state.json')
  }

  private loadEmployeeState(): WindowState {
    try {
      const p = this.employeeStatePath()
      if (existsSync(p)) {
        const parsed = JSON.parse(readFileSync(p, 'utf8')) as WindowState
        if (parsed && typeof parsed.width === 'number' && typeof parsed.height === 'number') return parsed
      }
    } catch { /* 使用默认 */ }
    return EMPLOYEE_DEFAULT
  }

  private saveEmployeeState() {
    if (!this.employeeWindow || this.employeeWindow.isDestroyed()) return
    try {
      const b = this.employeeWindow.getBounds()
      writeFileSync(this.employeeStatePath(), JSON.stringify(b), 'utf8')
    } catch { /* 非关键 */ }
  }

  createEmployeeWindow(): BrowserWindow {
    if (this.employeeWindow && !this.employeeWindow.isDestroyed()) {
      this.employeeWindow.show()
      this.employeeWindow.focus()
      return this.employeeWindow
    }
    const plan = this.currentPlan()
    const targetDisplay = plan.employeeDisplay ?? this.toSnapshot(this.describeDisplays().primary)
    const state = this.loadEmployeeState()
    const employeeBounds = this.resolveEmployeeBounds(state, targetDisplay)
    const win = new BrowserWindow({
      title: 'E-Shop Desktop — POS',
      x: employeeBounds.x,
      y: employeeBounds.y,
      width: employeeBounds.width,
      height: employeeBounds.height,
      minWidth: 1024,
      minHeight: 700,
      backgroundColor: '#0f1115',
      webPreferences: {
        preload: join(__dirname, '../preload/employeePreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        additionalArguments: [`--eshop-desktop-version=${app.getVersion()}`],
      },
    })
    this.employeeWindow = win
    this.roleByWebContentsId.set(win.webContents.id, 'employee')
    this.hardenWebContents(win, 'employee')
    updateHealth({ employeeWindow: 'starting' }, 'employee-window.creating')

    win.loadURL(employeeUrl()).catch((error) => {
      recordHealthError('employee-window', `loadURL failed: ${String(error)}`)
    })

    win.webContents.on('did-finish-load', () => {
      updateHealth({ employeeWindow: 'ok', cloudReachability: 'ok', network: 'ok' }, 'employee-window.loaded')
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      updateHealth({ employeeWindow: 'error', cloudReachability: 'error' }, 'employee-window.load-failed')
      recordHealthError('employee-window', `did-fail-load ${code} ${desc} ${url}`)
    })
    win.on('moved', () => this.saveEmployeeState())
    win.on('resized', () => this.saveEmployeeState())
    win.on('closed', () => {
      this.roleByWebContentsId.delete(win.webContents.id)
      this.employeeWindow = null
      updateHealth({ employeeWindow: 'closed' }, 'employee-window.closed')
      // 误关闭保护：Runtime 常驻 Tray，不随员工窗口退出
    })
    logger.info('employee-window.created', { display: targetDisplay.id })
    return win
  }

  private resolveEmployeeBounds(state: WindowState, display: DisplaySnapshot) {
    const candidate = {
      x: state.x ?? display.workArea.x + 40,
      y: state.y ?? display.workArea.y + 40,
      width: state.width,
      height: state.height,
    }
    if (typeof state.x === 'number' && typeof state.y === 'number' && displayContainsRect(display, candidate)) {
      return candidate
    }
    return boundsForWindow(display, { width: state.width, height: state.height })
  }

  private placeEmployeeWindow(win: BrowserWindow, display: DisplaySnapshot) {
    if (win.isDestroyed()) return
    try {
      if (win.isFullScreen()) win.setFullScreen(false)
      if (win.isMaximized()) win.unmaximize()
      const current = win.getBounds()
      if (!displayContainsRect(display, current)) {
        win.setBounds(boundsForWindow(display, { width: current.width, height: current.height }))
      }
      if (win.isMinimized()) win.restore()
      win.show()
    } catch (error) {
      recordHealthError('employee-window', `place failed: ${String(error)}`)
    }
  }

  focusEmployeeWindow() {
    if (this.employeeWindow && !this.employeeWindow.isDestroyed()) {
      if (this.employeeWindow.isMinimized()) this.employeeWindow.restore()
      this.employeeWindow.show()
      this.employeeWindow.focus()
    } else {
      this.createEmployeeWindow()
    }
  }

  // ── 顾客窗口 ───────────────────────────────────────────────────────────────

  /** 顾客窗口目标屏：第一块非主屏；无副屏时按需回退主屏（仅调试/强制模式） */
  /** 保证顾客窗口存在（仅有效 dual runtime state）；不会重复创建 */
  ensureCustomerWindow(reason: string): BrowserWindow | null {
    const plan = this.currentPlan()
    if (!plan.customerVisible || !plan.customerDisplay) {
      this.closeCustomerWindow(`ensure-skipped:${reason}`)
      return null
    }
    return this.ensureCustomerWindowOn(plan.customerDisplay, reason)
  }

  private ensureCustomerWindowOn(display: DisplaySnapshot, reason: string): BrowserWindow | null {
    if (this.quitting || !this.customerEnabled) return null
    if (this.customerWindow && !this.customerWindow.isDestroyed()) return this.customerWindow
    return this.createCustomerWindow(display, reason)
  }

  private createCustomerWindow(display: DisplaySnapshot, reason: string): BrowserWindow {
    const win = new BrowserWindow({
      title: 'E-Shop Desktop — Customer Display',
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      fullscreen: false,
      show: false,
      focusable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: '#0f1115',
      webPreferences: {
        preload: join(__dirname, '../preload/customerPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        additionalArguments: [`--eshop-desktop-version=${app.getVersion()}`],
      },
    })
    this.customerWindow = win
    this.roleByWebContentsId.set(win.webContents.id, 'customer')
    this.hardenWebContents(win, 'customer')
    updateHealth({ customerWindow: 'starting' }, 'customer-window.creating')

    // 注入顾客快照发送器
    cartSyncService.setCustomerSender((message) => {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.CART_APPLY, message)
    })

    win.loadURL(customerUrl()).catch((error) => {
      recordHealthError('customer-window', `loadURL failed: ${String(error)}`)
    })

    win.webContents.on('did-finish-load', () => {
      this.customerRecovery = markStarted(this.customerRecovery, Date.now())
      updateHealth({
        customerWindow: 'ok',
        customerRecovery: { attempts: this.customerRecovery.attempts, exhausted: false },
      }, 'customer-window.loaded')
      // React 挂载与 BroadcastChannel 订阅存在时间差：延迟重推两次，
      // 页面自身 guard 会拒绝重复快照，不会造成回退。
      this.scheduleReplay('did-finish-load')
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      recordHealthError('customer-window', `did-fail-load ${code} ${desc} ${url}`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      recordHealthError('customer-window', `render-process-gone: ${details.reason}`)
      if (!win.isDestroyed()) win.destroy()
    })
    win.on('closed', () => {
      this.roleByWebContentsId.delete(win.webContents.id)
      if (this.customerWindow === win) this.customerWindow = null
      cartSyncService.setCustomerSender(null)
      updateHealth({ customerWindow: 'closed' }, 'customer-window.closed')
      const suppressRecovery = this.closingCustomerForLayout || this.suppressNextCustomerRecovery
      this.suppressNextCustomerRecovery = false
      if (!suppressRecovery && !this.quitting && this.customerEnabled) this.scheduleCustomerRecovery('window-closed')
    })
    this.placeCustomerWindow(win, display)
    logger.info('customer-window.created', { display: display.id, reason })
    return win
  }

  private placeCustomerWindow(win: BrowserWindow, display: DisplaySnapshot) {
    if (win.isDestroyed()) return
    try {
      if (win.isFullScreen()) win.setFullScreen(false)
      win.setBounds(fullDisplayBounds(display))
      win.setFullScreen(true)
      win.showInactive()
      updateHealth({ customerWindow: 'ok' }, 'customer-window.placed')
    } catch (error) {
      recordHealthError('customer-window', `place failed: ${String(error)}`)
    }
  }

  private closeCustomerWindow(reason: string) {
    if (!this.customerWindow || this.customerWindow.isDestroyed()) {
      cartSyncService.setCustomerSender(null)
      updateHealth({ customerWindow: 'closed' }, `customer-window.closed:${reason}`)
      return
    }
    try {
      this.closingCustomerForLayout = true
      this.suppressNextCustomerRecovery = true
      this.customerWindow.setFullScreen(false)
      this.customerWindow.close()
      logger.info('customer-window.closed-for-layout', { reason })
    } catch (error) {
      recordHealthError('customer-window', `close failed: ${String(error)}`)
      try {
        this.customerWindow.hide()
      } catch { /* ignore */ }
    } finally {
      this.closingCustomerForLayout = false
      cartSyncService.setCustomerSender(null)
    }
  }

  private scheduleReplay(reason: string) {
    for (const t of this.replayTimers) clearTimeout(t)
    this.replayTimers = [
      setTimeout(() => cartSyncService.replayLatest(`${reason}+500ms`), 500),
      setTimeout(() => cartSyncService.replayLatest(`${reason}+2500ms`), 2500),
    ]
  }

  /** 顾客窗口意外关闭/崩溃后的自动恢复（有限次数 + 指数退避） */
  private scheduleCustomerRecovery(reason: string) {
    if (this.customerRetryTimer) return
    const decision = decideRecovery(this.customerRecovery, Date.now())
    this.customerRecovery = decision.state
    updateHealth({
      customerRecovery: { attempts: decision.state.attempts, exhausted: decision.state.exhausted },
    }, 'customer-window.recovery-decision')
    if (decision.action === 'give-up') {
      recordHealthError('customer-window', `recovery exhausted after ${decision.state.attempts} attempts (${reason})`)
      return
    }
    logger.warn('customer-window.recovery-scheduled', {
      reason,
      attempt: decision.state.attempts,
      delayMs: decision.delayMs,
    })
    this.customerRetryTimer = setTimeout(() => {
      this.customerRetryTimer = null
      this.ensureCustomerWindow(`recovery:${reason}`)
    }, decision.delayMs)
  }

  /** Tray 手动开关顾客窗口 */
  toggleCustomerWindow() {
    const nextMode: DisplayMode = this.displaySettings.displayMode === 'dual' ? 'single' : 'dual'
    this.customerEnabled = true
    this.customerRecovery = initialRecoveryState()
    this.setDisplayMode(nextMode)
  }

  // ── 安全加固（两个窗口共用） ─────────────────────────────────────────────

  private hardenWebContents(win: BrowserWindow, role: WindowRole) {
    const wc = win.webContents
    // 禁止任意新窗口
    wc.setWindowOpenHandler(({ url }) => {
      logger.warn('security.window-open-denied', { role, url })
      return { action: 'deny' }
    })
    // 导航仅允许 baseUrl 同源
    wc.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) {
        event.preventDefault()
        logger.warn('security.navigation-denied', { role, url })
      }
    })
    // 默认拒绝所有权限请求（摄像头/通知等；Milestone A 页面不需要）
    wc.session.setPermissionRequestHandler((_wc, permission, callback) => {
      logger.warn('security.permission-denied', { role, permission })
      callback(false)
    })
  }
}

export const windowManager = new WindowManager()
