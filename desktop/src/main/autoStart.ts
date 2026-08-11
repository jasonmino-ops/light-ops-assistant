import { app } from 'electron'
import { logger } from './logger'
import { updateHealth } from './runtimeHealth'

export interface LoginItemAppPort {
  isPackaged: boolean
  setLoginItemSettings(settings: {
    openAtLogin: boolean
    path: string
    args: string[]
  }): void
  getLoginItemSettings(): { openAtLogin: boolean }
}

export function configureStoreRuntimeAutoStart(options: {
  appPort?: LoginItemAppPort
  platform?: NodeJS.Platform
  executablePath?: string
} = {}) {
  const appPort = options.appPort ?? app
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    updateHealth({ autoStart: { supported: false, configured: false, lastError: null } }, 'auto-start.not-windows')
    return { supported: false, configured: false, error: null }
  }
  if (!appPort.isPackaged) {
    updateHealth({
      autoStart: { supported: true, configured: false, lastError: 'PACKAGED_BUILD_REQUIRED' },
    }, 'auto-start.development-build')
    return { supported: true, configured: false, error: 'PACKAGED_BUILD_REQUIRED' }
  }
  try {
    appPort.setLoginItemSettings({
      openAtLogin: true,
      path: options.executablePath ?? process.execPath,
      args: ['--store-runtime-background'],
    })
    const configured = appPort.getLoginItemSettings().openAtLogin
    updateHealth({
      autoStart: { supported: true, configured, lastError: configured ? null : 'AUTO_START_NOT_CONFIRMED' },
    }, 'auto-start.configured')
    logger.info('auto-start.configured', { configured })
    return { supported: true, configured, error: configured ? null : 'AUTO_START_NOT_CONFIRMED' }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AUTO_START_CONFIGURATION_FAILED'
    updateHealth({ autoStart: { supported: true, configured: false, lastError: code.slice(0, 120) } }, 'auto-start.failed')
    return { supported: true, configured: false, error: code }
  }
}
