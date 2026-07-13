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
  decideRecovery,
  initialRecoveryState,
  markStarted,
  type RecoveryState,
} from '../shared/backoff'

type WindowState = { x?: number; y?: number; width: number; height: number }

const EMPLOYEE_DEFAULT: WindowState = { width: 1280, height: 800 }

export class WindowManager {
  private employeeWindow: BrowserWindow | null = null
  private customerWindow: BrowserWindow | null = null
  private customerRecovery: RecoveryState = initialRecoveryState()
  private customerRetryTimer: NodeJS.Timeout | null = null
  private replayTimers: NodeJS.Timeout[] = []
  private quitting = false
  private customerEnabled = true
  private readonly roleByWebContentsId = new Map<number, WindowRole>()

  /** IPC 层用于校验发送者身份 */
  getRole(webContentsId: number): WindowRole | undefined {
    return this.roleByWebContentsId.get(webContentsId)
  }

  setQuitting() {
    this.quitting = true
    if (this.customerRetryTimer) clearTimeout(this.customerRetryTimer)
    for (const t of this.replayTimers) clearTimeout(t)
  }

  getEmployeeWindow() {
    return this.employeeWindow
  }

  getCustomerWindow() {
    return this.customerWindow
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
    screen.on('display-added', () => {
      logger.info('displays.added')
      this.publishDisplayHealth()
      // 副屏重新接入：恢复顾客窗口并移到副屏
      this.ensureCustomerWindow('display-added')
    })
    screen.on('display-removed', () => {
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
        } catch (error) {
          recordHealthError('customer-window', `relocate failed: ${String(error)}`)
        }
      }
    })
    screen.on('display-metrics-changed', () => this.publishDisplayHealth())
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
    logger.info('employee-window.created', { display: primary.id })
    return win
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
      if (!this.quitting && this.customerEnabled) this.scheduleCustomerRecovery('window-closed')
    })
    logger.info('customer-window.created', { display: display.id, isExternal, reason })
    return win
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
