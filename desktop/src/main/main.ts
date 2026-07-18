/**
 * E-Shop Desktop — 主进程入口（Milestone A: Desktop Shell）
 *
 * 生命周期：单实例锁 → app ready → 日志/配置/健康初始化 → IPC 注册
 * → 员工窗口（主屏）→ 顾客窗口（副屏，存在时）→ Tray → 屏幕监听。
 *
 * 架构基线：Cloud is Business / Desktop is Runtime。
 * 本进程不包含任何业务逻辑，仅加载现有云端页面并提供本地 Runtime 能力。
 */

import { app, BrowserWindow } from 'electron'
import { initLogger, logger, getLogPaths } from './logger'
import { loadConfig } from './config'
import { registerIpcHandlers } from './ipcRouter'
import { windowManager } from './windowManager'
import { createTray, destroyTray } from './tray'
import {
  recordDeploymentFailure,
  updateDeploymentComponent,
  updateHealth,
  recordHealthError,
  getHealthSnapshot,
} from './runtimeHealth'
import { createDefaultHardwareManager } from './hardware/hardwareManager'
import { WindowsProviderSupervisor } from './provider/providerSupervisor'
import { ActivationApiClient } from './activation/activationApiClient'
import { CredentialStore } from './activation/credentialStore'
import { ActivationRuntime } from './activation/activationRuntime'
import { ActivationWindowController } from './activation/activationWindowController'
import { registerActivationIpcHandlers } from './activation/activationIpc'
import type { ActivationPublicState, AuthorizedDesktopContext } from './activation/activationTypes'
import {
  buildDeploymentSystemInfo,
  exportDiagnosticsBundle,
  openDeploymentLogDirectory,
} from './deploymentSupport'
import { classifyDeploymentFailure } from '../shared/deploymentDiagnostics'

