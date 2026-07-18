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
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { customerUrl, employeeUrl, getConfig, isAllowedNavigation } from './config'
import { logger } from './logger'
import {
  markDeploymentCloudRecovered,
  recordDeploymentFailure,
  recordHealthError,
  updateDeploymentComponent,
  updateDeploymentRetry,
  updateHealth,
} from './runtimeHealth'
import { cartSyncService } from './cartSyncService'
import { IPC_CHANNELS, type WindowRole } from '../shared/ipcChannels'
import {
  categorizeDiagnosticsUrl,
  classifyDeploymentFailure,
  getDeploymentFailureDescriptor,
  sanitizeDiagnosticMessage,
  type DeploymentFailure,
} from '../shared/deploymentDiagnostics'
import {
  beginRetry,
  completeRetrySuccess,
  initialRetryState,
  markRetryFailure,
  type RetryTransitionResult,
} from '../shared/deploymentRecovery'
import {
  decideRecovery,
  initialRecoveryState,
  markStarted,
  type RecoveryState,
} from '../shared/backoff'

type WindowState = { x?: number; y?: number; width: number; height: number }
type EmployeeContentMode = 'cloud' | 'deployment-error'
type CustomerContentMode = 'cloud' | 'fallback'

const EMPLOYEE_DEFAULT: WindowState = { width: 1280, height: 800 }

export class WindowManager {
  private employeeWindow: BrowserWindow | null = null
  private customerWindow: BrowserWindow | null = null
  private customerRecovery: RecoveryState = initialRecoveryState()
  private customerRetryTimer: NodeJS.Timeout | null = null
  private replayTimers: NodeJS.Timeout[] = []
  private employeeRetryTimer: NodeJS.Timeout | null = null
  private customerCloudRestoreTimer: NodeJS.Timeout | null = null
  private quitting = false
  private customerEnabled = true
  private displayWatchRegistered = false
  private formalRuntimeGuard: () => boolean = () => true
  private readonly roleByWebContentsId = new Map<number, WindowRole>()
  private employeeContentMode: EmployeeContentMode = 'cloud'
  private customerContentMode: CustomerContentMode = 'cloud'
  private employeeRetryState = initialRetryState()
  private lastEmployeeFailure: DeploymentFailure | null = null
  private lastEmployeeFailureFingerprint: string | null = null

  /** IPC 层用于校验发送者身份 */
  getRole(webContentsId: number): WindowRole | undefined {
    return this.roleByWebContentsId.get(webContentsId)
  }

  setQuitting() {
    this.quitting = true
    if (this.customerRetryTimer) clearTimeout(this.customerRetryTimer)
    if (this.employeeRetryTimer) clearTimeout(this.employeeRetryTimer)
    if (this.customerCloudRestoreTimer) clearTimeout(this.customerCloudRestoreTimer)
    for (const t of this.replayTimers) clearTimeout(t)
  }

  getEmployeeWindow() {
    return this.employeeWindow
  }

  getCustomerWindow() {
    return this.customerWindow
  }

  getEmployeeContentMode() {
    return this.employeeContentMode
  }

  isEmployeeDeploymentRendererActive(webContentsId: number): boolean {
    return Boolean(
      this.employeeWindow &&
      !this.employeeWindow.isDestroyed() &&
      this.employeeWindow.webContents.id === webContentsId &&
      this.employeeContentMode === 'deployment-error',
    )
  }

  getLastEmployeeDeploymentFailure() {
    return this.lastEmployeeFailure ? { ...this.lastEmployeeFailure, metadata: { ...this.lastEmployeeFailure.metadata } } : null
  }

  setFormalRuntimeGuard(guard: () => boolean) {
    this.formalRuntimeGuard = guard
  }

  private isFormalRuntimeAllowed(action: string, reason?: string): boolean {
    if (this.quitting) return false
    const allowed = this.formalRuntimeGuard()
    if (!allowed) logger.warn('formal-runtime.denied-before-activation', { action, reason })
    return allowed
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
    updateDeploymentComponent('displays', {
      level: externals.length > 0 ? 'HEALTHY' : 'DEGRADED',
      state: `${all.length} display(s), ${externals.length} external`,
      message: externals.length > 0 ? 'customer display available' : 'customer display absent',
    }, 'deployment.displays.health-updated')
  }

