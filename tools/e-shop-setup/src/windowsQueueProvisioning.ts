import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import {
  LOGICAL_QUEUE_NAMES,
  type QueueProvisioningInput,
  type QueueProvisioningInspection,
  type QueueProvisioningSystem,
} from './queueProvisioning'
import { resolveVerifiedDriverFamily } from './windowsHardwareProvisioning'
import type { ProvisionAction } from './softwareProvisioning'

const PROCESS_TIMEOUT_MS = 60_000
const KITCHEN_PORT_PREFIX = 'E-Shop-Kitchen-'
const KITCHEN_PORT_REPAIR_SLOTS = 10

type CommandRunner = (file: string, args: string[], timeout?: number) => Promise<string>

export type WindowsQueueProvisioningOptions = {
  runtimePlatform?: NodeJS.Platform
  runtimeArchitecture?: string
  run?: CommandRunner
}

type WindowsQueuePrinterMetadata = {
  Name?: string | null
  DriverName?: string | null
  PortName?: string | null
}

type WindowsQueuePortMetadata = {
  Name?: string | null
  PrinterHostAddress?: string | null
  PortNumber?: string | number | null
  Protocol?: string | number | null
}

type WindowsQueueSnapshot = {
  Printers?: WindowsQueuePrinterMetadata[] | WindowsQueuePrinterMetadata | null
  Ports?: WindowsQueuePortMetadata[] | WindowsQueuePortMetadata | null
  Drivers?: string[] | string | null
}

type QueueProvisioningPlan = {
  inspection: QueueProvisioningInspection
  frontDriverName: string | null
  frontPortName: string | null
  kitchenAddress: string | null
  kitchenPortName: string | null
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

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return values.map(stringOrNull).filter((entry): entry is string => entry !== null)
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

function parseKitchenEndpoint(endpoint: string): { address: string; port: 9100 } | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):9100$/.exec(endpoint)
  if (!match || isIP(match[1]!) !== 4) return null
  return { address: match[1]!, port: 9100 }
}

export function kitchenPortName(endpoint: string, repairSlot = 0): string {
  const digest = createHash('sha256').update(endpoint).digest('hex').slice(0, 16)
  return `${KITCHEN_PORT_PREFIX}${digest}${repairSlot > 0 ? `-r${repairSlot}` : ''}`
}

function portMatchesEndpoint(
  port: WindowsQueuePortMetadata,
  endpoint: { address: string; port: 9100 },
): boolean {
  const address = stringOrNull(port.PrinterHostAddress)
  const portNumber = Number(port.PortNumber)
  const protocol = stringOrNull(port.Protocol)?.toLocaleUpperCase('en-US')
  return address === endpoint.address && portNumber === 9100 && (protocol === '1' || protocol === 'RAW')
}

function queueName(record: WindowsQueuePrinterMetadata): string | null {
  return stringOrNull(record.Name)
}

