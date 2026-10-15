import { describe, expect, it } from 'vitest'
import {
  isSafeNetworkPrintSettingsShortcut,
  networkPrintSettingsShortcutPath,
  openNetworkPrintSettings,
  NETWORK_PRINT_SETTINGS_APP_ID,
  NETWORK_PRINT_SETTINGS_EXECUTABLE,
} from '../src/main/networkPrintSettingsLauncher'

const appDataPath = 'C:\\Users\\owner\\AppData\\Roaming'
const target = `C:\\Users\\owner\\AppData\\Local\\Programs\\E-Shop-Network-Print-Addon\\${NETWORK_PRINT_SETTINGS_EXECUTABLE}`
const validShortcut = { target, args: '--settings-only', icon: target, iconIndex: 0, appUserModelId: NETWORK_PRINT_SETTINGS_APP_ID }
const issueManagedAddonSession = async () => ({
  browserDeviceId: 'desktop-test-device', storeCode: 'STORE-A',
  token: `${'a'.repeat(96)}.${'b'.repeat(43)}`, expiresAt: '2099-01-01T00:00:00.000Z',
})

describe('Desktop Network Print settings launcher', () => {
  it('resolves only the official per-user Start Menu shortcut', () => {
    expect(networkPrintSettingsShortcutPath({ platform: 'win32', appDataPath })).toBe(
      'C:\\Users\\owner\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\店小二\\管理与维护\\Network 打印设置.lnk',
    )
    expect(networkPrintSettingsShortcutPath({ platform: 'darwin', appDataPath })).toBeNull()
  })

  it('accepts the exact Add-on identity and settings-only argument', () => {
    expect(isSafeNetworkPrintSettingsShortcut(validShortcut, 'win32')).toBe(true)
  })

  it.each([
    [{ ...validShortcut, args: '--manage' }, 'legacy manage argument'],
    [{ ...validShortcut, args: '--settings-only --extra' }, 'extra argument'],
    [{ ...validShortcut, target: 'C:\\Program Files\\Other\\E-Shop-Network-Print-Addon.exe' }, 'wrong target'],
    [{ ...validShortcut, icon: `${target}.copy` }, 'wrong icon'],
    [{ ...validShortcut, iconIndex: 1 }, 'wrong icon index'],
    [{ ...validShortcut, appUserModelId: 'com.example.other' }, 'wrong app identity'],
    [{ ...validShortcut, target: 'E-Shop-Network-Print-Addon.exe' }, 'relative target'],
  ])('rejects %s', (shortcut) => {
    expect(isSafeNetworkPrintSettingsShortcut(shortcut, 'win32')).toBe(false)
  })

  it('opens the verified shortcut and never falls back when the contract is old', async () => {
    const opened: string[] = []
    const childHandoffs: string[] = []
    const result = await openNetworkPrintSettings({
      platform: 'win32',
      appDataPath,
      readShortcutLink: () => validShortcut,
      openPath: async (file) => { opened.push(file); return '' },
      issueManagedAddonSession,
      writeManagedPrintChildHandoff: async (_path, session) => { childHandoffs.push(session.storeCode) },
      writeManagedAddonHandoff: async () => undefined,
    })
    expect(result).toEqual({ ok: true })
    expect(opened).toEqual([networkPrintSettingsShortcutPath({ platform: 'win32', appDataPath })])
    expect(childHandoffs).toEqual(['STORE-A'])

    opened.length = 0
    const legacy = await openNetworkPrintSettings({
      platform: 'win32',
      appDataPath,
      readShortcutLink: () => ({ ...validShortcut, args: '--manage' }),
      openPath: async (file) => { opened.push(file); return '' },
      issueManagedAddonSession,
    })
    expect(legacy).toEqual({ ok: false, code: 'NETWORK_PRINT_SETTINGS_SHORTCUT_INVALID' })
    expect(opened).toEqual([])
  })

  it('fails closed on missing, unreadable, and failed-open entries', async () => {
    expect(await openNetworkPrintSettings({
      platform: 'win32', appDataPath,
      readShortcutLink: () => { throw new Error('missing') },
      openPath: async () => '',
      issueManagedAddonSession,
    })).toEqual({ ok: false, code: 'NETWORK_PRINT_SETTINGS_SHORTCUT_UNAVAILABLE' })

    expect(await openNetworkPrintSettings({
      platform: 'win32', appDataPath,
      readShortcutLink: () => validShortcut,
      openPath: async () => 'open failed',
      issueManagedAddonSession,
      writeManagedAddonHandoff: async () => undefined,
    })).toEqual({ ok: false, code: 'NETWORK_PRINT_SETTINGS_OPEN_FAILED' })

    expect(await openNetworkPrintSettings({
      platform: 'linux', appDataPath,
      readShortcutLink: () => validShortcut,
      openPath: async () => '',
      issueManagedAddonSession,
    })).toEqual({ ok: false, code: 'NETWORK_PRINT_SETTINGS_WINDOWS_REQUIRED' })
  })
})
