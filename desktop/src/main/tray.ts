/**
 * E-Shop Desktop — Tray（最小版）
 *
 * 误关闭保护：关闭员工窗口不退出 Runtime；只能通过 Tray「退出」真正退出。
 */

import { Tray, Menu, nativeImage, dialog, app } from 'electron'
import { logger, getLogPaths } from './logger'
import { getHealthSnapshot } from './runtimeHealth'
import { getConfigPath } from './config'
import type { WindowManager } from './windowManager'

// 16x16 单色收银台图标（内嵌 base64，避免打包资源路径问题）
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWElEQVR4nGNgGAWDHfxHwqTq+c/AwMDAhE0DPk3IipmwSRJjEIomJhyKCBqMSzNBg/FpxmswIc14DSbGYLwuI9Zg/D4l1mBSDcOZDsjRPJioGSTHjIJhBADOTh4ZWvNZ2wAAAABJRU5ErkJggg=='

let tray: Tray | null = null

export function createTray(windowManager: WindowManager, onQuit: () => void) {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  tray = new Tray(icon)
  tray.setToolTip(`E-Shop Desktop v${app.getVersion()}`)

  const menu = Menu.buildFromTemplate([
    { label: '打开收银窗口', click: () => windowManager.focusEmployeeWindow() },
    { label: '打开/关闭顾客窗口', click: () => windowManager.toggleCustomerWindow() },
    {
      label: '查看运行状态',
      click: () => {
        const health = getHealthSnapshot()
        const { logFile } = getLogPaths()
        dialog.showMessageBox({
          type: 'info',
          title: 'E-Shop Desktop — Runtime Health',
          message: `E-Shop Desktop v${health.version}`,
          detail: [
            JSON.stringify(health, null, 2),
            '',
            `日志: ${logFile ?? '(未初始化)'}`,
            `配置: ${getConfigPath() ?? '(未初始化)'}`,
          ].join('\n'),
        }).catch(() => { /* 忽略对话框错误 */ })
      },
    },
    { type: 'separator' },
    {
      label: '退出 E-Shop Desktop',
      click: () => {
        logger.info('tray.quit-clicked')
        onQuit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => windowManager.focusEmployeeWindow())
  logger.info('tray.created')
  return tray
}

export function destroyTray() {
  tray?.destroy()
  tray = null
}
