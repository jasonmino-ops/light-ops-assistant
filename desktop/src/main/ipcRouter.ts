/**
 * E-Shop Desktop — IPC 路由（白名单 + 发送者身份校验 + payload 校验）
 *
 * 安全边界：
 * - 仅注册 shared/ipcChannels.ts 中声明的通道，不存在通用透传通道
 * - 每个消息校验 sender（webContents.id → 窗口角色 + 仅接受主 frame）
 * - 顾客窗口不能发送 CART_PUBLISH，不能 invoke HEALTH_GET —— 无法反向控制 POS
 * - payload 由 validateCartSnapshotMessage 做运行时校验
 */

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, SENDABLE_BY_ROLE, INVOKABLE_BY_ROLE, type WindowRole } from '../shared/ipcChannels'
import { cartSyncService } from './cartSyncService'
import { getHealthSnapshot, updateHealth } from './runtimeHealth'
import { logger } from './logger'
import type { WindowManager } from './windowManager'
import { isAllowedNavigation } from './config'
import { isDesktopTransactionOperation, type DesktopTransactionRequest } from '../shared/transactionBridge'
import type { DesktopTransactionProxy } from './desktopTransactionProxy'

function senderRole(
  windowManager: WindowManager,
  event: IpcMainEvent | IpcMainInvokeEvent,
): WindowRole | null {
  // 仅接受主 frame（拒绝 iframe 伪造）
  if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) return null
  return windowManager.getRole(event.sender.id) ?? null
}

function authorize(
  windowManager: WindowManager,
  event: IpcMainEvent | IpcMainInvokeEvent,
  channel: string,
  mode: 'send' | 'invoke',
): WindowRole | null {
  const role = senderRole(windowManager, event)
  const table = mode === 'send' ? SENDABLE_BY_ROLE : INVOKABLE_BY_ROLE
  if (!role || !table[role].includes(channel)) {
    logger.warn('ipc.unauthorized', { channel, mode, role, webContentsId: event.sender.id })
    return null
  }
  return role
}

export function registerIpcHandlers(
  windowManager: WindowManager,
  options: { transactionProxy?: DesktopTransactionProxy } = {},
) {
  ipcMain.on(IPC_CHANNELS.CART_PUBLISH, (event, payload: unknown) => {
    if (!authorize(windowManager, event, IPC_CHANNELS.CART_PUBLISH, 'send')) return
    cartSyncService.ingest(payload)
  })

  ipcMain.on(IPC_CHANNELS.DISPLAY_READY, (event) => {
    if (!authorize(windowManager, event, IPC_CHANNELS.DISPLAY_READY, 'send')) return
    logger.info('ipc.display-ready')
    cartSyncService.replayLatest('display-ready')
  })

  ipcMain.handle(IPC_CHANNELS.HEALTH_GET, (event) => {
    if (!authorize(windowManager, event, IPC_CHANNELS.HEALTH_GET, 'invoke')) return null
    return getHealthSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER, (event) => {
    return setEmployeeFullscreen(windowManager, event, IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER, true)
  })

  ipcMain.handle(IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT, (event) => {
    return setEmployeeFullscreen(windowManager, event, IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT, false)
  })

  ipcMain.handle(IPC_CHANNELS.EMPLOYEE_FULLSCREEN_STATE, (event) => {
    if (!authorize(windowManager, event, IPC_CHANNELS.EMPLOYEE_FULLSCREEN_STATE, 'invoke')) return false
    const win = windowManager.getEmployeeWindow()
    if (!win || win.isDestroyed() || win.webContents.id !== event.sender.id) return false
    return win.isFullScreen()
  })

  ipcMain.handle(IPC_CHANNELS.TRANSACTION_REQUEST, async (event, payload: unknown) => {
    if (!authorize(windowManager, event, IPC_CHANNELS.TRANSACTION_REQUEST, 'invoke')) {
      return { ok: false, status: 403, body: { error: 'DESKTOP_IPC_UNAUTHORIZED' }, error: 'DESKTOP_IPC_UNAUTHORIZED' }
    }
    if (!event.senderFrame || !isAllowedNavigation(event.senderFrame.url)) {
      return { ok: false, status: 403, body: { error: 'DESKTOP_IPC_ORIGIN_REJECTED' }, error: 'DESKTOP_IPC_ORIGIN_REJECTED' }
    }
    if (
      !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !isDesktopTransactionOperation((payload as { operation?: unknown }).operation)
    ) {
      return { ok: false, status: 400, body: { error: 'DESKTOP_PROXY_OPERATION_REJECTED' }, error: 'DESKTOP_PROXY_OPERATION_REJECTED' }
    }
    if (!options.transactionProxy) {
      return { ok: false, status: 503, body: { error: 'DESKTOP_TRANSACTION_UNAVAILABLE' }, error: 'DESKTOP_TRANSACTION_UNAVAILABLE' }
    }
    return options.transactionProxy.request(payload as DesktopTransactionRequest)
  })

  updateHealth({ ipc: 'ok' }, 'ipc.registered')
}

export function setEmployeeFullscreen(
  windowManager: WindowManager,
  event: IpcMainInvokeEvent,
  channel: string,
  fullscreen: boolean,
): boolean {
  if (!authorize(windowManager, event, channel, 'invoke')) return false
  const win = windowManager.getEmployeeWindow()
  if (!win || win.isDestroyed() || win.webContents.id !== event.sender.id) return false
  win.setFullScreen(fullscreen)
  return win.isFullScreen()
}
