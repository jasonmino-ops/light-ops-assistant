import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { createConnection } from 'node:net'

import { install as installCertificate } from '../../certificate-manager/src/core/actions'
import { loadCertificatePackage } from '../../certificate-manager/src/core/certPackage'
import { fingerprintsEqual, parseCertificate } from '../../certificate-manager/src/core/certificate'
import { eshopCertPath, qzPropertiesPath } from '../../certificate-manager/src/core/env'
import { overrideContains } from '../../certificate-manager/src/core/override'
import { getProperty } from '../../certificate-manager/src/core/properties'
import {
  hasQzInstallAssets,
  detectQzVersion,
  isQzRunning,
  startQzAndConfirm,
} from '../../certificate-manager/src/core/qz'
import { readState } from '../../certificate-manager/src/core/state'
import { resolveWindowsEnv } from '../../certificate-manager/src/main/env.win'
import type {
  CertificateInspection,
  DesktopInspection,
  PreflightInspection,
  ProvisionAction,
  QzInspection,
  SoftwareProvisioningSystem,
} from './softwareProvisioning'

const DEFAULT_REQUIRED_DISK_BYTES = 2 * 1024 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 10 * 60 * 1_000
const STARTUP_TIMEOUT_MS = 20_000

export type WindowsSoftwareProvisioningConfig = {
  desktopInstallerPath: string
  desktopExpectedVersion: string
  desktopDisplayName: string
  desktopExecutableName: string
  qzInstallerPath: string
  qzExpectedVersion: '2.2.6'
  certificatePackageDir: string
  cloudHealthUrl: string
  requiredDiskBytes?: number
  programDataDir?: string
}

type DesktopPowerShellResult = {
  Installed?: boolean
  Version?: string | null
  ExecutablePath?: string | null
  RuntimeRunning?: boolean
}

type WindowsEnvironmentPowerShellResult = {
  Platform?: string | null
  Is64BitOperatingSystem?: boolean | null
  ProcessorArchitecture?: string | null
  ProcessorArchitectureW6432?: string | null
}

export type WindowsEnvironmentDetection = {
  platform: NodeJS.Platform
  architecture: string
  source: 'CIM' | 'WINDOWS_ENVIRONMENT' | 'NODE_RUNTIME' | 'UNCONFIRMED'
}

