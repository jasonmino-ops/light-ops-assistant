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
import { updateHealth, recordHealthError, getHealthSnapshot } from './runtimeHealth'
import { createDefaultHardwareManager } from './hardware/hardwareManager'
import { WindowsProviderSupervisor } from './provider/providerSupervisor'

// ── 单实例（A4）────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 已有实例运行：本实例直接退出；日志由已有实例的 second-instance 事件记录
  app.quit()
} else {
  app.on('second-instance', () => {
    logger.warn('single-instance.conflict', { note: 'second launch detected, focusing employee window' })
    windowManager.focusEmployeeWindow()
  })

  let quitting = false
  let providerSupervisor: WindowsProviderSupervisor | null = null
  async function quitApp() {
    if (quitting) return
    quitting = true
    windowManager.setQuitting()
    try { await providerSupervisor?.stop() } catch (error) {
      recordHealthError('provider', `provider stop failed: ${String(error)}`)
    }
    destroyTray()
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

  app.whenReady().then(() => {
    initLogger(app.getPath('userData'))
    logger.info('app.start', {
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      osVersion: process.getSystemVersion?.() ?? 'unknown',
      logFile: getLogPaths().logFile,
    })
    updateHealth({ app: 'ok', version: app.getVersion() }, 'app.ready')

    const userDataDir = app.getPath('userData')
    loadConfig(userDataDir)
    windowManager.initDisplaySettings(userDataDir)

    // Hardware Runtime 基础框架（A9）：仅注册占位设备
    const hardware = createDefaultHardwareManager()
    updateHealth({ hardwareRuntime: 'ok' }, 'hardware.registered')
    logger.info('hardware.status', hardware.getStatusSummary())

    providerSupervisor = new WindowsProviderSupervisor()
    registerIpcHandlers(windowManager, providerSupervisor)

    windowManager.createEmployeeWindow()
    windowManager.applyDisplayLayout('startup')
    windowManager.watchDisplays()

    providerSupervisor.start().catch((error) => {
      recordHealthError('provider', `provider start failed: ${String(error)}`)
    })

    createTray(windowManager, () => { void quitApp() })
  }).catch((error) => {
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
    windowManager.setQuitting()
  })
}