// ── 单实例（A4）────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例运行：本实例直接退出；日志由已有实例的 second-instance 事件记录
  app.quit()
} else {
  app.on('second-instance', () => {
    logger.warn('single-instance.conflict', { note: 'second launch detected' })
    if (activationRuntime?.isAuthorized()) windowManager.focusEmployeeWindow()
    else activationWindowController?.focus()
  })

  let quitting = false
  let providerSupervisor: WindowsProviderSupervisor | null = null
  let activationRuntime: ActivationRuntime | null = null
  let activationWindowController: ActivationWindowController | null = null
  let authorizedRuntimeStarted = false
  let authorizedRuntimeStartPromise: Promise<void> | null = null

  async function quitApp() {
    if (quitting) return
    quitting = true
    activationRuntime?.markQuitting()
    windowManager.setQuitting()
    try { await providerSupervisor?.stop() } catch (error) {
      recordHealthError('provider', `provider stop failed: ${String(error)}`)
    }
    destroyTray()
    activationWindowController?.destroy()
    logger.info('app.quit', { uptimeSeconds: getHealthSnapshot().uptimeSeconds })
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.destroy() } catch { /* 已销毁 */ }
    }
    app.quit()
  }

  // ── 全局异常（A8）──────────────────────────────────────────────────────────
  process.on('uncaughtException', (error) => {
    recordHealthError('process', `uncaughtException: ${error.stack ?? error.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    recordHealthError('process', `unhandledRejection: ${String(reason)}`)
  })

  async function startAuthorizedDesktopRuntime(_context: AuthorizedDesktopContext): Promise<void> {
    if (authorizedRuntimeStarted) return
    if (authorizedRuntimeStartPromise) return authorizedRuntimeStartPromise
    authorizedRuntimeStartPromise = (async () => {
      windowManager.setFormalRuntimeGuard(() => activationRuntime?.isAuthorized() === true)

      // Hardware Runtime 基础框架（A9）：仅注册占位设备
      const hardware = createDefaultHardwareManager()
      updateHealth({ hardwareRuntime: 'ok' }, 'hardware.registered')
      logger.info('hardware.status', hardware.getStatusSummary())

      registerIpcHandlers(windowManager, {
        getSystemInfo: () => buildDeploymentSystemInfo(activationRuntime?.getDeploymentSummary() ?? null),
        openLogs: openDeploymentLogDirectory,
        exportDiagnostics: () => exportDiagnosticsBundle({
          activation: activationRuntime?.getDeploymentSummary() ?? null,
          provider: getHealthSnapshot().providerRuntime,
        }),
        onQuit: () => { void quitApp() },
        returnToActivation: () => {
          if (!activationRuntime || activationRuntime.isAuthorized()) {
            return { ok: false, error: 'RETURN_TO_ACTIVATION_NOT_ALLOWED' }
          }
          activationWindowController?.show()
          return { ok: true }
        },
        recheckProvider: () => providerSupervisor?.recheckStatus() ?? getHealthSnapshot().providerRuntime,
      })

      windowManager.createEmployeeWindow()
      windowManager.ensureCustomerWindow('startup')
      windowManager.watchDisplays()

      providerSupervisor = new WindowsProviderSupervisor()
      providerSupervisor.start().catch((error) => {
        recordHealthError('provider', `provider start failed: ${String(error)}`)
      })

      createTray(windowManager, () => { void quitApp() })
      authorizedRuntimeStarted = true
    })().catch((error) => {
      authorizedRuntimeStartPromise = null
      throw error
    })
    return authorizedRuntimeStartPromise
  }

  async function initializeApplication(): Promise<void> {
    initLogger(app.getPath('userData'))
    logger.info('app.start', {
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      osVersion: process.getSystemVersion?.() ?? 'unknown',
      logFile: getLogPaths().logFile,
    })
    updateHealth({ app: 'ok', version: app.getVersion() }, 'app.ready')
    updateDeploymentComponent('application', { level: 'HEALTHY', state: 'ready' }, 'deployment.application.ready')
    updateDeploymentComponent('logs', { level: 'HEALTHY', state: 'available', message: 'log directory available' }, 'deployment.logs.available')
    updateDeploymentComponent('system', { level: 'HEALTHY', state: 'ready' }, 'deployment.system.ready')

    const config = loadConfig(app.getPath('userData'))
    windowManager.setFormalRuntimeGuard(() => activationRuntime?.isAuthorized() === true)

    activationWindowController = new ActivationWindowController({
      isAuthorized: () => activationRuntime?.isAuthorized() === true,
      onClosedBeforeAuthorization: () => { void quitApp() },
    })

    activationRuntime = new ActivationRuntime({
      credentialStore: new CredentialStore(app.getPath('userData')),
      apiClient: new ActivationApiClient({ baseUrl: config.baseUrl }),
      initialStoreCodeHint: config.storeCode || undefined,
      startAuthorizedRuntime: startAuthorizedDesktopRuntime,
    })

    registerActivationIpcHandlers({
      runtime: activationRuntime,
      windowController: activationWindowController,
      onQuit: () => { void quitApp() },
    })

    activationRuntime.onStateChanged((state) => {
      activationWindowController?.sendState(state)
      applyActivationDeploymentHealth(state)
      if (state.kind === 'AUTHORIZED_RUNNING') activationWindowController?.closeAfterAuthorization()
    })

    await activationRuntime.initialize()
    if (!activationRuntime.isAuthorized()) activationWindowController.show()
  }

  app.whenReady().then(() => initializeApplication()).catch((error) => {
    recordHealthError('app', `whenReady failed: ${String(error)}`)
  })

  // 所有窗口关闭时不退出（Tray 常驻，误关闭保护）
  app.on('window-all-closed', () => {
    logger.info('app.all-windows-closed', { note: 'runtime stays in tray' })
  })

  app.on('render-process-gone', (_event, webContents, details) => {
    recordHealthError('renderer', `render-process-gone id=${webContents.id} reason=${details.reason}`)
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU') {
      recordHealthError('child-process', `${details.type} gone: ${details.reason}`)
    }
  })

  app.on('before-quit', () => {
    activationRuntime?.markQuitting()
    windowManager.setQuitting()
  })

  function applyActivationDeploymentHealth(state: ActivationPublicState) {
    if (state.kind === 'AUTHORIZED_RUNNING') {
      updateDeploymentComponent('activation', {
        level: 'HEALTHY',
        state: state.kind,
        message: 'activation authorized',
      }, 'deployment.activation.authorized')
      return
    }
    if (state.kind === 'BOOTING' || state.kind === 'ACTIVATING' || state.kind === 'VERIFYING' || state.kind === 'AUTHORIZED_STARTING') {
      updateDeploymentComponent('activation', {
        level: 'UNKNOWN',
        state: state.kind,
        message: 'activation in progress',
      }, 'deployment.activation.progress')
      return
    }
    if (state.kind === 'UNACTIVATED') {
      updateDeploymentComponent('activation', {
        level: 'FAILED',
        state: state.kind,
        message: 'activation required',
      }, 'deployment.activation.required')
      return
    }
    if (state.kind === 'QUITTING') {
      updateDeploymentComponent('activation', {
        level: 'UNKNOWN',
        state: state.kind,
        message: 'application quitting',
      }, 'deployment.activation.quitting')
      return
    }
    const failure = classifyDeploymentFailure({
      component: 'ACTIVATION',
      activationKind: state.kind,
      metadata: {
        activationState: state.kind,
        retryAfterSeconds: state.retryAfterSeconds,
        subscriptionState: state.subscription?.accessState,
      },
    })
    recordDeploymentFailure(failure)
  }
}
