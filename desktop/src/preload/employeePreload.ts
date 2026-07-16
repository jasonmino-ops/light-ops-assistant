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
const PRINTER_PRINT_RECEIPT_CHANNEL = 'desktop:printer:print-receipt'
const WEB_REALTIME_BROADCAST_CHANNEL = 'light-ops:customer-display:realtime:v1'
const DESKTOP_RELAY_FLAG = 'relayedByDesktop'
const MAX_PRINT_PAYLOAD_BYTES = 24 * 1024
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

contextBridge.exposeInMainWorld('eshopDesktopPrinter', Object.freeze({
  printReceipt: (payload: unknown) => {
    validatePrintPayload(payload)
    return ipcRenderer.invoke(PRINTER_PRINT_RECEIPT_CHANNEL, payload)
  },
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

function validatePrintPayload(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_PRINT_RECEIPT')
  const receipt = payload as { schemaVersion?: unknown; receiptId?: unknown; storeName?: unknown; storeCode?: unknown; timestamp?: unknown; currencyCode?: unknown; total?: unknown; items?: unknown }
  if (receipt.schemaVersion !== '1') throw new Error('INVALID_PRINT_RECEIPT')
  if (!isText(receipt.receiptId, 80) || !isText(receipt.storeName, 120) || !isText(receipt.storeCode, 80)) throw new Error('INVALID_PRINT_RECEIPT')
  if (!isText(receipt.timestamp, 80) || !isText(receipt.currencyCode, 12)) throw new Error('INVALID_PRINT_RECEIPT')
  if (typeof receipt.total !== 'number' || !Number.isFinite(receipt.total)) throw new Error('INVALID_PRINT_RECEIPT')
  if (!Array.isArray(receipt.items) || receipt.items.length < 1 || receipt.items.length > 200) throw new Error('INVALID_PRINT_RECEIPT')
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength
  if (bytes > MAX_PRINT_PAYLOAD_BYTES) throw new Error('INVALID_PRINT_RECEIPT_OVERSIZED')
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}
