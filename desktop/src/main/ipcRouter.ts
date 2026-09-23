/**
 * E-Shop Desktop — IPC 路由（白名单 + 发送者身份校验 + payload 校验）
 *
 * 安全边界：
 * - 仅注册 shared/ipcChannels.ts 中声明的通道，不存在通用透传通道
 * - 每个消息校验 sender（webContents.id → 窗口角色 + 仅接受主 frame）
 * - 顾客窗口不能发送 CART_PUBLISH，不能 invoke HEALTH_GET —— 无法反向控制 POS
 * - payload 由 validateCartSnapshotMessage 做运行时校验
 */

import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, SENDABLE_BY_ROLE, INVOKABLE_BY_ROLE, type WindowRole } from '../shared/ipcChannels'
import { cartSyncService } from './cartSyncService'
import { getHealthSnapshot, updateHealth } from './runtimeHealth'
import { logger } from './logger'
import { getConfig, isAllowedNavigation } from './config'
import { CredentialStore } from './activation/credentialStore'
import { PosSessionBridge } from './posSessionBridge'
import type { WindowManager } from './windowManager'
import type { V3PrintingRuntime } from './printing/v3PrintingRuntime'
import { createHash } from 'node:crypto'

let v3PrintingRuntimeProvider: () => V3PrintingRuntime | null = () => null
export function setV3PrintingRuntimeProvider(provider: () => V3PrintingRuntime | null) {
  v3PrintingRuntimeProvider = provider
}

function localPrintIntent(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'expiresAt,orderNo,payloadBase64,printJobId,rendererVersion,role' ||
    typeof row.orderNo !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(row.orderNo) ||
    typeof row.printJobId !== 'string' || row.printJobId.length < 8 || row.printJobId.length > 128 ||
    (row.role !== 'FRONT' && row.role !== 'KITCHEN') || typeof row.rendererVersion !== 'string' ||
    !row.rendererVersion || typeof row.expiresAt !== 'string' || !Number.isFinite(Date.parse(row.expiresAt)) ||
    typeof row.payloadBase64 !== 'string' || row.payloadBase64.length > 4 * 1024 * 1024) return null
  const payload = Buffer.from(row.payloadBase64, 'base64')
  if (!payload.length || payload.toString('base64') !== row.payloadBase64) return null
  const canonicalKey = `cashier-network-v2:${row.orderNo}:${row.role}`
  const canonicalPrintJobId = `network:${createHash('sha256').update(canonicalKey).digest('hex')}`
  if (row.printJobId !== canonicalPrintJobId) return null
  return {
    orderNo: row.orderNo, role: row.role as 'FRONT' | 'KITCHEN', payload: new Uint8Array(payload),
    identity: { printJobId: row.printJobId, requestHash: createHash('sha256').update(payload).digest('hex'), rendererVersion: row.rendererVersion, expiresAt: row.expiresAt },
  }
}

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

export function registerIpcHandlers(windowManager: WindowManager) {
  const config = getConfig()
  const posSessionBridge = new PosSessionBridge({
    credentialReader: new CredentialStore(app.getPath('userData')),
    baseUrl: config.baseUrl,
  })
  void posSessionBridge.prepare()

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

  ipcMain.handle(IPC_CHANNELS.POS_SESSION_TAKE, async (event) => {
    if (authorize(windowManager, event, IPC_CHANNELS.POS_SESSION_TAKE, 'invoke') !== 'employee') return null
    const win = windowManager.getEmployeeWindow()
    if (!win || win.isDestroyed() || win.webContents.id !== event.sender.id) return null
    if (!event.senderFrame || !isAllowedNavigation(event.senderFrame.url, config)) return null
    return posSessionBridge.take()
  })

  ipcMain.handle(IPC_CHANNELS.V3_PRINT_SUBMIT, async (event, payload: unknown) => {
    if (authorize(windowManager, event, IPC_CHANNELS.V3_PRINT_SUBMIT, 'invoke') !== 'employee') return { status: 'REJECTED', reason: 'IPC_UNAUTHORIZED' }
    if (!event.senderFrame || !isAllowedNavigation(event.senderFrame.url, config)) return { status: 'REJECTED', reason: 'IPC_UNAUTHORIZED' }
    const intent = localPrintIntent(payload)
    if (!intent) return { status: 'REJECTED', reason: 'INVALID_PRINT_INTENT' }
    const runtime = v3PrintingRuntimeProvider()
    return runtime ? runtime.execute({ source: 'LOCAL_DESKTOP', ...intent }) : { status: 'V2_FALLBACK_REQUIRED', reason: 'V3_RUNTIME_UNAVAILABLE' }
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
