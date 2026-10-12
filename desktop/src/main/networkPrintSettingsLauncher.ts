import path from 'node:path'

export const NETWORK_PRINT_SETTINGS_SHORTCUT_NAME = 'Network 打印设置.lnk'
export const NETWORK_PRINT_SETTINGS_EXECUTABLE = 'E-Shop-Network-Print-Addon.exe'
export const NETWORK_PRINT_SETTINGS_APP_ID = 'com.elife.eshop.networkprint.addon'

export type NetworkPrintSettingsShortcut = {
  target?: string
  args?: string
  appUserModelId?: string
}

export type NetworkPrintSettingsLaunchResult =
  | { ok: true }
  | { ok: false; code: 'NETWORK_PRINT_SETTINGS_WINDOWS_REQUIRED' | 'NETWORK_PRINT_SETTINGS_SHORTCUT_UNAVAILABLE' | 'NETWORK_PRINT_SETTINGS_SHORTCUT_INVALID' | 'NETWORK_PRINT_SETTINGS_OPEN_FAILED' }

type ShortcutPathInput = {
  platform: NodeJS.Platform | string
  appDataPath: string
}

export function networkPrintSettingsShortcutPath({ platform, appDataPath }: ShortcutPathInput): string | null {
  if (platform !== 'win32') return null
  return path.win32.join(
    appDataPath,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    '店小二',
    '管理与维护',
    NETWORK_PRINT_SETTINGS_SHORTCUT_NAME,
  )
}

export function isSafeNetworkPrintSettingsShortcut(
  shortcut: NetworkPrintSettingsShortcut,
  platform: NodeJS.Platform | string,
): boolean {
  if (platform !== 'win32') return false
  if (typeof shortcut.target !== 'string' || typeof shortcut.args !== 'string'
    || typeof shortcut.appUserModelId !== 'string') return false
  const windowsPath = path.win32
  if (!windowsPath.isAbsolute(shortcut.target) || windowsPath.normalize(shortcut.target) !== shortcut.target) return false
  if (windowsPath.basename(shortcut.target).toLowerCase() !== NETWORK_PRINT_SETTINGS_EXECUTABLE.toLowerCase()) return false
  return shortcut.args.trim() === '--settings-only' && shortcut.appUserModelId === NETWORK_PRINT_SETTINGS_APP_ID
}

export type NetworkPrintSettingsLauncherDeps = {
  platform: NodeJS.Platform | string
  appDataPath: string
  readShortcutLink: (file: string) => NetworkPrintSettingsShortcut
  openPath: (file: string) => Promise<string>
}

export async function openNetworkPrintSettings(
  deps: NetworkPrintSettingsLauncherDeps,
): Promise<NetworkPrintSettingsLaunchResult> {
  const shortcutPath = networkPrintSettingsShortcutPath(deps)
  if (!shortcutPath) return { ok: false, code: 'NETWORK_PRINT_SETTINGS_WINDOWS_REQUIRED' }

  let shortcut: NetworkPrintSettingsShortcut
  try {
    shortcut = deps.readShortcutLink(shortcutPath)
  } catch {
    return { ok: false, code: 'NETWORK_PRINT_SETTINGS_SHORTCUT_UNAVAILABLE' }
  }

  if (!isSafeNetworkPrintSettingsShortcut(shortcut, deps.platform)) {
    return { ok: false, code: 'NETWORK_PRINT_SETTINGS_SHORTCUT_INVALID' }
  }

  try {
    const error = await deps.openPath(shortcutPath)
    return error ? { ok: false, code: 'NETWORK_PRINT_SETTINGS_OPEN_FAILED' } : { ok: true }
  } catch {
    return { ok: false, code: 'NETWORK_PRINT_SETTINGS_OPEN_FAILED' }
  }
}
