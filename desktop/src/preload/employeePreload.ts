/**
 * E-Shop Desktop — 员工窗口 Preload（sandboxed，自包含）
 *
 * 职责：
 * 1. 注入只读、最小化 Desktop Runtime 标识（显式环境检测，不用 User-Agent）
 * 2. 旁路捕获 Web 层 BroadcastChannel 上的购物车实时消息，经白名单 IPC 上报 Main
 *
 * 安全边界：
 * - sandbox: true / contextIsolation: true / nodeIntegration: false
 * - 不向页面暴露 ipcRenderer 或任何可调用的 Node 能力
 * - 仅使用一个固定 send 通道；无参数透传、无任意 channel
 * - 忽略带 relayedByDesktop 标记的回放消息，防止消息回环
 *
 * 注意：本文件必须保持自包含（sandboxed preload 无法 require 本地模块）。
 * 通道字符串与 src/shared/ipcChannels.ts 的一致性由 tests/static-security.test.ts 静态校验。
 */

import { contextBridge, ipcRenderer } from 'electron'

const CART_PUBLISH_CHANNEL = 'eshop:cart:publish'
const EMPLOYEE_FULLSCREEN_ENTER_CHANNEL = 'eshop:employee-fullscreen:enter'
const EMPLOYEE_FULLSCREEN_EXIT_CHANNEL = 'eshop:employee-fullscreen:exit'
const EMPLOYEE_FULLSCREEN_STATE_CHANNEL = 'eshop:employee-fullscreen:state'
const DEPLOYMENT_GET_HEALTH_CHANNEL = 'eshop:deployment:get-health'
const DEPLOYMENT_GET_SYSTEM_INFO_CHANNEL = 'eshop:deployment:get-system-info'
const DEPLOYMENT_RETRY_CLOUD_CHANNEL = 'eshop:deployment:retry-cloud'
const DEPLOYMENT_RELOAD_BUSINESS_CHANNEL = 'eshop:deployment:reload-business'
const DEPLOYMENT_RECHECK_PROVIDER_CHANNEL = 'eshop:deployment:recheck-provider'
const DEPLOYMENT_RECHECK_DISPLAYS_CHANNEL = 'eshop:deployment:recheck-displays'
const DEPLOYMENT_OPEN_LOGS_CHANNEL = 'eshop:deployment:open-logs'
const DEPLOYMENT_EXPORT_DIAGNOSTICS_CHANNEL = 'eshop:deployment:export-diagnostics'
const DEPLOYMENT_QUIT_CHANNEL = 'eshop:deployment:quit'
const DEPLOYMENT_RETURN_TO_ACTIVATION_CHANNEL = 'eshop:deployment:return-to-activation'
const WEB_REALTIME_BROADCAST_CHANNEL = 'light-ops:customer-display:realtime:v1'
const DESKTOP_RELAY_FLAG = 'relayedByDesktop'
const desktopEpoch = (() => {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `epoch-${Date.now()}-${Math.random().toString(36).slice(2)}`
  } catch {
    return `epoch-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
})()

const versionArg = process.argv.find((arg) => arg.startsWith('--eshop-desktop-version='))
const desktopVersion = versionArg ? versionArg.split('=')[1] : 'unknown'

// 只读 Desktop 环境标识：页面可通过 window.eshopDesktopRuntime 显式检测
contextBridge.exposeInMainWorld('eshopDesktopRuntime', Object.freeze({
  isDesktop: true,
  runtime: 'electron',
  windowRole: 'employee',
  version: desktopVersion,
  desktopEpoch,
}))

contextBridge.exposeInMainWorld('eshopDesktopEmployeeFullscreen', Object.freeze({
  enterEmployeeFullscreen: () => ipcRenderer.invoke(EMPLOYEE_FULLSCREEN_ENTER_CHANNEL),
  exitEmployeeFullscreen: () => ipcRenderer.invoke(EMPLOYEE_FULLSCREEN_EXIT_CHANNEL),
  getEmployeeFullscreenState: () => ipcRenderer.invoke(EMPLOYEE_FULLSCREEN_STATE_CHANNEL),
}))

contextBridge.exposeInMainWorld('eshopDesktopDeployment', Object.freeze({
  getHealth: () => ipcRenderer.invoke(DEPLOYMENT_GET_HEALTH_CHANNEL),
  getSystemInfo: () => ipcRenderer.invoke(DEPLOYMENT_GET_SYSTEM_INFO_CHANNEL),
  retryCloud: () => ipcRenderer.invoke(DEPLOYMENT_RETRY_CLOUD_CHANNEL),
  reloadBusiness: () => ipcRenderer.invoke(DEPLOYMENT_RELOAD_BUSINESS_CHANNEL),
  recheckProvider: () => ipcRenderer.invoke(DEPLOYMENT_RECHECK_PROVIDER_CHANNEL),
  recheckDisplays: () => ipcRenderer.invoke(DEPLOYMENT_RECHECK_DISPLAYS_CHANNEL),
  openLogs: () => ipcRenderer.invoke(DEPLOYMENT_OPEN_LOGS_CHANNEL),
  exportDiagnostics: () => ipcRenderer.invoke(DEPLOYMENT_EXPORT_DIAGNOSTICS_CHANNEL),
  quit: () => ipcRenderer.invoke(DEPLOYMENT_QUIT_CHANNEL),
  returnToActivation: () => ipcRenderer.invoke(DEPLOYMENT_RETURN_TO_ACTIVATION_CHANNEL),
}))

// 旁路捕获现有 Web 实时通道（零侵入：不修改任何冻结页面）
try {
  const channel = new BroadcastChannel(WEB_REALTIME_BROADCAST_CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    const message = event.data as Record<string, unknown> | null
    if (!message || typeof message !== 'object') return
    if (message[DESKTOP_RELAY_FLAG]) return // 回放消息，忽略，防回环
    if (message.type !== 'CART_SNAPSHOT' && message.type !== 'CLEAR') return
    ipcRenderer.send(CART_PUBLISH_CHANNEL, { ...message, desktopEpoch })
  }
} catch (error) {
  console.warn('[eshop-desktop] employee preload: BroadcastChannel unavailable', error)
}
