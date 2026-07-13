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
const WEB_REALTIME_BROADCAST_CHANNEL = 'light-ops:customer-display:realtime:v1'
const DESKTOP_RELAY_FLAG = 'relayedByDesktop'

const versionArg = process.argv.find((arg) => arg.startsWith('--eshop-desktop-version='))
const desktopVersion = versionArg ? versionArg.split('=')[1] : 'unknown'

// 只读 Desktop 环境标识：页面可通过 window.eshopDesktopRuntime 显式检测
contextBridge.exposeInMainWorld('eshopDesktopRuntime', Object.freeze({
  isDesktop: true,
  runtime: 'electron',
  windowRole: 'employee',
  version: desktopVersion,
}))

// 旁路捕获现有 Web 实时通道（零侵入：不修改任何冻结页面）
try {
  const channel = new BroadcastChannel(WEB_REALTIME_BROADCAST_CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    const message = event.data as Record<string, unknown> | null
    if (!message || typeof message !== 'object') return
    if (message[DESKTOP_RELAY_FLAG]) return // 回放消息，忽略，防回环
    if (message.type !== 'CART_SNAPSHOT' && message.type !== 'CLEAR') return
    ipcRenderer.send(CART_PUBLISH_CHANNEL, message)
  }
} catch (error) {
  console.warn('[eshop-desktop] employee preload: BroadcastChannel unavailable', error)
}
