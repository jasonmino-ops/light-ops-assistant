import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { install, repair, uninstall, update } from '../core/actions'
import { computeStatus } from '../core/status'
import { eshopLogPath } from '../core/env'
import { readLogTail } from '../core/fsAtomic'
import { resolveWindowsEnv } from './env.win'
import type { ActionResult, Status } from '../core/types'

// 单实例：现场工程师重复双击不该开出两个窗口去改同一份配置。
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win: BrowserWindow | null = null

function packageDir(): string {
  // 打包后 electron-builder 会把 certificate-package 放进 resources/
  const packaged = join(process.resourcesPath ?? '', 'certificate-package')
  if (existsSync(packaged)) return packaged
  return join(__dirname, '..', '..', 'certificate-package')
}

const env = resolveWindowsEnv({ packageDir: packageDir() })

function createWindow(): void {
  win = new BrowserWindow({
    width: 760,
    height: 820,
    resizable: true,
    title: 'E-Shop Certificate Manager',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadURL(pathToFileURL(join(__dirname, '..', 'renderer', 'index.html')).toString())

  // 不允许渲染进程打开任何外部页面或新窗口。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

function fromMainWindow(event: IpcMainInvokeEvent): boolean {
  return Boolean(win && !win.isDestroyed() && event.sender.id === win.webContents.id)
}

function guard<T>(handler: () => T) {
  return (event: IpcMainInvokeEvent): T => {
    if (!fromMainWindow(event)) throw new Error('UNAUTHORIZED_SENDER')
    return handler()
  }
}

ipcMain.handle('cm:status', guard((): Status => computeStatus(env)))
ipcMain.handle('cm:log', guard((): string[] => readLogTail(eshopLogPath(env), 200)))
ipcMain.handle('cm:install', guard((): ActionResult => install(env)))
ipcMain.handle('cm:update', guard((): ActionResult => update(env)))
ipcMain.handle('cm:repair', guard((): ActionResult => repair(env)))

// 卸载是破坏性操作：必须由主进程弹出确认框，渲染层无法绕过。
ipcMain.handle('cm:uninstall', async (event): Promise<ActionResult | null> => {
  if (!fromMainWindow(event)) throw new Error('UNAUTHORIZED_SENDER')
  const choice = await dialog.showMessageBox(win!, {
    type: 'warning',
    buttons: ['取消', '确认卸载'],
    defaultId: 0,
    cancelId: 0,
    title: '确认卸载',
    message: '确认移除 E-Shop Root Certificate？',
    detail: '将删除 E-Shop 部署的 Root 证书，并从 QZ Tray 的 authcert.override 中摘除对应条目。\n不会卸载 QZ Tray，不会删除 QZ 官方证书，不影响其它应用配置。',
  })
  if (choice.response !== 1) return null
  return uninstall(env)
})

ipcMain.handle('cm:openLogFolder', guard((): void => {
  shell.openPath(env.eshopDir)
}))
