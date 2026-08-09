import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { basename } from 'node:path'

import {
  KITCHEN_DISCOVERY_DEFERRED,
  VERIFIED_DRIVER_CATALOG,
  type DriverDetectionSource,
  type DriverInspection,
  type FrontUsbPrinterCandidate,
  type FrontUsbPrinterDetectionSource,
  type FrontUsbPrinterInspection,
  type FrontUsbQueueTargetProvider,
  type HardwareProvisioningPhase2System,
  type KitchenNetworkDetectionSource,
  type KitchenNetworkPrinterCandidate,
  type KitchenNetworkPrinterInspection,
  type ResolvedFrontUsbQueueTarget,
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

export type WindowsKitchenEndpointEvidence = {
  Address?: string | null
  Port?: string | number | null
  DetectionSources?: string | string[] | null
  Raw9100Reachable?: boolean | null
  WindowsPrinterPortAssociated?: boolean | null
}

type DriverFamilyMetadata = Pick<
  WindowsPrinterMetadata,
  'Name' | 'DriverName' | 'PnpDeviceId' | 'Manufacturer'
>

const DRIVER_FAMILY_METADATA_PATTERNS: Record<VerifiedDriverFamilyId, readonly RegExp[]> = {
  RONGTA_80MM: [/\b80Normal\b/i, /\bRong\s*Ta\b/i],
  XPRINTER_80MM: [/\bX[\s-]?printer\b/i, /芯烨/u, /\bXP[\s-]?N160II\b/i, /\bXP[\s-]?80\w*\b/i],
}

const KITCHEN_DETECTION_SOURCES: readonly KitchenNetworkDetectionSource[] = [
  'WINDOWS_STANDARD_TCPIP_PORT',
  'WINDOWS_NETWORK_NEIGHBOR',
  'LOCAL_IPV4_SUBNET_PROBE',
]

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

function kitchenDetectionSources(value: unknown): KitchenNetworkDetectionSource[] {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.filter(
    (source): source is KitchenNetworkDetectionSource =>
      typeof source === 'string' && KITCHEN_DETECTION_SOURCES.includes(source as KitchenNetworkDetectionSource),
  ))]
}

/**
 * Reduce raw Windows discovery evidence to reachable RAW 9100 endpoints only.
 * No queue/port configuration is created and no payload is sent to the endpoint.
 */
export function createKitchenNetworkPrinterCandidates(
  records: readonly WindowsKitchenEndpointEvidence[],
): KitchenNetworkPrinterCandidate[] {
  const candidates = new Map<string, KitchenNetworkPrinterCandidate>()
  for (const record of records) {
    const address = stringOrNull(record.Address)
    const port = Number(record.Port)
    if (!address || isIP(address) !== 4 || port !== 9100 || record.Raw9100Reachable !== true) continue
    const detectionSources = kitchenDetectionSources(record.DetectionSources)
    if (detectionSources.length === 0) continue
    const endpoint = `${address}:9100`
    const current = candidates.get(endpoint)
    if (current) {
      current.detectionSources = [...new Set([...current.detectionSources, ...detectionSources])]
      current.windowsPrinterPortAssociated ||= record.WindowsPrinterPortAssociated === true
      continue
    }
    candidates.set(endpoint, {
      endpoint,
      port: 9100,
      detectionSources,
      raw9100Reachable: true,
      windowsPrinterPortAssociated: record.WindowsPrinterPortAssociated === true,
    })
  }
  return [...candidates.values()].sort((left, right) => left.endpoint.localeCompare(right.endpoint, 'en-US'))
}

export class WindowsHardwareProvisioningSystem implements HardwareProvisioningPhase2System, FrontUsbQueueTargetProvider {
  private readonly runtimePlatform: NodeJS.Platform
  private readonly runtimeArchitecture: string
  private readonly run: CommandRunner
  private readonly resolvedFrontQueueTargets = new Map<string, ResolvedFrontUsbQueueTarget>()

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

  getResolvedFrontQueueTarget(candidateId: string): ResolvedFrontUsbQueueTarget | null {
    const target = this.resolvedFrontQueueTargets.get(candidateId)
    return target ? { ...target } : null
  }

