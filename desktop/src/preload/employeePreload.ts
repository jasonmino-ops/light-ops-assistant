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
const POS_SESSION_TAKE_CHANNEL = 'eshop:pos-session:take'
const V3_PRINT_SUBMIT_CHANNEL = 'eshop:v3-print:submit'
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

contextBridge.exposeInMainWorld('eshopV3Printing', Object.freeze({
  submit: (intent: unknown) => ipcRenderer.invoke(V3_PRINT_SUBMIT_CHANNEL, intent),
}))

type PosSessionPayload = {
  browserDeviceId: string
  storeCode: string
  token: string
  expiresAt: string
}

function isPosSessionPayload(value: unknown): value is PosSessionPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.browserDeviceId === 'string' &&
    /^desktop-[A-Za-z0-9_-]+$/.test(payload.browserDeviceId) &&
    typeof payload.storeCode === 'string' &&
    payload.storeCode.length > 0 &&
    payload.storeCode.length <= 128 &&
    typeof payload.token === 'string' &&
    payload.token.length >= 40 &&
    payload.token.length <= 4096 &&
    payload.token.includes('.') &&
    typeof payload.expiresAt === 'string' &&
    Number.isFinite(Date.parse(payload.expiresAt))
  )
}

// The Desktop credential never leaves main. Preload receives only the derived
// managed POS session and initializes the existing Cashier storage contract.
void ipcRenderer.invoke(POS_SESSION_TAKE_CHANNEL).then((value: unknown) => {
  if (!isPosSessionPayload(value)) return
  const tokenKey = `cashier:posDeviceToken:${value.storeCode}`
  const changed =
    window.localStorage.getItem('cashier:deviceId') !== value.browserDeviceId ||
    window.localStorage.getItem(tokenKey) !== value.token
  if (!changed) return
  window.localStorage.setItem('cashier:deviceId', value.browserDeviceId)
  window.localStorage.setItem(tokenKey, value.token)
  // Cashier reads its device token during initial mount. A one-time reload is
  // required when this startup handoff replaces or restores that token.
  window.location.reload()
}).catch(() => {
  // Existing Browser/Desktop recovery fallback remains responsible for recovery.
})

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