  watchDisplays() {
    if (!this.isFormalRuntimeAllowed('displays.watch')) return
    if (this.displayWatchRegistered) return
    this.displayWatchRegistered = true
    this.publishDisplayHealth()
    screen.on('display-added', () => {
      if (!this.isFormalRuntimeAllowed('displays.display-added')) return
      logger.info('displays.added')
      this.publishDisplayHealth()
      // 副屏重新接入：恢复顾客窗口并移到副屏
      this.ensureCustomerWindow('display-added')
    })
    screen.on('display-removed', () => {
      if (!this.isFormalRuntimeAllowed('displays.display-removed')) return
      logger.info('displays.removed')
      this.publishDisplayHealth()
      // 副屏断开：把顾客窗口挪回主屏窗口化，避免不可见/崩溃，不销毁
      const { externals } = this.describeDisplays()
      if (externals.length === 0 && this.customerWindow && !this.customerWindow.isDestroyed()) {
        try {
          this.customerWindow.setFullScreen(false)
          const { primary } = this.describeDisplays()
          this.customerWindow.setBounds({
            x: primary.workArea.x + 40,
            y: primary.workArea.y + 40,
            width: Math.min(1024, primary.workArea.width - 80),
            height: Math.min(640, primary.workArea.height - 80),
          })
          logger.info('customer-window.moved-to-primary-after-display-removed')
          const failure = classifyDeploymentFailure({
            component: 'DISPLAY',
            displayReason: 'DISPLAY_TOPOLOGY_CHANGED',
            metadata: {
              displayCount: allDisplayCount(),
              externalDisplayCount: 0,
              primaryDisplayId: primary.id,
            },
          })
          recordDeploymentFailure(failure)
        } catch (error) {
          recordHealthError('customer-window', `relocate failed: ${String(error)}`)
        }
      }
    })
    screen.on('display-metrics-changed', () => {
      if (!this.isFormalRuntimeAllowed('displays.metrics-changed')) return
      this.publishDisplayHealth()
    })
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
    if (!this.isFormalRuntimeAllowed('employee-window.create')) {
      throw new Error('formal runtime is not authorized')
    }
    if (this.employeeWindow && !this.employeeWindow.isDestroyed()) {
      this.employeeWindow.show()
      this.employeeWindow.focus()
      return this.employeeWindow
    }
    const { primary } = this.describeDisplays()
    const state = this.loadEmployeeState()
    const win = new BrowserWindow({
      title: 'E-Shop Desktop — POS',
      x: state.x ?? primary.workArea.x + 40,
      y: state.y ?? primary.workArea.y + 40,
      width: state.width,
      height: state.height,
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
      recordHealthError('employee-window', `loadURL failed: ${sanitizeDiagnosticMessage(error)}`)
      this.handleEmployeeCloudFailure(classifyDeploymentFailure({
        component: 'BUSINESS_CLOUD',
        description: String(error),
        metadata: { phase: 'employee-load', attempt: this.employeeRetryState.attempt },
      }))
    })

    win.webContents.on('did-finish-load', () => {
      if (this.employeeContentMode === 'cloud') {
        updateHealth({ employeeWindow: 'ok', cloudReachability: 'ok', network: 'ok' }, 'employee-window.loaded')
        markDeploymentCloudRecovered()
        if (this.employeeRetryState.state === 'RETRYING') {
          const transition = completeRetrySuccess(
            this.employeeRetryState,
            this.employeeRetryState.inFlightCorrelationId ?? 'unknown',
          )
          this.applyEmployeeRetryTransition(transition, 'deployment.retry.recovered')
        }
        this.lastEmployeeFailure = null
        this.lastEmployeeFailureFingerprint = null
      } else {
        updateHealth({ employeeWindow: 'degraded' }, 'employee-window.deployment-error-loaded')
        logger.info('deployment.error-renderer.loaded')
      }
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (code === -3) return
      if (this.employeeContentMode !== 'cloud') {
        recordHealthError('employee-window', `local renderer did-fail-load code=${code} message=${sanitizeDiagnosticMessage(desc)}`)
        return
      }
      const failure = classifyDeploymentFailure({
        component: 'BUSINESS_CLOUD',
        electronErrorCode: code,
        description: desc,
        metadata: { phase: 'employee-load', attempt: this.employeeRetryState.attempt },
      })
      updateHealth({ employeeWindow: 'error', cloudReachability: 'error' }, 'employee-window.load-failed')
      recordHealthError('employee-window', safeLoadFailureMessage('did-fail-load', code, desc, url))
      this.handleEmployeeCloudFailure(failure)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      recordHealthError('employee-window', `render-process-gone: ${details.reason}`)
      if (this.employeeContentMode === 'cloud') {
        this.handleEmployeeCloudFailure(classifyDeploymentFailure({
          component: 'BUSINESS_CLOUD',
          description: 'renderer-crashed',
          metadata: { reason: details.reason, phase: 'employee-renderer' },
        }))
      }
    })
    win.on('moved', () => this.saveEmployeeState())
    win.on('resized', () => this.saveEmployeeState())
    win.on('closed', () => {
      this.roleByWebContentsId.delete(win.webContents.id)
      this.employeeWindow = null
      updateHealth({ employeeWindow: 'closed' }, 'employee-window.closed')
      // 误关闭保护：Runtime 常驻 Tray，不随员工窗口退出
    })
    logger.info('employee-window.created', { display: primary.id })
    return win
  }

