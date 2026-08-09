import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import {
  KITCHEN_DISCOVERY_DEFERRED,
  VERIFIED_DRIVER_CATALOG,
  type DriverDetectionSource,
  type DriverInspection,
  type FrontUsbPrinterCandidate,
  type FrontUsbPrinterDetectionSource,
  type FrontUsbPrinterInspection,
  type HardwareProvisioningSystem,
  type VerifiedDriverFamilyId,
} from './hardwareProvisioning'
import type { ProvisionAction } from './softwareProvisioning'

const PROCESS_TIMEOUT_MS = 10 * 60 * 1_000

type CommandRunner = (file: string, args: string[], timeout?: number) => Promise<string>

export type WindowsHardwareProvisioningConfig = {
  externalDriverPayloads?: Partial<Record<VerifiedDriverFamilyId, string>>
  /** Backward-compatible explicit Rongta payload input. Never treated as bundled. */
  externalDriverInstallerPath?: string | null
}

export type WindowsHardwareProvisioningOptions = {
  runtimePlatform?: NodeJS.Platform
  runtimeArchitecture?: string
  run?: CommandRunner
}

type InstalledDriverMetadata = {
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
  Manufacturer?: string | null
}

type DriverFamilyMetadata = Pick<
  WindowsPrinterMetadata,
  'Name' | 'DriverName' | 'PnpDeviceId' | 'Manufacturer'
>

const DRIVER_FAMILY_METADATA_PATTERNS: Record<VerifiedDriverFamilyId, readonly RegExp[]> = {
  RONGTA_80MM: [/\b80Normal\b/i, /\bRong\s*Ta\b/i],
  XPRINTER_80MM: [/\bX[\s-]?printer\b/i, /芯烨/u, /\bXP[\s-]?N160II\b/i, /\bXP[\s-]?80\w*\b/i],
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

function objectArray<T extends object>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is T => entry !== null && typeof entry === 'object')
  }
  return value !== null && typeof value === 'object' ? [value as T] : []
}

function catalogEntry(family: VerifiedDriverFamilyId) {
  return VERIFIED_DRIVER_CATALOG.find(({ id }) => id === family)!
}

