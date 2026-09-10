import { execFile } from 'node:child_process'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { DesktopRegistration, NetworkRegistration } from './shortcutLifecycle'

const DESKTOP_KEY = 'Software\\1acbd53d-b2f7-5af7-b432-3048068fa60f'
const NETWORK_KEY = 'Software\\3b0d00d3-14c9-55d6-bef2-f6474bb2de71'
// Read only two product registrations and the current user's Known Folder.
// No caller-controlled command, registry path, environment override or secret.
const SCRIPT = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$rows=@();foreach($h in @('CurrentUser','LocalMachine')){foreach($v in @('Registry64','Registry32')){
 $root=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$h,[Microsoft.Win32.RegistryView]::$v)
 try {foreach($id in @('1acbd53d-b2f7-5af7-b432-3048068fa60f','3b0d00d3-14c9-55d6-bef2-f6474bb2de71')){
  $key=$root.OpenSubKey('Software\\'+$id);$un=$root.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$id)
  try {if($null -ne $key -or $null -ne $un){$rows+=@{hive=$h;id=$id;location=$(if($key){$key.GetValue('InstallLocation')});shortcut=$(if($key){$key.GetValue('ShortcutName')});version=$(if($un){$un.GetValue('DisplayVersion')});uninstall=$(if($un){$un.GetValue('UninstallString')})}}}
  finally {if($key){$key.Dispose()};if($un){$un.Dispose()}}
 }} finally {$root.Dispose()}
}}
@{programs=[Environment]::GetFolderPath('Programs');registrations=@($rows)}|ConvertTo-Json -Compress -Depth 4`

type Row = { hive: 'HKCU' | 'HKLM'; id: string; location: string; shortcut: string; version: string; uninstall: string }
type RegistrySnapshot = { programs: string; registrations: Row[] }
function fail(): never { throw new Error('ADDON_SHORTCUT_REGISTRATION_UNAVAILABLE') }
function localPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z]:\\/.test(value)
    || /[\u0000-\u001f"<>|?*]/.test(value) || path.win32.normalize(value) !== value || value.endsWith('\\')) fail()
  return value
}
export function parseShortcutRegistration(raw: string): RegistrySnapshot {
  if (raw.length > 32768) fail()
  const data = JSON.parse(raw)
  if (!data || Object.keys(data).sort().join(',') !== 'programs,registrations' || !Array.isArray(data.registrations)
    || data.registrations.length > 8) fail()
  const registrations: Row[] = data.registrations.map((row: Record<string, unknown>) => {
    if (!row || Object.keys(row).sort().join(',') !== 'hive,id,location,shortcut,uninstall,version'
      || !['CurrentUser', 'LocalMachine'].includes(String(row.hive))
      || ![DESKTOP_KEY.slice(9), NETWORK_KEY.slice(9)].includes(String(row.id))
      || ['shortcut', 'version', 'uninstall'].some(key => typeof row[key] !== 'string' || (row[key] as string).length > 2048)) fail()
    return { hive: row.hive === 'CurrentUser' ? 'HKCU' : 'HKLM', id: String(row.id), location: localPath(row.location),
      shortcut: String(row.shortcut), version: String(row.version), uninstall: String(row.uninstall) }
  })
  return { programs: localPath(data.programs), registrations }
}
export async function readShortcutRegistration(): Promise<RegistrySnapshot> {
  if (process.platform !== 'win32' || process.arch !== 'x64') fail()
  const systemRoot = localPath(process.env.SystemRoot)
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { timeout: 10000, maxBuffer: 32768, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => error ? reject(new Error('ADDON_SHORTCUT_REGISTRATION_UNAVAILABLE')) : resolve(stdout))
  })
  return parseShortcutRegistration(raw.trim())
}
async function assertNormalShortcutPath(file: string, directory: boolean): Promise<void> {
  const checked = localPath(file)
  if (process.platform !== 'win32') fail()
  // Encoded data is only a path argument to fixed read-only code, never a
  // PowerShell expression. Reject every reparse attribute through the root.
  const encoded = Buffer.from(checked, 'utf16le').toString('base64')
  const script = `$ErrorActionPreference='Stop';$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'));$directory=$${directory ? 'true' : 'false'};while($p){$a=[IO.File]::GetAttributes($p);$isDirectory=($a -band [IO.FileAttributes]::Directory) -ne 0;if(($a -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $isDirectory -ne $directory){exit 3};$directory=$true;$p=[IO.Path]::GetDirectoryName($p)};[Console]::Write('OK')`
  await new Promise<void>((resolve, reject) => {
    execFile(path.join(localPath(process.env.SystemRoot), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000, maxBuffer: 1024, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => !error && stdout === 'OK' ? resolve() : reject(new Error('SHORTCUT_UNSAFE_DIRECTORY')))
  })
}
export const assertNormalShortcutDirectory = (directory: string) => assertNormalShortcutPath(directory, true)
export const assertNormalShortcutFile = (file: string) => assertNormalShortcutPath(file, false)
async function regularLocal(file: string) {
  localPath(file)
  await assertNormalShortcutFile(file)
  let current = file
  while (path.dirname(current) !== current) {
    const info = await lstat(current)
    if (info.isSymbolicLink()) fail()
    current = path.dirname(current)
  }
  if ((await realpath(file)).toLowerCase() !== file.toLowerCase()) fail()
  const info = await lstat(file)
  if (!info.isFile()) fail()
}
async function verifyExecutable(file: string, packageName: string, version: string) {
  await regularLocal(file)
  const handle = await open(file, 'r')
  try {
    const dos = Buffer.alloc(64)
    if ((await handle.read(dos, 0, dos.length, 0)).bytesRead !== 64 || dos.readUInt16LE(0) !== 0x5a4d) fail()
    const offset = dos.readUInt32LE(60)
    if (offset < 64 || offset > 1024 * 1024) fail()
    const pe = Buffer.alloc(6)
    if ((await handle.read(pe, 0, 6, offset)).bytesRead !== 6 || pe.readUInt32LE(0) !== 0x4550
      || pe.readUInt16LE(4) !== 0x8664) fail()
  } finally { await handle.close() }
  const archive = path.join(path.dirname(file), 'resources', 'app.asar')
  await regularLocal(archive)
  // Electron's ASAR-aware fs reads only this exact packaged metadata member.
  const raw = await readFile(path.join(archive, 'package.json'), 'utf8')
  if (raw.length > 16384) fail()
  const packaged = JSON.parse(raw)
  if (packaged.name !== packageName || packaged.version !== version) fail()
}
function uniqueRow(snapshot: RegistrySnapshot, id: string): Row | undefined {
  const rows = snapshot.registrations.filter(row => row.id === id)
  const unique = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()]
  if (unique.length > 1) fail()
  return unique[0]
}
export async function desktopRegistration(snapshot: RegistrySnapshot): Promise<DesktopRegistration | null> {
  const row = uniqueRow(snapshot, DESKTOP_KEY.slice(9))
  if (!row) return null
  if (row.version !== '0.4.7' || row.shortcut !== 'E-Shop') fail()
  const executable = path.join(row.location, 'E-Shop 店小二.exe')
  await verifyExecutable(executable, 'eshop-desktop-prototype', row.version)
  return { source: 'windows-registry', hive: row.hive, registryKey: DESKTOP_KEY,
    appId: 'com.eshop.desktop.prototype', version: '0.4.7', installLocation: row.location,
    executable, shortcutName: 'E-Shop', executableVerified: true }
}
export async function networkRegistration(snapshot: RegistrySnapshot, executable: string): Promise<NetworkRegistration | null> {
  const row = uniqueRow(snapshot, NETWORK_KEY.slice(9))
  if (!row) return null
  if (row.hive !== 'HKCU' || !/^0\.1\.0-commercial-rc\.[1-5]$/.test(row.version)
    || !['E-Shop Network Print Add-on', 'E-Shop Network Print Add-on (TEST ONLY)'].includes(row.shortcut)
    || path.join(row.location, 'E-Shop-Network-Print-Addon.exe') !== executable) fail()
  await verifyExecutable(executable, 'eshop-network-print-addon', row.version)
  return { source: 'windows-registry', hive: 'HKCU', registryKey: NETWORK_KEY,
    appId: 'com.elife.eshop.networkprint.addon', version: row.version, installLocation: row.location,
    executable, shortcutName: row.shortcut, executableVerified: true }
}
export async function networkUninstaller(snapshot: RegistrySnapshot, executable: string): Promise<string | undefined> {
  const row = uniqueRow(snapshot, NETWORK_KEY.slice(9))
  if (!row || row.hive !== 'HKCU' || row.location !== path.dirname(executable)) return undefined
  const parsed = /^"([^"\r\n]+)" \/currentuser$/.exec(row.uninstall)
  if (!parsed) fail()
  const file = localPath(parsed[1])
  if (path.dirname(file) !== row.location
    || !['Uninstall E-Shop Network Print Add-on.exe', 'Uninstall E-Shop Network Print Add-on (TEST ONLY).exe'].includes(path.basename(file))) fail()
  await regularLocal(file)
  return file
}
