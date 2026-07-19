import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { basename, join } from 'node:path'
import type { ActivationPublicState } from './activationTypes'
import type { ActivationRendererCheckpoint } from './activationIpc'
import { logger } from '../logger'
import { categorizeDiagnosticsUrl, originHostHash, sanitizeDiagnosticMessage } from '../../shared/deploymentDiagnostics'

const DEFAULT_STARTUP_WATCHDOG_MS = 8_000

export type ActivationWindowControllerOptions = {
  onClosedBeforeAuthorization: () => void
  isAuthorized: () => boolean
  onStartupFailure?: (reasonCode: string) => void
  watchdogMs?: number
}

export class ActivationWindowController {
  private win: BrowserWindow | null = null
  private allowClose = false
  private latestState: ActivationPublicState | null = null
  private startupWatchdog: NodeJS.Timeout | null = null
  private startupWatchdogToken = 0
  private startupAcknowledged = false
  private startupFailureShown = false

  constructor(private readonly options: ActivationWindowControllerOptions) {}

  show() {
    const win = this.ensureWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (this.latestState) this.sendState(this.latestState)
    return win
  }

  focus() {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore()
      this.win.show()
      this.win.focus()
      return
    }
    this.show()
  }

  closeAfterAuthorization() {
    this.allowClose = true
    if (this.win && !this.win.isDestroyed()) {
      this.win.close()
    }
  }

  destroy() {
    this.allowClose = true
    this.clearStartupWatchdog()
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
    }
    this.win = null
  }

  isActivationWebContents(webContentsId: number): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.webContents.id === webContentsId)
  }

  isActivationSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) return false
    return this.isActivationWebContents(event.sender.id)
  }

  sendState(state: ActivationPublicState) {
    this.latestState = state
    if (!this.win || this.win.isDestroyed()) return
    this.win.webContents.send('eshop:activation:state-changed', state)
  }

  handleRendererCheckpoint(checkpoint: ActivationRendererCheckpoint) {
    logger.info(eventForCheckpoint(checkpoint.stage), {
      ...(checkpoint.stateKind ? { state: checkpoint.stateKind } : {}),
      ...(checkpoint.reasonCode ? { reasonCode: checkpoint.reasonCode } : {}),
    })
    if (
      checkpoint.stage === 'get-state-succeeded' ||
      (checkpoint.stage === 'rendered' && checkpoint.stateKind !== 'BOOTING')
    ) {
      this.acknowledgeStartup()
      return
    }
    if (checkpoint.stage === 'get-state-failed' || checkpoint.stage === 'startup-error') {
      this.showStartupFailure(checkpoint.reasonCode ?? 'ACTIVATION_RENDERER_STARTUP_ERROR')
    }
  }

  showStartupFailure(reasonCode: string) {
    const safeReasonCode = sanitizeReasonCode(reasonCode)
    this.options.onStartupFailure?.(safeReasonCode)
    this.startupFailureShown = true
    this.clearStartupWatchdog()
    const win = this.win
    if (!win || win.isDestroyed()) return
    const title = safeReasonCode === 'ACTIVATION_BRIDGE_MISSING'
      ? '启动组件加载失败'
      : '启动失败'
    const script = buildStartupFailureScript(title, safeReasonCode)
    win.webContents.executeJavaScript(script).catch((error) => {
      logger.error('activation-window.startup-fallback-failed', {
        reasonCode: safeReasonCode,
        message: sanitizeDiagnosticMessage(error),
      })
    })
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    this.allowClose = false
    this.startupAcknowledged = false
    this.startupFailureShown = false
    logger.info('activation-window.create.started')
    const win = new BrowserWindow({
      title: 'E-Shop Desktop Activation',
      width: 480,
      height: 620,
      minWidth: 420,
      minHeight: 560,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#f7f7f4',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../../preload/activationPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        additionalArguments: [`--eshop-desktop-version=${app.getVersion()}`],
      },
    })
    this.win = win
    this.harden(win)
    this.installDiagnostics(win)

    const rendererPath = join(__dirname, '../../renderer/activation/index.html')
    win.loadFile(rendererPath).catch((error) => {
      logger.error('activation-window.load-failed', { message: sanitizeDiagnosticMessage(error) })
      this.showStartupFailure('ACTIVATION_WINDOW_LOAD_FAILED')
    })
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
      if (this.latestState) this.sendState(this.latestState)
    })
    win.on('closed', () => {
      this.win = null
      if (!this.allowClose && !this.options.isAuthorized()) {
        this.options.onClosedBeforeAuthorization()
      }
    })
    logger.info('activation-window.created')
    this.startStartupWatchdog(win)
    return win
  }

  private installDiagnostics(win: BrowserWindow) {
    win.webContents.on('did-start-loading', () => {
      logger.info('activation-window.did-start-loading')
    })
    win.webContents.on('did-finish-load', () => {
      logger.info('activation-window.did-finish-load')
    })
    win.webContents.on('dom-ready', () => {
      logger.info('activation-window.dom-ready')
    })
    win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      logger.error('activation-window.did-fail-load', {
        code,
        isMainFrame: Boolean(isMainFrame),
        urlCategory: categorizeDiagnosticsUrl(url),
        originHostHash: originHostHash(url),
        message: sanitizeDiagnosticMessage(description),
      })
      if (isMainFrame) this.showStartupFailure('ACTIVATION_WINDOW_DID_FAIL_LOAD')
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      logger.error('activation-window.preload-error', {
        source: safeSourceBasename(preloadPath),
        message: sanitizeDiagnosticMessage(error),
      })
      this.showStartupFailure('ACTIVATION_PRELOAD_ERROR')
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      logger.error('activation-window.render-process-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      })
      this.showStartupFailure('ACTIVATION_RENDER_PROCESS_GONE')
    })
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (!isWarningOrErrorConsoleLevel(level)) return
      logger.warn('activation-window.console-error', {
        level: consoleLevelName(level),
        message: sanitizeRendererConsoleMessage(message),
        source: safeSourceBasename(sourceId),
        line,
      })
    })
  }

  private startStartupWatchdog(win: BrowserWindow) {
    this.clearStartupWatchdog()
    const token = this.startupWatchdogToken + 1
    this.startupWatchdogToken = token
    const timeoutMs = this.options.watchdogMs ?? DEFAULT_STARTUP_WATCHDOG_MS
    this.startupWatchdog = setTimeout(() => {
      if (this.startupWatchdogToken !== token) return
      if (this.startupAcknowledged || this.startupFailureShown) return
      if (!this.win || this.win !== win || win.isDestroyed()) return
      logger.error('activation-window.startup-watchdog-triggered', { timeoutMs })
      this.showStartupFailure('ACTIVATION_RENDERER_STARTUP_TIMEOUT')
    }, timeoutMs)
  }

  private clearStartupWatchdog() {
    this.startupWatchdogToken += 1
    if (this.startupWatchdog) clearTimeout(this.startupWatchdog)
    this.startupWatchdog = null
  }

  private acknowledgeStartup() {
    this.startupAcknowledged = true
    this.clearStartupWatchdog()
  }

  private harden(win: BrowserWindow) {
    const allowed = pathToFileURL(join(__dirname, '../../renderer/activation/index.html')).toString()
    win.webContents.setWindowOpenHandler(({ url }) => {
      logger.warn('activation-window.window-open-denied', {
        urlCategory: categorizeDiagnosticsUrl(url),
        originHostHash: originHostHash(url),
      })
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (url !== allowed) {
        event.preventDefault()
        logger.warn('activation-window.navigation-denied', {
          urlCategory: categorizeDiagnosticsUrl(url),
          originHostHash: originHostHash(url),
        })
      }
    })
    win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      logger.warn('activation-window.permission-denied', { permission })
      callback(false)
    })
  }
}

