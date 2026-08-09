import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import {
  ACTIVE_DRIVER_NAME,
  KITCHEN_DISCOVERY_DEFERRED,
  MATCHING_DRIVER_INSTALLER,
  type DriverDetectionSource,
  type DriverInspection,
  type FrontUsbPrinterCandidate,
  type FrontUsbPrinterDetectionSource,
  type FrontUsbPrinterInspection,
  type HardwareProvisioningSystem,
} from './hardwareProvisioning'
import type { ProvisionAction } from './softwareProvisioning'

const PROCESS_TIMEOUT_MS = 10 * 60 * 1_000

type CommandRunner = (file: string, args: string[], timeout?: number) => Promise<string>

export type WindowsHardwareProvisioningConfig = {
  expectedDriverName?: typeof ACTIVE_DRIVER_NAME
  externalDriverInstallerPath?: string | null
  matchingInstallerName?: typeof MATCHING_DRIVER_INSTALLER
}

export type WindowsHardwareProvisioningOptions = {
  runtimePlatform?: NodeJS.Platform
  runtimeArchitecture?: string
  run?: CommandRunner
}

type DriverPowerShellResult = {
  Found?: boolean
  Name?: string | null
  Version?: string | number | null
  Manufacturer?: string | null
  DetectionSource?: string | null
}