export type WindowsEnvironmentDetectionOptions = {
  runtimePlatform?: NodeJS.Platform
  runtimeArchitecture?: string
  run?: (file: string, args: string[], timeout?: number) => Promise<string>
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runExecutable(file: string, args: string[], timeout = PROCESS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${file} exited unsuccessfully (${error.name})`))
        return
      }
      resolve(`${stdout ?? ''}${stderr ?? ''}`)
    })
  })
}

async function portReady(port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (ready: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ready)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const parsed: unknown = JSON.parse(trimmed)
  if (Array.isArray(parsed)) return (parsed[0] as Record<string, unknown> | undefined) ?? null
  return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
}

function isWindowsPlatform(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value === 'Win32NT' || /Windows/i.test(value)
}

function isX64Architecture(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^(?:x64|x86_64|AMD64)$/i.test(value.trim())
}

function detectedWindowsArchitecture(value: WindowsEnvironmentPowerShellResult | null): string | null {
  if (!value || !isWindowsPlatform(value.Platform) || value.Is64BitOperatingSystem !== true) return null
  const native = typeof value.ProcessorArchitectureW6432 === 'string'
    ? value.ProcessorArchitectureW6432.trim()
    : ''
  if (native) return isX64Architecture(native) ? 'x64' : native
  const current = typeof value.ProcessorArchitecture === 'string'
    ? value.ProcessorArchitecture.trim()
    : ''
  if (current) return isX64Architecture(current) ? 'x64' : current
  return null
}

/**
 * Confirm Windows x64 without making CIM/WMI a single point of failure.
 *
 * CIM is retained as read-only evidence when available. WBEM access denial or
 * another CIM failure falls back to the non-WMI .NET Environment APIs, then to
 * the Node runtime identity. If none can prove Windows x64, the caller receives
 * UNCONFIRMED and Preflight remains fail-closed.
 */
export async function detectWindowsEnvironment(
  options: WindowsEnvironmentDetectionOptions = {},
): Promise<WindowsEnvironmentDetection> {
  const runtimePlatform = options.runtimePlatform ?? process.platform
  const runtimeArchitecture = options.runtimeArchitecture ?? process.arch
  const run = options.run ?? runExecutable

  if (runtimePlatform !== 'win32') {
    return { platform: runtimePlatform, architecture: runtimeArchitecture, source: 'UNCONFIRMED' }
  }

  try {
    const output = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop';$os=Get-CimInstance Win32_OperatingSystem;" +
      "[pscustomobject]@{Platform='Win32NT';Is64BitOperatingSystem=[Environment]::Is64BitOperatingSystem;" +
      "ProcessorArchitecture=$env:PROCESSOR_ARCHITECTURE;ProcessorArchitectureW6432=$env:PROCESSOR_ARCHITEW6432}|ConvertTo-Json -Compress",
    ], 20_000)
    const value = firstJsonObject(output) as WindowsEnvironmentPowerShellResult | null
    const architecture = detectedWindowsArchitecture(value)
    if (architecture) {
      return { platform: 'win32', architecture, source: 'CIM' }
    }
  } catch {
    // CIM/WMI can be denied by local WBEM policy. Continue with read-only,
    // non-WMI operating-system evidence instead of blocking a valid rerun.
  }

  try {
    const output = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[pscustomobject]@{Platform=[Environment]::OSVersion.Platform.ToString();' +
      'Is64BitOperatingSystem=[Environment]::Is64BitOperatingSystem;' +
      'ProcessorArchitecture=$env:PROCESSOR_ARCHITECTURE;' +
      'ProcessorArchitectureW6432=$env:PROCESSOR_ARCHITEW6432}|ConvertTo-Json -Compress',
    ], 20_000)
    const value = firstJsonObject(output) as WindowsEnvironmentPowerShellResult | null
    const architecture = detectedWindowsArchitecture(value)
    if (architecture) {
      return { platform: 'win32', architecture, source: 'WINDOWS_ENVIRONMENT' }
    }
  } catch {
    // Node runtime evidence below is independent of PowerShell/WMI.
  }

  if (runtimeArchitecture === 'x64') {
    return { platform: 'win32', architecture: 'x64', source: 'NODE_RUNTIME' }
  }
  return { platform: 'win32', architecture: 'UNCONFIRMED', source: 'UNCONFIRMED' }
}

export class WindowsSoftwareProvisioningSystem implements SoftwareProvisioningSystem {
  private readonly requiredDiskBytes: number

  constructor(private readonly config: WindowsSoftwareProvisioningConfig) {
    this.requiredDiskBytes = config.requiredDiskBytes ?? DEFAULT_REQUIRED_DISK_BYTES
  }

  async inspectPreflight(): Promise<PreflightInspection> {
    const environment = await detectWindowsEnvironment()
    if (environment.platform !== 'win32' || environment.architecture !== 'x64') {
      return {
        platform: environment.platform,
        architecture: environment.architecture,
        environmentDetectionSource: environment.source,
        administrator: null,
        cloudReachable: null,
        printSpoolerRunning: null,
        freeDiskBytes: null,
        requiredDiskBytes: this.requiredDiskBytes,
        desktop: null,
        qz: null,
        certificate: null,
      }
    }

    const [administrator, cloudReachable, printSpoolerRunning, freeDiskBytes, desktop, qz, certificate] = await Promise.all([
      this.administrator(),
      this.cloudReachable(),
      this.printSpoolerRunning(),
      this.freeDiskBytes(),
      this.inspectDesktop(),
      this.inspectQz(),
      this.inspectCertificate(),
    ])
    return {
      platform: environment.platform,
      architecture: environment.architecture,
      environmentDetectionSource: environment.source,
      administrator,
      cloudReachable,
      printSpoolerRunning,
      freeDiskBytes,
      requiredDiskBytes: this.requiredDiskBytes,
      desktop,
      qz,
      certificate,
    }
  }

  async inspectDesktop(): Promise<DesktopInspection> {
    this.requireWindows()
    const displayName = escapePowerShell(this.config.desktopDisplayName)
    const executableName = escapePowerShell(this.config.desktopExecutableName)
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      `$displayName='${displayName}'`,
      `$exeName='${executableName}'`,
      "$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
      '$app=Get-ItemProperty $keys | Where-Object { $_.DisplayName -eq $displayName -or $_.DisplayName -like ($displayName + \' *\') } | Select-Object -First 1',
      '$candidates=New-Object System.Collections.Generic.List[string]',
      'if($app.InstallLocation){$candidates.Add((Join-Path $app.InstallLocation $exeName))}',
      'if($app.UninstallString){$u=$app.UninstallString.Trim(\'"\');if(Test-Path -LiteralPath $u){$candidates.Add((Join-Path (Split-Path $u -Parent) $exeName))}}',
      '$candidates.Add((Join-Path $env:LOCALAPPDATA (\'Programs\\\' + $displayName + \'\\\' + $exeName)))',
      '$exe=$candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1',
      '$version=$null',
      'if($exe){$version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}',
      'if(-not $version -and $app){$version=$app.DisplayVersion}',
      '$running=$false',
      'if($exe){$running=[bool](Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe } | Select-Object -First 1)}',
      '[pscustomobject]@{Installed=[bool]$app;Version=$version;ExecutablePath=$exe;RuntimeRunning=$running}|ConvertTo-Json -Compress',
    ].join(';')
    const output = await runExecutable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 30_000)
    const value = firstJsonObject(output) as DesktopPowerShellResult | null
    const version = typeof value?.Version === 'string'
      ? value.Version.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? value.Version
      : null
    return {
      installed: value?.Installed === true,
      version,
      expectedVersion: this.config.desktopExpectedVersion,
      executablePresent: typeof value?.ExecutablePath === 'string' && value.ExecutablePath.length > 0,
      runtimeRunning: value?.RuntimeRunning === true,
    }
  }

  async installDesktop(): Promise<ProvisionAction> {
    this.requireWindows()
    const existing = await this.inspectDesktop()
    if (existing.installed && existing.version === existing.expectedVersion && existing.executablePresent) {
      return { changed: false, verified: true }
    }
    if (!existsSync(this.config.desktopInstallerPath)) throw new Error('Desktop installer payload is missing')
    await runExecutable(this.config.desktopInstallerPath, ['/S'])
    const state = await this.inspectDesktop()
    return {
      changed: true,
      verified: state.installed && state.version === state.expectedVersion && state.executablePresent,
    }
  }

  async ensureDesktopRunning(): Promise<boolean> {
    this.requireWindows()
    let executablePath = await this.desktopExecutablePath()
    if (!executablePath) return false
    const current = await this.inspectDesktop()
    if (current.runtimeRunning) return true

    const child = spawn(executablePath, [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      await delay(500)
      const state = await this.inspectDesktop()
      if (state.runtimeRunning) return true
      executablePath = (await this.desktopExecutablePath()) ?? executablePath
    }
    return false
  }

  async inspectQz(): Promise<QzInspection> {
    this.requireWindows()
    const env = this.certificateManagerEnv()
    const version = detectQzVersion(env)
    const [port8181Ready, port8182Ready] = await Promise.all([portReady(8181), portReady(8182)])
    return {
      installed: hasQzInstallAssets(env),
      version: version.status === 'OK' ? version.version : null,
      expectedVersion: this.config.qzExpectedVersion,
      running: isQzRunning(env),
      port8181Ready,
      port8182Ready,
    }
  }

  async installQz(): Promise<ProvisionAction> {
    this.requireWindows()
    const existing = await this.inspectQz()
    if (existing.installed && existing.version === existing.expectedVersion) {
      return { changed: false, verified: true }
    }
    if (!existsSync(this.config.qzInstallerPath)) throw new Error('QZ Tray installer payload is missing')
    await runExecutable(this.config.qzInstallerPath, ['/S'])
    const state = await this.inspectQz()
    return {
      changed: true,
      verified: state.installed && state.version === this.config.qzExpectedVersion,
    }
  }

  async ensureQzRunning(): Promise<boolean> {
    this.requireWindows()
    let env = this.certificateManagerEnv()
    if (!isQzRunning(env) && !startQzAndConfirm(env)) return false
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      const [ready8181, ready8182] = await Promise.all([portReady(8181), portReady(8182)])
      if (ready8181 && ready8182) return true
      await delay(500)
      env = this.certificateManagerEnv()
      if (!isQzRunning(env)) return false
    }
    return false
  }

  async inspectCertificate(): Promise<CertificateInspection> {
    this.requireWindows()
    const env = this.certificateManagerEnv()
    let certificatePackage: ReturnType<typeof loadCertificatePackage> | null = null
    try {
      certificatePackage = this.loadFormalCertificatePackage()
    } catch {
      // Missing or invalid payload is classified here and fails closed in the
      // certificate stage; inspection itself remains read-only.
    }

    const state = readState(env)
    const certPath = eshopCertPath(env)
    let fingerprintMatch = false
    if (certificatePackage && existsSync(certPath)) {
      try {
        fingerprintMatch = fingerprintsEqual(
          parseCertificate(readFileSync(certPath, 'utf8')).fingerprint,
          certificatePackage.manifest.rootFingerprint,
        )
      } catch {
        fingerprintMatch = false
      }
    }

    const propertiesPath = qzPropertiesPath(env)
    let overrideConfigured = false
    if (propertiesPath && existsSync(propertiesPath)) {
      try {
        overrideConfigured = overrideContains(
          getProperty(readFileSync(propertiesPath, 'utf8'), 'authcert.override'),
          certPath,
        )
      } catch {
        overrideConfigured = false
      }
    }

    const qz = await this.inspectQz()
    const packageValid = certificatePackage !== null
    // The frozen Manager proves the public CA is parseable, fingerprint-matched,
    // and referenced by authcert.override. The preceding QZ stage proves 2.2.6 is
    // running with both local endpoints ready; Manager provisioning restarts QZ
    // and confirms that runtime before returning. No signing secret is required.
    const qzAccepted = packageValid && fingerprintMatch && overrideConfigured && qz.running && qz.port8181Ready && qz.port8182Ready
    const managerStatus = qzAccepted
      ? 'OK'
      : state && certificatePackage && state.version < certificatePackage.manifest.version
        ? 'NEEDS_UPDATE'
        : state || existsSync(certPath)
          ? 'MISCONFIGURED'
          : 'NOT_INSTALLED'
    return {
      ready: qzAccepted,
      managerStatus,
      packageValid,
      fingerprintMatch,
      overrideConfigured,
      qzAccepted,
      publicFingerprint: certificatePackage?.manifest.rootFingerprint ?? null,
    }
  }

  async provisionCertificate(): Promise<ProvisionAction> {
    this.requireWindows()
    // Loading first enforces the frozen Certificate Manager package boundary:
    // public CA only, matching fingerprint, and no private-key-like material.
    this.loadFormalCertificatePackage()
    const before = await this.inspectCertificate()
    if (before.ready) return { changed: false, verified: true }
    const action = installCertificate(this.certificateManagerEnv())
    if (!action.ok) throw new Error('Certificate Manager install action failed')
    const after = await this.inspectCertificate()
    return { changed: !before.ready, verified: after.ready }
  }

  private certificateManagerEnv() {
    return resolveWindowsEnv({
      packageDir: this.config.certificatePackageDir,
      programData: this.config.programDataDir,
    })
  }

  private loadFormalCertificatePackage(): ReturnType<typeof loadCertificatePackage> {
    const certificatePackage = loadCertificatePackage(this.config.certificatePackageDir)
    const certificate = parseCertificate(certificatePackage.pem)
    const identity = [
      certificatePackage.manifest.certificateId,
      certificatePackage.manifest.displayName,
      certificate.subject,
    ].join(' ')
    if (/\bTEST\b|DO NOT USE IN PRODUCTION/i.test(identity)) {
      throw new Error('Non-production certificate package is forbidden')
    }
    return certificatePackage
  }

  private async cloudReachable(): Promise<boolean> {
    try {
      const response = await fetch(this.config.cloudHealthUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async administrator(): Promise<boolean> {
    const output = await runExecutable('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$id=[Security.Principal.WindowsIdentity]::GetCurrent();$p=New-Object Security.Principal.WindowsPrincipal($id);$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    ], 20_000)
    return /True/i.test(output)
  }

  private async printSpoolerRunning(): Promise<boolean> {
    const output = await runExecutable('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "(Get-Service -Name Spooler -ErrorAction Stop).Status -eq 'Running'",
    ], 20_000)
    return /True/i.test(output)
  }

  private async freeDiskBytes(): Promise<number> {
    const systemDrive = process.env.SystemDrive || win32.parse(process.cwd()).root || 'C:\\'
    const info = await statfs(systemDrive)
    return info.bavail * info.bsize
  }

  private async desktopExecutablePath(): Promise<string | null> {
    const displayName = escapePowerShell(this.config.desktopDisplayName)
    const executableName = escapePowerShell(this.config.desktopExecutableName)
    const script = [
      `$displayName='${displayName}'`,
      `$exeName='${executableName}'`,
      "$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
      '$app=Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $displayName -or $_.DisplayName -like ($displayName + \' *\') } | Select-Object -First 1',
      '$candidates=@()',
      'if($app.InstallLocation){$candidates+=(Join-Path $app.InstallLocation $exeName)}',
      'if($app.UninstallString){$u=$app.UninstallString.Trim(\'"\');if(Test-Path -LiteralPath $u){$candidates+=(Join-Path (Split-Path $u -Parent) $exeName)}}',
      '$candidates+=(Join-Path $env:LOCALAPPDATA (\'Programs\\\' + $displayName + \'\\\' + $exeName))',
      '$candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1',
    ].join(';')
    const path = (await runExecutable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 30_000)).trim()
    return path && existsSync(path) ? path : null
  }

  private requireWindows(): void {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error('Windows x64 is required')
    }
  }
}
