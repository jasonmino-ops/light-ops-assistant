import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { logger } from '../logger'
import type { PrinterSetupSnapshot } from './printerSetupService'

export class PrinterSetupWindowController {
  private win: BrowserWindow | null = null
  private latest: PrinterSetupSnapshot | null = null

  show(): BrowserWindow {
    const win = this.ensureWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (this.latest) this.sendState(this.latest)
    return win
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close()
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  isSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) return false
    return Boolean(this.win && !this.win.isDestroyed() && this.win.webContents.id === event.sender.id)
  }

  sendState(state: PrinterSetupSnapshot): void {
    this.latest = state
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('eshop:printer-setup:state-changed', state)
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      title: 'E-Shop Desktop — Printing Setup',
      width: 780,
      height: 760,
      minWidth: 700,
      minHeight: 640,
      autoHideMenuBar: true,
      backgroundColor: '#f6f3ec',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../../preload/printingSetupPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        additionalArguments: [`--eshop-desktop-version=${app.getVersion()}`],
      },
    })
    this.win = win
    this.harden(win)
    win.loadFile(join(__dirname, '../../renderer/printingSetup/index.html')).catch((error) => {
      logger.error('printer-setup-window.load-failed', { message: String(error).slice(0, 200) })
    })
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
      if (this.latest) this.sendState(this.latest)
    })
    win.on('closed', () => { if (this.win === win) this.win = null })
    logger.info('printer-setup-window.created')
    return win
  }

  private harden(win: BrowserWindow): void {
    const allowed = pathToFileURL(join(__dirname, '../../renderer/printingSetup/index.html')).toString()
    win.webContents.setWindowOpenHandler(({ url }) => {
      logger.warn('printer-setup-window.window-open-denied', { url })
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (url === allowed) return
      event.preventDefault()
      logger.warn('printer-setup-window.navigation-denied', { url })
    })
    win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      logger.warn('printer-setup-window.permission-denied', { permission })
      callback(false)
    })
  }
}
