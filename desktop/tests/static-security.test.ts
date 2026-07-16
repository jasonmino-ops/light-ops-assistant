/**
 * 静态安全边界测试（A1/A6）
 *
 * 直接读取源码做静态断言：
 * 1. 核心安全配置未被关闭（contextIsolation/sandbox/nodeIntegration）
 * 2. sandboxed preload 与 shared/ipcChannels.ts 的通道字符串保持同步
 * 3. preload 不引入 Node 危险能力，不暴露 ipcRenderer 原始对象
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  IPC_CHANNELS,
  WEB_REALTIME_BROADCAST_CHANNEL,
  DESKTOP_RELAY_FLAG,
} from '../src/shared/ipcChannels'

const src = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8')

const windowManagerSrc = src('main/windowManager.ts')
const employeePreloadSrc = src('preload/employeePreload.ts')
const customerPreloadSrc = src('preload/customerPreload.ts')
const mainSrc = src('main/main.ts')

describe('Electron 安全基线（静态）', () => {
  it('窗口 webPreferences：contextIsolation:true / nodeIntegration:false / sandbox:true', () => {
    expect(windowManagerSrc).toMatch(/contextIsolation:\s*true/)
    expect(windowManagerSrc).toMatch(/nodeIntegration:\s*false/)
    expect(windowManagerSrc).toMatch(/sandbox:\s*true/)
    expect(windowManagerSrc).not.toMatch(/contextIsolation:\s*false/)
    expect(windowManagerSrc).not.toMatch(/nodeIntegration:\s*true/)
    expect(windowManagerSrc).not.toMatch(/webSecurity:\s*false/)
    expect(windowManagerSrc).not.toMatch(/allowRunningInsecureContent/)
    expect(windowManagerSrc).not.toMatch(/enableRemoteModule/)
  })

  it('窗口拒绝任意新窗口与跨源导航', () => {
    expect(windowManagerSrc).toMatch(/setWindowOpenHandler/)
    expect(windowManagerSrc).toMatch(/will-navigate/)
    expect(windowManagerSrc).toMatch(/setPermissionRequestHandler/)
  })

  it('主进程不存在任意命令执行接口', () => {
    for (const s of [mainSrc, windowManagerSrc]) {
      expect(s).not.toMatch(/child_process|execFile|spawn\(|exec\(/)
      expect(s).not.toMatch(/\beval\(/)
    }
  })
})

describe('Preload 与 shared 通道白名单同步（sandboxed preload 自包含约束）', () => {
  it('员工 preload 使用且仅使用 CART_PUBLISH 发送', () => {
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.CART_PUBLISH}'`)
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER}'`)
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT}'`)
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.EMPLOYEE_FULLSCREEN_STATE}'`)
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.PRINTER_PRINT_RECEIPT}'`)
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.DISPLAY_GET_STATE}'`)
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.DISPLAY_SET_MODE}'`)
    expect(employeePreloadSrc).toContain(`'${IPC_CHANNELS.DISPLAY_SWAP}'`)
    expect(employeePreloadSrc).toContain(`'${WEB_REALTIME_BROADCAST_CHANNEL}'`)
    expect(employeePreloadSrc).toContain(`'${DESKTOP_RELAY_FLAG}'`)
    expect(employeePreloadSrc).not.toContain(IPC_CHANNELS.CART_APPLY)
    expect(employeePreloadSrc).not.toContain(IPC_CHANNELS.DISPLAY_READY)
  })

  it('顾客 preload 使用 CART_APPLY 接收 + DISPLAY_READY 上报', () => {
    expect(customerPreloadSrc).toContain(`'${IPC_CHANNELS.CART_APPLY}'`)
    expect(customerPreloadSrc).toContain(`'${IPC_CHANNELS.DISPLAY_READY}'`)
    expect(customerPreloadSrc).toContain(`'${WEB_REALTIME_BROADCAST_CHANNEL}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.CART_PUBLISH}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.EMPLOYEE_FULLSCREEN_STATE}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.PRINTER_PRINT_RECEIPT}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.DISPLAY_GET_STATE}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.DISPLAY_SET_MODE}'`)
    expect(customerPreloadSrc).not.toContain(`'${IPC_CHANNELS.DISPLAY_SWAP}'`)
  })

  it('preload 不 require 本地模块、不暴露 ipcRenderer/Node 能力给页面', () => {
    for (const s of [employeePreloadSrc, customerPreloadSrc]) {
      // 自包含：只允许 import electron
      const imports = [...s.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      expect(imports).toEqual(['electron'])
      expect(s).not.toMatch(/require\(/)
      expect(s).not.toMatch(/exposeInMainWorld\((?:'|")[^'"]+(?:'|"),\s*ipcRenderer/)
      expect(s).not.toMatch(/child_process|fs\.|process\.binding/)
      // 环境标识必须只读
      expect(s).toMatch(/Object\.freeze/)
    }
  })

  it('员工 preload 忽略回放消息（防回环）', () => {
    expect(employeePreloadSrc).toMatch(/DESKTOP_RELAY_FLAG\]\)\s*return/)
  })

  it('员工 preload 为每个页面生命周期注入 Desktop epoch', () => {
    expect(employeePreloadSrc).toMatch(/desktopEpoch/)
    expect(employeePreloadSrc).toMatch(/randomUUID|Math\.random/)
    expect(employeePreloadSrc).toMatch(/ipcRenderer\.send\(CART_PUBLISH_CHANNEL,\s*\{\s*\.\.\.message,\s*desktopEpoch\s*\}/)
  })

  it('顾客 preload 回放消息带 relay 标记', () => {
    expect(customerPreloadSrc).toMatch(/\[DESKTOP_RELAY_FLAG\]:\s*true/)
  })

  it('员工 preload 仅暴露受控原生全屏方法，不暴露通用窗口控制', () => {
    expect(employeePreloadSrc).toMatch(/exposeInMainWorld\('eshopDesktopEmployeeFullscreen'/)
    expect(employeePreloadSrc).toMatch(/enterEmployeeFullscreen/)
    expect(employeePreloadSrc).toMatch(/exitEmployeeFullscreen/)
    expect(employeePreloadSrc).toMatch(/getEmployeeFullscreenState/)
    expect(employeePreloadSrc).not.toMatch(/setFullScreen|BrowserWindow|windowControl/)
    expect(customerPreloadSrc).not.toMatch(/eshopDesktopEmployeeFullscreen/)
    expect(customerPreloadSrc).not.toMatch(/eshopDesktopPrinter/)
    expect(customerPreloadSrc).not.toMatch(/eshopDesktopDisplay/)
  })

  it('员工 preload 仅暴露专用打印 API，不暴露 ipcRenderer', () => {
    expect(employeePreloadSrc).toMatch(/exposeInMainWorld\('eshopDesktopPrinter'/)
    expect(employeePreloadSrc).toMatch(/printReceipt/)
    expect(employeePreloadSrc).toMatch(/ipcRenderer\.invoke\(PRINTER_PRINT_RECEIPT_CHANNEL/)
    expect(employeePreloadSrc).not.toMatch(/exposeInMainWorld\((?:'|")eshopDesktopPrinter(?:'|"),\s*ipcRenderer/)
  })

  it('员工 preload 仅暴露高层显示控制 API，不暴露坐标或窗口 ID', () => {
    expect(employeePreloadSrc).toMatch(/exposeInMainWorld\('eshopDesktopDisplay'/)
    expect(employeePreloadSrc).toMatch(/getState/)
    expect(employeePreloadSrc).toMatch(/setMode/)
    expect(employeePreloadSrc).toMatch(/swap/)
    expect(employeePreloadSrc).not.toMatch(/setBounds|setPosition|windowId|BrowserWindow/)
  })
})

describe('Desktop 环境检测（兼容策略：显式标识，不用 User-Agent）', () => {
  it('两个 preload 均注入只读 eshopDesktopRuntime 标识', () => {
    expect(employeePreloadSrc).toMatch(/exposeInMainWorld\('eshopDesktopRuntime'/)
    expect(customerPreloadSrc).toMatch(/exposeInMainWorld\('eshopDesktopRuntime'/)
    expect(employeePreloadSrc).toMatch(/windowRole:\s*'employee'/)
    expect(customerPreloadSrc).toMatch(/windowRole:\s*'customer'/)
  })
})
