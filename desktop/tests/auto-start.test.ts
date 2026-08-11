import { describe, expect, it, vi } from 'vitest'
import { configureStoreRuntimeAutoStart, type LoginItemAppPort } from '../src/main/autoStart'

describe('Store Runtime Windows auto start', () => {
  it('configures packaged Windows login start in background runtime mode', () => {
    const setLoginItemSettings = vi.fn()
    const appPort: LoginItemAppPort = {
      isPackaged: true,
      setLoginItemSettings,
      getLoginItemSettings: () => ({ openAtLogin: true }),
    }
    expect(configureStoreRuntimeAutoStart({
      appPort,
      platform: 'win32',
      executablePath: 'C:\\Program Files\\E-Shop Desktop\\E-Shop Desktop.exe',
    })).toEqual({ supported: true, configured: true, error: null })
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: 'C:\\Program Files\\E-Shop Desktop\\E-Shop Desktop.exe',
      args: ['--store-runtime-background'],
    })
  })

  it('does not claim readiness on development or non-Windows builds', () => {
    const noop = vi.fn()
    const developmentPort: LoginItemAppPort = {
      isPackaged: false,
      setLoginItemSettings: noop,
      getLoginItemSettings: () => ({ openAtLogin: false }),
    }
    expect(configureStoreRuntimeAutoStart({ appPort: developmentPort, platform: 'win32' })).toMatchObject({
      supported: true,
      configured: false,
      error: 'PACKAGED_BUILD_REQUIRED',
    })
    expect(configureStoreRuntimeAutoStart({ appPort: developmentPort, platform: 'darwin' })).toEqual({
      supported: false,
      configured: false,
      error: null,
    })
    expect(noop).not.toHaveBeenCalled()
  })
})