export type WindowsPrinterMetadata = {
  Name?: string | null
  DriverName?: string | null
  PortName?: string | null
  PortMonitor?: string | null
  PnpDeviceId?: string | null
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

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function parseJsonValue(text: string): unknown {
  const trimmed = text.trim()
  return trimmed ? JSON.parse(trimmed) as unknown : null
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isUsbTransport(record: WindowsPrinterMetadata): boolean {
  const pnpDeviceId = stringOrNull(record.PnpDeviceId)
  if (pnpDeviceId && /^(?:USBPRINT|USB)\\/i.test(pnpDeviceId)) return true
  const portMonitor = stringOrNull(record.PortMonitor)
  if (portMonitor && /\bUSB\b/i.test(portMonitor)) return true
  const portName = stringOrNull(record.PortName)
  return Boolean(portName && /^USB\d+$/i.test(portName))
}

function candidateIdentifier(record: WindowsPrinterMetadata): string {
  const identity = [record.Name, record.DriverName, record.PortName, record.PnpDeviceId]
    .map((value) => stringOrNull(value) ?? '')
    .join('\u0000')
    .toLocaleLowerCase('en-US')
  return `front-usb-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
}

function candidateSource(record: WindowsPrinterMetadata): FrontUsbPrinterDetectionSource {
  const pnpDeviceId = stringOrNull(record.PnpDeviceId)
  return pnpDeviceId && /^(?:USBPRINT|USB)\\/i.test(pnpDeviceId)
    ? 'WINDOWS_PRINTER_PNP_METADATA'
    : 'WINDOWS_PRINTER_PORT_METADATA'
}

/**
 * Keep only driver-compatible USB printer records, then replace raw Windows
 * queue, port, and PnP values with a non-sensitive deterministic identifier.
 * No golden-machine queue, port, VID, or PID is part of the matching rule.
 */
export function createFrontUsbPrinterCandidates(
  records: readonly WindowsPrinterMetadata[],
  expectedDriverName = ACTIVE_DRIVER_NAME,
): FrontUsbPrinterCandidate[] {
  const candidates = records
    .filter((record) => stringOrNull(record.DriverName)?.toLocaleLowerCase('en-US') === expectedDriverName.toLocaleLowerCase('en-US'))
    .filter(isUsbTransport)
    .map((record) => ({
      candidateId: candidateIdentifier(record),
      detectionSource: candidateSource(record),
    }))
  return [...new Map(candidates.map((candidate) => [candidate.candidateId, candidate])).values()]
}

export class WindowsHardwareProvisioningSystem implements HardwareProvisioningSystem {
  private readonly expectedDriverName: typeof ACTIVE_DRIVER_NAME
  private readonly matchingInstallerName: typeof MATCHING_DRIVER_INSTALLER
  private readonly runtimePlatform: NodeJS.Platform
  private readonly runtimeArchitecture: string
  private readonly run: CommandRunner

  constructor(
    private readonly config: WindowsHardwareProvisioningConfig = {},
    options: WindowsHardwareProvisioningOptions = {},
  ) {
    this.expectedDriverName = config.expectedDriverName ?? ACTIVE_DRIVER_NAME
    this.matchingInstallerName = config.matchingInstallerName ?? MATCHING_DRIVER_INSTALLER
    this.runtimePlatform = options.runtimePlatform ?? process.platform
    this.runtimeArchitecture = options.runtimeArchitecture ?? process.arch
    this.run = options.run ?? runExecutable
  }

  async inspectDriver(): Promise<DriverInspection> {
    this.requireWindows()
    const expected = escapePowerShell(this.expectedDriverName)
    const script = [
      "$ErrorActionPreference='Stop'",
      `$expected='${expected}'`,
      '$result=$null',
      'try{$driver=Get-PrinterDriver -Name $expected -ErrorAction SilentlyContinue | Select-Object -First 1;if($driver){$version=$driver.DriverVersion;if(-not $version){$version=$driver.MajorVersion};$result=[pscustomobject]@{Found=$true;Name=[string]$driver.Name;Version=[string]$version;Manufacturer=[string]$driver.Manufacturer;DetectionSource=\'WINDOWS_PRINT_MANAGEMENT\'}}}catch{}',
      'if(-not $result){$roots=@(\'Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Environments\\Windows x64\\Drivers\\Version-3\',\'Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Environments\\Windows x64\\Drivers\\Version-4\');foreach($root in $roots){$key=Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | Where-Object {$_.PSChildName -ieq $expected} | Select-Object -First 1;if($key){$item=Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue;$version=$item.DriverVersion;if(-not $version){$version=$item.Version};$manufacturer=$item.Provider;$result=[pscustomobject]@{Found=$true;Name=[string]$key.PSChildName;Version=[string]$version;Manufacturer=[string]$manufacturer;DetectionSource=\'WINDOWS_PRINT_DRIVER_REGISTRY\'};break}}}',
      'if(-not $result){$result=[pscustomobject]@{Found=$false;Name=$null;Version=$null;Manufacturer=$null;DetectionSource=\'NOT_FOUND\'}}',
      '$result | ConvertTo-Json -Compress',
    ].join(';')
    const value = parseJsonValue(await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], 30_000)) as DriverPowerShellResult | null
    const detectedName = stringOrNull(value?.Name)
    const source = stringOrNull(value?.DetectionSource)
    const detectionSource: DriverDetectionSource = source === 'WINDOWS_PRINT_MANAGEMENT' || source === 'WINDOWS_PRINT_DRIVER_REGISTRY'
      ? source
      : 'NOT_FOUND'
    const ready = value?.Found === true && detectedName?.toLocaleLowerCase('en-US') === this.expectedDriverName.toLocaleLowerCase('en-US')
    return {
      ready,
      expectedName: this.expectedDriverName,
      detectedName: ready ? detectedName : null,
      version: ready ? stringOrNull(value?.Version) : null,
      manufacturer: ready ? stringOrNull(value?.Manufacturer) : null,
      detectionSource: ready ? detectionSource : 'NOT_FOUND',
      externalInstallerProvided: this.externalInstallerProvided(),
    }
  }

  async installExternalDriver(): Promise<ProvisionAction> {
    this.requireWindows()
    const before = await this.inspectDriver()
    if (before.ready) return { changed: false, verified: true }
    const installerPath = this.config.externalDriverInstallerPath
    if (!installerPath || !this.externalInstallerProvided()) {
      throw new Error('A valid external driver installer was not supplied')
    }
    await this.run(installerPath, [], PROCESS_TIMEOUT_MS)
    const after = await this.inspectDriver()
    return { changed: true, verified: after.ready }
  }

  async inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection> {
    this.requireWindows()
    const expected = escapePowerShell(this.expectedDriverName)
    const script = [
      "$ErrorActionPreference='Stop'",
      `$expected='${expected}'`,
      '$pnp=@()',
      'try{$pnp=@(Get-PnpDevice -PresentOnly -Class Printer -ErrorAction SilentlyContinue | Where-Object {$_.InstanceId -match \'^(USBPRINT|USB)\\\\\'})}catch{}',
      '$records=@()',
      '$printers=@(Get-Printer -ErrorAction Stop | Where-Object {$_.DriverName -ieq $expected})',
      'foreach($printer in $printers){$port=$null;try{$port=Get-PrinterPort -Name ([string]$printer.PortName) -ErrorAction SilentlyContinue}catch{};$pnpMatch=$pnp | Where-Object {$_.FriendlyName -eq $printer.Name -or $_.FriendlyName -like (\'*\' + $expected + \'*\')} | Select-Object -First 1;$records+=[pscustomobject]@{Name=[string]$printer.Name;DriverName=[string]$printer.DriverName;PortName=[string]$printer.PortName;PortMonitor=if($port){[string]$port.PortMonitor}else{$null};PnpDeviceId=if($pnpMatch){[string]$pnpMatch.InstanceId}else{$null}}}',
      'ConvertTo-Json -InputObject @($records) -Compress',
    ].join(';')
    const value = parseJsonValue(await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], 30_000))
    const records = Array.isArray(value)
      ? value.filter((entry): entry is WindowsPrinterMetadata => entry !== null && typeof entry === 'object')
      : value !== null && typeof value === 'object'
        ? [value as WindowsPrinterMetadata]
        : []
    const candidates = createFrontUsbPrinterCandidates(records, this.expectedDriverName)
    return {
      candidates,
      roleResolution: candidates.length === 1
        ? 'AUTO_RESOLVED'
        : candidates.length > 1
          ? 'USER_CONFIRM_REQUIRED'
          : 'NOT_FOUND',
      selectedCandidateId: candidates.length === 1 ? candidates[0]!.candidateId : null,
      kitchenDiscovery: KITCHEN_DISCOVERY_DEFERRED,
    }
  }

  private externalInstallerProvided(): boolean {
    const path = this.config.externalDriverInstallerPath
    return Boolean(
      path &&
      basename(path).toLocaleLowerCase('en-US') === this.matchingInstallerName.toLocaleLowerCase('en-US') &&
      existsSync(path),
    )
  }

  private requireWindows(): void {
    if (this.runtimePlatform !== 'win32' || this.runtimeArchitecture !== 'x64') {
      throw new Error('Windows x64 is required')
    }
  }
}
