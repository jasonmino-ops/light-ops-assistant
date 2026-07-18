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
import type { DeploymentSystemInfo, DiagnosticsExportResult } from '../shared/deploymentDiagnostics'

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

export type DeploymentIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type DeploymentIpcOptions = {
  getSystemInfo: () => DeploymentSystemInfo
  openLogs: () => Promise<{ ok: true } | { ok: false; error: string }>
  exportDiagnostics: () => Promise<DiagnosticsExportResult>
  onQuit: () => void
  returnToActivation: () => { ok: true } | { ok: false; error: string }
  recheckProvider: () => unknown
}

const deploymentRateLimit = new Map<string, number>()

function authorizeDeploymentRenderer(
  windowManager: WindowManager,
  event: IpcMainInvokeEvent,
  channel: string,
): boolean {
  const role = authorize(windowManager, event, channel, 'invoke')
  if (role !== 'employee') return false
  if (!windowManager.isEmployeeDeploymentRendererActive(event.sender.id)) {
    logger.warn('deployment-ipc.denied-outside-local-renderer', { channel, webContentsId: event.sender.id })
    return false
  }
  return true
}

function rateLimitDeployment(event: IpcMainInvokeEvent, channel: string, minIntervalMs: number): boolean {
  const key = `${event.sender.id}:${channel}`
  const now = Date.now()
  const last = deploymentRateLimit.get(key) ?? 0
  if (now - last < minIntervalMs) return false
  deploymentRateLimit.set(key, now)
  return true
}

function sanitizeIpcError(error: unknown): string {
  if (!(error instanceof Error)) return 'DEPLOYMENT_IPC_ERROR'
  if (/token|authorization|bearer|cookie|pin|ciphertext|khqr|payment|phone|address/i.test(error.message)) {
    return 'DEPLOYMENT_IPC_ERROR'
  }
  return error.message.slice(0, 120) || 'DEPLOYMENT_IPC_ERROR'
}

async function deploymentInvoke<T>(
  windowManager: WindowManager,
  event: IpcMainInvokeEvent,
  channel: string,
  args: unknown[],
  action: () => Promise<T> | T,
  minIntervalMs = 250,
): Promise<DeploymentIpcResult<T>> {
  if (!authorizeDeploymentRenderer(windowManager, event, channel)) return { ok: false, error: 'UNAUTHORIZED' }
  if (args.length > 0) return { ok: false, error: 'INVALID_PAYLOAD' }
  if (!rateLimitDeployment(event, channel, minIntervalMs)) return { ok: false, error: 'RATE_LIMITED' }
  try {
    logger.info('deployment-ipc.invoke', { channel, webContentsId: event.sender.id })
    return { ok: true, data: await action() }
  } catch (error) {
    logger.warn('deployment-ipc.error', { channel, message: sanitizeIpcError(error) })
    return { ok: false, error: sanitizeIpcError(error) }
  }
}

export function registerIpcHandlers(windowManager: WindowManager, deploymentOptions?: DeploymentIpcOptions) {
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

  if (deploymentOptions) {
    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_GET_HEALTH, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_GET_HEALTH,
      args,
      () => getHealthSnapshot().deployment,
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO,
      args,
      deploymentOptions.getSystemInfo,
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_RETRY_CLOUD, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_RETRY_CLOUD,
      args,
      () => windowManager.retryEmployeeBusinessLoad('manual'),
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_RELOAD_BUSINESS, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_RELOAD_BUSINESS,
      args,
      () => windowManager.retryEmployeeBusinessLoad('reload'),
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_RECHECK_PROVIDER, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_RECHECK_PROVIDER,
      args,
      deploymentOptions.recheckProvider,
      1000,
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_RECHECK_DISPLAYS, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_RECHECK_DISPLAYS,
      args,
      () => windowManager.recheckDisplays(),
      1000,
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_OPEN_LOGS, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_OPEN_LOGS,
      args,
      async () => {
        const result = await deploymentOptions.openLogs()
        if (!result.ok) throw new Error(result.error)
        return result
      },
      1000,
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_EXPORT_DIAGNOSTICS, async (event, ...args: unknown[]) => {
      const result = await deploymentInvoke(
        windowManager,
        event,
        IPC_CHANNELS.DEPLOYMENT_EXPORT_DIAGNOSTICS,
        args,
        deploymentOptions.exportDiagnostics,
        3000,
      )
      if (!result.ok) return result
      if (!result.data.ok) return { ok: false, error: result.data.error }
      return { ok: true, data: { filePath: result.data.filePath, manifest: result.data.manifest } }
    })

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_QUIT, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_QUIT,
      args,
      () => {
        deploymentOptions.onQuit()
        return { ok: true }
      },
      1000,
    ))

    ipcMain.handle(IPC_CHANNELS.DEPLOYMENT_RETURN_TO_ACTIVATION, (event, ...args: unknown[]) => deploymentInvoke(
      windowManager,
      event,
      IPC_CHANNELS.DEPLOYMENT_RETURN_TO_ACTIVATION,
      args,
      () => {
        const result = deploymentOptions.returnToActivation()
        if (!result.ok) throw new Error(result.error)
        return result
      },
      1000,
    ))
  }

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
