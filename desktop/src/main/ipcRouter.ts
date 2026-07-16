/**
 * E-Shop Desktop — IPC 路由（白名单 + 发送者身份校验 + payload 校验）
 *
 * 安全边界：
 * - 仅注册 shared/ipcChannels.ts 中声明的通道，不存在通用透传通道
 * - 每个消息校验 sender（webContents.id → 窗口角色 + 仅接受主 frame）
 * - 顾客窗口不能发送 CART_PUBLISH，不能 invoke HEALTH_GET —— 无法反向控制 POS
 * - payload 由 validateCartSnapshotMessage 做运行时校验
 */

import { randomUUID } from 'node:crypto'
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { HrtCommandRequestPayload, HrtJsonValue } from '@eshop/hrt-contract'
import { IPC_CHANNELS, SENDABLE_BY_ROLE, INVOKABLE_BY_ROLE, type WindowRole } from '../shared/ipcChannels'
import { RuntimeReceiptPayload, validateRuntimeReceiptPayload } from '../shared/printerPayload'
import { cartSyncService } from './cartSyncService'
import { getHealthSnapshot, updateHealth } from './runtimeHealth'
import { logger } from './logger'
import type { WindowManager } from './windowManager'

export type DesktopPrintResult = {
  ok: boolean
  status: 'SUBMITTED' | 'FAILED' | 'TIMED_OUT' | 'PROVIDER_UNAVAILABLE' | 'PRINTER_NOT_CONFIGURED' | 'PRINTER_NOT_FOUND' | 'UNKNOWN'
  commandId?: string
  errorCode?: string
  message?: string
  effectBoundary?: string
}

export interface DesktopPrinterBridge {
  executeCommand(command: HrtCommandRequestPayload, timeoutMs?: number): Promise<{
    commandId: string
    outcome: string
    effectBoundary: string
    errorCode?: string
    message?: string
  }>
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

export function registerIpcHandlers(windowManager: WindowManager, printerBridge?: DesktopPrinterBridge) {
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

  ipcMain.handle(IPC_CHANNELS.PRINTER_PRINT_RECEIPT, async (event, payload: unknown): Promise<DesktopPrintResult> => {
    if (!authorize(windowManager, event, IPC_CHANNELS.PRINTER_PRINT_RECEIPT, 'invoke')) {
      return { ok: false, status: 'PROVIDER_UNAVAILABLE', errorCode: 'UNAUTHORIZED' }
    }
    if (!printerBridge) return { ok: false, status: 'PROVIDER_UNAVAILABLE', errorCode: 'PROVIDER_UNAVAILABLE' }
    let receipt: RuntimeReceiptPayload
    try {
      validateRuntimeReceiptPayload(payload)
      receipt = payload
    } catch (error) {
      return { ok: false, status: 'FAILED', errorCode: error instanceof Error ? error.message : 'INVALID_PRINT_RECEIPT' }
    }
    const command = createPrintCommand(receipt)
    try {
      const result = await printerBridge.executeCommand(command, 30000)
      return mapPrintResult(result)
    } catch (error) {
      return mapPrintError(error)
    }
  })

  updateHealth({ ipc: 'ok' }, 'ipc.registered')
}

function createPrintCommand(receipt: RuntimeReceiptPayload): HrtCommandRequestPayload {
  const commandId = `desktop-print-${randomUUID()}`
  return {
    commandId,
    idempotencyKey: `receipt:${receipt.saleId ?? receipt.receiptId}:runtime:v1`,
    device: { deviceId: 'receipt-printer', deviceKind: 'PRINTER', slotId: 'receipt-printer' },
    commandType: 'PRINT_RECEIPT',
    params: { receipt: receipt as unknown as HrtJsonValue },
  }
}

function mapPrintResult(result: Awaited<ReturnType<DesktopPrinterBridge['executeCommand']>>): DesktopPrintResult {
  if (result.outcome === 'SUCCEEDED' && result.effectBoundary === 'CROSSED') {
    return { ok: true, status: 'SUBMITTED', commandId: result.commandId, effectBoundary: result.effectBoundary }
  }
  if (result.outcome === 'TIMED_OUT') return { ok: false, status: 'TIMED_OUT', commandId: result.commandId, errorCode: result.errorCode, message: result.message, effectBoundary: result.effectBoundary }
  const status = result.errorCode === 'PRINTER_NOT_CONFIGURED'
    ? 'PRINTER_NOT_CONFIGURED'
    : result.errorCode === 'PRINTER_NOT_FOUND'
      ? 'PRINTER_NOT_FOUND'
      : result.errorCode === 'PROVIDER_UNAVAILABLE'
        ? 'PROVIDER_UNAVAILABLE'
        : 'FAILED'
  return { ok: false, status, commandId: result.commandId, errorCode: result.errorCode, message: result.message, effectBoundary: result.effectBoundary }
}

function mapPrintError(error: unknown): DesktopPrintResult {
  const code = error instanceof Error ? error.message : 'UNKNOWN'
  const status: DesktopPrintResult['status'] = code === 'PRINT_TIMEOUT'
    ? 'TIMED_OUT'
    : code === 'PRINTER_NOT_CONFIGURED'
      ? 'PRINTER_NOT_CONFIGURED'
      : code === 'PRINTER_NOT_FOUND'
        ? 'PRINTER_NOT_FOUND'
        : code === 'PROVIDER_UNAVAILABLE' || code === 'CAPABILITY_UNSUPPORTED'
          ? 'PROVIDER_UNAVAILABLE'
          : 'UNKNOWN'
  logger.warn('printer.ipc.failed', { errorCode: code, status })
  return { ok: false, status, errorCode: code }
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