export function resolveVerifiedDriverFamily(metadata: DriverFamilyMetadata): VerifiedDriverFamilyId | null {
  const values = [metadata.Name, metadata.DriverName, metadata.Manufacturer, metadata.PnpDeviceId]
    .map(stringOrNull)
    .filter((value): value is string => value !== null)
  for (const family of VERIFIED_DRIVER_CATALOG) {
    if (family.installedDriverNames.some((name) => values.some((value) => value.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US')))) {
      return family.id
    }
    if (DRIVER_FAMILY_METADATA_PATTERNS[family.id].some((pattern) => values.some((value) => pattern.test(value)))) {
      return family.id
    }
  }
  return null
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
  const pnpDeviceId = stringOrNull(record.PnpDeviceId)
  const identity = (pnpDeviceId
    ? ['pnp', pnpDeviceId]
    : [record.Name, record.DriverName, record.PortName]
  ).map((value) => stringOrNull(value) ?? '')
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
): FrontUsbPrinterCandidate[] {
  const candidates = records
    .filter(isUsbTransport)
    .map((record) => {
      const driverFamily = resolveVerifiedDriverFamily(record)
      return driverFamily
        ? {
            candidateId: candidateIdentifier(record),
            detectionSource: candidateSource(record),
            driverFamily,
          }
        : null
    })
    .filter((candidate): candidate is FrontUsbPrinterCandidate => candidate !== null)
  return [...new Map(candidates.map((candidate) => [candidate.candidateId, candidate])).values()]
}

export class WindowsHardwareProvisioningSystem implements HardwareProvisioningSystem {
  private readonly runtimePlatform: NodeJS.Platform
  private readonly runtimeArchitecture: string
  private readonly run: CommandRunner

  constructor(
    private readonly config: WindowsHardwareProvisioningConfig = {},
    options: WindowsHardwareProvisioningOptions = {},
  ) {
    this.runtimePlatform = options.runtimePlatform ?? process.platform
    this.runtimeArchitecture = options.runtimeArchitecture ?? process.arch
    this.run = options.run ?? runExecutable
  }

  async inspectDriver(): Promise<DriverInspection> {
    this.requireWindows()
    const [installedDrivers, frontCandidates] = await Promise.all([
      this.inspectInstalledDrivers(),
      this.frontUsbCandidates(),
    ])
    const installedByFamily = installedDrivers
      .map((driver) => ({ driver, family: resolveVerifiedDriverFamily({
        Name: driver.Name,
        DriverName: driver.Name,
        Manufacturer: driver.Manufacturer,
      }) }))
      .filter((entry): entry is { driver: InstalledDriverMetadata; family: VerifiedDriverFamilyId } => entry.family !== null)
    const candidateFamilies = [...new Set(frontCandidates.map(({ driverFamily }) => driverFamily))]
    const preferredFamily = candidateFamilies.length === 1 ? candidateFamilies[0]! : null
    const installed = preferredFamily
      ? installedByFamily.find(({ family }) => family === preferredFamily) ?? null
      : VERIFIED_DRIVER_CATALOG
          .map(({ id }) => installedByFamily.find(({ family }) => family === id))
          .find((entry) => entry !== undefined) ?? null

    if (installed) {
      const source = stringOrNull(installed.driver.DetectionSource)
      const detectionSource: DriverDetectionSource = source === 'WINDOWS_PRINT_MANAGEMENT' || source === 'WINDOWS_PRINT_DRIVER_REGISTRY'
        ? source
        : 'NOT_FOUND'
      return {
        ready: true,
        resolvedFamily: installed.family,
        resolutionSource: 'INSTALLED_DRIVER',
        detectedName: stringOrNull(installed.driver.Name),
        version: stringOrNull(installed.driver.Version),
        manufacturer: stringOrNull(installed.driver.Manufacturer),
        detectionSource,
        payloadAvailable: this.externalPayloadPath(installed.family) !== null,
      }
    }

    return {
      ready: false,
      resolvedFamily: preferredFamily,
      resolutionSource: preferredFamily ? 'USB_DEVICE_METADATA' : 'UNRESOLVED',
      detectedName: null,
      version: null,
      manufacturer: null,
      detectionSource: 'NOT_FOUND',
      payloadAvailable: preferredFamily ? this.externalPayloadPath(preferredFamily) !== null : false,
    }
  }

  async installExternalDriver(family: VerifiedDriverFamilyId): Promise<ProvisionAction> {
    this.requireWindows()
    const before = await this.inspectDriver()
    if (before.ready && before.resolvedFamily === family) return { changed: false, verified: true }
    const installerPath = this.externalPayloadPath(family)
    if (!installerPath) throw new Error('A valid external driver payload was not supplied for the resolved family')
    await this.run(installerPath, [], PROCESS_TIMEOUT_MS)
    const after = await this.inspectDriver()
    return { changed: true, verified: after.ready && after.resolvedFamily === family }
  }

  async inspectFrontUsbPrinters(): Promise<FrontUsbPrinterInspection> {
    this.requireWindows()
    const candidates = await this.frontUsbCandidates()
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

  private async inspectInstalledDrivers(): Promise<InstalledDriverMetadata[]> {
    const script = [
      "$ErrorActionPreference='Stop'",
      '$result=@()',
      'try{$drivers=@(Get-PrinterDriver -ErrorAction Stop);foreach($driver in $drivers){$version=$driver.DriverVersion;if(-not $version){$version=$driver.MajorVersion};$result+=[pscustomobject]@{Name=[string]$driver.Name;Version=[string]$version;Manufacturer=[string]$driver.Manufacturer;DetectionSource=\'WINDOWS_PRINT_MANAGEMENT\'}}}catch{}',
      'if($result.Count -eq 0){$roots=@(\'Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Environments\\Windows x64\\Drivers\\Version-3\',\'Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Environments\\Windows x64\\Drivers\\Version-4\');foreach($root in $roots){$keys=@(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue);foreach($key in $keys){$item=Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue;$version=$item.DriverVersion;if(-not $version){$version=$item.Version};$result+=[pscustomobject]@{Name=[string]$key.PSChildName;Version=[string]$version;Manufacturer=[string]$item.Provider;DetectionSource=\'WINDOWS_PRINT_DRIVER_REGISTRY\'}}}}',
      'ConvertTo-Json -InputObject @($result) -Compress',
    ].join(';')
    return objectArray<InstalledDriverMetadata>(parseJsonValue(await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], 30_000)))
  }

  private async frontUsbCandidates(): Promise<FrontUsbPrinterCandidate[]> {
    const script = [
      "$ErrorActionPreference='Stop'",
      '$pnp=@()',
      'try{$pnp=@(Get-PnpDevice -PresentOnly -Class Printer -ErrorAction SilentlyContinue | Where-Object {$_.InstanceId -match \'^(USBPRINT|USB)\\\\\'})}catch{}',
      '$records=@()',
      '$printers=@(Get-Printer -ErrorAction Stop)',
      'foreach($printer in $printers){$port=$null;try{$port=Get-PrinterPort -Name ([string]$printer.PortName) -ErrorAction SilentlyContinue}catch{};$driverName=[string]$printer.DriverName;$pnpMatch=$pnp | Where-Object {$_.FriendlyName -eq $printer.Name -or ($driverName -and $_.FriendlyName -like (\'*\' + $driverName + \'*\'))} | Select-Object -First 1;$records+=[pscustomobject]@{Name=[string]$printer.Name;DriverName=$driverName;PortName=[string]$printer.PortName;PortMonitor=if($port){[string]$port.PortMonitor}else{$null};PnpDeviceId=if($pnpMatch){[string]$pnpMatch.InstanceId}else{$null};Manufacturer=if($pnpMatch){[string]$pnpMatch.Manufacturer}else{$null}}}',
      'foreach($device in $pnp){$records+=[pscustomobject]@{Name=[string]$device.FriendlyName;DriverName=$null;PortName=$null;PortMonitor=$null;PnpDeviceId=[string]$device.InstanceId;Manufacturer=[string]$device.Manufacturer}}',
      'ConvertTo-Json -InputObject @($records) -Compress',
    ].join(';')
    const value = parseJsonValue(await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], 30_000))
    return createFrontUsbPrinterCandidates(objectArray<WindowsPrinterMetadata>(value))
  }

  private externalPayloadPath(family: VerifiedDriverFamilyId): string | null {
    const path = this.config.externalDriverPayloads?.[family] ??
      (family === 'RONGTA_80MM' ? this.config.externalDriverInstallerPath : null)
    if (!path || !existsSync(path)) return null
    const filename = basename(path).toLocaleLowerCase('en-US')
    const allowed = catalogEntry(family).externalInstallerFilenames
      .some((candidate) => candidate.toLocaleLowerCase('en-US') === filename)
    return allowed ? path : null
  }

  private requireWindows(): void {
    if (this.runtimePlatform !== 'win32' || this.runtimeArchitecture !== 'x64') {
      throw new Error('Windows x64 is required')
    }
  }
}