function eventForCheckpoint(stage: ActivationRendererCheckpoint['stage']): string {
  switch (stage) {
    case 'preload-ready': return 'activation-preload.ready'
    case 'script-started': return 'activation-renderer.script-started'
    case 'bridge-detected': return 'activation-renderer.bridge-detected'
    case 'subscribed': return 'activation-renderer.subscribed'
    case 'get-state-started': return 'activation-renderer.get-state.started'
    case 'get-state-succeeded': return 'activation-renderer.get-state.succeeded'
    case 'get-state-failed': return 'activation-renderer.get-state.failed'
    case 'rendered': return 'activation-renderer.rendered'
    case 'startup-error': return 'activation-renderer.startup-error'
  }
}

function sanitizeReasonCode(value: string): string {
  if (/token|authorization|bearer|pin|ciphertext|\b\d{6}\b|\bSTORE[-_][A-Z0-9_-]+\b/i.test(value)) return 'ACTIVATION_STARTUP_ERROR'
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized.slice(0, 72) || 'ACTIVATION_STARTUP_ERROR'
}

function safeSourceBasename(value?: string): string {
  if (!value) return 'unknown'
  const withoutQuery = value.split(/[?#]/)[0] ?? ''
  const normalized = withoutQuery.replace(/\\/g, '/')
  return basename(normalized).slice(0, 80) || 'unknown'
}

function isWarningOrErrorConsoleLevel(level: number): boolean {
  return level >= 2
}

function consoleLevelName(level: number): 'warning' | 'error' {
  return level >= 3 ? 'error' : 'warning'
}

const SAFE_RENDERER_ERROR_PATTERN =
  /\b(?:Uncaught\s+)?(ReferenceError|SyntaxError|TypeError|RangeError|EvalError|URIError|Error):\s*([^"'<>]{1,160})/i

const RENDERER_CONSOLE_UNSAFE_PATTERN =
  /token|authorization|bearer|cookie|pin|ciphertext|\b\d{6}\b|\bSTORE[-_][A-Z0-9_-]+\b|https?:\/\/|\?[A-Za-z0-9_.~-]+=|\/Users\/|\/home\/|[A-Za-z]:\\Users\\/i

function sanitizeRendererConsoleMessage(value: unknown): string {
  const text = value == null ? '' : String(value).replace(/\s+/g, ' ').trim()
  const match = text.match(SAFE_RENDERER_ERROR_PATTERN)
  if (match) {
    const candidate = `${match[1]}: ${match[2].trim()}`.slice(0, 180)
    if (!RENDERER_CONSOLE_UNSAFE_PATTERN.test(candidate)) return candidate
  }
  return sanitizeDiagnosticMessage(value)
}

function buildStartupFailureScript(title: string, reasonCode: string): string {
  return `
    (() => {
      const setText = (selector, value) => {
        const node = document.querySelector(selector);
        if (node) node.textContent = value;
      };
      const setHidden = (selector, value) => {
        const node = document.querySelector(selector);
        if (node) node.hidden = value;
      };
      setText('#state-title', ${JSON.stringify(title)});
      setText('#state-detail', '激活界面未能正确加载。请重新启动应用；如问题持续，请联系技术支持。');
      setText('#status-code', ${JSON.stringify(`状态: ${reasonCode}`)});
      setHidden('#busy', true);
      setHidden('#activation-form', true);
      setHidden('#reset-button', true);
      setHidden('#quit-button', true);
      const retry = document.querySelector('#retry-button');
      if (retry) {
        retry.hidden = false;
        retry.textContent = '重新加载';
        retry.onclick = () => window.location.reload();
      }
    })();
  `
}