  showEmployeeDeploymentError(failure: DeploymentFailure) {
    if (!this.isFormalRuntimeAllowed('employee-window.deployment-error')) return
    const win = this.employeeWindow && !this.employeeWindow.isDestroyed()
      ? this.employeeWindow
      : this.createEmployeeWindow()
    this.employeeContentMode = 'deployment-error'
    this.lastEmployeeFailure = { ...failure, metadata: { ...failure.metadata } }
    logger.warn('deployment.error-renderer.show', {
      component: failure.component,
      severity: failure.severity,
      eventCode: failure.code,
      correlationId: failure.correlationId,
    })
    win.loadURL(this.localRendererUrl('deployment-error')).catch((error) => {
      recordHealthError('deployment-error-renderer', `load failed: ${sanitizeDiagnosticMessage(error)}`)
    })
    win.show()
    win.focus()
  }

  retryEmployeeBusinessLoad(trigger: 'manual' | 'auto' | 'reload' = 'manual') {
    if (!this.isFormalRuntimeAllowed('employee-window.retry-business', trigger)) {
      return { ok: false, error: 'FORMAL_RUNTIME_NOT_AUTHORIZED', retry: this.employeeRetryState }
    }
    const failure = this.lastEmployeeFailure
    const descriptor = failure ? getDeploymentFailureDescriptor(failure.code) : getDeploymentFailureDescriptor('BUSINESS_CLOUD_UNKNOWN')
    const correlationId = randomUUID()
    const transition = beginRetry(
      this.employeeRetryState,
      descriptor,
      correlationId,
      Date.now(),
      trigger === 'manual' || trigger === 'reload',
    )
    this.applyEmployeeRetryTransition(transition, 'deployment.retry.begin')
    if (!transition.accepted || transition.action !== 'RETRY') {
      return { ok: false, error: transition.reason, retry: this.employeeRetryState }
    }
    this.restoreEmployeeBusinessPage(correlationId)
    return { ok: true, retry: this.employeeRetryState }
  }

  restoreEmployeeBusinessPage(correlationId = randomUUID()) {
    if (!this.isFormalRuntimeAllowed('employee-window.restore-business')) {
      return { ok: false, error: 'FORMAL_RUNTIME_NOT_AUTHORIZED' }
    }
    if (!this.employeeWindow || this.employeeWindow.isDestroyed()) {
      this.createEmployeeWindow()
      return { ok: true }
    }
    this.employeeContentMode = 'cloud'
    updateHealth({ employeeWindow: 'starting', cloudReachability: 'starting' }, 'employee-window.restore-business')
    logger.info('deployment.cloud.restore-started', {
      correlationId,
      attempt: this.employeeRetryState.attempt,
      stateFrom: 'deployment-error',
      stateTo: 'cloud',
    })
    this.employeeWindow.loadURL(employeeUrl()).catch((error) => {
      this.handleEmployeeCloudFailure(classifyDeploymentFailure({
        component: 'BUSINESS_CLOUD',
        description: String(error),
        correlationId,
        metadata: { phase: 'employee-restore', attempt: this.employeeRetryState.attempt },
      }))
    })
    return { ok: true }
  }

  recheckDisplays() {
    this.publishDisplayHealth()
    this.ensureCustomerWindow('deployment-recheck-displays')
    return true
  }

  private handleEmployeeCloudFailure(failure: DeploymentFailure) {
    const fingerprint = `${failure.code}:${failure.correlationId}:${failure.occurredAt}`
    if (this.lastEmployeeFailureFingerprint === fingerprint) return
    this.lastEmployeeFailureFingerprint = fingerprint
    this.lastEmployeeFailure = { ...failure, metadata: { ...failure.metadata } }
    recordDeploymentFailure(failure)
    const transition = markRetryFailure(this.employeeRetryState, failure)
    this.applyEmployeeRetryTransition(transition, 'deployment.retry.failure')
    this.showEmployeeDeploymentError(failure)
    if (transition.action === 'WAIT' && transition.delayMs > 0) {
      this.scheduleEmployeeRetry(transition.delayMs)
    }
  }

