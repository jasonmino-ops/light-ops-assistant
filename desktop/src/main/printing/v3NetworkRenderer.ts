import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'

const MAX_BYTES = 3 * 1024 * 1024

export class V3NetworkRenderer {
  private window: BrowserWindow | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  public render(request: unknown): Promise<Uint8Array> {
    const operation = this.queue.then(() => this.renderExclusive(request))
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  public dispose(): void {
    this.disposed = true
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private async renderExclusive(request: unknown): Promise<Uint8Array> {
    if (this.disposed) throw new Error('V3_NETWORK_RENDER_DISPOSED')
    const needsLoad = !this.window || this.window.isDestroyed()
    if (needsLoad) {
      this.window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, partition: 'v3-network-print-render', preload: path.join(__dirname, 'v3-network-render.cjs') } })
      const web = this.window.webContents
      web.setWindowOpenHandler(() => ({ action: 'deny' }))
      web.on('will-navigate', event => event.preventDefault())
      web.on('will-attach-webview', event => event.preventDefault())
      web.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false))
      web.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }))
    }
    const active = this.window!
    const trustedRendererUrl = pathToFileURL(path.join(__dirname, 'v3-network-render.html')).toString()
    const renderId = randomUUID()
    return new Promise<Uint8Array>((resolve, reject) => {
      let finished = false
      const finish = (bytes?: Uint8Array) => {
        if (finished) return
        finished = true; clearTimeout(timer); ipcMain.off('network:rendered', onResult)
        active.off('closed', failed); active.webContents.off('render-process-gone', failed)
        if (bytes) resolve(bytes); else { this.disposeWindow(); reject(new Error('V3_NETWORK_RENDER_FAILED')) }
      }
      const failed = () => finish()
      const onResult = (event: IpcMainEvent, value: { renderId?: unknown; bytes?: unknown }) => {
        if (event.sender !== active.webContents || event.senderFrame !== active.webContents.mainFrame ||
          event.senderFrame.url !== trustedRendererUrl || value?.renderId !== renderId) return
        finish(value.bytes instanceof Uint8Array && value.bytes.byteLength > 0 && value.bytes.byteLength <= MAX_BYTES ? Uint8Array.from(value.bytes) : undefined)
      }
      const timer = setTimeout(failed, 12_000)
      ipcMain.on('network:rendered', onResult); active.once('closed', failed); active.webContents.once('render-process-gone', failed)
      const loaded = needsLoad ? active.loadFile(path.join(__dirname, 'v3-network-render.html')) : Promise.resolve()
      loaded.then(() => { if (!finished) active.webContents.send('network:render', { renderId, request }) }).catch(failed)
    })
  }

  private disposeWindow(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}
