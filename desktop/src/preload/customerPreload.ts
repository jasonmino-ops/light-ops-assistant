/**
 * E-Shop Desktop — 顾客窗口 Preload（sandboxed，自包含）
 *
 * 职责：
 * 1. 注入只读 Desktop Runtime 标识（windowRole: customer）
 * 2. 接收 Main 下发的购物车快照，回放到页面 BroadcastChannel，
 *    由 /desktop/display 现有监听逻辑（含 sequence guard）消费
 * 3. 页面加载完成后向 Main 上报 display-ready，触发最新快照重推
 *
 * 安全边界：
 * - 顾客窗口只能发送 display-ready 一个通道，无法发送购物车数据，
 *   无法 invoke，任何反向控制 POS 的路径在 Main 端 IPC 白名单被拒绝
 * - 回放消息带 relayedByDesktop 标记，防止被员工窗口 preload 再次上报
 *
 * 注意：本文件必须保持自包含（sandboxed preload 无法 require 本地模块）。
 * 通道字符串与 src/shared/ipcChannels.ts 的一致性由 tests/static-security.test.ts 静态校验。
 */

import { contextBridge, ipcRenderer } from 'electron'

const CART_APPLY_CHANNEL = 'eshop:cart:apply'
const DISPLAY_READY_CHANNEL = 'eshop:display:ready'
const WEB_REALTIME_BROADCAST_CHANNEL = 'light-ops:customer-display:realtime:v1'
const DESKTOP_RELAY_FLAG = 'relayedByDesktop'

const versionArg = process.argv.find((arg) => arg.startsWith('--eshop-desktop-version='))
const desktopVersion = versionArg ? versionArg.split('=')[1] : 'unknown'

contextBridge.exposeInMainWorld('eshopDesktopRuntime', Object.freeze({
  isDesktop: true,
  runtime: 'electron',
  windowRole: 'customer',
  version: desktopVersion,
}))

let relayChannel: BroadcastChannel | null = null
try {
  relayChannel = new BroadcastChannel(WEB_REALTIME_BROADCAST_CHANNEL)
} catch (error) {
  console.warn('[eshop-desktop] customer preload: BroadcastChannel unavailable', error)
}

ipcRenderer.on(CART_APPLY_CHANNEL, (_event, message: unknown) => {
  if (!message || typeof message !== 'object') return
  const m = message as Record<string, unknown>
  if (m.type !== 'CART_SNAPSHOT' && m.type !== 'CLEAR') return
  try {
    relayChannel?.postMessage({ ...m, [DESKTOP_RELAY_FLAG]: true })
  } catch (error) {
    console.warn('[eshop-desktop] customer preload: relay failed', error)
  }
})

window.addEventListener('DOMContentLoaded', () => {
  try {
    ipcRenderer.send(DISPLAY_READY_CHANNEL)
  } catch (error) {
    console.warn('[eshop-desktop] customer preload: display-ready failed', error)
  }
})
