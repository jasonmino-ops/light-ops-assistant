import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { ActivationPublicState } from './activationTypes'
import { logger } from '../logger'

export type ActivationWindowControllerOptions = {
  onClosedBeforeAuthorization: () => void
  isAuthorized: () => boolean
}

export class ActivationWindowController {
  private win: BrowserWindow | null = null
  private allowClose = false
  private latestState: ActivationPublicState | null = null

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

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    this.allowClose = false
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
        preload: join(__dirname, '../preload/activationPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        additionalArguments: [`--eshop-desktop-version=${app.getVersion()}`],
      },
    })
    this.win = win
    this.harden(win)

    const rendererPath = join(__dirname, '../renderer/activation/index.html')
    win.loadFile(rendererPath).catch((error) => {
      logger.error('activation-window.load-failed', { message: String(error).slice(0, 200) })
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
    return win
  }

  private harden(win: BrowserWindow) {
    const allowed = pathToFileURL(join(__dirname, '../renderer/activation/index.html')).toString()
    win.webContents.setWindowOpenHandler(({ url }) => {
      logger.warn('activation-window.window-open-denied', { url })
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (url !== allowed) {
        event.preventDefault()
        logger.warn('activation-window.navigation-denied', { url })
      }
    })
    win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      logger.warn('activation-window.permission-denied', { permission })
      callback(false)
    })
  }
}
