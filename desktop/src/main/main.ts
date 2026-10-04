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
import { getConfig, loadConfig } from './config'
import { registerIpcHandlers, setV3PrintingRuntimeProvider } from './ipcRouter'
import { windowManager } from './windowManager'
import { createTray, destroyTray } from './tray'
import { updateHealth, recordHealthError, getHealthSnapshot } from './runtimeHealth'
import { createDefaultHardwareManager } from './hardware/hardwareManager'
import { WindowsProviderSupervisor } from './provider/providerSupervisor'
import { ActivationApiClient } from './activation/activationApiClient'
import { CredentialStore } from './activation/credentialStore'
import { ActivationRuntime } from './activation/activationRuntime'
import { ActivationWindowController } from './activation/activationWindowController'
import { registerActivationIpcHandlers } from './activation/activationIpc'
import type { AuthorizedDesktopContext } from './activation/activationTypes'
import { V3ControlPlaneClient } from './printing/controlPlaneClient'
import { V3ControlPlaneRuntime } from './printing/controlPlaneRuntime'
import { V3PrintingRuntime } from './printing/v3PrintingRuntime'
import { V3PrintJobClient } from './printing/v3PrintJobClient'
import { applyAuthorizedEndpointProvisioning } from './printing/localEndpointProvisioning'
import { attemptFreshV3Bootstrap } from './printing/freshV3Bootstrap'
import { PrinterSetupService, type PrinterSetupSnapshot } from './printing/printerSetupService'
import { PrinterSetupWindowController } from './printing/printerSetupWindowController'
import { registerPrinterSetupIpcHandlers } from './printing/printerSetupIpc'