  private scheduleEmployeeRetry(delayMs: number) {
    if (this.employeeRetryTimer) clearTimeout(this.employeeRetryTimer)
    logger.warn('deployment.retry.scheduled', {
      delayMs,
      attempt: this.employeeRetryState.attempt,
      lastFailureCode: this.employeeRetryState.lastFailureCode,
    })
    this.employeeRetryTimer = setTimeout(() => {
      this.employeeRetryTimer = null
      if (!this.quitting && this.employeeContentMode === 'deployment-error') {
        this.retryEmployeeBusinessLoad('auto')
      }
    }, delayMs)
  }

  private applyEmployeeRetryTransition(transition: RetryTransitionResult, logEvent: string) {
    const previous = this.employeeRetryState
    this.employeeRetryState = transition.state
    updateDeploymentRetry(this.employeeRetryState, logEvent)
    logger.info('deployment.retry.transition', {
      eventCode: transition.state.lastFailureCode,
      attempt: transition.state.attempt,
      stateFrom: previous.state,
      stateTo: transition.state.state,
      action: transition.action,
      accepted: transition.accepted,
      reason: transition.reason,
    })
  }

  focusEmployeeWindow() {
    if (!this.isFormalRuntimeAllowed('employee-window.focus')) return
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
  private pickCustomerDisplay(): { display: Display; isExternal: boolean } | null {
    const { primary, externals } = this.describeDisplays()
    if (externals.length > 0) {
      const sorted = [...externals].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
      return { display: sorted[0], isExternal: true }
    }
    if (getConfig().forceCustomerWindow) return { display: primary, isExternal: false }
    return null
  }

  /** 保证顾客窗口存在（存在副屏或强制模式时）；不会重复创建 */
  ensureCustomerWindow(reason: string): BrowserWindow | null {
    if (!this.isFormalRuntimeAllowed('customer-window.ensure', reason)) return null
    if (this.quitting || !this.customerEnabled) return null
    if (this.customerWindow && !this.customerWindow.isDestroyed()) return this.customerWindow
    const target = this.pickCustomerDisplay()
    if (!target) {
      logger.info('customer-window.skipped-no-external-display', { reason })
      updateHealth({ customerWindow: 'closed' }, 'customer-window.skipped')
      return null
    }
    return this.createCustomerWindow(target.display, target.isExternal, reason)
  }

  private createCustomerWindow(display: Display, isExternal: boolean, reason: string): BrowserWindow {
    if (!this.isFormalRuntimeAllowed('customer-window.create', reason)) {
      throw new Error('formal runtime is not authorized')
    }
    const win = new BrowserWindow({
      title: 'E-Shop Desktop — Customer Display',
      x: display.bounds.x,
      y: display.bounds.y,
      width: isExternal ? display.bounds.width : Math.min(1024, display.workArea.width - 80),
      height: isExternal ? display.bounds.height : Math.min(640, display.workArea.height - 80),
      frame: !isExternal,
      fullscreen: isExternal,
      autoHideMenuBar: true,
      backgroundColor: '#0f1115',
      focusable: false,
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
      recordHealthError('customer-window', `loadURL failed: ${sanitizeDiagnosticMessage(error)}`)
      this.showCustomerFallback('customer-load-promise-rejected')
    })

    win.webContents.on('did-finish-load', () => {
      if (this.customerContentMode === 'cloud') {
        this.customerRecovery = markStarted(this.customerRecovery, Date.now())
        updateHealth({
          customerWindow: 'ok',
          customerRecovery: { attempts: this.customerRecovery.attempts, exhausted: false },
        }, 'customer-window.loaded')
        updateDeploymentComponent('displays', {
          level: 'HEALTHY',
          state: 'customer cloud loaded',
          message: 'customer display cloud page loaded',
        }, 'deployment.customer-display.loaded')
        // React 挂载与 BroadcastChannel 订阅存在时间差：延迟重推两次，
        // 页面自身 guard 会拒绝重复快照，不会造成回退。
        this.scheduleReplay('did-finish-load')
      } else {
        updateHealth({ customerWindow: 'degraded' }, 'customer-window.fallback-loaded')
        logger.info('deployment.customer-fallback.loaded')
      }
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (code === -3) return
      recordHealthError('customer-window', safeLoadFailureMessage('did-fail-load', code, desc, url))
      if (this.customerContentMode === 'cloud') {
        const failure = classifyDeploymentFailure({
          component: 'DISPLAY',
          electronErrorCode: code,
          displayReason: 'CUSTOMER_LOAD_FAILED',
          metadata: { electronErrorCode: code, displayCount: this.describeDisplays().all.length },
        })
        recordDeploymentFailure(failure)
        this.showCustomerFallback('customer-did-fail-load')
      }
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      recordHealthError('customer-window', `render-process-gone: ${details.reason}`)
      if (!win.isDestroyed()) win.destroy()
    })
    win.on('closed', () => {
      this.roleByWebContentsId.delete(win.webContents.id)
      if (this.customerWindow === win) this.customerWindow = null
      this.customerContentMode = 'cloud'
      cartSyncService.setCustomerSender(null)
      updateHealth({ customerWindow: 'closed' }, 'customer-window.closed')
      if (!this.quitting && this.customerEnabled) this.scheduleCustomerRecovery('window-closed')
    })
    logger.info('customer-window.created', { display: display.id, isExternal, reason })
    return win
  }

  showCustomerFallback(reason: string) {
    if (!this.customerWindow || this.customerWindow.isDestroyed()) return
    this.customerContentMode = 'fallback'
    updateHealth({ customerWindow: 'degraded' }, 'customer-window.local-fallback')
    updateDeploymentComponent('displays', {
      level: 'DEGRADED',
      state: 'customer local fallback',
      message: 'customer display cloud page unavailable',
    }, 'deployment.customer-fallback.show')
    logger.warn('deployment.customer-fallback.show', { reason })
    this.customerWindow.loadURL(this.localRendererUrl('customer-fallback')).catch((error) => {
      recordHealthError('customer-fallback', `load failed: ${sanitizeDiagnosticMessage(error)}`)
    })
    this.scheduleCustomerCloudRestore(reason)
  }

  restoreCustomerBusinessPage(reason: string) {
    if (!this.customerWindow || this.customerWindow.isDestroyed()) return
    if (!this.isFormalRuntimeAllowed('customer-window.restore-business', reason)) return
    this.customerContentMode = 'cloud'
    logger.info('deployment.customer-cloud.restore-started', { reason })
    this.customerWindow.loadURL(customerUrl()).catch((error) => {
      recordHealthError('customer-window', `restore loadURL failed: ${sanitizeDiagnosticMessage(error)}`)
      this.showCustomerFallback('customer-restore-rejected')
    })
  }

  private scheduleCustomerCloudRestore(reason: string) {
    if (this.customerCloudRestoreTimer) clearTimeout(this.customerCloudRestoreTimer)
    this.customerCloudRestoreTimer = setTimeout(() => {
      this.customerCloudRestoreTimer = null
      if (!this.quitting && this.customerContentMode === 'fallback') {
        this.restoreCustomerBusinessPage(`fallback-auto-restore:${reason}`)
      }
    }, 5000)
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
      if (!this.isFormalRuntimeAllowed('customer-window.recovery', reason)) return
      this.ensureCustomerWindow(`recovery:${reason}`)
    }, decision.delayMs)
  }

  /** Tray 手动开关顾客窗口 */
  toggleCustomerWindow() {
    if (!this.isFormalRuntimeAllowed('customer-window.toggle')) return
    if (this.customerWindow && !this.customerWindow.isDestroyed()) {
      this.customerEnabled = false
      this.customerWindow.close()
    } else {
      this.customerEnabled = true
      this.customerRecovery = initialRecoveryState()
      this.ensureCustomerWindow('tray-open')
    }
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
      if (!isAllowedNavigation(url) && !this.isAllowedLocalRendererNavigation(role, url)) {
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

  private localRendererUrl(kind: 'deployment-error' | 'customer-fallback') {
    return pathToFileURL(join(__dirname, `../renderer/${kind}/index.html`)).toString()
  }

  private isAllowedLocalRendererNavigation(role: WindowRole, url: string): boolean {
    const allowed = role === 'employee'
      ? [this.localRendererUrl('deployment-error')]
      : [this.localRendererUrl('customer-fallback')]
    try {
      const target = new URL(url)
      return allowed.some((allowedUrl) => {
        const parsed = new URL(allowedUrl)
        return target.protocol === 'file:' && target.pathname === parsed.pathname
      })
    } catch {
      return false
    }
  }
}

export const windowManager = new WindowManager()

function allDisplayCount() {
  try {
    return screen.getAllDisplays().length
  } catch {
    return 0
  }
}

function safeLoadFailureMessage(prefix: string, code: number, description: string, url: string): string {
  return [
    prefix,
    `code=${code}`,
    `urlCategory=${categorizeDiagnosticsUrl(url)}`,
    `message=${sanitizeDiagnosticMessage(description)}`,
  ].join(' ')
}