function resolvePlan(input: QueueProvisioningInput, snapshot: WindowsQueueSnapshot): QueueProvisioningPlan {
  const printers = objectArray<WindowsQueuePrinterMetadata>(snapshot.Printers)
  const ports = objectArray<WindowsQueuePortMetadata>(snapshot.Ports)
  const installedDrivers = stringArray(snapshot.Drivers)
  const endpoint = parseKitchenEndpoint(input.kitchenEndpoint)
  const frontDriverName = stringOrNull(input.frontDriverName)
  const frontPortName = stringOrNull(input.frontPortName)
  const resolvedFamily = frontDriverName ? resolveVerifiedDriverFamily({ DriverName: frontDriverName }) : null
  const driverReady = Boolean(
    frontDriverName &&
    resolvedFamily === input.frontDriverFamily &&
    installedDrivers.some((driver) => driver.toLocaleLowerCase('en-US') === frontDriverName.toLocaleLowerCase('en-US')),
  )
  const frontQueue = printers.find((record) => queueName(record) === LOGICAL_QUEUE_NAMES.front) ?? null
  const kitchenQueue = printers.find((record) => queueName(record) === LOGICAL_QUEUE_NAMES.kitchen) ?? null

  const correctKitchenPort = endpoint
    ? ports.find((port) => portMatchesEndpoint(port, endpoint)) ?? null
    : null
  const existingPortNames = new Set(ports.map(({ Name }) => stringOrNull(Name)).filter((name): name is string => name !== null))
  let kitchenPortNameValue = stringOrNull(correctKitchenPort?.Name)
  if (!kitchenPortNameValue && endpoint) {
    for (let slot = 0; slot < KITCHEN_PORT_REPAIR_SLOTS; slot += 1) {
      const candidate = kitchenPortName(input.kitchenEndpoint, slot)
      if (!existingPortNames.has(candidate)) {
        kitchenPortNameValue = candidate
        break
      }
    }
  }

  const inputResolved = Boolean(frontDriverName && frontPortName && endpoint && resolvedFamily === input.frontDriverFamily)
  const frontMappingCorrect = Boolean(
    frontQueue &&
    frontDriverName &&
    frontPortName &&
    stringOrNull(frontQueue.DriverName) === frontDriverName &&
    stringOrNull(frontQueue.PortName) === frontPortName,
  )
  const kitchenPortReady = correctKitchenPort !== null
  const kitchenMappingCorrect = Boolean(
    kitchenQueue &&
    frontDriverName &&
    kitchenPortNameValue &&
    stringOrNull(kitchenQueue.DriverName) === frontDriverName &&
    stringOrNull(kitchenQueue.PortName) === kitchenPortNameValue &&
    kitchenPortReady,
  )
  const portProvisionable = Boolean(kitchenPortNameValue)
  const inspection: QueueProvisioningInspection = {
    ready: Boolean(
      inputResolved &&
      driverReady &&
      frontMappingCorrect &&
      kitchenMappingCorrect &&
      kitchenPortReady,
    ),
    inputResolved,
    driverReady,
    driverFamily: resolvedFamily,
    portProvisionable,
    front: {
      exists: frontQueue !== null,
      mappingCorrect: frontMappingCorrect,
    },
    kitchen: {
      exists: kitchenQueue !== null,
      mappingCorrect: kitchenMappingCorrect,
      portReady: kitchenPortReady,
    },
  }
  return {
    inspection,
    frontDriverName,
    frontPortName,
    kitchenAddress: endpoint?.address ?? null,
    kitchenPortName: kitchenPortNameValue,
  }
}

export class WindowsQueueProvisioningSystem implements QueueProvisioningSystem {
  private readonly runtimePlatform: NodeJS.Platform
  private readonly runtimeArchitecture: string
  private readonly run: CommandRunner

  constructor(options: WindowsQueueProvisioningOptions = {}) {
    this.runtimePlatform = options.runtimePlatform ?? process.platform
    this.runtimeArchitecture = options.runtimeArchitecture ?? process.arch
    this.run = options.run ?? runExecutable
  }

  async inspectQueues(input: QueueProvisioningInput): Promise<QueueProvisioningInspection> {
    this.requireWindows()
    return resolvePlan(input, await this.readSnapshot()).inspection
  }

