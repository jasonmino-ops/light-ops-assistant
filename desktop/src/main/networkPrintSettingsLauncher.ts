import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, open, rename } from 'node:fs/promises'
import { safeStorage } from 'electron'
import { writeManagedPrintChildHandoff } from './managedPrintChildHandoff'

// This is the bounded on-disk wire contract. The Add-on owns parsing and
// validation; Desktop only emits a fresh, encrypted handoff after the server
// issues the short-lived capability. Keeping the writer inside Desktop's
// rootDir avoids compiling the Add-on's TypeScript source into Desktop.
const MANAGED_ADDON_HANDOFF_AUDIENCE = 'eshop-managed-network-print-addon' as const
const MANAGED_ADDON_HANDOFF_SCHEMA_VERSION = 1 as const
type ManagedAddonHandoff = {
  schemaVersion: typeof MANAGED_ADDON_HANDOFF_SCHEMA_VERSION
  audience: typeof MANAGED_ADDON_HANDOFF_AUDIENCE
  browserDeviceId: string
  storeCode: string
  token: string
  expiresAt: string
  nonce: string
}
function managedAddonHandoffPath(appDataPath: string): string {
  return path.join(appDataPath, 'E-Shop-Network-Print-Addon', 'handoff.bin')
}

export const NETWORK_PRINT_SETTINGS_SHORTCUT_NAME = 'Network 打印设置.lnk'
export const NETWORK_PRINT_SETTINGS_EXECUTABLE = 'E-Shop-Network-Print-Addon.exe'
export const NETWORK_PRINT_SETTINGS_APP_ID = 'com.elife.eshop.networkprint.addon'
export const NETWORK_PRINT_SETTINGS_INSTALL_SUFFIX = path.win32.join(
  'Programs',
  'E-Shop-Network-Print-Addon',
  NETWORK_PRINT_SETTINGS_EXECUTABLE,
)

export type NetworkPrintSettingsShortcut = {
  target?: string
  args?: string
  icon?: string
  iconIndex?: number
  appUserModelId?: string
}

export type NetworkPrintSettingsLaunchResult =
  | { ok: true }
  | { ok: false; code: 'NETWORK_PRINT_SETTINGS_WINDOWS_REQUIRED' | 'NETWORK_PRINT_SETTINGS_SHORTCUT_UNAVAILABLE' | 'NETWORK_PRINT_SETTINGS_SHORTCUT_INVALID' | 'NETWORK_PRINT_SETTINGS_HANDOFF_UNAVAILABLE' | 'NETWORK_PRINT_SETTINGS_HANDOFF_WRITE_FAILED' | 'NETWORK_PRINT_SETTINGS_OPEN_FAILED' }

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
    || typeof shortcut.icon !== 'string' || typeof shortcut.iconIndex !== 'number'
    || typeof shortcut.appUserModelId !== 'string') return false
  const windowsPath = path.win32
  if (!windowsPath.isAbsolute(shortcut.target) || windowsPath.normalize(shortcut.target) !== shortcut.target) return false
  if (windowsPath.basename(shortcut.target).toLowerCase() !== NETWORK_PRINT_SETTINGS_EXECUTABLE.toLowerCase()) return false
  const normalizedTarget = shortcut.target.toLowerCase()
  if (!normalizedTarget.endsWith(`\\${NETWORK_PRINT_SETTINGS_INSTALL_SUFFIX.toLowerCase()}`)) return false
  if (shortcut.icon !== shortcut.target || shortcut.iconIndex !== 0) return false
  return shortcut.args === '--settings-only' && shortcut.appUserModelId === NETWORK_PRINT_SETTINGS_APP_ID
}

export type NetworkPrintSettingsLauncherDeps = {
  platform: NodeJS.Platform | string
  appDataPath: string
  readShortcutLink: (file: string) => NetworkPrintSettingsShortcut
  openPath: (file: string) => Promise<string>
  issueManagedAddonSession: () => Promise<{ browserDeviceId: string; storeCode: string; token: string; expiresAt: string } | null>
  writeManagedPrintChildHandoff?: (appDataPath: string, session: { browserDeviceId: string; storeCode: string; token: string; expiresAt: string }) => Promise<void>
  writeManagedAddonHandoff?: (appDataPath: string, session: { browserDeviceId: string; storeCode: string; token: string; expiresAt: string }) => Promise<void>
}

async function writeManagedAddonHandoff(appDataPath: string, session: { browserDeviceId: string; storeCode: string; token: string; expiresAt: string }) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('SAFE_STORAGE_UNAVAILABLE')
  const handoff: ManagedAddonHandoff = {
    schemaVersion: MANAGED_ADDON_HANDOFF_SCHEMA_VERSION,
    audience: MANAGED_ADDON_HANDOFF_AUDIENCE,
    browserDeviceId: session.browserDeviceId,
    storeCode: session.storeCode,
    token: session.token,
    expiresAt: session.expiresAt,
    nonce: randomUUID(),
  }
  const destination = managedAddonHandoffPath(appDataPath)
  await mkdir(path.win32.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(safeStorage.encryptString(JSON.stringify(handoff)).toString('base64'), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, destination)
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

  let session: Awaited<ReturnType<NetworkPrintSettingsLauncherDeps['issueManagedAddonSession']>>
  try {
    session = await deps.issueManagedAddonSession()
  } catch {
    return { ok: false, code: 'NETWORK_PRINT_SETTINGS_HANDOFF_UNAVAILABLE' }
  }
  if (!session || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
    return { ok: false, code: 'NETWORK_PRINT_SETTINGS_HANDOFF_UNAVAILABLE' }
  }
  try {
    await (deps.writeManagedPrintChildHandoff
      ?? deps.writeManagedAddonHandoff
      ?? ((appDataPath, value) => writeManagedPrintChildHandoff(appDataPath, value)))(deps.appDataPath, session)
  } catch {
    return { ok: false, code: 'NETWORK_PRINT_SETTINGS_HANDOFF_WRITE_FAILED' }
  }

  try {
    const error = await deps.openPath(shortcutPath)
    return error ? { ok: false, code: 'NETWORK_PRINT_SETTINGS_OPEN_FAILED' } : { ok: true }
  } catch {
    return { ok: false, code: 'NETWORK_PRINT_SETTINGS_OPEN_FAILED' }
  }
}