// ── 单实例（A4）────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例运行：本实例直接退出；日志由已有实例的 second-instance 事件记录
  app.quit()
} else {
  app.on('second-instance', () => {
    logger.warn('single-instance.conflict', { note: 'second launch detected' })
    if (activationRuntime?.isAuthorized() && printerSetupService?.snapshot().state === 'READY' && providerSupervisor?.isReady() === true) windowManager.focusEmployeeWindow()
    else if (activationRuntime?.isAuthorized()) printerSetupWindowController?.show()
    else activationWindowController?.focus()
  })

  let quitting = false
  let providerSupervisor: WindowsProviderSupervisor | null = null
  let activationRuntime: ActivationRuntime | null = null
  let activationWindowController: ActivationWindowController | null = null
  let authorizedRuntimeStarted = false
  let authorizedRuntimeStartPromise: Promise<void> | null = null
  let credentialStore: CredentialStore | null = null
  let v3ControlPlaneRuntime: V3ControlPlaneRuntime | null = null
  let v3PrintingRuntime: V3PrintingRuntime | null = null
  let printerSetupService: PrinterSetupService | null = null
  let printerSetupWindowController: PrinterSetupWindowController | null = null
  let providerReadinessUnsubscribe: (() => void) | null = null
  let cashierWindowsStarted = false

  async function quitApp() {
    if (quitting) return
    quitting = true
    activationRuntime?.markQuitting()
    windowManager.setQuitting()
    providerReadinessUnsubscribe?.()
    providerReadinessUnsubscribe = null
    try { await providerSupervisor?.stop() } catch (error) {
      recordHealthError('provider', `provider stop failed: ${String(error)}`)
    }
    try { await v3PrintingRuntime?.close() } catch (error) {
      recordHealthError('v3-printing', `printing runtime close failed: ${String(error)}`)
    }
    try { await v3ControlPlaneRuntime?.stop() } catch (error) {
      recordHealthError('v3-control-plane', `control-plane stop failed: ${String(error)}`)
    }
    destroyTray()
    printerSetupWindowController?.destroy()
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

  async function startAuthorizedDesktopRuntime(context: AuthorizedDesktopContext): Promise<void> {
    if (authorizedRuntimeStarted) return
    if (authorizedRuntimeStartPromise) return authorizedRuntimeStartPromise
    authorizedRuntimeStartPromise = (async () => {
      windowManager.setAuthorizedLaunchContext({ storeCode: context.device.storeCode })
      windowManager.setFormalRuntimeGuard(() => activationRuntime?.isAuthorized() === true)

      // Hardware Runtime 基础框架（A9）：仅注册占位设备
      const hardware = createDefaultHardwareManager()
      updateHealth({ hardwareRuntime: 'ok' }, 'hardware.registered')
      logger.info('hardware.status', hardware.getStatusSummary())

      const credential = await credentialStore?.readCredential()
      let initialPrinterSetupState: PrinterSetupSnapshot | null = null
      if (credential?.ok) {
        const controlPlaneClient = new V3ControlPlaneClient(getConfig().baseUrl, credential.credential.deviceToken)
        const bootstrap = await attemptFreshV3Bootstrap({
          appDataPath: app.getPath('appData'),
          userDataPath: app.getPath('userData'),
          credentialStore: credentialStore!,
          client: controlPlaneClient,
        })
        logger.info('v3-control-plane.fresh-bootstrap', { status: bootstrap.status })
        v3ControlPlaneRuntime = new V3ControlPlaneRuntime(
          controlPlaneClient,
          context.device.deviceId,
        )
        await v3ControlPlaneRuntime.start()
        v3PrintingRuntime = await V3PrintingRuntime.open({
          userDataPath: app.getPath('userData'),
          controlPlane: v3ControlPlaneRuntime,
          storeId: context.device.storeId,
          deviceId: context.device.deviceId,
          cloud: new V3PrintJobClient(getConfig().baseUrl, credential.credential.deviceToken),
        })
        await applyAuthorizedEndpointProvisioning(v3PrintingRuntime, {
          storeId: context.device.storeId,
          deviceId: context.device.deviceId,
        })
        await v3PrintingRuntime.start()
        printerSetupService = new PrinterSetupService(v3PrintingRuntime, app.getVersion())
        initialPrinterSetupState = await printerSetupService.initialize()
        logger.info('v3-control-plane.reconciled', { status: v3ControlPlaneRuntime.current().status })
      } else {
        throw new Error('AUTHORIZED_RUNTIME_CREDENTIAL_UNAVAILABLE')
      }

      providerSupervisor = new WindowsProviderSupervisor()
      await providerSupervisor.start()

      setV3PrintingRuntimeProvider(() => v3PrintingRuntime)
      registerIpcHandlers(windowManager)
      printerSetupWindowController = new PrinterSetupWindowController()
      const openCashierIfReady = (state: PrinterSetupSnapshot = printerSetupService!.snapshot()) => {
        const providerReady = providerSupervisor?.isReady() === true
        if (state.state !== 'READY' || !providerReady) {
          cashierWindowsStarted = false
          windowManager.holdCashier()
          if (state.state !== 'READY') printerSetupWindowController?.show()
          return
        }
        if (cashierWindowsStarted) {
          windowManager.resumeCashier()
          windowManager.focusEmployeeWindow()
          return
        }
        windowManager.resumeCashier()
        windowManager.createEmployeeWindow()
        windowManager.ensureCustomerWindow('startup')
        windowManager.watchDisplays()
        cashierWindowsStarted = true
      }
      providerReadinessUnsubscribe = providerSupervisor.onReadinessChanged(() => {
        if (!quitting) openCashierIfReady()
      })
      registerPrinterSetupIpcHandlers({
        service: printerSetupService!,
        windowController: printerSetupWindowController,
        onStateChanged: (state) => openCashierIfReady(state),
      })
      printerSetupWindowController.sendState(initialPrinterSetupState!)

      createTray(windowManager,
        () => { void quitApp() },
        () => printerSetupWindowController?.show(),
        () => printerSetupService?.snapshot().state === 'READY' && providerSupervisor?.isReady() === true,
      )
      openCashierIfReady(initialPrinterSetupState!)
      authorizedRuntimeStarted = true
    })().catch(async (error) => {
      providerReadinessUnsubscribe?.()
      providerReadinessUnsubscribe = null
      try { await providerSupervisor?.stop() } catch { /* startup cleanup */ }
      try { await v3PrintingRuntime?.close() } catch { /* startup cleanup */ }
      try { await v3ControlPlaneRuntime?.stop() } catch { /* startup cleanup */ }
      providerSupervisor = null
      v3PrintingRuntime = null
      v3ControlPlaneRuntime = null
      printerSetupService = null
      cashierWindowsStarted = false
      printerSetupWindowController?.destroy()
      printerSetupWindowController = null
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

    const config = loadConfig(app.getPath('userData'))
    windowManager.setFormalRuntimeGuard(() => activationRuntime?.isAuthorized() === true)

    activationWindowController = new ActivationWindowController({
      isAuthorized: () => activationRuntime?.isAuthorized() === true,
      onClosedBeforeAuthorization: () => { void quitApp() },
    })

    credentialStore = new CredentialStore(app.getPath('userData'))
    activationRuntime = new ActivationRuntime({
      credentialStore,
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
}