  async provisionQueues(input: QueueProvisioningInput): Promise<ProvisionAction> {
    this.requireWindows()
    const plan = resolvePlan(input, await this.readSnapshot())
    if (plan.inspection.ready) return { changed: false, verified: true }
    if (
      !plan.inspection.inputResolved ||
      !plan.inspection.driverReady ||
      !plan.inspection.portProvisionable ||
      !plan.frontDriverName ||
      !plan.frontPortName ||
      !plan.kitchenAddress ||
      !plan.kitchenPortName
    ) {
      throw new Error('Queue provisioning prerequisites are not ready')
    }

    const frontQueue = escapePowerShell(LOGICAL_QUEUE_NAMES.front)
    const kitchenQueue = escapePowerShell(LOGICAL_QUEUE_NAMES.kitchen)
    const driver = escapePowerShell(plan.frontDriverName)
    const frontPort = escapePowerShell(plan.frontPortName)
    const kitchenPort = escapePowerShell(plan.kitchenPortName)
    const kitchenAddress = escapePowerShell(plan.kitchenAddress)
    const script = [
      "$ErrorActionPreference='Stop'",
      "$queueProvisioningSchema='eshop.queue.provisioning.v1'",
      `$frontQueue='${frontQueue}'`,
      `$kitchenQueue='${kitchenQueue}'`,
      `$driver='${driver}'`,
      `$frontPort='${frontPort}'`,
      `$kitchenPort='${kitchenPort}'`,
      `$kitchenAddress='${kitchenAddress}'`,
      '$port=Get-PrinterPort -Name $kitchenPort -ErrorAction SilentlyContinue',
      'if(-not $port){Add-PrinterPort -Name $kitchenPort -PrinterHostAddress $kitchenAddress -PortNumber 9100;$port=Get-PrinterPort -Name $kitchenPort -ErrorAction Stop}',
      'if(([string]$port.PrinterHostAddress -ne $kitchenAddress) -or ([int]$port.PortNumber -ne 9100) -or ([string]$port.Protocol -notin @(\'1\',\'RAW\'))){throw \'Kitchen RAW 9100 port verification failed\'}',
      '$front=Get-Printer -Name $frontQueue -ErrorAction SilentlyContinue',
      'if(-not $front){Add-Printer -Name $frontQueue -DriverName $driver -PortName $frontPort}else{if(([string]$front.DriverName -ne $driver) -or ([string]$front.PortName -ne $frontPort)){Set-Printer -Name $frontQueue -DriverName $driver -PortName $frontPort}}',
      '$kitchen=Get-Printer -Name $kitchenQueue -ErrorAction SilentlyContinue',
      'if(-not $kitchen){Add-Printer -Name $kitchenQueue -DriverName $driver -PortName $kitchenPort}else{if(([string]$kitchen.DriverName -ne $driver) -or ([string]$kitchen.PortName -ne $kitchenPort)){Set-Printer -Name $kitchenQueue -DriverName $driver -PortName $kitchenPort}}',
    ].join(';')
    await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], PROCESS_TIMEOUT_MS)
    return { changed: true, verified: true }
  }

  private async readSnapshot(): Promise<WindowsQueueSnapshot> {
    const frontQueue = escapePowerShell(LOGICAL_QUEUE_NAMES.front)
    const kitchenQueue = escapePowerShell(LOGICAL_QUEUE_NAMES.kitchen)
    const script = [
      "$ErrorActionPreference='Stop'",
      "$queueInspectionSchema='eshop.queue.inspection.v1'",
      `$frontQueue='${frontQueue}'`,
      `$kitchenQueue='${kitchenQueue}'`,
      '$printerRecords=@();foreach($queueName in @($frontQueue,$kitchenQueue)){$printer=Get-Printer -Name $queueName -ErrorAction SilentlyContinue;if($printer){$printerRecords+=@([pscustomobject]@{Name=[string]$printer.Name;DriverName=[string]$printer.DriverName;PortName=[string]$printer.PortName})}}',
      '$portRecords=@(Get-PrinterPort -ErrorAction Stop | ForEach-Object {[pscustomobject]@{Name=[string]$_.Name;PrinterHostAddress=[string]$_.PrinterHostAddress;PortNumber=[string]$_.PortNumber;Protocol=[string]$_.Protocol}})',
      '$drivers=@(Get-PrinterDriver -ErrorAction Stop | ForEach-Object {[string]$_.Name})',
      '[pscustomobject]@{Printers=@($printerRecords);Ports=@($portRecords);Drivers=@($drivers)} | ConvertTo-Json -Depth 5 -Compress',
    ].join(';')
    return (parseJsonValue(await this.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], 30_000)) ?? {}) as WindowsQueueSnapshot
  }

  private requireWindows(): void {
    if (this.runtimePlatform !== 'win32' || this.runtimeArchitecture !== 'x64') {
      throw new Error('Windows x64 is required')
    }
  }
}