  async inspectKitchenNetworkPrinters(): Promise<KitchenNetworkPrinterInspection> {
    this.requireWindows()
    const script = [
      "$ErrorActionPreference='Stop'",
      '$targetPort=9100',
      '$probeTimeoutMs=250',
      '$endpointMap=@{}',
      'function Add-Endpoint([string]$address,[string]$source,[bool]$windowsAssociated){$parsed=$null;if(-not [System.Net.IPAddress]::TryParse($address,[ref]$parsed)){return};if($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork){return};if($address -match \'^(127\\.|169\\.254\\.|0\\.|22[4-9]\\.|23[0-9]\\.|24[0-9]\\.|25[0-5]\\.)\'){return};if(-not $endpointMap.ContainsKey($address)){$endpointMap[$address]=[pscustomobject]@{Address=$address;Sources=@();WindowsPrinterPortAssociated=$false}};$entry=$endpointMap[$address];if($entry.Sources -notcontains $source){$entry.Sources+=@($source)};if($windowsAssociated){$entry.WindowsPrinterPortAssociated=$true}}',
      '$printers=@();try{$printers=@(Get-Printer -ErrorAction Stop)}catch{}',
      'foreach($printer in $printers){$port=$null;try{$port=Get-PrinterPort -Name ([string]$printer.PortName) -ErrorAction SilentlyContinue}catch{};if(-not $port){continue};$monitor=[string]$port.PortMonitor;if($monitor -notmatch \'Standard TCP/IP\'){continue};$address=[string]$port.PrinterHostAddress;if(-not $address){$address=[string]$printer.PortName};Add-Endpoint $address \'WINDOWS_STANDARD_TCPIP_PORT\' $true}',
      '$configs=@();try{$configs=@(Get-NetIPConfiguration -ErrorAction Stop | Where-Object {$_.NetAdapter.Status -eq \'Up\' -and $_.IPv4DefaultGateway})}catch{}',
      '$interfaceIndexes=@($configs | ForEach-Object {[int]$_.InterfaceIndex})',
      '$neighbors=@();try{$neighbors=@(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction Stop | Where-Object {$interfaceIndexes -contains [int]$_.InterfaceIndex -and $_.State -in @(\'Reachable\',\'Stale\',\'Delay\',\'Probe\',\'Permanent\')})}catch{}',
      'foreach($neighbor in $neighbors){Add-Endpoint ([string]$neighbor.IPAddress) \'WINDOWS_NETWORK_NEIGHBOR\' $false}',
      'foreach($config in $configs){foreach($local in @($config.IPv4Address)){$prefix=[int]$local.PrefixLength;$localAddress=[string]$local.IPAddress;if($prefix -lt 24 -or $prefix -gt 30 -or $localAddress -match \'^(127\\.|169\\.254\\.)\'){continue};$octets=$localAddress.Split(\'.\');if($octets.Count -ne 4){continue};$blockSize=[int][math]::Pow(2,(32-$prefix));$networkStart=[int]([math]::Floor(([int]$octets[3])/$blockSize)*$blockSize);for($last=$networkStart+1;$last -lt ($networkStart+$blockSize-1);$last++){$candidate=\"$($octets[0]).$($octets[1]).$($octets[2]).$last\";if($candidate -ne $localAddress){Add-Endpoint $candidate \'LOCAL_IPV4_SUBNET_PROBE\' $false}}}}',
      '$pending=@();foreach($entry in $endpointMap.GetEnumerator()){$client=$null;try{$client=[System.Net.Sockets.TcpClient]::new();$async=$client.BeginConnect([string]$entry.Key,$targetPort,$null,$null);$pending+=@([pscustomobject]@{Client=$client;Async=$async;Metadata=$entry.Value})}catch{if($client){$client.Dispose()}}}',
      '$result=@();foreach($probe in $pending){$reachable=$false;try{if($probe.Async.AsyncWaitHandle.WaitOne($probeTimeoutMs)){$probe.Client.EndConnect($probe.Async);$reachable=$probe.Client.Connected}}catch{}finally{$probe.Client.Dispose()};if($reachable){$result+=@([pscustomobject]@{Address=[string]$probe.Metadata.Address;Port=$targetPort;DetectionSources=@($probe.Metadata.Sources);Raw9100Reachable=$true;WindowsPrinterPortAssociated=[bool]$probe.Metadata.WindowsPrinterPortAssociated})}}',
      'ConvertTo-Json -InputObject @($result) -Compress',
    ].join(';')
    const value = parseJsonValue(await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], 45_000))
    const candidates = createKitchenNetworkPrinterCandidates(objectArray<WindowsKitchenEndpointEvidence>(value))
    return {
      candidates,
      roleResolution: candidates.length === 1
        ? 'AUTO_RESOLVED'
        : candidates.length > 1
          ? 'USER_CONFIRM_REQUIRED'
          : 'NOT_FOUND',
      selectedEndpoint: candidates.length === 1 ? candidates[0]!.endpoint : null,
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
    const records = objectArray<WindowsPrinterMetadata>(value)
    const candidates = createFrontUsbPrinterCandidates(records)
    this.resolvedFrontQueueTargets.clear()
    for (const record of records) {
      const candidate = createFrontUsbPrinterCandidates([record])[0]
      const driverName = stringOrNull(record.DriverName)
      const portName = stringOrNull(record.PortName)
      if (!candidate || !driverName || !portName || this.resolvedFrontQueueTargets.has(candidate.candidateId)) continue
      this.resolvedFrontQueueTargets.set(candidate.candidateId, {
        candidateId: candidate.candidateId,
        driverFamily: candidate.driverFamily,
        driverName,
        portName,
      })
    }
    return candidates
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
